import { BloomFilter } from '../../src/core/bloom.js';
const f = BloomFilter.fromKeys(['a.example', 'b.example'], 0.01, 0);
const b = f.serialize();
const g = BloomFilter.deserialize(b);
console.log('deserialized OK, has a.example:', g.has('a.example'));
