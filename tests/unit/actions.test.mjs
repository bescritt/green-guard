import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { SafetyActions, OVERLAY_ID, BANNER_ID, LOCK_STYLE_ID, MAX_Z } from '../../src/runtime/actions.js';
import { BrowserAdapter } from '../../src/platform/browser.js';
import { fakeGlobal } from '../helpers/fake-chrome.mjs';
import { ACTION } from '../../src/core/tiers.js';

/**
 * Run an injected page-function in a jsdom realm so that `document`/`window`
 * resolve to the jsdom globals (exactly as they would on a real page). Returns
 * whatever the function returns.
 */
function runIn(dom, inj) {
  const src = `(${inj.func.toString()}).apply(null, ${JSON.stringify(inj.args)})`;
  return dom.window.eval(src);
}

function makeActions(opts = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://example.com/',
    runScripts: 'outside-only', // lets window.eval run our injected funcs in the page realm
  });
  const { chrome, globalObj } = fakeGlobal(opts.chromeOpts || { manifestVersion: 3 });
  const browser = new BrowserAdapter(globalObj);
  const actions = new SafetyActions(browser, { i18n: (k) => k });
  return { dom, chrome, browser, actions };
}

test('ACT-01 blank injects a branded overlay with the reason, escape hatch and safe privacy link', async () => {
  const { dom, chrome, actions } = makeActions();
  const tabId = chrome.openTab();
  await actions.blank(tabId, { reason: 'Known scam detected', tier: 'known_scam' });
  const inj = chrome.executedScripts.find((s) => s.func);
  assert.ok(inj, 'a page function was injected');
  runIn(dom, inj);
  const el = dom.window.document.getElementById(OVERLAY_ID);
  assert.ok(el, 'overlay element exists');
  assert.equal(el.getAttribute('role'), 'dialog');
  assert.equal(el.getAttribute('aria-modal'), 'true');
  assert.equal(el.style.zIndex, String(MAX_Z));
  assert.ok(el.textContent.includes('SafeBrowsing+'), 'brand present');
  assert.ok(el.textContent.includes('Known scam detected'), 'reason present');
  assert.ok(dom.window.document.getElementById(OVERLAY_ID + '-proceed'), 'escape hatch present');
  const privacy = dom.window.document.getElementById(OVERLAY_ID + '-privacy');
  assert.ok(privacy, 'privacy link present');
  assert.equal(privacy.getAttribute('rel'), 'noopener noreferrer', 'privacy link is safe');
  assert.equal(privacy.getAttribute('target'), '_blank');
});

test('ACT-02 blank is idempotent — applying twice yields one overlay', async () => {
  const { dom, chrome, actions } = makeActions();
  const tabId = chrome.openTab();
  await actions.blank(tabId, { reason: 'first' });
  const inj1 = chrome.executedScripts.pop();
  runIn(dom, inj1);
  await actions.blank(tabId, { reason: 'second' });
  const inj2 = chrome.executedScripts.pop();
  runIn(dom, inj2);
  assert.equal(dom.window.document.querySelectorAll('#' + OVERLAY_ID).length, 1, 'exactly one overlay');
});

test('ACT-03 lock injects USER-origin CSS and registers capture-phase key/contextmenu suppression', async () => {
  const { dom, chrome, actions } = makeActions();
  const tabId = chrome.openTab();
  await actions.lock(tabId);
  const css = chrome.injectedCSS.find((c) => c.origin === 'USER' && c.css.includes('pointer-events'));
  assert.ok(css, 'USER-origin lock CSS injected');
  const inj = chrome.executedScripts.find((s) => s.func);
  runIn(dom, inj);
  assert.ok(dom.window[LOCK_STYLE_ID], 'lock state marker set in window');
  assert.ok(dom.window[LOCK_STYLE_ID].events.includes('contextmenu'), 'contextmenu suppressed');
  assert.ok(dom.window[LOCK_STYLE_ID].events.includes('keydown'), 'keydown suppressed');
});

test('ACT-04 warn shows a dismissible banner', async () => {
  const { dom, chrome, actions } = makeActions();
  const tabId = chrome.openTab();
  await actions.warn(tabId, { reason: 'suspicious' });
  const inj = chrome.executedScripts.find((s) => s.func);
  runIn(dom, inj);
  const bar = dom.window.document.getElementById(BANNER_ID);
  assert.ok(bar, 'banner present');
  bar.querySelector('button').dispatchEvent(new dom.window.Event('click'));
  assert.equal(dom.window.document.getElementById(BANNER_ID), null, 'dismiss removes banner');
});

test('ACT-05 mute falls back to pausing media when tabs.mute is denied', async () => {
  const { dom, chrome, actions } = makeActions();
  chrome.tabs.update = async () => { throw new Error('tab audio muting disabled by policy'); };
  // Put a playing video in the page so the media-pause fallback has something to act on.
  const v = dom.window.document.createElement('video');
  v.muted = false;
  dom.window.document.body.appendChild(v);
  let paused = false;
  v.pause = () => { paused = true; };
  const tabId = chrome.openTab();
  const res = await actions.mute(tabId);
  assert.equal(res.ok, true, 'fallback still succeeds');
  assert.equal(res.method, 'media-pause-fallback');
  // The fallback injected a func that pauses page media; run it against the jsdom doc.
  const inj = chrome.executedScripts.find((s) => s.func);
  runIn(dom, inj);
  assert.equal(paused, true, 'the page video was paused by the fallback');
});

test('ACT-06 close removes the tab and forgets it', async () => {
  const { chrome, actions } = makeActions();
  const tabId = chrome.openTab();
  await actions.close(tabId);
  assert.equal(chrome.tabs_.has(tabId), false, 'tab removed');
  assert.deepEqual(actions.appliedTo(tabId), []);
});

test('ACT-07 revertAll undoes every reversible action', async () => {
  const { dom, chrome, actions } = makeActions();
  const tabId = chrome.openTab();
  await actions.mute(tabId);
  await actions.lock(tabId);
  await actions.blank(tabId, { reason: 'x' });
  // Run the blank injection so the overlay actually exists in the DOM.
  runIn(dom, chrome.executedScripts[chrome.executedScripts.length - 1]);
  const before = chrome.executedScripts.length;
  const out = await actions.revertAll(tabId);
  // Run every injection revertAll produced (unmute/lock/unblank) against the DOM.
  for (let i = before; i < chrome.executedScripts.length; i++) runIn(dom, chrome.executedScripts[i]);
  assert.deepEqual(out.map((o) => o.action).sort(), ['blank', 'lock', 'mute'], 'all reverted');
  assert.equal(dom.window.document.getElementById(OVERLAY_ID), null, 'overlay gone after revert');
});

/** Run an injected func with a document that is NOT the jsdom one (fallback path). */
function runInWithDoc(doc, dom, inj) {
  const fn = dom.window.eval('(' + inj.func.toString() + ')');
  // Provide `document` via the function's first-arg convention used by mute().
  fn.call({ document: doc, window: dom.window }, ...(inj.args || []));
}
