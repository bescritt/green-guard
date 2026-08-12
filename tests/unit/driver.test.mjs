import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockDriver, downDriver, MOCK_SCAM_DOMAINS } from '../../src/driver/mock.js';
import { DriverClient, BREAKER, DEFAULT_TIMEOUTS } from '../../src/driver/client.js';
import { DriverError, ERROR_CODE, DRIVER_METHODS, conformsToDriver } from '../../src/core/contract.js';
import { TIER } from '../../src/core/tiers.js';
import { BloomFilter } from '../../src/core/bloom.js';

const features = (over = {}) => ({
  url: 'https://example.com/page',
  domain: 'example.com',
  textSample: 'A perfectly ordinary page with a privacy policy and terms and contact details.',
  title: 'Example',
  hasAutoplayMedia: false,
  hasPopups: false,
  fullscreenAttempts: 0,
  focusGrabs: 0,
  permissionRequests: [],
  ...over,
});

const HASH = 'a'.repeat(64);
/** No-op sleep so retry/backoff tests run instantly and cannot flake. */
const fastClient = (t, o = {}) => new DriverClient(t, { sleep: async () => {}, random: () => 0.5, ...o });

test('DRV-01 MockDriver structurally implements the contract', () => {
  const c = conformsToDriver(new MockDriver());
  assert.ok(c.ok, c.errors.join('; '));
  for (const m of DRIVER_METHODS) assert.equal(typeof new MockDriver()[m], 'function', m);
});

test('DRV-02 client refuses a transport that is not a driver', () => {
  assert.throws(() => new DriverClient({}), /does not implement AnalyticsDriver/);
  assert.throws(() => new DriverClient({ classifyPage() {} }), /missing method/);
  assert.throws(() => new DriverClient(null), /does not implement/);
});

test('DRV-03 client exposes all six contract methods', () => {
  const c = fastClient(new MockDriver());
  for (const m of DRIVER_METHODS) assert.equal(typeof c[m], 'function', m);
});

test('DRV-04 classifyPage returns a valid ClassificationResult', async () => {
  const c = fastClient(new MockDriver());
  const r = await c.classifyPage(features());
  assert.ok(['ideal', 'safe', 'mediocre', 'risky', 'known_scam'].includes(r.tier));
  assert.ok(r.confidence >= 0 && r.confidence <= 1);
  assert.ok(Array.isArray(r.suggestedActions));
  assert.equal(typeof r.details, 'string');
});

test('DRV-05 known scam domains classify as known_scam with high confidence', async () => {
  const c = fastClient(new MockDriver());
  for (const d of MOCK_SCAM_DOMAINS) {
    const r = await c.classifyPage(features({ url: `https://${d}/x`, domain: d }));
    assert.equal(r.tier, TIER.KNOWN_SCAM, d);
    assert.ok(r.confidence > 0.9, `${d} confidence ${r.confidence}`);
  }
});

test('DRV-06 malformed PageFeatures is rejected with INVALID_INPUT, not retried', async () => {
  const c = fastClient(new MockDriver());
  await assert.rejects(
    () => c.classifyPage({ url: '' }),
    (e) => e instanceof DriverError && e.code === ERROR_CODE.INVALID_INPUT && e.retryable === false,
  );
  assert.equal(c.stats.retries, 0, 'INVALID_INPUT must never be retried');
});

test('DRV-07 CRITICAL a driver failure NEVER yields a fabricated safe verdict', async () => {
  const c = fastClient(downDriver());
  await assert.rejects(
    () => c.classifyPage(features()),
    (e) => e instanceof DriverError && e.code === ERROR_CODE.EXT_TRANSPORT_UNAVAILABLE,
    'must throw, not return {tier:"safe"} — the observed production driver fails open here (§5.2) and we must not',
  );
});

test('DRV-08 malformed driver response is caught by validation, never dispatched', async () => {
  const m = new MockDriver().setFaults({ malformed: true });
  const raw = await m.classifyPage(features());
  const { validateClassificationResult } = await import('../../src/core/contract.js');
  const v = validateClassificationResult(raw);
  assert.equal(v.ok, false, 'garbage must not validate');
  assert.match(v.errors.join(';'), /tier/);
});

test('DRV-09 timeout fires and is reported as TIMEOUT', async () => {
  const m = new MockDriver().setFaults({ hang: true });
  const c = new DriverClient(m, { timeouts: { healthCheck: 30 }, sleep: async () => {} });
  await assert.rejects(
    () => c.healthCheck(),
    (e) => e.code === ERROR_CODE.TIMEOUT,
  );
  assert.equal(c.stats.timeouts, 1);
});

test('DRV-10 retryable failure is retried and can succeed', async () => {
  const m = new MockDriver().setFaults({ failMethod: 'getThreatList', code: ERROR_CODE.RATE_LIMITED, failTimes: 1 });
  const c = fastClient(m, { retries: { getThreatList: 2 } });
  const bytes = await c.getThreatList();
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(c.stats.retries, 1, 'exactly one retry should have been needed');
});

test('DRV-11 non-retryable failure is not retried', async () => {
  const m = new MockDriver().setFaults({ failMethod: 'classifyPage', code: ERROR_CODE.AUTH_INVALID });
  const c = fastClient(m, { retries: { classifyPage: 3 } });
  await assert.rejects(() => c.classifyPage(features()), (e) => e.code === ERROR_CODE.AUTH_INVALID);
  assert.equal(c.stats.retries, 0);
});

test('DRV-12 retries are exhausted then the last error is thrown', async () => {
  const m = new MockDriver().setFaults({ failMethod: 'submitReport', code: ERROR_CODE.TIMEOUT });
  const c = fastClient(m, { retries: { submitReport: 2 } });
  await assert.rejects(
    () => c.submitReport({ url: 'https://x.example', reportType: 'scam', pageHash: HASH }),
    (e) => e.code === ERROR_CODE.TIMEOUT,
  );
  assert.equal(c.stats.retries, 2, 'must use exactly the configured retry budget');
});

test('DRV-13 backoff uses full jitter within the ceiling', () => {
  const c = fastClient(new MockDriver(), { baseBackoffMs: 100, maxBackoffMs: 1000 });
  const lows = new DriverClient(new MockDriver(), { random: () => 0, baseBackoffMs: 100, maxBackoffMs: 1000, sleep: async () => {} });
  const highs = new DriverClient(new MockDriver(), { random: () => 0.999, baseBackoffMs: 100, maxBackoffMs: 1000, sleep: async () => {} });
  assert.equal(lows._backoffFor(0), 0, 'full jitter must be able to return 0');
  assert.ok(highs._backoffFor(0) <= 100);
  assert.ok(highs._backoffFor(3) <= 800);
  assert.ok(highs._backoffFor(10) <= 1000, 'must respect the ceiling');
  assert.equal(c._backoffFor(1), 100, 'random=0.5 of ceiling 200');
});

test('DRV-14 breaker opens after the threshold of consecutive hard failures', async () => {
  const m = new MockDriver().setFaults({ down: true });
  const c = fastClient(m, { breakerThreshold: 3, retries: { healthCheck: 0 } });
  assert.equal(c.state, BREAKER.CLOSED);
  for (let i = 0; i < 3; i++) await assert.rejects(() => c.healthCheck());
  assert.equal(c.state, BREAKER.OPEN, 'must open at the threshold');
});

test('DRV-15 open breaker short-circuits without touching the transport', async () => {
  const m = new MockDriver().setFaults({ down: true });
  const c = fastClient(m, { breakerThreshold: 2 });
  for (let i = 0; i < 2; i++) await assert.rejects(() => c.healthCheck());
  const before = m.calls.healthCheck;
  await assert.rejects(() => c.healthCheck(), (e) => /circuit breaker is open/.test(e.message));
  assert.equal(m.calls.healthCheck, before, 'transport must NOT be called while open');
  assert.equal(c.stats.shortCircuits, 1);
});

test('DRV-16 breaker half-opens after cooldown and closes on success', async () => {
  let now = 1000;
  const m = new MockDriver().setFaults({ down: true });
  const c = new DriverClient(m, {
    breakerThreshold: 2, breakerCooldownMs: 5000,
    now: () => now, sleep: async () => {}, retries: { healthCheck: 0 },
  });
  for (let i = 0; i < 2; i++) await assert.rejects(() => c.healthCheck());
  assert.equal(c.state, BREAKER.OPEN);
  now += 5000;            // cooldown elapses
  m.clearFaults();        // driver recovers
  assert.equal(await c.healthCheck(), true);
  assert.equal(c.state, BREAKER.CLOSED, 'a successful probe must close the breaker');
});

test('DRV-17 a failed half-open probe re-opens the breaker immediately', async () => {
  let now = 0;
  const m = new MockDriver().setFaults({ down: true });
  const c = new DriverClient(m, {
    breakerThreshold: 2, breakerCooldownMs: 1000,
    now: () => now, sleep: async () => {}, retries: { healthCheck: 0 },
  });
  for (let i = 0; i < 2; i++) await assert.rejects(() => c.healthCheck());
  now += 1000;
  await assert.rejects(() => c.healthCheck());
  assert.equal(c.state, BREAKER.OPEN, 'one failed probe is enough to re-open');
});

test('DRV-18 request-level errors do NOT trip the breaker', async () => {
  const m = new MockDriver();
  const c = fastClient(m, { breakerThreshold: 2 });
  for (let i = 0; i < 5; i++) {
    await assert.rejects(() => c.classifyPage({ url: '' }), (e) => e.code === ERROR_CODE.INVALID_INPUT);
  }
  assert.equal(c.state, BREAKER.CLOSED, 'bad input says nothing about driver health');
});

test('DRV-19 FEATURE_NOT_AVAILABLE does not trip the breaker either', async () => {
  const c = fastClient(new MockDriver({ entitled: false }), { breakerThreshold: 2 });
  for (let i = 0; i < 4; i++) {
    await assert.rejects(() => c.summarizePage('hello world.'), (e) => e.code === ERROR_CODE.FEATURE_NOT_AVAILABLE);
  }
  assert.equal(c.state, BREAKER.CLOSED);
});

test('DRV-20 isHealthy never throws, returns false when down', async () => {
  assert.equal(await fastClient(new MockDriver()).isHealthy(), true);
  assert.equal(await fastClient(downDriver()).isHealthy(), false);
  const hang = new DriverClient(new MockDriver().setFaults({ hang: true }), { timeouts: { healthCheck: 20 } });
  assert.equal(await hang.isHealthy(), false);
});

test('DRV-21 reset closes the breaker for an explicit user retry', async () => {
  const c = fastClient(downDriver(), { breakerThreshold: 1 });
  await assert.rejects(() => c.healthCheck());
  assert.equal(c.state, BREAKER.OPEN);
  c.reset();
  assert.equal(c.state, BREAKER.CLOSED);
  assert.equal(c.consecutiveFailures, 0);
});

test('DRV-22 unknown method is rejected before any transport call', async () => {
  const c = fastClient(new MockDriver());
  await assert.rejects(() => c.call('deleteEverything'), (e) => e.code === ERROR_CODE.INVALID_INPUT);
});

test('DRV-23 getThreatList returns a loadable bloom filter containing the scam domains', async () => {
  const c = fastClient(new MockDriver());
  const bytes = await c.getThreatList();
  const f = BloomFilter.deserialize(bytes);
  for (const d of MOCK_SCAM_DOMAINS) assert.ok(f.has(d), `threat list missing ${d}`);
  assert.equal(f.has('definitely-not-listed.example'), false);
});

test('DRV-24 submitReport validates, stores, dedupes, and updates the threat list (§10.3)', async () => {
  const m = new MockDriver();
  const c = fastClient(m);
  const report = { url: 'https://newly-reported.example/p', reportType: 'phishing', comment: 'fake login', pageHash: HASH };
  assert.equal(await c.submitReport(report), undefined, 'contract says Promise<void>');
  assert.equal(m.reports.length, 1);
  await assert.rejects(() => c.submitReport(report), (e) => /duplicate/.test(e.message));
  const f = BloomFilter.deserialize(await c.getThreatList());
  assert.ok(f.has('newly-reported.example'), 'reported domain must appear in the refreshed list');
});

test('DRV-25 submitReport rejects a bad report type and a bad hash', async () => {
  const c = fastClient(new MockDriver());
  await assert.rejects(
    () => c.submitReport({ url: 'https://x.example', reportType: 'gossip', pageHash: HASH }),
    (e) => e.code === ERROR_CODE.INVALID_INPUT,
  );
  await assert.rejects(
    () => c.submitReport({ url: 'https://x.example', reportType: 'scam', pageHash: 'ZZZ' }),
    (e) => e.code === ERROR_CODE.INVALID_INPUT,
  );
});

test('PRM-01 summarizePage is gated on entitlement', async () => {
  await assert.rejects(
    () => fastClient(new MockDriver({ entitled: false })).summarizePage('Some article text.'),
    (e) => e.code === ERROR_CODE.FEATURE_NOT_AVAILABLE,
  );
  const r = await fastClient(new MockDriver({ entitled: true })).summarizePage(
    'First sentence. Second sentence. Third sentence.',
  );
  assert.ok(r.summary.length > 0);
  assert.equal(typeof r.model, 'string');
  assert.ok(Number.isInteger(r.tokensUsed));
});

test('PRM-02 summarizePage enforces the length cap and rejects empty text', async () => {
  const c = fastClient(new MockDriver({ entitled: true }));
  await assert.rejects(() => c.summarizePage(''), (e) => e.code === ERROR_CODE.INVALID_INPUT);
  await assert.rejects(() => c.summarizePage('   '), (e) => e.code === ERROR_CODE.INVALID_INPUT);
  await assert.rejects(() => c.summarizePage('x'.repeat(100001)), (e) => e.code === ERROR_CODE.INVALID_INPUT);
});

test('PRM-03 verifyEntitlement reflects the entitlement state', async () => {
  assert.equal(await fastClient(new MockDriver({ entitled: true })).verifyEntitlement(), true);
  assert.equal(await fastClient(new MockDriver({ entitled: false })).verifyEntitlement(), false);
});

test('DRV-26 default timeouts match the driver_requirements latency budgets', () => {
  assert.ok(DEFAULT_TIMEOUTS.healthCheck <= 1000, '§2.5 says within 1 s');
  assert.ok(DEFAULT_TIMEOUTS.submitReport <= 2000, '§2.3 says < 2 s');
  assert.ok(DEFAULT_TIMEOUTS.verifyEntitlement <= 3000, '§2.6 says < 3 s');
  assert.ok(DEFAULT_TIMEOUTS.classifyPage <= 5000, '§2.1 says p99 < 5 s');
});

test('DRV-27 error envelope round-trips through the wire format', () => {
  const e = new DriverError(ERROR_CODE.RATE_LIMITED, 'slow down', { details: { retryAfter: 30 } });
  const env = e.toEnvelope();
  assert.equal(env.error.code, 'RATE_LIMITED');
  assert.equal(env.error.retryable, true);
  const back = DriverError.fromEnvelope(env);
  assert.equal(back.code, e.code);
  assert.equal(back.retryable, true);
  assert.deepEqual(back.details, { retryAfter: 30 });
  assert.equal(DriverError.fromEnvelope({}).code, ERROR_CODE.EXT_MALFORMED_RESPONSE);
});

test('DRV-28 an unknown error code degrades to INTERNAL_ERROR rather than propagating', () => {
  const e = new DriverError('WAT_IS_THIS', 'weird');
  assert.equal(e.code, ERROR_CODE.INTERNAL_ERROR);
});

test('DRV-29 native-messaging "no such application" is classified as unavailable', async () => {
  const broken = new MockDriver();
  broken.healthCheck = async () => { throw new Error('No such native application com.extension.av.communication'); };
  const c = fastClient(broken);
  await assert.rejects(() => c.healthCheck(), (e) => e.code === ERROR_CODE.EXT_TRANSPORT_UNAVAILABLE);
});

test('DRV-30 snapshot reports breaker state and counters', async () => {
  const c = fastClient(new MockDriver());
  await c.healthCheck();
  const s = c.snapshot();
  assert.equal(s.state, BREAKER.CLOSED);
  assert.equal(s.calls, 1);
  assert.equal(s.failures, 0);
});
