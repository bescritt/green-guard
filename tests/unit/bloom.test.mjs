import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BloomFilter, fnv1a, optimalBits, optimalHashes, theoreticalFpRate,
  checksumBytes, MAGIC, HEADER_SIZE, VERSION, DESIGN_MARGIN,
} from '../../src/core/bloom.js';

test('BLM-01 fnv1a is deterministic and seed-sensitive', () => {
  assert.equal(fnv1a('example.com'), fnv1a('example.com'));
  assert.notEqual(fnv1a('example.com'), fnv1a('example.org'));
  assert.notEqual(fnv1a('example.com', 1), fnv1a('example.com', 2));
  assert.ok(Number.isInteger(fnv1a('x')) && fnv1a('x') >= 0 && fnv1a('x') <= 0xffffffff);
});

test('BLM-02 fnv1a handles non-ASCII and astral code points without throwing', () => {
  for (const s of ['日本語ドメイン.jp', 'münchen.de', 'emoji-🎉.example', 'ＡＢＣ', '\u0000\u007f']) {
    const h = fnv1a(s);
    assert.ok(Number.isInteger(h), s);
    assert.equal(h, fnv1a(s), 'must be stable');
  }
  assert.notEqual(fnv1a('🎉'), fnv1a('🎊'));
});

test('BLM-03 fnv1a matches the reference vector for the empty string and "a"', () => {
  // FNV-1a 32-bit reference: "" → 0x811c9dc5, "a" → 0xe40c292c
  assert.equal(fnv1a(''), 0x811c9dc5);
  assert.equal(fnv1a('a'), 0xe40c292c);
  assert.equal(fnv1a('foobar'), 0xbf9cf968);
});

test('BLM-04 sizing rejects impossible parameters', () => {
  assert.throws(() => optimalBits(0, 0.01), RangeError);
  assert.throws(() => optimalBits(-5, 0.01), RangeError);
  assert.throws(() => optimalBits(100, 0), RangeError);
  assert.throws(() => optimalBits(100, 1), RangeError);
  assert.throws(() => optimalBits(100, 1.5), RangeError);
});

test('BLM-05 sizing carries the documented design margin', () => {
  const ideal = Math.ceil((-100000 * Math.log(0.001)) / (Math.LN2 ** 2));
  const withMargin = optimalBits(100000, 0.001);
  assert.ok(withMargin > ideal, 'must exceed the textbook size');
  assert.ok(DESIGN_MARGIN > 1 && DESIGN_MARGIN < 1.5, 'margin must be modest');
});

test('BLM-06 optimalHashes picks the better of floor/ceil, never worse', () => {
  for (const n of [1000, 10000, 100000]) {
    const m = optimalBits(n, 0.001);
    const k = optimalHashes(m, n);
    const real = (m / n) * Math.LN2;
    const lo = Math.max(1, Math.floor(real)), hi = Math.max(1, Math.ceil(real));
    assert.ok(k === lo || k === hi, `k=${k} must be a neighbour of ${real}`);
    assert.ok(theoreticalFpRate(m, k, n) <= theoreticalFpRate(m, real >= 1 ? Math.round(real) : 1, n) + 1e-12);
    assert.ok(k >= 1 && k <= 32);
  }
});

test('BLM-07 constructor validates its arguments', () => {
  assert.throws(() => new BloomFilter({ bits: 0, hashes: 3 }), RangeError);
  assert.throws(() => new BloomFilter({ bits: 100, hashes: 0 }), RangeError);
  assert.throws(() => new BloomFilter({ bits: 100, hashes: 33 }), RangeError);
  assert.throws(() => new BloomFilter({ bits: 1.5, hashes: 3 }), RangeError);
  assert.throws(
    () => new BloomFilter({ bits: 800, hashes: 3, bytes: new Uint8Array(5) }),
    RangeError,
    'byte length mismatch must be rejected, not silently padded',
  );
});

test('BLM-08 INVARIANT zero false negatives for every inserted key', () => {
  const keys = Array.from({ length: 5000 }, (_, i) => `bad-${i}.example.com`);
  const f = BloomFilter.fromKeys(keys, 0.01);
  for (const k of keys) assert.ok(f.has(k), `false negative on ${k}`);
});

test('BLM-09 add reports novelty and count tracks distinct insertions', () => {
  const f = BloomFilter.create(1000, 0.01);
  assert.equal(f.count, 0);
  assert.equal(f.add('a.example'), true);
  assert.equal(f.count, 1);
  assert.equal(f.add('a.example'), false, 're-adding must report no new bits');
  assert.equal(f.count, 1, 'count must not double-count');
});

test('BLM-10 empty filter answers no to everything', () => {
  const f = BloomFilter.create(1000, 0.01);
  for (let i = 0; i < 500; i++) assert.equal(f.has(`k${i}`), false);
  assert.equal(f.fillRatio(), 0);
});

test('BLM-11 measured false-positive rate stays inside the p=0.001 budget', () => {
  const N = 20000, P = 0.001;
  const f = BloomFilter.fromKeys(Array.from({ length: N }, (_, i) => `s${i}.bad.example`), P);
  let fp = 0, trials = 60000;
  for (let i = 0; i < trials; i++) if (f.has(`c${i}.good.example`)) fp++;
  const rate = fp / trials;
  assert.ok(rate <= P, `measured ${rate.toExponential(3)} must be <= ${P}`);
});

test('BLM-12 serialize produces a self-describing header', () => {
  const f = BloomFilter.fromKeys(['a.example', 'b.example'], 0.01, 7);
  const ser = f.serialize();
  const dv = new DataView(ser.buffer, ser.byteOffset, ser.byteLength);
  assert.equal(dv.getUint32(0, false), MAGIC, 'magic');
  assert.equal(ser[4], VERSION, 'version');
  assert.equal(ser[5], f.hashes, 'k');
  assert.equal(dv.getUint32(8, false), f.bits, 'm');
  assert.equal(dv.getUint32(20, false), 7, 'seed round-trips');
  assert.equal(ser.length, HEADER_SIZE + f.bytes.length);
});

test('BLM-13 round trip preserves every answer and all parameters', () => {
  const keys = Array.from({ length: 2000 }, (_, i) => `d${i}.example.net`);
  const f = BloomFilter.fromKeys(keys, 0.001, 42);
  const g = BloomFilter.deserialize(f.serialize());
  assert.equal(g.bits, f.bits);
  assert.equal(g.hashes, f.hashes);
  assert.equal(g.seed, f.seed);
  assert.equal(g.count, f.count);
  assert.equal(g.capacity, f.capacity);
  for (const k of keys) assert.ok(g.has(k), `lost ${k}`);
  for (let i = 0; i < 2000; i++) {
    const probe = `absent-${i}.example.net`;
    assert.equal(g.has(probe), f.has(probe), `divergence on ${probe}`);
  }
});

test('BLM-14 deserialize rejects a truncated buffer', () => {
  const f = BloomFilter.fromKeys(['a'], 0.01);
  const ser = f.serialize();
  assert.throws(() => BloomFilter.deserialize(ser.subarray(0, 10)), /truncated/);
  assert.throws(() => BloomFilter.deserialize(new Uint8Array(0)), /truncated/);
});

test('BLM-15 deserialize rejects bad magic and unsupported version', () => {
  const ser = BloomFilter.fromKeys(['a'], 0.01).serialize();
  const badMagic = Uint8Array.from(ser); badMagic[0] ^= 0xff;
  assert.throws(() => BloomFilter.deserialize(badMagic), /bad magic/);
  const badVer = Uint8Array.from(ser); badVer[4] = 99;
  assert.throws(() => BloomFilter.deserialize(badVer), /unsupported version/);
});

test('BLM-16 deserialize detects body tampering via checksum', () => {
  const f = BloomFilter.fromKeys(Array.from({ length: 500 }, (_, i) => `k${i}`), 0.01);
  const ser = f.serialize();
  for (const at of [HEADER_SIZE, HEADER_SIZE + 7, ser.length - 1]) {
    const t = Uint8Array.from(ser);
    t[at] ^= 0x01;
    assert.throws(() => BloomFilter.deserialize(t), /checksum mismatch/, `tamper at ${at} undetected`);
  }
});

test('BLM-17 deserialize rejects a body length that contradicts the header', () => {
  const f = BloomFilter.fromKeys(['a'], 0.01);
  const ser = f.serialize();
  const dv = new DataView(ser.buffer, ser.byteOffset, ser.byteLength);
  dv.setUint32(8, f.bits + 4096, false); // claim more bits than bytes provided
  assert.throws(() => BloomFilter.deserialize(ser), /body length/);
});

test('BLM-18 deserialize copies, never aliases the caller buffer', () => {
  const f = BloomFilter.fromKeys(['aliased.example'], 0.01);
  const ser = f.serialize();
  const g = BloomFilter.deserialize(ser);
  ser.fill(0, HEADER_SIZE); // scribble over the source AFTER parsing
  assert.ok(g.has('aliased.example'), 'filter must own its bytes');
});

test('BLM-19 accepts array/ArrayBuffer-backed input shapes', () => {
  const ser = BloomFilter.fromKeys(['x.example'], 0.01).serialize();
  const viaBuffer = BloomFilter.deserialize(ser.buffer.slice(ser.byteOffset, ser.byteOffset + ser.byteLength));
  assert.ok(viaBuffer.has('x.example'));
});

test('BLM-20 fillRatio and estimatedFpRate track reality', () => {
  const N = 5000;
  const f = BloomFilter.fromKeys(Array.from({ length: N }, (_, i) => `f${i}`), 0.001);
  const fill = f.fillRatio();
  assert.ok(fill > 0.3 && fill < 0.7, `fill ${fill} should sit near 0.5 for a well-sized filter`);
  assert.ok(f.estimatedFpRate() <= 0.001 * 1.5, `estimate ${f.estimatedFpRate()}`);
  const empty = BloomFilter.create(100, 0.01);
  assert.equal(empty.estimatedFpRate(), 0);
});

test('BLM-21 checksumBytes is order-sensitive', () => {
  assert.equal(checksumBytes(new Uint8Array([1, 2, 3])), checksumBytes(new Uint8Array([1, 2, 3])));
  assert.notEqual(checksumBytes(new Uint8Array([1, 2, 3])), checksumBytes(new Uint8Array([3, 2, 1])));
});

test('BLM-22 different seeds give different bit patterns for the same keys', () => {
  const keys = Array.from({ length: 200 }, (_, i) => `seeded-${i}`);
  const a = BloomFilter.fromKeys(keys, 0.01, 1);
  const b = BloomFilter.fromKeys(keys, 0.01, 2);
  assert.notDeepEqual(Array.from(a.bytes), Array.from(b.bytes));
  for (const k of keys) { assert.ok(a.has(k)); assert.ok(b.has(k)); }
});

test('BLM-23 keys are stringified consistently', () => {
  const f = BloomFilter.create(100, 0.01);
  f.add(12345);
  assert.ok(f.has('12345'), 'number and its string form must collide by design');
});

test('BLM-24 a 1-item filter is still valid', () => {
  const f = BloomFilter.fromKeys(['solo.example'], 0.001);
  assert.ok(f.has('solo.example'));
  assert.ok(f.bits >= 8);
  assert.ok(BloomFilter.deserialize(f.serialize()).has('solo.example'));
});
