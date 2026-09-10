/* HerbiSight — Shared configuration, constants, and settings helpers. */
(() => {
  'use strict';

  const DEFAULTS = {
    youtubeMode: 'dim',
    facebookMode: 'dim',
    skipShorts: true
  };

  // Comprehensive multilingual AI-badge test covering:
  // - Acronyms: AI, IA, KI, SI, ИИ with optional dots, hyphens (KI-Info), apostrophes (l'IA), or CJK characters (AI情報)
  // - Keyword roots across EN, PL, DE, FR, ES, IT, PT, NL, CZ, TR, UK, RU, AR, JA, ZH, KO
  const AI_LABEL_RE = /(^|[\s\b\x27\u2019\-])(A\.?I\.?|I\.?A\.?|K\.?I\.?|S\.?I\.?|ИИ)([:\s\b\x27\u2019\-\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]|$)|made with AI|synthetic|altered|generat|sztuczn|inteligencj|künstlich|generiert|génér|artificiel|sintéti|sintetiz|yapay|uměl|kunstmatig|штучн|сгенерир|искусствен|الذكاء|生成|생성|人工知能/i;

  const normalizeSettings = (s) => {
    if (!s || typeof s !== 'object') return { ...DEFAULTS };
    let youtubeMode = s.youtubeMode;
    if (!youtubeMode) {
      if (s.enabled === false) youtubeMode = 'allow';
      else if (s.mode === 'hide') youtubeMode = 'block';
      else youtubeMode = 'dim';
    }
    let facebookMode = s.facebookMode;
    if (!facebookMode) {
      if (s.enabled === false) facebookMode = 'allow';
      else if (s.mode === 'hide') facebookMode = 'block';
      else facebookMode = 'dim';
    }
    const skipShorts = s.skipShorts ?? DEFAULTS.skipShorts;
    return {
      ...DEFAULTS,
      ...s,
      youtubeMode,
      facebookMode,
      skipShorts
    };
  };

  globalThis.HerbiSight = {
    DEFAULTS,
    AI_LABEL_RE,
    normalizeSettings
  };
})();
