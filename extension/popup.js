/* HerbiSight popup: settings live in storage; stats come from the active tab. */
(() => {
  'use strict';
  const B = globalThis.browser ?? globalThis.chrome;
  const { DEFAULTS, normalizeSettings } = globalThis.HerbiSight;
  let settings = { ...DEFAULTS };

  const $ = (id) => document.getElementById(id);

  const render = () => {
    ['allow', 'dim', 'block'].forEach((v) => {
      const ytBtn = $('yt-' + v);
      if (ytBtn) ytBtn.classList.toggle('active', settings.youtubeMode === v);
      const fbBtn = $('fb-' + v);
      if (fbBtn) fbBtn.classList.toggle('active', settings.facebookMode === v);
    });

    $('skipShorts').checked = !!settings.skipShorts;
    const shortsRow = $('shorts-row');
    if (shortsRow) {
      shortsRow.classList.toggle('disabled', settings.youtubeMode === 'allow');
    }
  };

  const save = () => B.storage.local.set({ settings });

  const loadStats = async () => {
    try {
      const got = await B.storage.local.get(['totalPulled', 'cache_v1']);
      $('stat-total').textContent = got.totalPulled || 0;
      const cached = got.cache_v1 ? Object.keys(got.cache_v1).length : 0;
      $('stat-checked').textContent = cached;
    } catch (e) { /* leave dashes */ }

    try {
      const tabs = await B.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id != null) {
        const stats = await B.tabs.sendMessage(tabs[0].id, { type: 'aib:stats' });
        if (stats) {
          $('stat-session').textContent = stats.sessionPulled ?? '–';
          if (stats.entriesChecked != null) {
            $('stat-checked').textContent = stats.entriesChecked;
          }
        }
      }
    } catch (e) {
      $('stat-session').textContent = '–'; // not a supported tab or script not ready
    }
  };

  const init = async () => {
    try {
      const got = await B.storage.local.get('settings');
      if (got.settings) settings = normalizeSettings(got.settings);
    } catch (e) { /* defaults */ }
    render();
    loadStats();

    ['allow', 'dim', 'block'].forEach((v) => {
      $('yt-' + v).addEventListener('click', () => {
        settings.youtubeMode = v;
        render();
        save();
      });
      $('fb-' + v).addEventListener('click', () => {
        settings.facebookMode = v;
        render();
        save();
      });
    });

    $('skipShorts').addEventListener('change', () => {
      settings.skipShorts = $('skipShorts').checked;
      save();
    });

    $('clear').addEventListener('click', async () => {
      await B.storage.local.set({ cache_v1: {}, totalPulled: 0 });
      loadStats();
    });
  };

  init();
})();
