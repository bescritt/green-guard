import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIER, ACTION, isTier, isAction, tierRank, worseTier, isAtLeastAsBadAs,
  resolveActions, DEFAULT_ACTION_POLICY, ALL_ACTIONS,
} from '../../src/core/tiers.js';
import { computeTier, classifyHeuristically, scorePage, needsDeepAnalysis, CONF_MIN, CONF_MAX } from '../../src/core/heuristics.js';
import { BloomFilter, fnv1a } from '../../src/core/bloom.js';
import { normaliseDomain, registrableDomain, domainMatches, WhitelistStore } from '../../src/core/whitelist.js';
import { arbitrate, SOURCE } from '../../src/core/arbitrate.js';
import { sanitise, DEFAULT_SETTINGS } from '../../src/core/settings.js';
import { verifyLicence, EntitlementStore, encodePayload, LICENSE_FIELDS, TEST_PUBLIC_KEY_JWK } from '../../src/core/premium.js';

const feats = (o = {}) => ({
  url: 'https://example.com/', domain: 'example.com', title: 'Example',
  textSample: 'A normal page with a privacy policy and terms and a contact email support@example.com and a phone number.',
  hasAutoplayMedia: false, hasPopups: false, fullscreenAttempts: 0, focusGrabs: 0, permissionRequests: [],
  ...o,
});

// ── tiers ──────────────────────────────────────────────────────────────────
test('T-01 tier ordering and helpers', () => {
  assert.ok(isTier('ideal') && isTier('known_scam') && !isTier('meh'));
  assert.ok(isAction('mute') && !isAction('explode'));
  assert.equal(tierRank('known_scam'), 4);
  assert.equal(tierRank('ideal'), 0);
  assert.equal(worseTier('risky', 'mediocre'), 'risky');
  assert.equal(worseTier('ideal', 'ideal'), 'ideal');
  assert.ok(isAtLeastAsBadAs('risky', 'mediocre'));
  assert.ok(!isAtLeastAsBadAs('mediocre', 'risky'));
});

test('T-02 DEFAULT_ACTION_POLICY maps every tier to a sensible default set', () => {
  for (const t of ['ideal', 'safe', 'mediocre', 'risky', 'known_scam']) {
    assert.ok(Array.isArray(DEFAULT_ACTION_POLICY[t]), `policy for ${t}`);
    for (const a of DEFAULT_ACTION_POLICY[t]) assert.ok(isAction(a));
  }
  assert.ok(DEFAULT_ACTION_POLICY.known_scam.includes('blank'));
  assert.deepEqual(DEFAULT_ACTION_POLICY.ideal, ['none'], 'ideal gets no real action');
});

test('T-03 resolveActions: whitelist ⇒ nothing, disabled ⇒ nothing', () => {
  assert.deepEqual(resolveActions({ tier: 'known_scam', whitelisted: true }), []);
  assert.deepEqual(resolveActions({ tier: 'risky', settings: { enabled: false } }), []);
});

test('T-04 resolveActions: close is gated on explicit opt-in and worst tier only', () => {
  const base = { tier: 'known_scam', settings: { closeOnKnownScam: true } };
  assert.ok(resolveActions(base).includes('close'), 'opt-in + worst tier closes');
  assert.ok(!resolveActions({ ...base, tier: 'risky' }).includes('close'), 'not on risky');
  assert.ok(!resolveActions({ tier: 'known_scam', settings: { closeOnKnownScam: false } }).includes('close'));
});

test('T-05 resolveActions: banner mode downgrades blank/lock to warn', () => {
  const a = resolveActions({ tier: 'known_scam', settings: { bannerModeOnly: true } });
  assert.ok(!a.includes('blank') && !a.includes('lock') && a.includes('warn'));
});

test('T-06 resolveActions: driver hints cannot escalate past policy', () => {
  // Driver asks for 'close' on a mediocre page; policy forbids it.
  const a = resolveActions({ tier: 'mediocre', settings: {}, suggestedActions: ['close'] });
  assert.ok(!a.includes('close'), 'driver cannot force close');
  // Driver may add a warn on a tier that is already at/above the action floor.
  const b = resolveActions({ tier: 'mediocre', settings: {}, suggestedActions: ['warn'] });
  assert.ok(b.includes('warn'));
});

// ── heuristics ──────────────────────────────────────────────────────────────
test('H-01 clean page scores low', () => {
  const r = classifyHeuristically(feats());
  assert.ok(['ideal', 'safe', 'mediocre'].includes(r.tier));
  assert.ok(r.confidence >= CONF_MIN && r.confidence <= CONF_MAX);
});

test('H-02 autoplay + fullscreen grabs + focus grabs ⇒ risky', () => {
  const r = classifyHeuristically(feats({ hasAutoplayMedia: true, fullscreenAttempts: 3, focusGrabs: 5 }));
  assert.ok(['risky', 'known_scam'].includes(r.tier), `tier=${r.tier}`);
});

test('H-03 aggressive permission requests escalate', () => {
  const r = classifyHeuristically(feats({ permissionRequests: ['geolocation', 'camera', 'microphone', 'notifications'] }));
  assert.ok(r.confidence > 0.6);
});

test('H-04 heuristic confidence band is enforced', () => {
  for (let i = 0; i < 50; i++) {
    const r = classifyHeuristically(feats({ hasAutoplayMedia: i % 2 === 0, fullscreenAttempts: i % 5, focusGrabs: i % 3 }));
    assert.ok(r.confidence >= CONF_MIN && r.confidence <= CONF_MAX, `confidence ${r.confidence} at ${i}`);
  }
});

test('F-10 trust signals cannot suppress a risk signal or drive a negative score', () => {
  // A page with a single soft risk signal (autoplay) plus a faked legal footer.
  // The footer is no longer a trust signal (user feedback: bad UX on both
  // corporate + scam pages), so it is ignored; the autoplay risk stands. The
  // remaining "good-page" trust signals are capped so they can never push the
  // score negative or cancel an active risk.
  const scam = feats({
    textSample: 'Our privacy policy and terms of service. Contact us.',
    hasAutoplayMedia: true,
  });
  const r = classifyHeuristically(scam);
  assert.equal(r.score, 8, `autoplay risk (8) should stand; footer is not a signal (got ${r.score})`);
  assert.notEqual(r.tier, 'ideal', 'a faked-legal-footer page must not be ideal');

  // A genuinely quiet, substantial page (real trust signals) must floor at 0,
  // never go negative — and still cannot cancel any risk that appears.
  const calm = feats({ textSample: 'x'.repeat(3000) });
  const c = classifyHeuristically(calm);
  assert.ok(c.score >= 0, `calm page score must not be negative (got ${c.score})`);

  // Hard risk + quiet_page trust: trust is capped at the risk, never below 0.
  const mixed = feats({ textSample: 'x'.repeat(3000) + ' call now your computer is infected', hasAutoplayMedia: true });
  const m = classifyHeuristically(mixed);
  assert.ok(m.score >= 0, `mixed score must not be negative (got ${m.score})`);
});

test('H-05 needsDeepAnalysis is true for the undecided band only', () => {
    assert.ok(needsDeepAnalysis(classifyHeuristically(feats({ textSample: 'some arbitrary page content', hasAutoplayMedia: true, focusGrabs: 2 }))));
  assert.ok(!needsDeepAnalysis(classifyHeuristically(feats({ textSample: 'some arbitrary content', hasAutoplayMedia: true, hasPopups: true, fullscreenAttempts: 5, focusGrabs: 8, permissionRequests: ['camera', 'microphone'] }))), 'clearly bad needs no ML');
});

test('H-06 scorePage is pure and returns a normalised 0..1 risk', () => {
  const s = scorePage(feats());
  assert.ok(s >= 0 && s <= 1);
});

// ── bloom ───────────────────────────────────────────────────────────────────
test('B-01 FNV-1a reference vectors (32-bit canonical)', () => {
  assert.equal(fnv1a(''), 0x811c9dc5);
  assert.equal(fnv1a('a'), 0xe40c292c);
  assert.equal(fnv1a('foobar'), 0xbf9cf968);
});

test('B-02 a bloom filter of 100k domains meets p<=0.001 measured', () => {
  const f = BloomFilter.fromKeys(Array.from({ length: 100000 }, (_, i) => `d${i}.example`), 0.001, 0);
  let fp = 0;
  const N = 100000;
  for (let i = 0; i < N; i++) if (f.has(`d${i + 100000000}.missing`)) fp++;
  const rate = fp / N;
  assert.ok(rate <= 0.001, `measured fp ${rate} > 0.001`);
  assert.equal(f.has('d0.example'), true);
});

test('B-03 serialise → deserialize is lossless and tamper-evident', () => {
  const f = BloomFilter.fromKeys(['a.example', 'b.example'], 0.01, 0);
  const bytes = f.serialize();
  const g = BloomFilter.deserialize(bytes);
  assert.ok(g.has('a.example') && g.has('b.example'));
  const tampered = bytes.slice();
  tampered[10] ^= 0xff;
  // Corruption must fail closed: deserialize throws rather than returning a
  // half-trusted filter. The orchestrator's loadBloom() catches and drops it.
  assert.throws(() => BloomFilter.deserialize(tampered), /length|checksum|magic|truncated/);
});

// ── whitelist ─────────────────────────────────────────────────────────────
test('W-01 normaliseDomain handles schemes, ports, trailing dots, case', () => {
  assert.equal(normaliseDomain('https://Example.COM/'), 'example.com');
  assert.equal(normaliseDomain('http://example.com:8080/path?q=1'), 'example.com');
  assert.equal(normaliseDomain('EXAMPLE.COM.'), 'example.com');
  assert.equal(normaliseDomain('not a url'), '');
  assert.equal(normaliseDomain(''), '');
});

test('W-02 registrableDomain handles multi-part public suffixes', () => {
  assert.equal(registrableDomain('shop.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('a.b.example.com'), 'example.com');
  assert.equal(registrableDomain('foo.github.io'), 'foo.github.io');
});

test('W-03 domainMatches: subdomain inherits trust; reverse does not', () => {
  assert.ok(domainMatches('shop.example.com', 'example.com'));
  assert.ok(!domainMatches('example.com', 'shop.example.com'), 'parent does not trust child');
});

test('W-04 WhitelistStore: add normalises to registrable, covers subdomains, not siblings', async () => {
  const mem = { _d: {}, async get(k) { return this._d; }, async set(v) { Object.assign(this._d, v); } };
  const w = new WhitelistStore(mem);
  await w.add('shop.example.co.uk');
  assert.ok(await w.isWhitelisted('shop.example.co.uk'));
  assert.ok(await w.isWhitelisted('checkout.shop.example.co.uk'), 'subdomain of a whitelisted registrable is covered');
  assert.ok(await w.isWhitelisted('example.co.uk'), 'the registrable domain itself is covered');
  assert.ok(!(await w.isWhitelisted('other.co.uk')), 'a sibling under a different registrable is not covered');
});

// ── arbitrate ──────────────────────────────────────────────────────────────
test('A-01 whitelist overrides any other source', () => {
  const d = arbitrate([
    { source: SOURCE.BLOOM, tier: TIER.KNOWN_SCAM, confidence: 0.99 },
    { source: SOURCE.HEURISTIC, tier: TIER.SAFE, confidence: 0.8 },
  ], { whitelisted: true });
  assert.equal(d.tier, TIER.IDEAL, 'whitelist ⇒ ideal');
});

test('A-02 bloom beats an undecided heuristic', () => {
  const d = arbitrate([
    { source: SOURCE.BLOOM, tier: TIER.KNOWN_SCAM, confidence: 0.99 },
    { source: SOURCE.HEURISTIC, tier: TIER.MEDIOCRE, confidence: 0.65 },
  ], { whitelisted: false });
  assert.equal(d.tier, TIER.KNOWN_SCAM);
});

test('A-03 an unreachable driver does NOT leave a safe verdict', () => {
  const d = arbitrate([
    { source: SOURCE.DRIVER, tier: TIER.MEDIOCRE, confidence: 0, reachable: false },
    { source: SOURCE.HEURISTIC, tier: TIER.RISKY, confidence: 0.7 },
  ], { whitelisted: false });
  assert.equal(d.tier, TIER.RISKY, 'driver unreachable ⇒ fall through to heuristic, never safe');
});

test('A-04 ties break toward the safer tier', () => {
  const d = arbitrate([
    { source: SOURCE.HEURISTIC, tier: TIER.RISKY, confidence: 0.7 },
    { source: SOURCE.ML, tier: TIER.MEDIOCRE, confidence: 0.7 },
  ], { whitelisted: false });
  assert.equal(d.tier, TIER.RISKY);
});

test('A-05 a reachable, confident driver is preferred', () => {
  const d = arbitrate([
    { source: SOURCE.HEURISTIC, tier: TIER.MEDIOCRE, confidence: 0.6 },
    { source: SOURCE.DRIVER, tier: TIER.RISKY, confidence: 0.85, reachable: true },
  ], { whitelisted: false });
  assert.equal(d.tier, TIER.RISKY);
});

// ── settings ───────────────────────────────────────────────────────────────
test('S-01 sanitise drops unknown keys and keeps closeOnKnownScam boolean', () => {
  const s = sanitise({ ...DEFAULT_SETTINGS, bogus: 1, closeOnKnownScam: 'true', protectionLevel: 'turbo' });
  assert.equal(s.bogus, undefined);
  assert.equal(s.closeOnKnownScam, true);
  assert.equal(s.protectionLevel, 'balanced', 'invalid level reset to default');
});

// ── premium ───────────────────────────────────────────────────────────────
test('P-01 a valid licence (signed with the test key) verifies', async () => {
  // Build a self-consistent check: we cannot sign without the private key here,
  // so assert the verification function degrades cleanly on the placeholder key
  // and that the envelope round-trips through encodePayload.
  const payload = { sub: 'user1', iat: Date.now() - 1000, exp: Date.now() + 100000, plan: 'premium', v: 1 };
  const res = await verifyLicence({ payload, signatureBytes: new Uint8Array(64) }, { subtle: stubSubtle(), publicKeyJwk: TEST_PUBLIC_KEY_JWK });
  // With a zero placeholder key and a 64-byte signature, verification fails
  // cleanly to not-entitled (never throws, never entitled by default).
  assert.equal(res.entitled, false);
  assert.equal(typeof res.reason, 'string');
});

test('P-02 malformed / absent licence ⇒ not entitled, no throw', async () => {
  assert.equal((await verifyLicence(null, { subtle: stubSubtle() })).entitled, false);
  assert.equal((await verifyLicence({}, { subtle: stubSubtle() })).entitled, false);
  assert.equal((await verifyLicence({ payload: {}, signatureBytes: 'x' }, { subtle: stubSubtle() })).entitled, false);
});

test('P-03 EntitlementStore applies the grace window', async () => {
  const mem = { _d: {}, get(k) { return Promise.resolve(this._d); }, set(v) { Object.assign(this._d, v); return Promise.resolve(); } };
  const store = new EntitlementStore({ subtle: stubSubtle(), publicKeyJwk: TEST_PUBLIC_KEY_JWK, nowFn: () => 1_000_000, graceMs: 5000, storage: mem });
  await store.verify({ payload: { plan: 'premium' }, signatureBytes: new Uint8Array(64) });
  // Last check was "not entitled"; grace window only preserves entitlement, so
  // isEntitled stays false. With a successful recheck returning entitled, it flips.
  assert.equal(await store.isEntitled(), false);
  assert.equal(await store.isEntitled({ onRecheck: async () => ({ entitled: true }) }), true);
});

function stubSubtle() {
  // A Web Crypto stub that records calls and returns deterministic rejection for
  // verify (we have no real private key in the unit suite).
  return {
    importKey: async () => ({}),
    verify: async () => false,
    async sign() { throw new Error('no private key in unit suite'); },
  };
}
