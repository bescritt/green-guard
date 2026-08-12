/**
 * core/heuristics.js — the rule-based classifier.
 *
 * PURE. No chrome.*, no DOM.
 *
 * Two jobs (extension_requirements.md §4.2, §4.3 "Fallback"):
 *   1. Score a page from extracted features, to decide whether the expensive
 *      offscreen ML pass is worth waking up.
 *   2. BE the classifier when the driver is unreachable and ML cannot load.
 *      This is the floor of the system: it must never throw, never depend on
 *      the network, and always return a usable tier.
 *
 * Every rule carries its weight and a human-readable reason, because "risky,
 * confidence 0.72" with no explanation is not a product, it is a rumour.
 */

import { TIER, ACTION } from './tiers.js';

/**
 * Rule set. `test(f)` returns true when the signal is present.
 * Weights are additive; the total maps to a tier via SCORE_THRESHOLDS.
 * Negative weights are trust signals.
 */
export const RULES = Object.freeze([
  {
    id: 'autoplay_media',
    weight: 8,
    reason: 'Media plays automatically without user interaction',
    test: (f) => f.hasAutoplayMedia === true,
  },
  {
    id: 'popups',
    weight: 15,
    reason: 'Page opened pop-up windows',
    test: (f) => f.hasPopups === true,
  },
  {
    id: 'fullscreen_grab',
    weight: 18,
    reason: 'Page attempted to take over the full screen',
    test: (f) => (f.fullscreenAttempts | 0) > 0,
  },
  {
    id: 'repeat_fullscreen_grab',
    weight: 12,
    reason: 'Repeated full-screen takeover attempts',
    test: (f) => (f.fullscreenAttempts | 0) > 2,
  },
  {
    id: 'focus_grabs',
    weight: 10,
    reason: 'Page repeatedly stole keyboard focus',
    test: (f) => (f.focusGrabs | 0) > 2,
  },
  {
    id: 'aggressive_permissions',
    weight: 12,
    reason: 'Requested intrusive permissions immediately on load',
    test: (f) => {
      const p = Array.isArray(f.permissionRequests) ? f.permissionRequests : [];
      const intrusive = ['notifications', 'geolocation', 'camera', 'microphone', 'midi'];
      return p.some((x) => intrusive.includes(String(x).toLowerCase()));
    },
  },
  {
    id: 'permission_pile_on',
    weight: 10,
    reason: 'Requested three or more permissions at once',
    test: (f) => (Array.isArray(f.permissionRequests) ? f.permissionRequests.length : 0) >= 3,
  },
  {
    id: 'tech_support_scam_language',
    weight: 34,
    reason: 'Text matches the tech-support scam pattern (call this number now)',
    test: (f) => {
      const t = lower(f.textSample);
      const alarm =
        /\b(virus|malware|infected|trojan|spyware|hacked|compromised)\b/.test(t) &&
        /\b(call|dial|contact|phone)\b/.test(t) &&
        /(\+?\d[\d\s().-]{7,}\d)/.test(t);
      return alarm;
    },
  },
  {
    id: 'fake_security_alert',
    weight: 28,
    reason: 'Imitates an operating-system or browser security warning',
    test: (f) => {
      const t = lower(f.textSample);
      return (
        /\b(windows|microsoft|apple|mcafee|norton)\b/.test(t) &&
        /\b(security alert|warning|critical alert|your (pc|computer|device) is)\b/.test(t)
      );
    },
  },
  {
    id: 'credential_urgency',
    weight: 22,
    reason: 'Urgent demand for account credentials or verification',
    test: (f) => {
      const t = lower(f.textSample);
      return (
        /\b(verify|confirm|re-?activate|unlock|suspend(ed)?|locked)\b/.test(t) &&
        /\b(account|password|login|sign ?in|billing|payment)\b/.test(t) &&
        /\b(immediately|within \d+ (hours?|minutes?)|urgent|now|expire)/.test(t)
      );
    },
  },
  {
    id: 'prize_bait',
    weight: 20,
    reason: 'Prize, giveaway or lottery bait',
    test: (f) => {
      const t = lower(f.textSample);
      return /\b(you('ve| have) won|congratulations|claim your (prize|reward|gift)|free (iphone|gift ?card)|lucky winner)\b/.test(t);
    },
  },
  {
    id: 'crypto_doubling',
    weight: 30,
    reason: 'Cryptocurrency giveaway or doubling scheme',
    test: (f) => {
      const t = lower(f.textSample);
      return /\b(double your (btc|eth|crypto|bitcoin)|send \d+ (btc|eth)|giveaway)\b/.test(t)
        && /\b(bitcoin|btc|ethereum|eth|wallet|usdt)\b/.test(t);
    },
  },
  {
    id: 'countdown_pressure',
    weight: 12,
    reason: 'Artificial countdown or scarcity pressure',
    test: (f) => {
      const t = lower(f.textSample);
      return /\b(offer expires|only \d+ (left|remaining)|hurry|limited time|act now|last chance)\b/.test(t);
    },
  },
  {
    id: 'no_contact_info',
    weight: 8,
    reason: 'No contact, legal or company information found',
    test: (f) => {
      const t = lower(f.textSample);
      if (t.length < 400) return false; // too little text to judge
      return !/\b(contact|about us|privacy|terms|imprint|impressum|©|copyright|all rights reserved)\b/.test(t);
    },
  },
  {
    id: 'punycode_or_lookalike',
    weight: 24,
    reason: 'Domain uses punycode or a look-alike pattern',
    test: (f) => {
      const d = lower(f.domain);
      if (!d) return false;
      if (d.includes('xn--')) return true;
      // brand name buried in a longer hostname: paypal.com.secure-login.tld
      return /\b(paypal|apple|microsoft|google|amazon|netflix|facebook|instagram|binance|coinbase)\b/.test(d)
        && !/^(www\.)?(paypal|apple|microsoft|google|amazon|netflix|facebook|instagram|binance|coinbase)\.[a-z.]{2,10}$/.test(d);
    },
  },
  {
    id: 'suspicious_tld_plus_urgency',
    weight: 10,
    reason: 'High-abuse top-level domain combined with urgency',
    test: (f) => {
      const d = lower(f.domain);
      const risky = /\.(zip|mov|top|xyz|gq|cf|tk|ml|click|country|kim|work|link)$/.test(d);
      const t = lower(f.textSample);
      return risky && /\b(urgent|verify|winner|free|claim|alert)\b/.test(t);
    },
  },
  {
    id: 'ip_literal_host',
    weight: 14,
    reason: 'Site served from a bare IP address',
    test: (f) => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(f.domain || '')),
  },
  // ── trust signals (negative weight) ──────────────────────────────────────
  // NOTE: a *present* legal/contact footer is NOT a trust signal — it is a bad
  // UX on both corporate and scam pages (user feedback), so we do not reward its
  // presence. Its *absence* is already a mild risk signal via `no_contact_info`.
  // The remaining trust signals below describe genuinely "normal-quality" pages
  // and are capped by the F-10 fix so they can never cancel an active risk.
  {
    id: 'substantial_content',
    weight: -6,
    reason: 'Substantial article-like content',
    test: (f) => String(f.textSample || '').length > 2500,
  },
  {
    id: 'quiet_page',
    weight: -8,
    reason: 'No autoplay, no pop-ups, no focus or fullscreen grabs',
    test: (f) =>
      f.hasAutoplayMedia !== true &&
      f.hasPopups !== true &&
      (f.fullscreenAttempts | 0) === 0 &&
      (f.focusGrabs | 0) === 0,
  },
]);

function lower(v) {
  return typeof v === 'string' ? v.toLowerCase() : '';
}

/**
 * Score → tier boundaries. Inclusive lower bound, ordered worst-first so the
 * first match wins.
 */
export const SCORE_THRESHOLDS = Object.freeze([
  { min: 45, tier: TIER.KNOWN_SCAM },
  { min: 28, tier: TIER.RISKY },
  { min: 14, tier: TIER.MEDIOCRE },
  { min: 0, tier: TIER.SAFE },
  { min: -Infinity, tier: TIER.IDEAL },
]);

/** Heuristic confidence band (extension_requirements.md §4.4: 0.6–0.85). */
export const CONF_MIN = 0.6;
export const CONF_MAX = 0.85;

/**
 * Classify from features alone.
 * Never throws: a classifier that can throw is a classifier that can leave the
 * user unprotected. Malformed input degrades to the neutral tier.
 *
 * @returns {{tier:string, confidence:number, score:number, matched:Array, details:string, suggestedActions:string[]}}
 */
export function classifyHeuristically(features) {
  const f = features && typeof features === 'object' ? features : {};
  const matched = [];
  let riskScore = 0;   // sum of positive (risk) weights
  let trustRelief = 0; // sum of |negative| (trust) weights

  for (const rule of RULES) {
    let hit = false;
    try {
      hit = rule.test(f) === true;
    } catch {
      hit = false; // a broken rule must not break classification
    }
    if (hit) {
      if (rule.weight >= 0) riskScore += rule.weight;
      else trustRelief += Math.abs(rule.weight);
      matched.push({ id: rule.id, weight: rule.weight, reason: rule.reason });
    }
  }

  // F-10: a trust signal (e.g. "has a privacy/terms/contact footer") must never
  // (a) push the score negative, nor (b) cancel an active risk signal. It can
  // at most offset the risk it co-exists with. A scam page that merely fakes a
  // legal footer therefore stays in a non-trusted tier; only a page with zero
  // risk signals can benefit from the trust relief (and even then score floors
  // at 0, never below).
  const score = riskScore - Math.min(trustRelief, riskScore);

  const tier = SCORE_THRESHOLDS.find((t) => score >= t.min).tier;

  // Confidence scales with how far past the threshold we are, and with how many
  // independent signals agree. One rule firing is a hint; five is a case.
  const positives = matched.filter((m) => m.weight > 0).length;
  const agreement = Math.min(1, positives / 4);
  const magnitude = Math.min(1, Math.abs(score) / 60);
  const confidence = round2(CONF_MIN + (CONF_MAX - CONF_MIN) * (0.35 * agreement + 0.65 * magnitude));

  return {
    tier,
    confidence,
    score,
    matched,
    details: matched.length
      ? matched.map((m) => m.reason).join('; ')
      : 'No suspicious signals detected',
    suggestedActions: suggestFor(tier),
  };
}

function suggestFor(tier) {
  switch (tier) {
    case TIER.KNOWN_SCAM:
      return [ACTION.MUTE, ACTION.BLANK, ACTION.LOCK];
    case TIER.RISKY:
      return [ACTION.WARN, ACTION.MUTE];
    case TIER.MEDIOCRE:
      return [ACTION.WARN];
    default:
      return [ACTION.NONE];
  }
}

/**
 * Should we spend an offscreen ML pass on this page?
 * Yes when the heuristics are *undecided* — clear verdicts at either end are not
 * worth ~20 MB of model and a document spin-up (extension_requirements.md §4.3).
 */
export function needsDeepAnalysis(result, { lower: lo = 8, upper: hi = 45 } = {}) {
  const s = result && typeof result.score === 'number' ? result.score : 0;
  return s >= lo && s < hi;
}

/**
 * Pure 0..1 risk score from a PageFeatures record (H-06). Used by callers that
 * want a continuous signal rather than a discrete tier — e.g. a debug overlay
 * or a "how risky was this page?" telemetry event. Never throws on bad input.
 */
export function scorePage(features) {
  const f = features && typeof features === 'object' ? features : {};
  let score = 0;
  for (const rule of RULES) {
    try {
      if (rule.test(f) === true) score += Math.abs(rule.weight);
    } catch { /* broken rule must not break scoring */ }
  }
  // Normalise against the worst-case weight sum we actually use.
  const max = RULES.reduce((m, r) => m + Math.abs(r.weight), 0) || 1;
  return Math.min(1, Math.max(0, score / max));
}

/**
 * Convenience: classify and return only the tier. Thin wrapper over
 * `classifyHeuristically` so callers don't have to destructure the full result.
 */
export function computeTier(features) {
  return classifyHeuristically(features).tier;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
