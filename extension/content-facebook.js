/* HerbiSight for Facebook — filters posts labeled as AI content in the feed.
 *
 * How it works:
 *   Facebook renders AI disclosure labels directly on feed cards as interactive
 *   role="button" elements (e.g. "AI content", "AI info", "Made with AI", localized variants).
 *   We detect matching buttons in-memory, resolve the enclosing whole post card
 *   (via data-virtualized, aria-posinset, role=article, or bottom action bar ancestors),
 *   and collapse or dim it via CSS.
 */
(() => {
  'use strict';
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B?.storage) return;

  const { DEFAULTS, AI_LABEL_RE, normalizeSettings } = globalThis.HerbiSight;
  const FORBIDDEN_TAGS = new Set(['HTML', 'BODY', 'MAIN', 'NAV', 'HEADER']);

  // ------------------------------------------------------------------- state
  let settings = { ...DEFAULTS };
  let storageReady = false;
  let scanScheduled = false;
  let saveTimer = null;
  let newPulls = 0;
  let lastHref = location.href;

  const flaggedContainers = new Set();

  // -------------------------------------------------------------- root attrs
  const applyRootAttrs = () => {
    const de = document.documentElement;
    if (!de) return;
    const isEnabled = settings.facebookMode !== 'allow';
    if (isEnabled) de.setAttribute('data-aib-on', '');
    else de.removeAttribute('data-aib-on');
    de.setAttribute('data-aib-mode', settings.facebookMode === 'block' ? 'hide' : 'dim');
  };

  // ----------------------------------------------------------------- storage
  const loadStorage = async () => {
    try {
      const got = await B.storage.local.get('settings');
      if (got.settings && typeof got.settings === 'object') {
        settings = normalizeSettings(got.settings);
      }
    } catch (e) { /* first run */ }
    storageReady = true;
    applyRootAttrs();
    console.log('[HerbiSight] Facebook filtering mode:', settings.facebookMode);
    scheduleScan();
  };

  const scheduleSave = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      if (newPulls > 0) {
        const n = newPulls;
        newPulls = 0;
        try {
          const got = await B.storage.local.get('totalPulled');
          await B.storage.local.set({ totalPulled: (got.totalPulled || 0) + n });
        } catch (e) { /* ignore */ }
      }
    }, 2500);
  };

  // -------------------------------------------------------- container lookup
  const isSafePostContainer = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (FORBIDDEN_TAGS.has(el.tagName)) return false;
    const role = el.getAttribute ? el.getAttribute('role') : null;
    if (role === 'main' || role === 'feed' || role === 'navigation') return false;
    if (el.id && el.id.startsWith('mount_0_0_')) return false;
    return el.tagName === 'DIV' || el.tagName === 'ARTICLE';
  };

  const findPostContainer = (el) => {
    // 1. Modern Facebook mobile feed card container (WebLite / DCM delivery content module)
    const mobileCard = el.closest('div[data-dcm-id], div[data-tracking-duration-id]');
    if (mobileCard && isSafePostContainer(mobileCard)) return mobileCard;

    // 2. Modern Facebook virtualized feed card container (language-agnostic React attribute)
    const virtCard = el.closest('div[data-virtualized="false"]');
    if (virtCard && isSafePostContainer(virtCard)) return virtCard;

    // 3. Feed item container with ARIA set position (language-agnostic W3C attribute)
    const posCard = el.closest('div[aria-posinset]');
    if (posCard && isSafePostContainer(posCard)) return posCard;

    // 4. Semantic ARIA article (standard feed posts)
    const article = el.closest('div[role="article"], article');
    if (article && isSafePostContainer(article)) return article;

    // 5. Feed unit pagelet wrapper
    const pagelet = el.closest('div[data-pagelet*="FeedUnit"]');
    if (pagelet && isSafePostContainer(pagelet)) return pagelet;

    // 6. Language-agnostic fallback: walk up to container enclosing bottom action elements
    let curr = el;
    let bestCard = null;
    while (curr && curr.parentElement && curr.parentElement !== document.body) {
      const role = curr.getAttribute?.('role');
      if (role === 'main' || role === 'feed' || role === 'navigation') break;
      if (curr.id && curr.id.startsWith('mount_0_0_')) break;

      // Check for bottom action bar indicators without relying on localized text:
      // - data-ad-rendering-role (internal React ad/feed prop)
      // - role="toolbar" (reactions / bottom action bar)
      // - bottom comment/share forms
      // - mobile reactions/actions (data-long-click-action-id, data-comp-id)
      if (
        curr.querySelector?.(
          '[data-ad-rendering-role*="button"], [role="toolbar"], form[action*="comment"], [data-long-click-action-id], [data-comp-id]'
        )
      ) {
        bestCard = curr;
        const parentActions = curr.parentElement.querySelectorAll?.(
          '[data-ad-rendering-role*="button"], [role="toolbar"], [data-long-click-action-id], [data-comp-id]'
        );
        if (parentActions && parentActions.length > 1) {
          break;
        }
      }
      curr = curr.parentElement;
    }
    if (bestCard && isSafePostContainer(bestCard)) return bestCard;

    return null;
  };

  // ------------------------------------------------------------------ marking
  const mark = (container, flagged) => {
    if (!container || !container.isConnected || !isSafePostContainer(container)) return;
    if (flagged) {
      if (!container.hasAttribute('data-aib')) {
        container.setAttribute('data-aib', '');
        console.log('[HerbiSight] Whole post flagged and dimmed/hidden:', container);
      }
      if (!flaggedContainers.has(container)) {
        flaggedContainers.add(container);
        newPulls++;
        scheduleSave();
      }
    } else {
      container.removeAttribute('data-aib');
      flaggedContainers.delete(container);
    }
  };

  // -------------------------------------------------------------------- scan
  const inspectElement = (el) => {
    if (!el || !el.isConnected) return;

    // AI badges are compact pill elements, not layout wrappers
    if (el.children.length > 5) return;

    const rawText = el.textContent || '';
    const ariaText = el.getAttribute('aria-label') || '';
    // Strip zero-width, bidirectional (LRM/RLM), and format control characters
    const clean = (rawText + ' ' + ariaText)
      .replace(/[\u200B-\u200F\uFEFF\u034F\u202A-\u202E]/gu, '')
      .trim();
    if (!clean || clean.length > 60) return;

    // Ignore Meta's sidebar chatbot / search entry
    if (/^\s*meta\s+ai\s*$/i.test(clean)) return;
    if (/^\s*ask\s+meta\s+ai/i.test(clean)) return;

    if (AI_LABEL_RE.test(clean)) {
      console.log('[HerbiSight] Matched AI element text:', clean);
      const container = findPostContainer(el);
      if (container) {
        mark(container, true);
      } else {
        console.warn('[HerbiSight] AI element found but could not resolve post container:', el);
      }
    }
  };

  const CANDIDATE_SEL = '[role="button"], [role="link"], [data-focusable="true"]';

  const scan = () => {
    if (!storageReady || settings.facebookMode === 'allow' || !document.body) return;

    // Query interactive buttons, links, and focusable elements across desktop & mobile
    const elements = document.querySelectorAll(CANDIDATE_SEL);
    for (const el of elements) {
      inspectElement(el);
    }
  };

  const scheduleScan = () => {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      scan();
    }, 150);
  };

  // ------------------------------------------------------------------ popup IPC
  try {
    B.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'aib:stats') {
        for (const el of flaggedContainers) {
          if (!el.isConnected) flaggedContainers.delete(el);
        }
        const totalFeedItems = document.querySelectorAll(
          'div[data-virtualized="false"], div[aria-posinset], div[role="article"], div[data-pagelet*="FeedUnit"], div[data-dcm-id], div[data-tracking-duration-id]'
        ).length;
        sendResponse({
          platform: 'facebook',
          sessionPulled: flaggedContainers.size,
          entriesChecked: Math.max(totalFeedItems, flaggedContainers.size),
          flaggedCount: flaggedContainers.size
        });
      }
    });
  } catch (e) { /* messaging unavailable; popup shows dashes */ }

  // --------------------------------------------------------- storage changes
  try {
    B.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.settings) {
        settings = normalizeSettings(changes.settings.newValue);
        applyRootAttrs();
        console.log('[HerbiSight] Settings changed. New Facebook mode:', settings.facebookMode);
        if (settings.facebookMode !== 'allow') scheduleScan();
      }
    });
  } catch (e) { /* ignore */ }

  // -------------------------------------------------------------------- boot
  applyRootAttrs();
  loadStorage();

  const observer = new MutationObserver(scheduleScan);
  const startObserver = () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleScan();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }

  // SPA navigation watcher
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      scheduleScan();
    }
  }, 1500);
})();
