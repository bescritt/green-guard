import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BloomFilter, fnv1a } from '../../src/core/bloom.js';
test('B-03 WITH fnv1a import', () => {
  const f = BloomFilter.fromKeys(['a.example', 'b.example'], 0.01, 0);
  const bytes = f.serialize();
  const g = BloomFilter.deserialize(bytes);
  assert.ok(g.has('a.example') && g.has('b.example'));
});
