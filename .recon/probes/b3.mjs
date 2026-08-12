import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BloomFilter, fnv1a } from '../../src/core/bloom.js';
test('B-03 isolated', () => {
  const f = BloomFilter.fromKeys(['a.example', 'b.example'], 0.01, 0);
  const bytes = f.serialize();
  const g = BloomFilter.deserialize(bytes);
  assert.ok(g.has('a.example') && g.has('b.example'));
  const tampered = bytes.slice();
  tampered[10] ^= 0xff;
  const h = BloomFilter.deserialize(tampered);
  assert.equal(h.meta.ok, false, 'checksum must catch tampering');
});
