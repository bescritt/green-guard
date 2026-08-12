import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserAdapter, ENGINE } from '../../src/platform/browser.js';
import { fakeGlobal, fakeFirefoxGlobal } from '../helpers/fake-chrome.mjs';

const fakeApi = { chrome: { runtime: { getManifest: () => ({ manifest_version: 3 }) }, storage: { local: {} }, tabs: {} }, globalObj: {} };

test('BA-01 detects a chromium MV3 engine from real capability, not UA', async () => {
  const { globalObj } = fakeGlobal({ manifestVersion: 3, hasOffscreen: true });
  const b = new BrowserAdapter(globalObj);
  assert.equal(b.engine, ENGINE.CHROMIUM_MV3);
});

test('BA-02 detects Firefox MV2 and reports no offscreen', async () => {
  const { globalObj } = fakeFirefoxGlobal({ manifestVersion: 2 });
  const b = new BrowserAdapter(globalObj);
  assert.equal(b.engine, ENGINE.FIREFOX_MV2);
  assert.equal(b.capabilities.offscreen, false);
  assert.equal(b.capabilities.scripting, false);
});

test('BA-03 storage get/set round-trips through the correct area', async () => {
  const { globalObj } = fakeGlobal({ manifestVersion: 3, hasSessionStorage: true });
  const b = new BrowserAdapter(globalObj);
  await b.storageSet({ foo: 1 }, 'local');
  const got = await b.storageGet(['foo'], 'local');
  assert.equal(got.foo, 1);
  await b.storageSet({ token: 'x' }, 'session');
  const s = await b.storageGet(['token'], 'session');
  assert.equal(s.token, 'x');
});

test('BA-04 capabilities accurately report what is absent', async () => {
  const { globalObj } = fakeGlobal({ manifestVersion: 3, hasNativeMessaging: false, hasSessionStorage: false });
  const b = new BrowserAdapter(globalObj);
  assert.equal(b.capabilities.nativeMessaging, false);
  assert.equal(b.capabilities.sessionStorage, false);
  assert.throws(() => b.connectNative('x'), /unavailable/);
});

test('BA-05 executeScript uses scripting on MV3 and tabs on MV2', async () => {
  const c3 = fakeGlobal({ manifestVersion: 3 });
  const b3 = new BrowserAdapter(c3.globalObj);
  const tab3 = c3.chrome.openTab();
  await b3.executeScript({ target: { tabId: tab3 }, func: () => 1 + 1 });
  assert.ok(c3.chrome.executedScripts.some((s) => s.func), 'MV3 scripting path used');

  const c2 = fakeFirefoxGlobal({ manifestVersion: 2 });
  const b2 = new BrowserAdapter(c2.globalObj);
  const tab2 = c2.chrome.openTab();
  await b2.executeScript({ target: { tabId: tab2 }, func: () => 1 + 1 });
  assert.ok(c2.chrome.executedScripts.some((s) => s.tabId !== undefined), 'MV2 tabs path used');
});

test('BA-06 insertCSS honours USER origin on MV2', async () => {
  const c2 = fakeFirefoxGlobal({ manifestVersion: 2 });
  const b2 = new BrowserAdapter(c2.globalObj);
  const tab2 = c2.chrome.openTab();
  await b2.insertCSS({ target: { tabId: tab2 }, css: 'body{}', origin: 'USER' });
  const inj = c2.chrome.injectedCSS.find((c) => c.tabId === tab2);
  assert.equal(inj.cssOrigin, 'user', 'MV2 maps USER → user origin');
});

test('BA-07 alarms create/clear and onAlarm dispatch', async () => {
  const { globalObj } = fakeGlobal({ manifestVersion: 3 });
  const b = new BrowserAdapter(globalObj);
  b.createAlarm('x', { periodInMinutes: 1 });
  let fired = null;
  b.onAlarm((a) => { fired = a; });
  await globalObj.chrome.advance(60000);
  assert.equal(fired && fired.name, 'x');
  await b.clearAlarm('x');
});

test('BA-08 sendMessage routes through the runtime and returns listener result', async () => {
  const { globalObj } = fakeGlobal({ manifestVersion: 3 });
  const b = new BrowserAdapter(globalObj);
  globalObj.chrome.runtime.onMessage.addListener((msg) => ({ echoed: msg.v }));
  const r = await b.sendMessage({ v: 7 });
  assert.equal(r.echoed, 7);
});

test('BA-09 getMessage falls back to the key only when the i18n layer returns nothing', () => {
  const { globalObj } = fakeGlobal({ manifestVersion: 3 });
  const b = new BrowserAdapter(globalObj);
  // The fake i18n always returns a bracketed key; the adapter passes it through.
  assert.equal(b.getMessage('does-not-exist'), '[does-not-exist]');
  // A stub that mimics a real missing key (empty string) must fall back to the key.
  b.api.i18n.getMessage = () => '';
  assert.equal(b.getMessage('still-missing'), 'still-missing');
});

test('BA-10 an absent API yields engine UNKNOWN rather than crashing', () => {
  const b = new BrowserAdapter({});
  assert.equal(b.available, false);
  assert.equal(b.engine, ENGINE.UNKNOWN);
  assert.equal(b.capabilities.offscreen, false);
});
