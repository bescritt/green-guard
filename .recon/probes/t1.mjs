import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIER, ACTION, isTier, isAction, tierRank, worseTier, isAtLeastAsBadAs, resolveActions, DEFAULT_ACTION_POLICY } from '../../src/core/tiers.js';
test('dbg', () => {
  console.log('ideal rank', tierRank('ideal'), 'knownscam rank', tierRank('known_scam'));
  console.log('worse ideal/ideal', worseTier('ideal','ideal'));
  console.log('isTier ideal', isTier('ideal'), 'isAction mute', isAction('mute'), 'isAction explode', isAction('explode'));
  console.log('atLeastAsBadAs risky mediocre', isAtLeastAsBadAs('risky','mediocre'));
  console.log('default policy ideal', JSON.stringify(DEFAULT_ACTION_POLICY.ideal));
});
