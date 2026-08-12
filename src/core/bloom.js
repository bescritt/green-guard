/**
 * core/bloom.js — bloom filter for the local known-scam pre-filter.
 *
 * PURE. No chrome.*, no DOM. Works on Uint8Array so it can be persisted to
 * chrome.storage.local (as bytes) or received from driver.getThreatList().
 *
 * Source: extension_requirements.md §4.1 (100k domains, p=0.001, ~180 KB,
 *         compact Uint8Array, storage key `threat_bloom`),
 *         driver_requirements.md §2.4 (serialisation, signing, test vectors).
 *
 * Design decisions and *why*:
 *  - FNV-1a 32-bit ×2 + Kirsch-Mitzenmacher enhanced double hashing
 *    (g_i = h1 + i*h2 + i*i, the +i² term avoids the degenerate cycles plain
 *    double hashing hits when h2 shares a factor with m). Pure integer math,
 *    no crypto dependency, identical results in every JS engine.
 *  - A self-describing 32-byte header, so a filter carries its own parameters.
 *    A filter you cannot interpret without out-of-band metadata is a liability
 *    (driver_requirements.md §2.4 TODO asks exactly this question).
 *  - Big-endian header fields: wire formats are big-endian by convention and it
 *    removes any host-endianness ambiguity.
 */

export const MAGIC = 0x53424631; // "SBF1"
export const HEADER_SIZE = 32;
export const VERSION = 1;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a (32-bit, canonical) over the UTF-8 bytes of `str`.
 * Returns an unsigned 32-bit integer. We hash bytes (not code units) so that
 * non-ASCII domains are folded identically regardless of the host's string
 * representation.
 */
export function fnv1a(str, seed = FNV_OFFSET) {
  let h = seed >>> 0;
  const bytes = new TextEncoder().encode(str);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/**
 * Design margin on the bit count.
 *
 * WHY THIS EXISTS — measured, not theorised: sizing with the textbook
 * m = -n·ln(p)/(ln2)² and k = round((m/n)·ln2) gives a *measured* rate of
 * 1.045e-3 at n=100000, p=0.001 — i.e. it overshoots the requirement, because
 * k must be an integer and rounding k away from its real optimum costs accuracy.
 * The spec (extension_requirements.md §4.1) states p=0.001 as a budget to stay
 * *under*, so we size with a 12% bit margin. Cost: 175.5 KiB → ~196 KiB, still
 * within the spec's "~180 KB" order of magnitude and far under any storage limit.
 * Benefit: the acceptance test asserts measured ≤ target and actually passes.
 */
export const DESIGN_MARGIN = 1.12;

/** Theoretical false-positive rate for m bits, k hashes, n items. */
export function theoreticalFpRate(m, k, n) {
  return Math.pow(1 - Math.exp((-k * n) / m), k);
}

/** Bit count m for n items at false-positive rate p, including the design margin. */
export function optimalBits(n, p, margin = DESIGN_MARGIN) {
  if (!(n > 0)) throw new RangeError('capacity must be > 0');
  if (!(p > 0 && p < 1)) throw new RangeError('fpRate must be in (0,1)');
  const ideal = (-n * Math.log(p)) / (Math.LN2 * Math.LN2);
  return Math.max(8, Math.ceil(ideal * margin));
}

/**
 * Hash count k for m bits and n items.
 *
 * The real optimum (m/n)·ln2 is rarely an integer, and `round` is not always the
 * better of the two neighbours. Evaluate both and keep whichever actually has the
 * lower theoretical rate — cheap to compute, strictly better than rounding.
 */
export function optimalHashes(m, n) {
  const real = (m / n) * Math.LN2;
  const lo = Math.max(1, Math.min(32, Math.floor(real)));
  const hi = Math.max(1, Math.min(32, Math.ceil(real)));
  if (lo === hi) return lo;
  return theoreticalFpRate(m, lo, n) <= theoreticalFpRate(m, hi, n) ? lo : hi;
}

export class BloomFilter {
  /**
   * @param {object} o
   * @param {number} o.bits   size in bits (m)
   * @param {number} o.hashes number of hash functions (k)
   * @param {number} [o.capacity] declared design capacity (n), metadata only
   * @param {Uint8Array} [o.bytes] existing bit array
   * @param {number} [o.count] number of items already inserted
   * @param {number} [o.seed]
   */
  constructor({ bits, hashes, capacity = 0, bytes, count = 0, seed = 0 }) {
    if (!Number.isInteger(bits) || bits <= 0) throw new RangeError('bits must be a positive integer');
    if (!Number.isInteger(hashes) || hashes <= 0 || hashes > 32) {
      throw new RangeError('hashes must be an integer in 1..32');
    }
    this.bits = bits;
    this.hashes = hashes;
    this.capacity = capacity;
    this.seed = seed >>> 0;
    this.count = count;
    const need = Math.ceil(bits / 8);
    if (bytes) {
      if (bytes.length !== need) {
        throw new RangeError(`bytes length ${bytes.length} != required ${need}`);
      }
      this.bytes = bytes;
    } else {
      this.bytes = new Uint8Array(need);
    }
  }

  /** Build a filter sized for `capacity` items at `fpRate`. */
  static create(capacity, fpRate = 0.001, seed = 0) {
    const bits = optimalBits(capacity, fpRate);
    const hashes = optimalHashes(bits, capacity);
    return new BloomFilter({ bits, hashes, capacity, seed });
  }

  /** Build and populate from an iterable of keys. */
  static fromKeys(keys, fpRate = 0.001, seed = 0) {
    const arr = Array.isArray(keys) ? keys : [...keys];
    const f = BloomFilter.create(Math.max(1, arr.length), fpRate, seed);
    for (const k of arr) f.add(k);
    return f;
  }

  /** Bit indices for a key — enhanced double hashing. */
  *_indices(key) {
    const s = String(key);
    const h1 = fnv1a(s, (FNV_OFFSET ^ this.seed) >>> 0);
    const h2 = fnv1a(s, (h1 ^ 0x9e3779b9) >>> 0) | 1; // odd ⇒ coprime with 2^k
    for (let i = 0; i < this.hashes; i++) {
      const combined = (h1 + Math.imul(i, h2) + Math.imul(i, i)) >>> 0;
      yield combined % this.bits;
    }
  }

  add(key) {
    let novel = false;
    for (const idx of this._indices(key)) {
      const byte = idx >>> 3;
      const mask = 1 << (idx & 7);
      if ((this.bytes[byte] & mask) === 0) {
        this.bytes[byte] |= mask;
        novel = true;
      }
    }
    if (novel) this.count++;
    return novel;
  }

  has(key) {
    for (const idx of this._indices(key)) {
      if ((this.bytes[idx >>> 3] & (1 << (idx & 7))) === 0) return false;
    }
    return true;
  }

  /** Fraction of bits set — the honest health signal for a filter. */
  fillRatio() {
    let set = 0;
    for (let i = 0; i < this.bytes.length; i++) {
      let b = this.bytes[i];
      while (b) {
        b &= b - 1;
        set++;
      }
    }
    return set / this.bits;
  }

  /** Estimated current false-positive rate from the measured fill ratio. */
  estimatedFpRate() {
    return Math.pow(this.fillRatio(), this.hashes);
  }

  /**
   * Serialise to a self-describing byte array.
   *
   * Header (32 bytes, big-endian):
   *   0..3   magic 'SBF1'
   *   4      version
   *   5      hashes (k)
   *   6..7   reserved (0)
   *   8..11  bits (m)
   *   12..15 capacity (n)
   *   16..19 count
   *   20..23 seed
   *   24..27 fnv1a of the bit array (integrity, not authenticity)
   *   28..31 reserved (0)
   */
  serialize() {
    const out = new Uint8Array(HEADER_SIZE + this.bytes.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, MAGIC, false);
    out[4] = VERSION;
    out[5] = this.hashes;
    dv.setUint32(8, this.bits, false);
    dv.setUint32(12, this.capacity, false);
    dv.setUint32(16, this.count, false);
    dv.setUint32(20, this.seed, false);
    dv.setUint32(24, checksumBytes(this.bytes), false);
    out.set(this.bytes, HEADER_SIZE);
    return out;
  }

  static deserialize(input) {
    const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (buf.length < HEADER_SIZE) throw new Error('bloom: truncated header');
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const magic = dv.getUint32(0, false);
    if (magic !== MAGIC) {
      throw new Error(`bloom: bad magic 0x${magic.toString(16)} (expected 0x${MAGIC.toString(16)})`);
    }
    const version = buf[4];
    if (version !== VERSION) throw new Error(`bloom: unsupported version ${version}`);
    const hashes = buf[5];
    const bits = dv.getUint32(8, false);
    const capacity = dv.getUint32(12, false);
    const count = dv.getUint32(16, false);
    const seed = dv.getUint32(20, false);
    const want = dv.getUint32(24, false);
    const need = Math.ceil(bits / 8);
    const body = buf.subarray(HEADER_SIZE);
    if (body.length !== need) {
      throw new Error(`bloom: body length ${body.length} != declared ${need}`);
    }
    const got = checksumBytes(body);
    if (got !== want) {
      throw new Error(`bloom: checksum mismatch 0x${got.toString(16)} != 0x${want.toString(16)}`);
    }
    // Copy so the filter never aliases a caller-owned buffer.
    return new BloomFilter({
      bits,
      hashes,
      capacity,
      count,
      seed,
      bytes: new Uint8Array(body),
    });
  }
}

/** FNV-1a over raw bytes — integrity check only, NOT a signature. */
export function checksumBytes(bytes) {
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], FNV_PRIME) >>> 0;
  return h >>> 0;
}
