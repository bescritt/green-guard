import { BloomFilter } from '../../src/core/bloom.js';
const f = BloomFilter.fromKeys(['a.example', 'b.example'], 0.01, 0);
console.log('bits=', f.bits, 'byteslen=', f.bytes.length);
const b = f.serialize();
console.log('serlen=', b.length);
const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
console.log('header bits field @8 =', dv.getUint32(8, false), 'need=', Math.ceil(dv.getUint32(8,false)/8));
