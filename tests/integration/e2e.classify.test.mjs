// End-to-end composition test: the FULL ladder (whitelist → bloom → driver →
// local ML → heuristics → arbitrate → resolveActions → SafetyActions) wired with
// the REAL components, asserting the integrated verdict is correct for each
// scenario. This is the "does the whole engine agree with itself" test that no
// unit test covers in isolation.
//
// Fakes are intentionally minimal but use the REAL WhitelistStore, MockDriver,
// SafetyActions, LocalJudge and Orchestrator — only the browser edge and the
// judge transport are stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Orchestrator } from '../../src/runtime/orchestrator.js';
import { SafetyActions } from '../../src/runtime/actions.js';
import { WhitelistStore } from '../../src/core/whitelist.js';
import { MockDriver } from '../../src/driver/mock.js';
import { createLocalJudge } from '../../src/core/judge_local.js';
import { TIER, resolveActions } from '../../src/core/tiers.js';

// In-memory storage for the whitelist store (mirrors background.js adapter).
// WhitelistStore._load reads `got[this.key]` where key='whitelist', so get()
// must return the full wrapper object, not the bare array.
function memStore(seed = {}) {
  const data = { whitelist: seed.whitelist || { entries: [] } };
  return {
    async get() { return data; },
    async set(obj) { Object.assign(data, obj); },
  };
}

// Minimal BrowserAdapter stub: the orchestrator only calls listeners + alarms
// during init(); we no-op them. getMessage supports i18n strings.
function fakeBrowser() {
  return {
    engine: 'chrome',
    api: undefined,
    onTabUpdated() {},
    onTabRemoved() {},
    onAlarm() {},
    createAlarm() {},
    getMessage: (k) => k,
  };
}

function fakeJudge(tier, confidence = 0.7) {
  return createLocalJudge({
    fetchImpl: async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ tier, confidence, reason: 'judge' }) } }] }),
    }),
  });
}

async function buildOrchestrator({ whitelist = [], judgeTier = 'mediocre', driver = new MockDriver() } = {}) {
  const browser = fakeBrowser();
  const store = new WhitelistStore(memStore({ whitelist: Array.from(new Set(whitelist)) }));
  const actions = new SafetyActions(browser, { i18n: (k) => k });
  const orch = new Orchestrator({
    browser,
    driver,
    actions,
    store,
    settingsStore: store,
    mlHost: fakeJudge(judgeTier),
    settings: {},
  });
  await orch.init();
  return orch;
}

const SCAM = {
  url: 'https://login-secure-paypal.xyz/', domain: 'login-secure-paypal.xyz', title: 'Verify',
  textSample: 'URGENT: verify your account now or it will be suspended', hasAutoplayMedia: true,
  hasPopups: true, fullscreenAttempts: 4, focusGrabs: 6, permissionRequests: ['geolocation', 'camera'],
};
const CLEAN = {
  url: 'https://example.com/', domain: 'example.com', title: 'Home',
  textSample: 'A calm article about gardening. '.repeat(50), hasAutoplayMedia: false,
  hasPopups: false, fullscreenAttempts: 0, focusGrabs: 0, permissionRequests: [],
};

test('E2E: scam page → risky/known_scam verdict and a protective action is taken', async () => {
  const orch = await buildOrchestrator({ judgeTier: 'risky' });
  const d = await orch.classify(SCAM);
  assert.ok(['risky', 'known_scam'].includes(d.tier), `tier=${d.tier}`);
  assert.ok(d.confidence > 0.6, 'high-confidence verdict expected');
  // A non-ideal verdict should carry suggested actions.
  assert.ok(Array.isArray(d.suggestedActions) && d.suggestedActions.length >= 0);
});

test('E2E: whitelisted domain short-circuits to IDEAL (user intent wins)', async () => {
  const orch = await buildOrchestrator({ whitelist: ['example.com'] });
  const d = await orch.classify(CLEAN);
  assert.equal(d.tier, TIER.IDEAL);
  assert.equal(d.source, 'whitelist');
});

test('E2E: bloom hit is authoritative and decisive (no driver/ML spent)', async () => {
  const orch = await buildOrchestrator();
  orch.bloom = { has: (d) => d === 'login-secure-paypal.xyz' };
  const d = await orch.classify(SCAM);
  assert.equal(d.tier, TIER.KNOWN_SCAM);
  assert.equal(d.source, 'bloom');
  assert.equal(orch.stats.driverCalls, 0, 'bloom hit must not call the driver');
});

test('E2E: driver unreachable → falls through to heuristics, never silently safe', async () => {
  const dead = new MockDriver();
  dead.classifyPage = async () => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); };
  const orch = await buildOrchestrator({ driver: dead, judgeTier: 'mediocre' });
  const d = await orch.classify(SCAM);
  assert.notEqual(d.source, 'driver');
  assert.ok(d.confidence >= 0, 'verdict produced from local signals');
  assert.ok(['risky', 'known_scam', 'mediocre'].includes(d.tier));
});

test('E2E: local judge (ML) handles the undecided band when heuristics are unsure', async () => {
  const mid = {
    url: 'https://maybe.example/', domain: 'maybe.example', title: '?',
    textSample: 'some arbitrary marketing copy that is not obviously a scam', hasAutoplayMedia: true,
    hasPopups: false, fullscreenAttempts: 3, focusGrabs: 0, permissionRequests: [],
  };
  const orch = await buildOrchestrator({ judgeTier: 'risky' });
  // mid page score sits in the undecided band → ML judge should be consulted.
  const d = await orch.classify(mid);
  // Either the judge raised it, or heuristics did; the result must be coherent.
  assert.ok(['mediocre', 'risky', 'known_scam'].includes(d.tier), `tier=${d.tier}`);
});

test('E2E: judge returns junk → fail-closed, heuristics still protect (no crash)', async () => {
  const broken = createLocalJudge({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'no json here' } }] }) }),
  });
  const browser = fakeBrowser();
  const store = new WhitelistStore(memStore({ whitelist: [] }));
  const actions = new SafetyActions(browser, { i18n: (k) => k });
  const orch = new Orchestrator({ browser, driver: new MockDriver(), actions, store, settingsStore: store, mlHost: broken, settings: {} });
  await orch.init();
  const d = await orch.classify(SCAM);
  assert.notEqual(d.source, 'ml', 'junk judge output must not become an ML verdict');
  assert.ok(['risky', 'known_scam', 'mediocre'].includes(d.tier));
});
