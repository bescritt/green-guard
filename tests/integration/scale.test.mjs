// Scale / performance validation: the engine must hold up "at all scales"
// (project requirement). We exercise two scale axes offline:
//   1. Bloom filter at 1,000,000 inserted keys — memory + query throughput,
//      and a measured false-positive rate near the design target (p ~ 0.001).
//   2. 5,000 concurrent page classifications through the full Orchestrator
//      ladder (with the judge stubbed) — the degradation ladder must not
//      serialise or deadlock under fan-in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BloomFilter } from '../../src/core/bloom.js';
import { Orchestrator } from '../../src/runtime/orchestrator.js';
import { SafetyActions } from '../../src/runtime/actions.js';
import { WhitelistStore } from '../../src/core/whitelist.js';
import { MockDriver } from '../../src/driver/mock.js';

function memStore(seed = {}) {
  const data = { ...seed };
  return { async get() { return data.whitelist; }, async set(o) { data.whitelist = o; } };
}
function fakeBrowser() {
  return { engine: 'chrome', api: undefined, onTabUpdated() {}, onTabRemoved() {}, onAlarm() {}, createAlarm() {}, getMessage: (k) => k };
}

test('SCALE: bloom holds 1,000,000 keys with measured FP rate within 2x target and fast queries', () => {
  const N = 1_000_000;
  const p = 0.001;
  const bf = BloomFilter.fromKeys(Array.from({ length: N }, (_, i) => `site-${i}.example`), p);
  // membership of inserted keys is exact
  assert.ok(bf.has('site-0.example'));
  assert.ok(bf.has(`site-${N - 1}.example`));
  // measured FP rate over 50k never-inserted keys
  let fp = 0;
  const trieds = 50_000;
  for (let i = 0; i < trieds; i++) if (bf.has(`absent-${i}.example`)) fp++;
  const rate = fp / trieds;
  assert.ok(rate <= 2 * p, `measured FP ${rate.toFixed(5)} exceeds 2x target ${2 * p}`);
  // query throughput sanity
  const t0 = Date.now();
  for (let i = 0; i < 200_000; i++) bf.has(`site-${i}.example`);
  const qps = 200_000 / ((Date.now() - t0) / 1000);
  assert.ok(qps > 100_000, `query throughput too low: ${qps.toFixed(0)} qps/s`);
});

test('SCALE: 5,000 concurrent classifications through the full ladder', async () => {
  const browser = fakeBrowser();
  const store = new WhitelistStore(memStore({ whitelist: { entries: new Set() } }));
  const actions = new SafetyActions(browser, { i18n: (k) => k });
  const orch = new Orchestrator({ browser, driver: new MockDriver(), actions, store, settingsStore: store, settings: {} });
  await orch.init();

  const feat = (i) => ({
    url: `https://page-${i}.example/`, domain: `page-${i}.example`, title: 't',
    textSample: i % 3 === 0 ? 'URGENT verify your account now' : 'normal',
    hasAutoplayMedia: i % 5 === 0, hasPopups: false, fullscreenAttempts: i % 7 === 0 ? 3 : 0,
    focusGrabs: 0, permissionRequests: [],
  });

  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: 5000 }, (_, i) => orch.classify(feat(i))));
  const elapsed = Date.now() - t0;

  assert.equal(results.length, 5000);
  for (const r of results) assert.ok(['ideal', 'safe', 'mediocre', 'risky', 'known_scam'].includes(r.tier));
  // No deadlock / serialisation: 5k full-ladder classifications in well under a second per item.
  assert.ok(elapsed < 60_000, `concurrent classify took too long: ${elapsed}ms`);
  // The 1/3 scam-ish pages should have produced non-safe verdicts.
  const unsafe = results.filter((r) => ['risky', 'known_scam'].includes(r.tier)).length;
  assert.ok(unsafe > 0, 'expected some risky verdicts from scam-like inputs');
});
