// Popup UI logic. Reads stats from the background worker and opens Settings.
// Chrome MV3 popup pages expose the API as `chrome`, not `browser`.
const browser = globalThis.browser || globalThis.chrome;
const $ = (id) => document.getElementById(id);

async function refresh() {
  try {
    const res = await browser.runtime.sendMessage({ type: 'GET_STATE' });
    if (res && res.stats) {
      $('nav').textContent = res.stats.navigations || 0;
      $('cls').textContent = res.stats.classified || 0;
      $('blk').textContent = res.stats.blocked || 0;
      $('bloom').textContent = res.stats.bloomHits || 0;
    }
  } catch (e) {
    $('note').textContent = 'Could not reach background worker.';
  }
}

$('openOptions').addEventListener('click', () => browser.runtime.openOptionsPage?.() || browser.runtime.openOptionsPage());
refresh();
