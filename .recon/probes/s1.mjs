import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitise, DEFAULT_SETTINGS } from '../../src/core/settings.js';
test('s1', () => {
  const s = sanitise({ ...DEFAULT_SETTINGS, bogus: 1, closeOnKnownScam: 'true', protectionLevel: 'turbo' });
  console.log('closeOnKnownScam=', s.closeOnKnownScam, 'prot=', s.protectionLevel, 'bogus=', s.bogus);
});
