import { BloomFilter, optimalBits } from '../../src/core/bloom.js';
const f = BloomFilter.fromKeys(['a.example','b.example'], 0.01, 0);
console.log('bits', f.bits, 'bytes.len', f.bytes.length, 'need', Math.ceil(f.bits/8));
const b = f.serialize();
console.log('serialized len', b.length);
