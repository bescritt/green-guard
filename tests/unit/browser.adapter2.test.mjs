// Focused adapter tests for the chrome.* methods the production bridge depends
// on but the first browser.test.mjs left uncovered: native messaging, offscreen
// document lifecycle, getURL, and onMessage listener wiring. These are the real
// integration edges (src/driver/native.js calls sendNativeMessage), so they
// deserve explicit offline coverage through fake-chrome.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAdapter } from '../../src/platform/browser.js';
import { fakeGlobal, fakeFirefoxGlobal } from '../helpers/fake-chrome.mjs';

function mv3WithNative(nativeHandler) {
  const { chrome, globalObj } = fakeGlobal({ manifestVersion: 3, hasNativeMessaging: true, hasOffscreen: true });
  chrome.nativeHandler = nativeHandler;
  return createBrowserAdapter(globalObj);
}

test('BA-11 sendNativeMessage routes to the native host and returns its reply', async () => {
  const browser = mv3WithNative((msg) => ({ request: msg.request, service_status: 0, echoed: true }));
  const res = await browser.sendNativeMessage('com.extension.av.communication', { request: 'MALVERTISING_SUPPORT' });
  assert.equal(res.echoed, true);
  assert.equal(res.request, 'MALVERTISING_SUPPORT');
});

test('BA-12 sendNativeMessage throws when the API is absent', async () => {
  const { chrome, globalObj } = fakeGlobal({ manifestVersion: 3, hasNativeMessaging: false });
  const browser = createBrowserAdapter(globalObj);
  await assert.rejects(() => browser.sendNativeMessage('x', {}), /sendNativeMessage unavailable/);
});

test('BA-13 connectNative throws when nativeMessaging capability is absent', () => {
  const { globalObj } = fakeGlobal({ manifestVersion: 3, hasNativeMessaging: false });
  const browser = createBrowserAdapter(globalObj);
  assert.throws(() => browser.connectNative('x'), /nativeMessaging unavailable/);
});

test('BA-14 offscreen document create/close route through the API', async () => {
  const { chrome, globalObj } = fakeGlobal({ manifestVersion: 3, hasOffscreen: true });
  const browser = createBrowserAdapter(globalObj);
  let created = null;
  chrome.offscreen = { createDocument: async (o) => { created = o; }, closeDocument: async () => { created = null; } };
  await browser.createOffscreenDocument({ url: 'offscreen.html', reasons: ['ML'] });
  assert.ok(created, 'createDocument was called');
  await browser.closeOffscreenDocument();
  assert.equal(created, null, 'closeDocument was called');
});

test('BA-15 offscreen throws when capability is absent (MV2)', async () => {
  const { globalObj } = fakeFirefoxGlobal({ hasOffscreen: false });
  const browser = createBrowserAdapter(globalObj);
  await assert.rejects(() => browser.createOffscreenDocument({ url: 'x' }), /offscreen unavailable/);
});

test('BA-16 getURL resolves extension-relative paths', () => {
  const { globalObj } = fakeGlobal({ manifestVersion: 3 });
  const browser = createBrowserAdapter(globalObj);
  const url = browser.getURL('content/safe-view.js');
  assert.ok(url.startsWith('chrome-extension://fakeextensionid0000000000000000/'), 'extension URL prefix');
  assert.ok(url.endsWith('content/safe-view.js'), 'path preserved');
});

test('BA-17 onMessage listener is wired and receives messages', () => {
  const { chrome, globalObj } = fakeGlobal({ manifestVersion: 3 });
  const browser = createBrowserAdapter(globalObj);
  let got = null;
  browser.onMessage((msg) => { got = msg; });
  chrome.runtime.onMessage.emit({ type: 'PING' }, { id: chrome.runtime.id }, () => {});
  assert.deepEqual(got, { type: 'PING' });
});
