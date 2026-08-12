/**
 * core/judge_local.js — on-device LLM verdict source for the orchestrator.
 *
 * Wraps the local 4k-LLM judge (llama.cpp, OpenAI-compatible) running at
 * `baseUrl` (default http://localhost:8080). Implements the same `classify`
 * contract the orchestrator expects from `mlHost`:
 *
 *     classify(features) -> { tier, confidence, details, suggestedActions }
 *
 * Design rules (so it can NEVER silently downgrade safety):
 *   - If the judge is unreachable or returns junk, classify THROWS (the
 *     orchestrator catches it and falls back to heuristics — documented §4.3).
 *   - We do NOT return a verdict we cannot defend. A malformed model answer is
 *     treated as a failure, not as "safe".
 *   - The prompt constrains the model to the TIER vocabulary and a 0.6–0.85
 *     confidence band (extension_requirements.md §4.4: ML source confidence).
 *   - `fetchImpl` and `baseUrl` are injectable so tests can drive a local mock
 *     server without a real GPU/LLM.
 *
 * PURE-ish: depends only on a `fetch` (available in MV3 service workers and
 * Node 18+). No chrome.*.
 */

import { TIER } from './tiers.js';

const VALID_TIERS = new Set(Object.values(TIER));

/** Strict JSON extraction: find the first {...} block and parse it. */
function extractJson(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clampBand(n) {
  const v = Number.isFinite(n) ? n : 0.7;
  return Math.min(0.85, Math.max(0.6, v));
}

/**
 * @param {object} features normalised PageFeatures
 * @returns {Promise<{tier:string, confidence:number, details:string}>}
 */
export async function localJudgeClassify(features, { fetchImpl, baseUrl = 'http://localhost:8080', model } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('no fetch implementation available for local judge');

  const prompt = [
    'You are a web-page safety classifier. Given the extracted page signals,',
    'respond with STRICT JSON only: {"tier": one of',
    `["${Object.values(TIER).join('", "')}"], "confidence": number in [0.6,0.85],`,
    '"reason": short string}. Higher tier means more dangerous.',
    'Signals:',
    JSON.stringify({
      url: features.url,
      domain: features.domain,
      title: features.title,
      textSample: (features.textSample || '').slice(0, 1500),
      hasAutoplayMedia: features.hasAutoplayMedia,
      hasPopups: features.hasPopups,
      fullscreenAttempts: features.fullscreenAttempts,
      focusGrabs: features.focusGrabs,
      permissionRequests: features.permissionRequests,
    }),
    'Respond with JSON only.',
  ].join(' ');

  let res;
  try {
    res = await doFetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model || 'local',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 200,
      }),
    });
  } catch (err) {
    throw new Error(`local judge unreachable: ${err && err.message}`);
  }
  if (!res || !res.ok) throw new Error(`local judge returned ${res && res.status}`);

  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content ?? data?.content ?? '';
  const parsed = extractJson(content);
  if (!parsed || !VALID_TIERS.has(parsed.tier)) {
    throw new Error('local judge returned an unparseable or off-vocabulary verdict');
  }
  return {
    tier: parsed.tier,
    confidence: clampBand(parsed.confidence),
    details: `Local LLM judge: ${String(parsed.reason || 'no reason given').slice(0, 200)}`,
  };
}

/**
 * LocalJudge object the orchestrator can hold. Fails-closed on any problem.
 */
export function createLocalJudge({ fetchImpl, baseUrl = 'http://localhost:8080', model } = {}) {
  return {
    async classify(features) {
      const v = await localJudgeClassify(features, { fetchImpl, baseUrl, model });
      return v;
    },
  };
}
