import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIER, TIER_ORDER, ACTION, ALL_ACTIONS, isTier, isAction, tierRank, worseTier,
  isAtLeastAsBadAs, resolveActions, orderActions, actionSeverity, DEFAULT_ACTION_POLICY,
} from '../../src/core/tiers.js';

test('TIER-01 five tiers exist, in the spec order', () => {
  assert.deepEqual(TIER_ORDER, ['ideal', 'safe', 'mediocre', 'risky', 'known_scam']);
  assert.equal(TIER_ORDER.length, 5);
});

test('TIER-02 tier identifiers are frozen wire values', () => {
  assert.ok(Object.isFrozen(TIER));
  assert.ok(Object.isFrozen(TIER_ORDER));
  assert.equal(TIER.KNOWN_SCAM, 'known_scam', 'wire value must be snake_case per contract');
});

test('TIER-03 isTier accepts exactly the five, rejects everything else', () => {
  for (const t of TIER_ORDER) assert.ok(isTier(t), t);
  for (const bad of ['KNOWN_SCAM', 'scam', '', null, undefined, 0, {}, ['safe'], 'Safe']) {
    assert.equal(isTier(bad), false, `must reject ${JSON.stringify(bad)}`);
  }
});

test('TIER-04 tierRank is a strict total order, throws on unknown', () => {
  for (let i = 1; i < TIER_ORDER.length; i++) {
    assert.ok(tierRank(TIER_ORDER[i]) > tierRank(TIER_ORDER[i - 1]));
  }
  assert.throws(() => tierRank('nope'), TypeError);
});

test('TIER-05 worseTier is commutative and idempotent', () => {
  for (const a of TIER_ORDER) {
    assert.equal(worseTier(a, a), a);
    for (const b of TIER_ORDER) {
      assert.equal(worseTier(a, b), worseTier(b, a), `${a} vs ${b}`);
      assert.equal(tierRank(worseTier(a, b)), Math.max(tierRank(a), tierRank(b)));
    }
  }
});

test('TIER-06 isAtLeastAsBadAs boundary is inclusive', () => {
  assert.ok(isAtLeastAsBadAs(TIER.RISKY, TIER.RISKY));
  assert.ok(isAtLeastAsBadAs(TIER.KNOWN_SCAM, TIER.RISKY));
  assert.equal(isAtLeastAsBadAs(TIER.MEDIOCRE, TIER.RISKY), false);
});

test('ACT-01 the seven contract actions exist', () => {
  assert.deepEqual(
    [...ALL_ACTIONS].sort(),
    ['blank', 'close', 'lock', 'mute', 'none', 'safe_view', 'warn'],
  );
  for (const a of ALL_ACTIONS) assert.ok(isAction(a));
  assert.equal(isAction('nuke'), false);
});

test('ACT-02 close is the most destructive action', () => {
  const max = Math.max(...ALL_ACTIONS.map(actionSeverity));
  assert.equal(actionSeverity(ACTION.CLOSE), max);
  assert.ok(actionSeverity(ACTION.MUTE) < actionSeverity(ACTION.BLANK));
  assert.throws(() => actionSeverity('unknown'), TypeError);
});

test('ACT-03 orderActions dedupes, drops none, sorts least-destructive-first', () => {
  const out = orderActions([ACTION.BLANK, ACTION.MUTE, ACTION.MUTE, ACTION.NONE, ACTION.WARN]);
  assert.deepEqual(out, [ACTION.WARN, ACTION.MUTE, ACTION.BLANK]);
  assert.equal(orderActions([ACTION.NONE]).length, 0);
  assert.deepEqual(orderActions(['garbage', ACTION.MUTE]), [ACTION.MUTE]);
});

test('ACT-04 default policy is non-destructive below risky', () => {
  for (const t of [TIER.IDEAL, TIER.SAFE]) {
    assert.deepEqual([...DEFAULT_ACTION_POLICY[t]], [ACTION.NONE], t);
  }
  assert.ok(!DEFAULT_ACTION_POLICY[TIER.MEDIOCRE].includes(ACTION.BLANK));
  assert.ok(DEFAULT_ACTION_POLICY[TIER.KNOWN_SCAM].includes(ACTION.BLANK));
});

test('ACT-05 no default policy anywhere contains close (irreversible, opt-in only)', () => {
  for (const t of TIER_ORDER) {
    assert.ok(!DEFAULT_ACTION_POLICY[t].includes(ACTION.CLOSE), `${t} must not auto-close`);
  }
});

test('POL-01 INVARIANT whitelist yields no actions for every tier', () => {
  for (const tier of TIER_ORDER) {
    assert.deepEqual(
      resolveActions({ tier, whitelisted: true, settings: { allowClose: true, minTierForAction: TIER.IDEAL } }),
      [],
      `whitelist must win for ${tier}`,
    );
  }
});

test('POL-02 INVARIANT close never appears unless allowClose', () => {
  for (const tier of TIER_ORDER) {
    const out = resolveActions({
      tier,
      settings: { minTierForAction: TIER.IDEAL, actionPolicy: { [tier]: [ACTION.CLOSE, ACTION.MUTE] } },
    });
    assert.ok(!out.includes(ACTION.CLOSE), `${tier} leaked close`);
  }
  const allowed = resolveActions({
    tier: TIER.KNOWN_SCAM,
    settings: { allowClose: true, actionPolicy: { [TIER.KNOWN_SCAM]: [ACTION.CLOSE, ACTION.MUTE] } },
  });
  assert.deepEqual(allowed, [ACTION.MUTE, ACTION.CLOSE]);
});

test('POL-03 disabled extension performs no actions at all', () => {
  for (const tier of TIER_ORDER) {
    assert.deepEqual(resolveActions({ tier, settings: { enabled: false } }), [], tier);
  }
});

test('POL-04 minTierForAction gates milder tiers', () => {
  assert.deepEqual(resolveActions({ tier: TIER.MEDIOCRE, settings: { minTierForAction: TIER.RISKY } }), []);
  assert.ok(resolveActions({ tier: TIER.RISKY, settings: { minTierForAction: TIER.RISKY } }).length > 0);
});

test('POL-05 default known_scam response is mute+lock+blank, ordered', () => {
  const out = resolveActions({ tier: TIER.KNOWN_SCAM });
  assert.deepEqual(out, [ACTION.MUTE, ACTION.LOCK, ACTION.BLANK]);
  assert.deepEqual([...out].sort((a, b) => actionSeverity(a) - actionSeverity(b)), out, 'must be ordered');
});

test('POL-06 banner mode downgrades takeover actions to warn (store policy §8.4)', () => {
  const out = resolveActions({ tier: TIER.KNOWN_SCAM, settings: { bannerModeOnly: true } });
  assert.ok(!out.includes(ACTION.BLANK), 'blank must be suppressed');
  assert.ok(!out.includes(ACTION.LOCK), 'lock must be suppressed');
  assert.ok(out.includes(ACTION.WARN));
  assert.ok(out.includes(ACTION.MUTE), 'muting is not a takeover, keep it');
});

test('POL-07 driver suggestions narrow but cannot escalate past policy', () => {
  // Driver asks to close a mediocre page; policy for mediocre is warn only.
  const out = resolveActions({
    tier: TIER.MEDIOCRE,
    suggestedActions: [ACTION.CLOSE, ACTION.BLANK],
    settings: { allowClose: true },
  });
  assert.ok(!out.includes(ACTION.CLOSE), 'driver must not escalate to close');
  assert.ok(!out.includes(ACTION.BLANK), 'driver must not escalate to blank');
});

test('POL-08 driver may always request a warning', () => {
  const out = resolveActions({ tier: TIER.RISKY, suggestedActions: [ACTION.WARN] });
  assert.deepEqual(out, [ACTION.WARN]);
});

test('POL-09 driver suggestion subset is honoured', () => {
  const out = resolveActions({ tier: TIER.KNOWN_SCAM, suggestedActions: [ACTION.MUTE] });
  assert.deepEqual(out, [ACTION.MUTE], 'driver asked for less; give less');
});

test('POL-10 empty/garbage suggestions fall back to policy, never crash', () => {
  const base = resolveActions({ tier: TIER.KNOWN_SCAM });
  assert.deepEqual(resolveActions({ tier: TIER.KNOWN_SCAM, suggestedActions: [] }), base);
  assert.deepEqual(resolveActions({ tier: TIER.KNOWN_SCAM, suggestedActions: ['xyz'] }), base);
  assert.deepEqual(resolveActions({ tier: TIER.KNOWN_SCAM, suggestedActions: null }), base);
});

test('POL-11 unknown tier throws rather than silently doing nothing', () => {
  assert.throws(() => resolveActions({ tier: 'unknown' }), TypeError);
  assert.throws(() => resolveActions({}), TypeError);
});

test('POL-12 result is always deduped', () => {
  const out = resolveActions({
    tier: TIER.RISKY,
    settings: { actionPolicy: { [TIER.RISKY]: [ACTION.MUTE, ACTION.MUTE, ACTION.WARN, ACTION.WARN] } },
  });
  assert.equal(new Set(out).size, out.length);
});
