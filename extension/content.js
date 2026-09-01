/* Weedout for YouTube — silently filters videos YouTube labels as "Made with AI".
 *
 * How it works:
 *   YouTube only ships the AI-disclosure badge in *watch-page* data
 *   (videoPrimaryInfoRenderer.badges → metadataBadgeRenderer{icon:INFO, label:"AI"}).
 *   Feed/search/related list renderers carry no badge data at all, so for every
 *   video that shows up in a list we make one tiny lookup against YouTube's own
 *   InnerTube `next` endpoint with a `fields` mask (~0.4–1 KB per video, same
 *   origin, no API key needed), cache the verdict in browser.storage.local, and
 *   collapse flagged items via CSS. Works for regular videos and Shorts alike.
 */
(() => {
  'use strict';
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B?.storage) return;

  // ------------------------------------------------------------------ config
  const CONTAINERS = [
    'ytd-rich-item-renderer',            // home / subscriptions / channel grid
    'ytd-video-renderer',                // search results, history
    'ytd-compact-video-renderer',        // legacy related sidebar
    'ytd-grid-video-renderer',           // legacy channel grid
    'ytd-playlist-video-renderer',       // playlist page
    'ytd-playlist-panel-video-renderer', // queue / playlist panel on watch
    'ytd-reel-item-renderer',            // legacy Shorts shelf
    'yt-lockup-view-model',              // new related sidebar, grid lockups
    'ytm-shorts-lockup-view-model',      // Shorts shelves
    'ytm-shorts-lockup-view-model-v2',
    'ytm-video-with-context-renderer',   // m.youtube.com
    'ytm-compact-video-renderer',
    'ytm-rich-item-renderer'
  ];
  const CONTAINER_SEL = CONTAINERS.join(',');
  const FIELDS =
    'contents.twoColumnWatchNextResults.results.results.contents.videoPrimaryInfoRenderer.badges';
  const CONCURRENCY = 4;
  const CLEAN_TTL_DAYS = 30;    // re-check "clean" verdicts after this many days
  const FLAGGED_TTL_DAYS = 180; // re-check "AI" verdicts after this many days
  const CACHE_MAX = 30000;
  const DEFAULTS = { enabled: true, mode: 'hide', skipShorts: true };

  // AI-badge test, locale-independent first (icon), label text as backup.
  const AI_LABEL_RE = /(^|\s)(AI|IA|KI|ИИ)(:|\s|$)|made with AI|synthetic|altered|generat|sztuczn|künstlich|generiert|génér|sintéti|sintetiz|yapay|生成|생성|人工知能/i;

  // ------------------------------------------------------------------- state
  let settings = { ...DEFAULTS };
  let cache = Object.create(null); // videoId -> [flag(0|1), dayStamp]
  let storageReady = false;
  const elsById = new Map();       // videoId -> Set<Element> seen on this page
  const hiddenIds = new Set();     // unique flagged ids encountered this tab session
  const queued = new Set();
  const failed = new Map();        // videoId -> attempts (give up after 2)
  const queue = [];
  let running = 0;
  let backoffUntil = 0;
  let clientVersion = null;
  let scanScheduled = false;
  let saveTimer = null;
  let newPulls = 0;                // not-yet-persisted increment of the lifetime counter
  let lastShortsSkip = { id: null, t: 0 };
  let lastHref = location.href;

  const today = () => Math.floor(Date.now() / 86400000);

  // -------------------------------------------------------------- root attrs
  const applyRootAttrs = () => {
    const de = document.documentElement;
    if (!de) return;
    if (settings.enabled) de.setAttribute('data-aib-on', '');
    else de.removeAttribute('data-aib-on');
    de.setAttribute('data-aib-mode', settings.mode === 'dim' ? 'dim' : 'hide');
  };

  // ----------------------------------------------------------------- storage
  const loadStorage = async () => {
    try {
      const got = await B.storage.local.get(['settings', 'cache_v1']);
      if (got.settings && typeof got.settings === 'object') {
        settings = { ...DEFAULTS, ...got.settings };
      }
      if (got.cache_v1 && typeof got.cache_v1 === 'object') cache = got.cache_v1;
    } catch (e) { /* first run */ }
    storageReady = true;
    applyRootAttrs();
    onNavigate(); // also schedules a scan; covers the initial page before any yt-navigate-finish
  };

  const pruneCache = () => {
    const ids = Object.keys(cache);
    if (ids.length <= CACHE_MAX) return;
    ids.sort((a, b) => (cache[a][1] || 0) - (cache[b][1] || 0)); // oldest first
    const drop = ids.length - Math.floor(CACHE_MAX * 0.8);
    for (let i = 0; i < drop; i++) delete cache[ids[i]];
  };

  const scheduleSave = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      pruneCache();
      try {
        await B.storage.local.set({ cache_v1: cache });
        if (newPulls > 0) {
          const n = newPulls; newPulls = 0;
          const got = await B.storage.local.get('totalPulled');
          await B.storage.local.set({ totalPulled: (got.totalPulled || 0) + n });
        }
      } catch (e) { /* storage full or gone; try again next time */ }
    }, 2500);
  };

  // ------------------------------------------------------------ id extraction
  const idFromHref = (h) => {
    if (!h) return null;
    let m = h.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    m = h.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  };

  const idOf = (el) => {
    const a = el.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
    return a ? idFromHref(a.getAttribute('href')) : null;
  };

  // ------------------------------------------------------------------ marking
  const mark = (el, flagged) => {
    if (flagged) el.setAttribute('data-aib', '');
    else el.removeAttribute('data-aib');
  };

  const applyVerdict = (id, flagged) => {
    const set = elsById.get(id);
    if (set) {
      for (const el of set) {
        if (el.isConnected) mark(el, flagged);
        else set.delete(el);
      }
      if (flagged && set.size > 0 && !hiddenIds.has(id)) {
        hiddenIds.add(id);
        newPulls++;
        scheduleSave();
      }
    }
  };

  const setVerdict = (id, flagged) => {
    cache[id] = [flagged ? 1 : 0, today()];
    scheduleSave();
    applyVerdict(id, flagged);
  };

  // ------------------------------------------------------------------ lookups
  const scrapeClientVersion = () => {
    if (clientVersion) return clientVersion;
    try {
      for (const s of document.scripts) {
        const m = (s.textContent || '').match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/);
        if (m) { clientVersion = m[1]; break; }
      }
    } catch (e) { /* ignore */ }
    if (!clientVersion) clientVersion = '2.20250601.01.00'; // fallback; InnerTube accepts older versions
    return clientVersion;
  };

  const isAIResponse = (json) => {
    const cs = json?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
    if (!Array.isArray(cs)) return false;
    for (const c of cs) {
      const badges = c?.videoPrimaryInfoRenderer?.badges;
      if (!Array.isArray(badges)) continue;
      for (const b of badges) {
        const mb = b?.metadataBadgeRenderer;
        if (!mb) continue;
        const label = (mb.label || '') + ' ' + (mb.accessibilityData?.label || '');
        if (mb.icon?.iconType === 'INFO') return true;
        if (AI_LABEL_RE.test(label)) return true;
      }
    }
    return false;
  };

  const fetchVerdict = async (id, useFields = true) => {
    const url = '/youtubei/v1/next?prettyPrint=false' +
      (useFields ? '&fields=' + encodeURIComponent(FIELDS) : '');
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: scrapeClientVersion() } },
        videoId: id
      })
    });
    if (r.status === 400 && useFields) return fetchVerdict(id, false); // mask rejected → full response works too
    if (!r.ok) { const e = new Error('http ' + r.status); e.status = r.status; throw e; }
    return isAIResponse(await r.json());
  };

  const pump = () => {
    if (!settings.enabled) return;
    const now = Date.now();
    if (now < backoffUntil) {
      setTimeout(pump, backoffUntil - now + 50);
      return;
    }
    while (running < CONCURRENCY && queue.length > 0) {
      const id = queue.shift();
      queued.delete(id);
      running++;
      fetchVerdict(id)
        .then((flagged) => setVerdict(id, flagged))
        .catch((e) => {
          const attempts = (failed.get(id) || 0) + 1;
          failed.set(id, attempts);
          if (e.status === 429 || e.status >= 500) backoffUntil = Date.now() + 30000;
          if (attempts < 2 && !queued.has(id)) { queued.add(id); queue.push(id); }
        })
        .finally(() => { running--; pump(); });
    }
  };

  const enqueue = (id) => {
    if (queued.has(id) || (failed.get(id) || 0) >= 2) return;
    queued.add(id);
    queue.push(id);
    pump();
  };

  // ------------------------------------------------------------------- verdict
  // Returns 0/1 if known (and possibly schedules a background re-check), null if unknown.
  const cachedVerdict = (id) => {
    const entry = cache[id];
    if (!entry) return null;
    const [flag, ts] = entry;
    const age = today() - (ts || 0);
    if (age > (flag ? FLAGGED_TTL_DAYS : CLEAN_TTL_DAYS)) enqueue(id); // stale → re-check, keep old verdict meanwhile
    return flag;
  };

  // -------------------------------------------------------------------- scan
  const processElement = (el) => {
    const id = idOf(el);
    if (el.__aibId && el.__aibId !== id) {
      // recycled component now shows a different video
      const old = elsById.get(el.__aibId);
      if (old) old.delete(el);
      mark(el, false);
      el.__aibId = null;
    }
    if (!id) return;
    el.__aibId = id;
    let set = elsById.get(id);
    if (!set) { set = new Set(); elsById.set(id, set); }
    set.add(el);
    const v = cachedVerdict(id);
    if (v === null) enqueue(id);
    else mark(el, v === 1);
  };

  const scan = () => {
    if (!storageReady || !settings.enabled || !document.body) return;
    for (const el of document.querySelectorAll(CONTAINER_SEL)) processElement(el);
  };

  const scheduleScan = () => {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => { scanScheduled = false; scan(); }, 250);
  };

  // -------------------------------------------------------------- navigation
  const currentWatchId = () => {
    if (location.pathname === '/watch') {
      return idFromHref(location.search);
    }
    const m = location.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  };

  const maybeSkipShort = (id) => {
    if (!settings.enabled || !settings.skipShorts) return;
    const now = Date.now();
    if (lastShortsSkip.id === id && now - lastShortsSkip.t < 2500) return;
    lastShortsSkip = { id, t: now };
    // stable, non-localized hook: the down-navigation button of the Shorts player
    const btn = document.querySelector('#navigation-button-down button, [id="navigation-button-down"] yt-button-shape button');
    if (btn) btn.click();
  };

  const onNavigate = () => {
    if (!storageReady) return;
    clientVersion = null; // page scripts may have been replaced; re-scrape lazily
    const id = currentWatchId();
    if (id && settings.enabled) {
      // Warm the cache for the video being watched; if it's a flagged Short, skip it.
      const v = cachedVerdict(id);
      const isShort = location.pathname.startsWith('/shorts/');
      if (v === 1) {
        if (isShort) maybeSkipShort(id);
      } else if (v === null) {
        fetchVerdict(id)
          .then((flagged) => {
            setVerdict(id, flagged);
            if (flagged && isShort && currentWatchId() === id) maybeSkipShort(id);
          })
          .catch(() => { /* leave unknown */ });
      }
    }
    scheduleScan();
  };

  // ------------------------------------------------------------------ popup IPC
  try {
    B.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'aib:stats') {
        let flaggedCount = 0;
        for (const id in cache) if (cache[id][0]) flaggedCount++;
        sendResponse({
          sessionPulled: hiddenIds.size,
          cacheCount: Object.keys(cache).length,
          flaggedCount
        });
      }
    });
  } catch (e) { /* messaging unavailable; popup shows dashes */ }

  // --------------------------------------------------------- storage changes
  try {
    B.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.settings) {
        const wasEnabled = settings.enabled;
        settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
        applyRootAttrs();
        if (settings.enabled && !wasEnabled) scheduleScan();
      }
      if (changes.cache_v1 && changes.cache_v1.newValue &&
          Object.keys(changes.cache_v1.newValue).length === 0 &&
          Object.keys(cache).length > 0) {
        // cache cleared from the popup
        cache = Object.create(null);
        hiddenIds.clear();
        failed.clear();
        for (const set of elsById.values()) for (const el of set) mark(el, false);
        scheduleScan();
      }
    });
  } catch (e) { /* ignore */ }

  // -------------------------------------------------------------------- boot
  applyRootAttrs(); // defaults immediately, real settings right after storage read
  loadStorage();

  const observer = new MutationObserver(scheduleScan);
  const startObserver = () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    onNavigate();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }

  // YouTube SPA navigation + safety-net polling (href watcher covers Shorts swipes)
  document.addEventListener('yt-navigate-finish', onNavigate);
  document.addEventListener('yt-page-data-updated', scheduleScan);
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onNavigate();
    }
    scheduleScan();
  }, 1500);
})();
