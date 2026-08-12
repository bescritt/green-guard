/**
 * core/arbitrate.js — decide the final tier from several disagreeing sources.
 *
 * PURE. No chrome.*, no I/O.
 *
 * extension_requirements.md §4.4 states the rules compactly:
 *   | Bloom filter positive | known_scam | 0.99 |
 *   | Driver classification | any        | as returned |
 *   | Local ML + heuristics | any        | 0.6–0.85 |
 *   "The highest-confidence source wins. If driver and local ML disagree, the
 *    driver takes precedence (unless the driver is unreachable)."
 *
 * Those two sentences are not the same rule, and the difference matters: a
 * driver returning `safe` at 0.55 versus local ML returning `risky` at 0.80 is
 * decided one way by "highest confidence" and the other by "driver takes
 * precedence". We resolve the ambiguity explicitly (recorded as a spec conflict
 * in the risk register) with a documented precedence lattice:
 *
 *   1. WHITELIST — user intent is absolute; short-circuits everything.
 *   2. BLOOM     — a signed, locally-verified threat list is authority, not opinion.
 *   3. DRIVER    — precedence over local ML when reachable AND its confidence is
 *                  not derisory (>= DRIVER_MIN_CONFIDENCE).
 *   4. Otherwise highest confidence wins; ties break toward the SAFER verdict.
 *
 * Rule 4's tie-break is a deliberate safety bias: when two sources are equally
 * confident and disagree, protecting the user costs a false positive, while the
 * other choice costs a compromised user. The whitelist and "Proceed anyway"
 * make the false positive cheap and reversible.
 */

import { TIER, tierRank, isTier, worseTier } from './tiers.js';

export const SOURCE = Object.freeze({
  WHITELIST: 'whitelist',
  BLOOM: 'bloom',
  DRIVER: 'driver',
  ML: 'ml',
  HEURISTIC: 'heuristic',
});

/** Authority rank; higher wins on precedence, independent of confidence. */
const SOURCE_AUTHORITY = Object.freeze({
  [SOURCE.WHITELIST]: 100,
  [SOURCE.BLOOM]: 80,
  [SOURCE.DRIVER]: 60,
  [SOURCE.ML]: 40,
  [SOURCE.HEURISTIC]: 20,
});

export const BLOOM_CONFIDENCE = 0.99; // §4.4, fixed by spec
export const DRIVER_MIN_CONFIDENCE = 0.5;

/**
 * @typedef {{source:string, tier:string, confidence:number, details?:string,
 *            suggestedActions?:string[], reachable?:boolean}} Verdict
 */

/**
 * Arbitrate a set of verdicts into one decision.
 *
 * @param {Verdict[]} verdicts
 * @param {object}   [opts]
 * @param {boolean}  [opts.whitelisted] user has whitelisted this domain
 * @returns {{tier:string, confidence:number, source:string, details:string,
 *            suggestedActions:string[], considered:Verdict[], reasoning:string}}
 */
export function arbitrate(verdicts, { whitelisted = false } = {}) {
  const considered = (Array.isArray(verdicts) ? verdicts : [])
    .filter((v) => v && isTier(v.tier))
    .map((v) => ({
      source: v.source,
      tier: v.tier,
      confidence: clamp01(typeof v.confidence === 'number' ? v.confidence : 0),
      details: typeof v.details === 'string' ? v.details : '',
      suggestedActions: Array.isArray(v.suggestedActions) ? v.suggestedActions : [],
      reachable: v.reachable !== false,
      authority: SOURCE_AUTHORITY[v.source] ?? 0,
    }));

  if (whitelisted) {
    return {
      tier: TIER.IDEAL,
      confidence: 1,
      source: SOURCE.WHITELIST,
      details: 'Domain is on your whitelist',
      suggestedActions: [],
      considered,
      reasoning: 'whitelist short-circuit: user intent overrides all classifiers',
    };
  }

  if (considered.length === 0) {
    // No opinion at all. Do not invent one; "mediocre/unknown" with low
    // confidence is the honest answer and triggers nothing by default.
    return {
      tier: TIER.MEDIOCRE,
      confidence: 0,
      source: SOURCE.HEURISTIC,
      details: 'No classification available',
      suggestedActions: [],
      considered,
      reasoning: 'no verdicts supplied: defaulting to neutral with zero confidence',
    };
  }

  // 2. Bloom filter positive is authority.
  const bloomHit = considered.find(
    (v) => v.source === SOURCE.BLOOM && tierRank(v.tier) >= tierRank(TIER.RISKY),
  );
  if (bloomHit) {
    return finish(
      { ...bloomHit, confidence: Math.max(bloomHit.confidence, BLOOM_CONFIDENCE) },
      considered,
      'bloom filter hit: signed local threat list is authoritative (§4.4)',
    );
  }

  // 3. Driver precedence when reachable and not derisory.
  const driver = considered.find((v) => v.source === SOURCE.DRIVER && v.reachable);
  const locals = considered.filter((v) => v.source === SOURCE.ML || v.source === SOURCE.HEURISTIC);
  if (driver && driver.confidence >= DRIVER_MIN_CONFIDENCE) {
    const dissent = locals.find((l) => tierRank(l.tier) > tierRank(driver.tier) && l.confidence >= 0.8);
    if (dissent) {
      // Driver says milder, a *highly* confident local source says worse.
      // Take the worse tier but attribute honestly and keep the lower confidence:
      // this is a disagreement, not a consensus, and the UI should say so.
      return finish(
        {
          source: SOURCE.DRIVER,
          tier: worseTier(driver.tier, dissent.tier),
          confidence: Math.min(driver.confidence, dissent.confidence),
          details: [driver.details, dissent.details].filter(Boolean).join(' | '),
          suggestedActions: mergeActions(driver, dissent),
        },
        considered,
        `driver precedence with high-confidence local dissent (${dissent.source} @${dissent.confidence}): escalated to safer tier`,
      );
    }
    return finish(driver, considered, 'driver reachable and confident: driver takes precedence (§4.4)');
  }

  // 4. Highest confidence; ties break toward the safer (worse) tier, then authority.
  const best = [...considered].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const rb = tierRank(b.tier), ra = tierRank(a.tier);
    if (rb !== ra) return rb - ra; // worse tier wins a tie: safety bias
    return b.authority - a.authority;
  })[0];

  return finish(
    best,
    considered,
    driver
      ? `driver present but confidence ${driver.confidence} < ${DRIVER_MIN_CONFIDENCE}: fell through to highest-confidence source`
      : 'no reachable driver: highest-confidence local source wins, ties break safer',
  );
}

function finish(v, considered, reasoning) {
  return {
    tier: v.tier,
    confidence: clamp01(v.confidence),
    source: v.source,
    details: v.details || '',
    suggestedActions: Array.isArray(v.suggestedActions) ? [...new Set(v.suggestedActions)] : [],
    considered,
    reasoning,
  };
}

function mergeActions(a, b) {
  return [...new Set([...(a.suggestedActions || []), ...(b.suggestedActions || [])])];
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
