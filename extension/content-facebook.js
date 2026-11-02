/* HerbiSight for Facebook — filters posts labeled as AI content in the feed.
 * Detects AI disclosure badges in-memory, resolves enclosing feed cards
 * without relying on localized text, and collapses or dims them via CSS.
 */
(() => {
  'use strict';
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B?.storage) return;

  const { DEFAULTS, AI_LABEL_RE, normalizeSettings } = globalThis.HerbiSight;
  const FORBIDDEN_TAGS = new Set(['HTML', 'BODY', 'MAIN', 'NAV', 'HEADER']);

  const COMMENT_SEL = [
    '[data-sigil*="comment"]',
    '[data-sigil*="reply"]',
    '[data-sigil*="ufi"]',
    '[data-commentid]',
    '[data-testid*="comment" i]',
    '[data-testid*="UFI" i]',
    '[data-testid*="feedback" i]',
    '[data-ad-rendering-role="comment"]',
    'div[data-pagelet*="Comment" i]',
    'div[data-pagelet*="comment" i]',
    'div[data-pagelet*="UFI" i]',
    'div[data-pagelet*="ufi" i]',
    'div[data-pagelet*="Feedback" i]',
    'div[data-pagelet*="feedback" i]',
    'form[action*="comment"]',
    'form[action*="reply"]',
    'ul[role="group"]',
    'ul[class*="comment" i]',
    '[role="article"] [role="article"]',
    'div[role="region"][aria-label*="Comment" i]',
    'div[role="region"][aria-label*="comment" i]',
    'div[role="region"][aria-label*="Komentarz" i]',
    'div[role="region"][aria-label*="komentarz" i]'
  ].join(',');

  const COMMENT_ARIA_RE = /(^|[\s\b\x27\u2019\-])(comment|reply|replies|komentar|odpowied|comentario|respuesta|commentaire|r[eé]ponse|kommentar|antwort|commento|risposta|reactie|комментар|коментар|ответ|відповідь|yorum|yanıt|تعليق|رد|コメント|評論|评论|댓글)/i;

  const isCommentOrInsideComment = (el) => {
    if (!el || el.nodeType !== 1) return false;

    if (el.matches?.(COMMENT_SEL) || el.closest?.(COMMENT_SEL)) return true;
    if (el.closest?.('form, [role="textbox"], [contenteditable="true"]')) return true;
    if (el.closest?.('ul, ol')) return true;

    let curr = el;
    while (curr && curr !== document.body) {
      const sigil = curr.getAttribute?.('data-sigil');
      if (sigil && /comment|reply/i.test(sigil)) return true;

      const testid = curr.getAttribute?.('data-testid');
      if (testid && /comment|ufi|feedback/i.test(testid)) return true;

      const aria = curr.getAttribute?.('aria-label');
      if (aria && COMMENT_ARIA_RE.test(aria)) {
        const role = curr.getAttribute?.('role');
        if (role !== 'main' && role !== 'feed') return true;
      }

      if (
        curr.hasAttribute?.('data-virtualized') ||
        curr.hasAttribute?.('data-dcm-id') ||
        curr.hasAttribute?.('data-tracking-duration-id') ||
        curr.getAttribute?.('role') === 'feed'
      ) {
        break;
      }

      curr = curr.parentElement;
    }

    return false;
  };

  let settings = { ...DEFAULTS };
  let storageReady = false;
  let scanScheduled = false;
  let saveTimer = null;
  let newPulls = 0;
  let lastHref = location.href;

  const flaggedContainers = new Set();

  const applyRootAttrs = () => {
    const de = document.documentElement;
    if (!de) return;
    const isEnabled = settings.facebookMode !== 'allow';
    if (isEnabled) de.setAttribute('data-aib-on', '');
    else de.removeAttribute('data-aib-on');
    de.setAttribute('data-aib-mode', settings.facebookMode === 'block' ? 'hide' : 'dim');
  };

  const loadStorage = async () => {
    try {
      const got = await B.storage.local.get('settings');
      if (got.settings && typeof got.settings === 'object') {
        settings = normalizeSettings(got.settings);
      }
    } catch { /* first run */ }
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
        } catch { /* ignore */ }
      }
    }, 2500);
  };

  const isSafePostContainer = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (FORBIDDEN_TAGS.has(el.tagName)) return false;
    const role = el.getAttribute ? el.getAttribute('role') : null;
    if (role === 'main' || role === 'feed' || role === 'navigation') return false;
    if (el.id && el.id.startsWith('mount_0_0_')) return false;
    if (isCommentOrInsideComment(el)) return false;
    return el.tagName === 'DIV' || el.tagName === 'ARTICLE';
  };

  const findPostContainer = (el) => {
    if (!el || isCommentOrInsideComment(el)) return null;

    const mobileCard = el.closest('div[data-dcm-id], div[data-tracking-duration-id]');
    if (mobileCard && isSafePostContainer(mobileCard)) return mobileCard;

    const virtCard = el.closest('div[data-virtualized="false"]');
    if (virtCard && isSafePostContainer(virtCard)) return virtCard;

    const posCard = el.closest('div[aria-posinset]');
    if (posCard && isSafePostContainer(posCard)) return posCard;

    let article = el.closest('div[role="article"], article');
    while (article && isCommentOrInsideComment(article)) {
      article = article.parentElement?.closest('div[role="article"], article');
    }
    if (article && isSafePostContainer(article)) return article;

    const pagelet = el.closest('div[data-pagelet*="FeedUnit"]');
    if (pagelet && isSafePostContainer(pagelet)) return pagelet;

    // Fallback: walk up to container enclosing post actions (toolbar, reactions, comment form)
    let curr = el;
    let bestCard = null;
    while (curr && curr.parentElement && curr.parentElement !== document.body) {
      const role = curr.getAttribute?.('role');
      if (role === 'main' || role === 'feed' || role === 'navigation') break;
      if (curr.id && curr.id.startsWith('mount_0_0_')) break;

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

  const mark = (container, flagged) => {
    if (!container || !container.isConnected) return;
    if (flagged) {
      if (!isSafePostContainer(container) || isCommentOrInsideComment(container)) return;
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

  const inspectElement = (el) => {
    if (!el || !el.isConnected) return;
    if (isCommentOrInsideComment(el)) return;

    // AI badges are compact pill elements, not container wrappers
    if (el.children.length > 5) return;

    const rawText = el.textContent || '';
    const ariaText = el.getAttribute('aria-label') || '';
    // Strip zero-width, bidirectional (LRM/RLM), and format control characters
    const clean = (rawText + ' ' + ariaText)
      .replace(/[\u200B-\u200F\uFEFF\u034F\u202A-\u202E]/gu, '')
      .trim();
    if (!clean || clean.length > 60) return;

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

    const badMarked = document.querySelectorAll('[data-aib]');
    for (const el of badMarked) {
      if (isCommentOrInsideComment(el)) {
        mark(el, false);
      }
    }

    const elements = document.querySelectorAll(CANDIDATE_SEL);
    for (const el of elements) {
      if (isCommentOrInsideComment(el)) continue;
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

  try {
    B.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'aib:stats') {
        for (const el of flaggedContainers) {
          if (!el.isConnected || isCommentOrInsideComment(el)) {
            if (el.isConnected) mark(el, false);
            flaggedContainers.delete(el);
          }
        }
        let totalFeedItems = 0;
        const candidates = document.querySelectorAll(
          'div[data-virtualized="false"], div[aria-posinset], div[role="article"], div[data-pagelet*="FeedUnit"], div[data-dcm-id], div[data-tracking-duration-id]'
        );
        for (const c of candidates) {
          if (isSafePostContainer(c)) totalFeedItems++;
        }
        sendResponse({
          platform: 'facebook',
          sessionPulled: flaggedContainers.size,
          entriesChecked: Math.max(totalFeedItems, flaggedContainers.size),
          flaggedCount: flaggedContainers.size
        });
      }
    });
  } catch { /* messaging unavailable; popup shows dashes */ }

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
  } catch { /* ignore */ }

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

  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      scheduleScan();
    }
  }, 1500);
})();
