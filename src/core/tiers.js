/**
 * core/tiers.js — the five safety tiers, their ordering, and the action policy.
 *
 * PURE. No chrome.*, no DOM, no I/O. This module is the single source of truth
 * for what a tier means; every other layer imports from here.
 *
 * Source: IDEA.md §Project Vision, extension_requirements.md §3 (SafetyTier),
 *         §4.4 (final tier decision), §5 (safety actions), §10 (data flows).
 */

/** Canonical tier identifiers. Wire values — never localise these. */
export const TIER = Object.freeze({
  IDEAL: 'ideal',
  SAFE: 'safe',
  MEDIOCRE: 'mediocre',
  RISKY: 'risky',
  KNOWN_SCAM: 'known_scam',
});

/** Ordered best → worst. Index doubles as severity rank. */
export const TIER_ORDER = Object.freeze([
  TIER.IDEAL,
  TIER.SAFE,
  TIER.MEDIOCRE,
  TIER.RISKY,
  TIER.KNOWN_SCAM,
]);

export const ALL_TIERS = TIER_ORDER;

/** Canonical action identifiers (driver_requirements.md §2.1 suggestedActions). */
export const ACTION = Object.freeze({
  NONE: 'none',
  WARN: 'warn',
  MUTE: 'mute',
  LOCK: 'lock',
  BLANK: 'blank',
  CLOSE: 'close',
  SAFE_VIEW: 'safe_view',
});

export const ALL_ACTIONS = Object.freeze([
  ACTION.NONE,
  ACTION.WARN,
  ACTION.MUTE,
  ACTION.LOCK,
  ACTION.BLANK,
  ACTION.CLOSE,
  ACTION.SAFE_VIEW,
]);

/**
 * Destructiveness rank. `close` is irreversible from the page's point of view,
 * so it is never applied automatically unless the user opted in explicitly.
 */
const ACTION_SEVERITY = Object.freeze({
  [ACTION.NONE]: 0,
  [ACTION.WARN]: 1,
  [ACTION.SAFE_VIEW]: 2,
  [ACTION.MUTE]: 3,
  [ACTION.LOCK]: 4,
  [ACTION.BLANK]: 5,
  [ACTION.CLOSE]: 6,
});

export function isTier(value) {
  return typeof value === 'string' && TIER_ORDER.includes(value);
}

export function isAction(value) {
  return typeof value === 'string' && ALL_ACTIONS.includes(value);
}

/** Severity rank of a tier; throws on an unknown tier (fail loud, not silent). */
export function tierRank(tier) {
  const i = TIER_ORDER.indexOf(tier);
  if (i < 0) throw new TypeError(`unknown tier: ${JSON.stringify(tier)}`);
  return i;
}

export function actionSeverity(action) {
  const s = ACTION_SEVERITY[action];
  if (s === undefined) throw new TypeError(`unknown action: ${JSON.stringify(action)}`);
  return s;
}

/** The worse (higher-severity) of two tiers. */
export function worseTier(a, b) {
  return tierRank(a) >= tierRank(b) ? a : b;
}

export function isAtLeastAsBadAs(tier, threshold) {
  return tierRank(tier) >= tierRank(threshold);
}

/**
 * Default action policy per tier. Deliberately conservative:
 *  - nothing destructive below `risky`
 *  - `close` never appears in a default; the user must opt in (see settings)
 * extension_requirements.md §10.1 enables mute+blank(+lock) for known_scam.
 */
export const DEFAULT_ACTION_POLICY = Object.freeze({
  [TIER.IDEAL]: Object.freeze([ACTION.NONE]),
  [TIER.SAFE]: Object.freeze([ACTION.NONE]),
  [TIER.MEDIOCRE]: Object.freeze([ACTION.WARN]),
  [TIER.RISKY]: Object.freeze([ACTION.WARN, ACTION.MUTE]),
  [TIER.KNOWN_SCAM]: Object.freeze([ACTION.MUTE, ACTION.BLANK, ACTION.LOCK]),
});

/** Sort actions so the least destructive runs first (mute before blank). */
export function orderActions(actions) {
  return [...new Set(actions)]
    .filter(isAction)
    .filter((a) => a !== ACTION.NONE)
    .sort((a, b) => actionSeverity(a) - actionSeverity(b));
}

/**
 * Resolve the actions to apply.
 *
 * Invariants (property-tested):
 *   1. A whitelisted domain yields [] — always, for every tier. No exceptions.
 *   2. `close` is only ever returned when settings.allowClose === true.
 *   3. The result is ordered least→most destructive and contains no duplicates.
 *   4. `none` never appears alongside a real action.
 *   5. Tiers at or below settings.minTierForAction yield [].
 *
 * @param {object} o
 * @param {string} o.tier
 * @param {boolean} [o.whitelisted]
 * @param {object} [o.settings]
 * @param {string[]} [o.suggestedActions] driver hints, intersected with policy
 * @returns {string[]}
 */
export function resolveActions({ tier, whitelisted = false, settings = {}, suggestedActions } = {}) {
  if (!isTier(tier)) throw new TypeError(`unknown tier: ${JSON.stringify(tier)}`);
  if (whitelisted) return [];

  const {
    enabled = true,
    allowClose = false,
    closeOnKnownScam = false,   // §5.4: opt-in; only closes on the worst tier
    minTierForAction = TIER.MEDIOCRE,
    actionPolicy = DEFAULT_ACTION_POLICY,
    bannerModeOnly = false,
    respectDriverSuggestions = true,
  } = settings;

  if (!enabled) return [];
  if (!isAtLeastAsBadAs(tier, minTierForAction)) return [];

  let actions = orderActions(actionPolicy[tier] ?? DEFAULT_ACTION_POLICY[tier] ?? []);

  // Driver hints may *narrow* or *inform* but never escalate past the user's policy,
  // except that a driver may always ask for a warning.
  if (respectDriverSuggestions && Array.isArray(suggestedActions) && suggestedActions.length) {
    const hinted = orderActions(suggestedActions);
    const allowed = new Set(actions);
    const merged = hinted.filter((a) => allowed.has(a) || a === ACTION.WARN);
    if (merged.length) actions = orderActions(merged);
  }

  // Store-policy softening (§8.4 / R-07): banner mode replaces full-page takeover.
  if (bannerModeOnly) {
    actions = orderActions(
      actions.map((a) => (a === ACTION.BLANK || a === ACTION.LOCK ? ACTION.WARN : a)),
    );
  }

  // Close is the one irreversible action, so it is gated on an explicit opt-in
  // that applies *only* to the worst tier (a misconfigured toggle must never be
  // able to silently close every questionable tab).
  const permitClose = allowClose || (closeOnKnownScam && tier === TIER.KNOWN_SCAM);
  if (permitClose && tier === TIER.KNOWN_SCAM && !actions.includes(ACTION.CLOSE)) {
    actions = orderActions([...actions, ACTION.CLOSE]);
  } else if (!permitClose) {
    actions = actions.filter((a) => a !== ACTION.CLOSE);
  }

  return actions;
}
