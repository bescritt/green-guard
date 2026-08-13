// Options UI logic. Loads current settings and persists changes via the
// background worker (which owns the SettingsStore).
// Chrome MV3 options pages expose the API as `chrome`, not `browser`
// (no webext polyfill), so resolve the global defensively.
const browser = globalThis.browser || globalThis.chrome;
const $ = (id) => document.getElementById(id);
const DEFAULTS = { enabled: true, protectionLevel: 'balanced', closeOnKnownScam: false, shareReports: false };

async function load() {
  try {
    const res = await browser.runtime.sendMessage({ type: 'GET_STATE' });
    const s = Object.assign({}, DEFAULTS, res?.settings || {});
    $('enabled').checked = !!s.enabled;
    $('protectionLevel').value = s.protectionLevel || 'balanced';
    $('closeOnKnownScam').checked = !!s.closeOnKnownScam;
    $('shareReports').checked = !!s.shareReports;
  } catch {
    $('status').textContent = 'Could not reach background worker.';
  }
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const patch = {
    enabled: $('enabled').checked,
    protectionLevel: $('protectionLevel').value,
    closeOnKnownScam: $('closeOnKnownScam').checked,
    shareReports: $('shareReports').checked,
  };
  await browser.runtime.sendMessage({ type: 'SET_SETTINGS', patch });
  $('status').textContent = 'Saved.';
});

load();
