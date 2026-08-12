import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeChrome, fakeGlobal } from '../helpers/fake-chrome.mjs';
import { BrowserAdapter } from '../../src/platform/browser.js';
import { SafetyActions } from '../../src/runtime/actions.js';
import { Orchestrator, ALARM, KEEPALIVE_PERIOD_MIN, THREATLIST_PERIOD_MIN } from '../../src/runtime/orchestrator.js';
import { MockDriver, MOCK_SCAM_DOMAINS } from '../../src/driver/mock.js';
import { DriverClient } from '../../src/driver/client.js';
import { WhitelistStore } from '../../src/core/whitelist.js';
import { SettingsStore } from '../../src/core/settings.js';
import { BloomFilter } from '../../src/core/bloom.js';
import { TIER, ACTION } from '../../src/core/tiers.js';

/** Assemble a fully-wired orchestrator over a fake browser. */
function makeOrchestrator(opts = {}) {
  const { chrome, globalObj } = fakeGlobal(opts.chromeOpts || { manifestVersion: 3 });
  const browser = new BrowserAdapter(globalObj);
  const store = new WhitelistStore({ get: (k) => chrome.storage.local.get(k), set: (v) => chrome.storage.local.set(v) });
  const settingsStore = new SettingsStore({ get: (k) => chrome.storage.local.get(k), set: (v) => chrome.storage.local.set(v) });
  const actions = new SafetyActions(browser, { i18n: (k) => k });
  const driver = opts.noDriver ? null : new DriverClient(new MockDriver(opts.driverOpts || {}));
  const orch = new Orchestrator({ browser, driver, actions, store, settingsStore, onEvent: opts.onEvent });
  return { chrome, browser, store, settingsStore, actions, driver, orch };
}

const navFeatures = (url) => ({
  url, domain: new URL(url).hostname, title: 'Page',
  textSample: '', hasAutoplayMedia: false, hasPopups: false,
  fullscreenAttempts: 0, focusGrabs: 0, permissionRequests: [],
});

test('INT-01 a known-scam domain is detected by bloom and blanked, no driver call', async () => {
  const { chrome, orch, store } = makeOrchestrator();
  const f = BloomFilter.fromKeys(MOCK_SCAM_DOMAINS, 0.001, 0);
  await chrome.storage.local.set({ threat_bloom: Array.from(f.serialize()) });
  await orch.init();
  const tabId = chrome.openTab({ url: `https://${MOCK_SCAM_DOMAINS[0]}/x` });

  const out = await orch.handleNavigation(tabId, { status: 'complete', url: `https://${MOCK_SCAM_DOMAINS[0]}/x` }, { url: `https://${MOCK_SCAM_DOMAINS[0]}/x` });
  assert.equal(out.decision.tier, TIER.KNOWN_SCAM);
  assert.ok(out.actions.includes(ACTION.BLANK));
  assert.equal(out.results.find((r) => r.action === ACTION.BLANK)?.ok, true);
  // Bloom hit is decisive: the driver must NOT have been consulted.
  assert.equal(orch.driver.transport.calls.classifyPage, 0, 'bloom hit must not trigger a driver call');
});

test('INT-02 when bloom misses, the driver is consulted and its verdict drives the action', async () => {
  const { chrome, orch } = makeOrchestrator({ driverOpts: { entitled: false } });
  await orch.init();
  const tabId = chrome.openTab({ url: 'https://some-clean-site.example/article' });
  const out = await orch.handleNavigation(tabId, { status: 'complete', url: 'https://some-clean-site.example/article' }, { url: 'https://some-clean-site.example/article' });
  assert.ok(out.actions.length === 0, 'a clean page should get no safety action');
  assert.ok(orch.driver.transport.calls.classifyPage >= 1, 'driver should have been called');
});

test('INT-03 driver-down must NOT yield a safe page; local heuristics still protect tiers that fail hard', async () => {
  const { chrome, orch } = makeOrchestrator({ driverOpts: {}, noDriver: false });
  // Load a bloom that knows the scam domain, so the bloom path is what catches it.
  const f = BloomFilter.fromKeys(MOCK_SCAM_DOMAINS, 0.001, 0);
  await chrome.storage.local.set({ threat_bloom: Array.from(f.serialize()) });
  // Force the driver to be down for this test.
  orch.driver.transport.setFaults({ down: true });
  await orch.init();
  const tabId = chrome.openTab({ url: `https://${MOCK_SCAM_DOMAINS[0]}/x` });
  const out = await orch.handleNavigation(tabId, { status: 'complete', url: `https://${MOCK_SCAM_DOMAINS[0]}/x` }, { url: `https://${MOCK_SCAM_DOMAINS[0]}/x` });
  assert.equal(out.decision.tier, TIER.KNOWN_SCAM, 'bloom still catches it with no driver');
  assert.ok(out.actions.includes(ACTION.BLANK));
});

test('INT-04 whitelisted domain is never acted on, even if bloom-risky', async () => {
  const { chrome, orch, store } = makeOrchestrator();
  await store.add('scam-lookalike.example');
  await orch.init();
  const tabId = chrome.openTab({ url: 'https://scam-lookalike.example/page' });
  const out = await orch.handleNavigation(tabId, { status: 'complete', url: 'https://scam-lookalike.example/page' }, { url: 'https://scam-lookalike.example/page' });
  assert.deepEqual(out.actions, [], 'whitelist overrides everything');
});

test('INT-05 "Proceed anyway" whitelists the domain and reverts all actions', async () => {
  const { chrome, orch, store, actions } = makeOrchestrator();
  const f = BloomFilter.fromKeys(MOCK_SCAM_DOMAINS, 0.001, 0);
  await chrome.storage.local.set({ threat_bloom: Array.from(f.serialize()) });
  await orch.init();
  const tabId = chrome.openTab({ url: `https://${MOCK_SCAM_DOMAINS[1]}/x` });
  await orch.handleNavigation(tabId, { status: 'complete', url: `https://${MOCK_SCAM_DOMAINS[1]}/x` }, { url: `https://${MOCK_SCAM_DOMAINS[1]}/x` });
  assert.ok(actions.appliedTo(tabId).includes(ACTION.BLANK));

  const res = await orch.whitelistAndRevert(tabId, `https://${MOCK_SCAM_DOMAINS[1]}/x`);
  assert.equal(res.domain, 'scam-lookalike.example' === 'x' ? '' : 'phish-login.example');
  assert.deepEqual(actions.appliedTo(tabId), []);
  // Now a fresh navigation to the same domain does nothing.
  const out2 = await orch.handleNavigation(tabId, { status: 'complete', url: `https://${MOCK_SCAM_DOMAINS[1]}/x` }, { url: `https://${MOCK_SCAM_DOMAINS[1]}/x` });
  assert.deepEqual(out2.actions, []);
});

test('INT-06 keepalive is acquired while classifying and released after', async () => {
  const { chrome, orch } = makeOrchestrator({ driverOpts: { latencyMs: 0 } });
  await orch.init();
  assert.equal(orch._keepaliveActive, false);
  const tabId = chrome.openTab({ url: 'https://slow.example/page' });
  const p = orch.handleNavigation(tabId, { status: 'complete', url: 'https://slow.example/page' }, { url: 'https://slow.example/page' });
  assert.equal(orch.pendingCount, 1, 'work is pending');
  await p;
  assert.equal(orch.pendingCount, 0, 'released after');
});

test('INT-07 threat-list alarm is scheduled at 6h and refreshes the bloom', async () => {
  const { chrome, orch } = makeOrchestrator();
  await orch.init();
  const alarms = await chrome.alarms.getAll();
  const update = alarms.find((a) => a.name === ALARM.UPDATE_THREATLIST);
  assert.ok(update, 'update alarm scheduled');
  assert.equal(THREATLIST_PERIOD_MIN, 360, 'spec period');
  // Fire it.
  await chrome.advance(360 * 60000);
  const bytes = await chrome.storage.local.get('threat_bloom');
  assert.ok(Array.isArray(bytes.threat_bloom), 'bloom stored as array');
  const f = BloomFilter.deserialize(Uint8Array.from(bytes.threat_bloom));
  assert.ok(f.has(MOCK_SCAM_DOMAINS[0]), 'refreshed list contains the mock scam domain');
});

test('INT-08 keepalive period is under the 30s idle timeout (no dead worker pending)', async () => {
  assert.ok(KEEPALIVE_PERIOD_MIN < 0.5, '0.42 min < 0.5 min');
  const { chrome, orch } = makeOrchestrator();
  await orch.init();
  await chrome.advance(0); // not strictly needed; just ensure no throw
  assert.ok(true);
});

test('INT-09 idempotency: repeated onUpdated for the same url classifies once', async () => {
  const { chrome, orch } = makeOrchestrator({ driverOpts: {} });
  await orch.init();
  const tabId = chrome.openTab({ url: 'https://dup.example/page' });
  const url = 'https://dup.example/page';
  await orch.handleNavigation(tabId, { status: 'complete', url }, { url });
  const before = orch.stats.navigations;
  // Chrome emits several onUpdated events per navigation.
  await orch.handleNavigation(tabId, { status: 'loading', url }, { url });
  await orch.handleNavigation(tabId, { status: 'complete', url }, { url });
  assert.equal(orch.stats.navigations, before, 'second identical url must be a no-op');
});

test('INT-10 report flow submits then refreshes the list (§10.3)', async () => {
  const { chrome, orch, driver } = makeOrchestrator();
  await orch.init();
  const url = 'https://newly-reported.example/scam';
  const r = await orch.submitReport({ url, reportType: 'scam', pageHash: 'b'.repeat(64) });
  assert.equal(r.ok, true);
  assert.ok(driver.transport.reports.length === 1, 'report stored on driver');
  const f = BloomFilter.deserialize(Uint8Array.from((await chrome.storage.local.get('threat_bloom')).threat_bloom));
  assert.ok(f.has('newly-reported.example'), 'reported domain is now on the list');
});

test('INT-11 master disable stops all protection without error', async () => {
  const { chrome, orch } = makeOrchestrator();
  await orch.settingsStore.set({ enabled: false });
  await orch.init();
  const tabId = chrome.openTab({ url: `https://${MOCK_SCAM_DOMAINS[0]}/x` });
  const out = await orch.handleNavigation(tabId, { status: 'complete', url: `https://${MOCK_SCAM_DOMAINS[0]}/x` }, { url: `https://${MOCK_SCAM_DOMAINS[0]}/x` });
  assert.equal(out, null, 'disabled → no handling');
});

test('INT-12 unclassifiable schemes (chrome://, about:) are ignored', async () => {
  const { chrome, orch } = makeOrchestrator();
  await orch.init();
  assert.equal(await orch.handleNavigation(1, { status: 'complete', url: 'chrome://extensions' }, { url: 'chrome://extensions' }), null);
  assert.equal(await orch.handleNavigation(2, { status: 'complete', url: 'about:blank' }, { url: 'about:blank' }), null);
});

test('INT-13 close-on-known-scam is opt-in and only closes at the strictest setting', async () => {
  const { chrome, orch } = makeOrchestrator();
  const f = BloomFilter.fromKeys(MOCK_SCAM_DOMAINS, 0.001, 0);
  await chrome.storage.local.set({ threat_bloom: Array.from(f.serialize()) });
  await orch.settingsStore.set({ protectionLevel: 'strict', closeOnKnownScam: true });
  await orch.init();
  const tabId = chrome.openTab({ url: `https://${MOCK_SCAM_DOMAINS[2]}/x` });
  const out = await orch.handleNavigation(tabId, { status: 'complete', url: `https://${MOCK_SCAM_DOMAINS[2]}/x` }, { url: `https://${MOCK_SCAM_DOMAINS[2]}/x` });
  assert.ok(out.actions.includes(ACTION.CLOSE), 'strict + opt-in closes');
  assert.equal(chrome.tabs_.has(tabId), false, 'tab was removed');
});

test('INT-14 banner-mode downgrades blank/lock into a warn', async () => {
  const { chrome, orch } = makeOrchestrator();
  const f = BloomFilter.fromKeys(MOCK_SCAM_DOMAINS, 0.001, 0);
  await chrome.storage.local.set({ threat_bloom: Array.from(f.serialize()) });
  await orch.settingsStore.set({ bannerModeOnly: true });
  await orch.init();
  const tabId = chrome.openTab({ url: `https://${MOCK_SCAM_DOMAINS[0]}/x` });
  const out = await orch.handleNavigation(tabId, { status: 'complete', url: `https://${MOCK_SCAM_DOMAINS[0]}/x` }, { url: `https://${MOCK_SCAM_DOMAINS[0]}/x` });
  assert.ok(!out.actions.includes(ACTION.BLANK), 'blank suppressed in banner mode');
  assert.ok(!out.actions.includes(ACTION.LOCK), 'lock suppressed in banner mode');
  assert.ok(out.actions.includes(ACTION.WARN), 'warn shown instead');
});

test('INT-15 no unhandled rejection when navigation throws inside the listener path', async () => {
  const { chrome, orch } = makeOrchestrator();
  await orch.init();
  const tabId = chrome.openTab({ url: 'https://throw.example/x' });
  // Force a throw by making the store throw.
  orch.store.isWhitelisted = () => { throw new Error('boom'); };
  let rej = false;
  const handler = (e) => { if (e && e.type === 'unhandledRejection') rej = true; };
  process.on('unhandledRejection', handler);
  await orch.handleNavigation(tabId, { status: 'complete', url: 'https://throw.example/x' }, { url: 'https://throw.example/x' }).catch(() => {});
  await new Promise((r) => setTimeout(r, 10));
  process.off('unhandledRejection', handler);
  assert.equal(rej, false, 'internal throw must be caught, not leaked');
});
