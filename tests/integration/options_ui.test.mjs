// Functional regression for the "Options Save does nothing / extension can't
// turn on" bug. Reproduces the Chrome options-page context: a jsdom window
// where the extension API is exposed as `chrome` (NOT `browser`), loads the
// REAL bundled options.js, and verifies that submitting the form (1) resolves
// the global without throwing and (2) persists a SET_SETTINGS message and shows
// "Saved.".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(ROOT, '..', '..', 'dist', 'mv3');

test('OPT-01 Save persists settings and shows "Saved." in a chrome-only (no browser polyfill) context', async () => {
  const optHtml = readFileSync(join(DIST, 'options.html'), 'utf8');
  const optJs = readFileSync(join(DIST, 'options.js'), 'utf8');

  const dom = new JSDOM(optHtml, { runScripts: 'outside-only', url: 'chrome-extension://abc/options.html' });
  const { window } = dom;

  // Simulate Chrome MV3: only `chrome` global, no `browser` polyfill.
  let sent = null;
  window.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        sent = msg;
        // Mimic the background replying with persisted settings.
        if (msg.type === 'GET_STATE') return { settings: { enabled: true, protectionLevel: 'balanced', closeOnKnownScam: false, shareReports: false } };
        if (msg.type === 'SET_SETTINGS') return { type: 'SETTINGS', settings: msg.patch };
        return undefined;
      },
    },
  };
  // Ensure `browser` is NOT defined (the exact Chrome condition that broke Save).
  delete window.browser;

  // Load the real options.js into the page realm.
  window.eval(optJs);

  // Let the auto-run `load()` settle.
  await new Promise((r) => setTimeout(r, 30));

  // Change a setting and submit.
  window.document.getElementById('enabled').checked = false;
  window.document.getElementById('protectionLevel').value = 'strict';
  const form = window.document.getElementById('form');
  form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

  await new Promise((r) => setTimeout(r, 30));

  assert.ok(sent, 'a message was sent on submit');
  assert.equal(sent.type, 'SET_SETTINGS', 'save sends SET_SETTINGS');
  assert.equal(sent.patch.enabled, false, 'enabled flag persisted');
  assert.equal(sent.patch.protectionLevel, 'strict', 'protection level persisted');
  assert.equal(window.document.getElementById('status').textContent, 'Saved.', 'status shows Saved.');
});
