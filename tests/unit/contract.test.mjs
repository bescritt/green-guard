import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePageFeatures, validateClassificationResult, validateReportSubmission,
  validateSummaryResult, conformsToDriver, DRIVER_METHODS, LIMITS,
} from '../../src/core/contract.js';
import { BloomFilter } from '../../src/core/bloom.js';
import { TIER, ACTION } from '../../src/core/tiers.js';

const HASH = 'a'.repeat(64);

test('CON-01 PageFeatures: rejects empty url and missing fields', () => {
  assert.equal(validatePageFeatures({}).ok, false);
  assert.equal(validatePageFeatures({ url: '' }).ok, false);
  assert.equal(validatePageFeatures({ url: 'x' }).ok, false, 'needs a domain');
  assert.equal(validatePageFeatures('nonsense').ok, false);
  assert.equal(validatePageFeatures(null).ok, false);
});

test('CON-02 PageFeatures: accepts a minimal valid record and normalises arrays', () => {
  const v = validatePageFeatures({
    url: 'https://x.example/p', domain: 'x.example', title: 'T',
    textSample: 'hello', hasAutoplayMedia: false, hasPopups: false,
    fullscreenAttempts: 0, focusGrabs: 0, permissionRequests: ['geolocation'],
  });
  assert.ok(v.ok, v.errors.join('; '));
  assert.equal(v.value.domain, 'x.example');
});

test('CON-03 PageFeatures: truncates textSample at 8 KB and never splits a UTF-8 code point', () => {
  const long = 'é'.repeat(20000); // 2 bytes each → 40000 bytes, well over 8KiB
  const v = validatePageFeatures({ url: 'https://x.example', domain: 'x.example', textSample: long });
  assert.ok(v.ok);
  const bytes = new TextEncoder().encode(v.value.textSample);
  assert.ok(bytes.length <= LIMITS.TEXT_SAMPLE_BYTES, `bytes=${bytes.length} <= ${LIMITS.TEXT_SAMPLE_BYTES}`);
  assert.ok(v.value.textSample.endsWith('é'), 'must not end mid-code-point');
});

test('CON-04 PageFeatures: rejects non-array permissionRequests and bad flags', () => {
  assert.equal(validatePageFeatures({ url: 'https://x.example', domain: 'x.example', permissionRequests: 'geolocation' }).ok, false);
  assert.equal(validatePageFeatures({ url: 'https://x.example', domain: 'x.example', hasAutoplayMedia: 'yes' }).ok, false);
});

test('CON-05 ClassificationResult: rejects an unknown tier; repairs (clamps) out-of-range confidence; filters bad actions', () => {
  assert.equal(validateClassificationResult({ tier: 'DEFINITELY_BAD', confidence: 0.5 }).ok, false, 'unknown tier is fatal');
  // Out-of-range confidence is clamped, not rejected (a tier is still actionable).
  const clamped = validateClassificationResult({ tier: TIER.SAFE, confidence: 7.5 });
  assert.ok(clamped.ok, 'overshoot confidence is repaired');
  assert.equal(clamped.value.confidence, 1, 'clamped to 1');
  const low = validateClassificationResult({ tier: TIER.SAFE, confidence: -3 });
  assert.ok(low.ok);
  assert.equal(low.value.confidence, 0, 'clamped to 0');
  // Unknown suggested actions are filtered out, not fatal.
  const filtered = validateClassificationResult({ tier: TIER.RISKY, confidence: 0.5, suggestedActions: ['mute', 'launch_nukes'] });
  assert.ok(filtered.ok);
  assert.deepEqual(filtered.value.suggestedActions, ['mute']);
});

test('CON-06 ClassificationResult: rejects a non-array suggestedActions container', () => {
  assert.equal(validateClassificationResult({ tier: TIER.SAFE, confidence: 0.5, suggestedActions: 'mute' }).ok, false, 'string actions rejected');
  assert.equal(validateClassificationResult({ tier: TIER.SAFE }).ok, false, 'confidence required (structural)');
});

test('CON-07 ClassificationResult: accepts a fully-formed result', () => {
  const v = validateClassificationResult({
    tier: TIER.RISKY, confidence: 0.7, suggestedActions: [ACTION.WARN, ACTION.LOCK], details: 'reasons',
  });
  assert.ok(v.ok, v.errors.join('; '));
});

test('CON-08 ReportSubmission: accepts the valid types and a 64-hex hash', () => {
  for (const t of ['scam', 'phishing', 'malware', 'fraud', 'spam']) {
    const v = validateReportSubmission({ url: 'https://x.example', reportType: t, pageHash: HASH });
    assert.ok(v.ok, `${t}: ${v.errors.join('; ')}`);
  }
});

test('CON-09 ReportSubmission: rejects a bad type, a malformed hash, and a missing url', () => {
  assert.equal(validateReportSubmission({ url: 'https://x.example', reportType: 'gossip', pageHash: HASH }).ok, false);
  assert.equal(validateReportSubmission({ url: 'https://x.example', reportType: 'scam', pageHash: 'zzz' }).ok, false);
  assert.equal(validateReportSubmission({ url: '', reportType: 'scam', pageHash: HASH }).ok, false, 'empty url rejected');
  assert.equal(validateReportSubmission({ reportType: 'scam', pageHash: HASH }).ok, false, 'missing url rejected');
});

test('CON-10 SummaryResult: requires summary + model + integer tokens', () => {
  assert.ok(validateSummaryResult({ summary: 'S', model: 'm', tokensUsed: 3 }).ok);
  assert.equal(validateSummaryResult({ summary: 'S', model: 'm' }).ok, false);
  assert.equal(validateSummaryResult({ summary: 42, model: 'm', tokensUsed: 3 }).ok, false);
  assert.equal(validateSummaryResult({ summary: 'S', model: 'm', tokensUsed: 'many' }).ok, false);
});

test('CON-11 LIMITS are within the documented driver_requirements budgets', () => {
  assert.ok(LIMITS.FULL_TEXT_CHARS >= 100000, '§2.2 cap');
  assert.equal(LIMITS.TEXT_SAMPLE_BYTES, 8 * 1024, 'PageFeatures first 8 KB');
  assert.ok(LIMITS.THREAT_LIST_BYTES >= 8 * 1024 * 1024, 'a 100k-domain bloom is ~196KB; cap allows margin');
});

test('CON-13 conformsToDriver accepts a faithful implementation and names missing methods', () => {
  const good = {};
  for (const m of DRIVER_METHODS) good[m] = async () => {};
  assert.ok(conformsToDriver(good).ok);
  assert.equal(conformsToDriver({ classifyPage() {} }).ok, false, 'missing 5 methods');
  assert.equal(conformsToDriver(null).ok, false);
});
