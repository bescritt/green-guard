// Unit tests for the on-device local judge (core/judge_local.js).
//
// The judge is an external LLM; we inject a fake `fetchImpl` so the test is
// deterministic and offline. We assert the failure modes are fail-closed:
// unreachable judge and junk verdicts must THROW (the orchestrator then falls
// back to heuristics), never return a silently-safe verdict.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localJudgeClassify, createLocalJudge } from '../../src/core/judge_local.js';
import { TIER } from '../../src/core/tiers.js';

const FEATURES = {
  url: 'https://example.com/', domain: 'example.com', title: 'x',
  textSample: 'call now your computer is infected', hasAutoplayMedia: true,
  hasPopups: false, fullscreenAttempts: 0, focusGrabs: 0, permissionRequests: [],
};

function fakeFetch(body, { status = 200, ok = true } = {}) {
  return async () => ({
    ok, status,
    json: async () => ({ choices: [{ message: { content: body } }] }),
  });
}

test('local judge parses a valid tier verdict', async () => {
  const f = fakeFetch(JSON.stringify({ tier: 'risky', confidence: 0.72, reason: 'scam language' }));
  const v = await localJudgeClassify(FEATURES, { fetchImpl: f });
  assert.equal(v.tier, 'risky');
  assert.equal(v.confidence, 0.72);
  assert.match(v.details, /Local LLM judge/);
});

test('local judge clamps confidence into the ML band 0.6–0.85', async () => {
  const f = fakeFetch(JSON.stringify({ tier: 'known_scam', confidence: 0.01, reason: 'x' }));
  const v = await localJudgeClassify(FEATURES, { fetchImpl: f });
  assert.equal(v.confidence, 0.6); // clamped up
  assert.equal(v.tier, 'known_scam');
});

test('local judge rejects an off-vocabulary tier (fail-closed)', async () => {
  const f = fakeFetch(JSON.stringify({ tier: 'banana', confidence: 0.7 }));
  await assert.rejects(() => localJudgeClassify(FEATURES, { fetchImpl: f }), /unparseable|off-vocabulary/);
});

test('local judge rejects unparseable model output (fail-closed)', async () => {
  const f = fakeFetch('Sorry, I cannot help with that. Here is some prose with no json.');
  await assert.rejects(() => localJudgeClassify(FEATURES, { fetchImpl: f }));
});

test('local judge throws when the endpoint is unreachable (fail-closed)', async () => {
  const f = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(() => localJudgeClassify(FEATURES, { fetchImpl: f }), /unreachable/);
});

test('local judge throws on a non-200 response', async () => {
  const f = fakeFetch('', { status: 503, ok: false });
  await assert.rejects(() => localJudgeClassify(FEATURES, { fetchImpl: f }), /returned 503/);
});

test('createLocalJudge wraps classify and fails closed', async () => {
  const judge = createLocalJudge({ fetchImpl: fakeFetch(JSON.stringify({ tier: TIER.MEDIOCRE, confidence: 0.65, reason: 'ok' })) });
  const v = await judge.classify(FEATURES);
  assert.equal(v.tier, TIER.MEDIOCRE);
  const broken = createLocalJudge({ fetchImpl: async () => { throw new Error('down'); } });
  await assert.rejects(() => broken.classify(FEATURES));
});
