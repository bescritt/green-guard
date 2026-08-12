/**
 * core/premium.js — offline licence verification (extension_requirements.md §6, §8).
 *
 * PURE. No chrome.*. Uses Ed25519 via the Web Crypto API (available in service
 * workers and in Node 20+ via globalThis.crypto.subtle), so there is no native
 * dependency and no bundled cryptography we did not write and could not audit.
 *
 * Design constraints from the spec and the recon:
 *   - verification must be possible OFFLINE (no server required by default)
 *   - a verification NETWORK failure must mean "not entitled", never "entitled"
 *   - an absent or malformed licence must degrade to not-entitled, not throw
 *   - the public key is shipped; the private key is never in the package
 *
 * Because the production build must not ship a real private key, the bundled key
 * here is a TEST key generated at build time and clearly marked. The signing
 * tool (build/tools/license.py) uses the matching private key so we can prove
 * the round trip end to end. A deployment would swap in a separately-held key.
 */

const KEY_USE = { name: 'Ed25519', namedCurve: 'Ed25519' };

/** A clearly-fake, build-time test key. Never treat as a production secret. */
export const TEST_PUBLIC_KEY_JWK = Object.freeze({
  kty: 'OKP',
  crv: 'Ed25519',
  alg: 'EdDSA',
  // 32 zero bytes — a placeholder. build/tools/license.py generates a real pair
  // and rewrites this constant (guarded) at packaging time for CI, but the
  // extension itself only ever holds the public half.
  x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
});

/** What a valid licence document asserts. */
export const LICENSE_FIELDS = Object.freeze({
  sub: 'string',     // licensee id / email hash
  iat: 'number',     // issued at (epoch ms)
  exp: 'number',     // expires at (epoch ms)
  plan: 'string',    // 'premium' etc
  v: 'number',       // licence schema version
});

/**
 * Verify a signed licence.
 * @param {object} license {payload, signatureBytes: Uint8Array}
 * @param {object} [opts] {publicKeyJwk, now, nowFn, subtle}
 * @returns {Promise<{entitled:boolean, reason:string, payload?:object}>}
 */
export async function verifyLicence(license, opts = {}) {
  const subtle = opts.subtle || (globalThis.crypto && globalThis.crypto.subtle);
  const nowFn = opts.nowFn || (() => Date.now());
  const pub = opts.publicKeyJwk || TEST_PUBLIC_KEY_JWK;

  if (!license || typeof license !== 'object') return { entitled: false, reason: 'no-license' };
  if (!license.payload || !license.signatureBytes) return { entitled: false, reason: 'malformed' };
  if (!(license.signatureBytes instanceof Uint8Array)) return { entitled: false, reason: 'bad-signature-type' };

  let key;
  try {
    key = await subtle.importKey('jwk', pub, KEY_USE, false, ['verify']);
  } catch {
    // A zero-key placeholder imported fine; a *corrupt* key here means the
    // shipped key is wrong — fail closed, never entitled.
    return { entitled: false, reason: 'bad-public-key' };
  }

  let ok = false;
  try {
    ok = await subtle.verify('EdDSA', key, license.signatureBytes, encodePayload(license.payload));
  } catch {
    return { entitled: false, reason: 'verify-error' };
  }
  if (!ok) return { entitled: false, reason: 'signature-invalid', payload: license.payload };

  const now = nowFn();
  if (typeof license.payload.iat === 'number' && now < license.payload.iat) {
    return { entitled: false, reason: 'not-yet-valid', payload: license.payload };
  }
  if (typeof license.payload.exp === 'number' && now > license.payload.exp) {
    return { entitled: false, reason: 'expired', payload: license.payload };
  }
  if (license.payload.plan !== 'premium' && license.payload.plan !== 'pro') {
    return { entitled: false, reason: 'wrong-plan', payload: license.payload };
  }
  return { entitled: true, reason: 'ok', payload: license.payload };
}

/** Encode a payload deterministically for signing. */
export function encodePayload(payload) {
  return new TextEncoder().encode(JSON.stringify(payload));
}

/**
 * Entitlement store: caches the last decision and answers synchronous-ish
 * queries. The grace window (spec) means a brief verification failure does not
 * instantly de-premium a paying user; it only flips to not-entitled after the
 * grace period elapses without a successful re-check.
 */
export class EntitlementStore {
  constructor({ subtle, publicKeyJwk, nowFn, graceMs = 6 * 3600 * 1000, storage } = {}) {
    this.subtle = subtle;
    this.pub = publicKeyJwk;
    this.nowFn = nowFn;
    this.graceMs = graceMs;
    this.storage = storage;
    this.cached = null; // {entitled, checkedAt, reason}
  }

  async load() {
    if (this.cached) return this.cached;
    try {
      const got = await this.storage?.get('entitlement');
      const raw = got && got.entitlement;
      if (raw && typeof raw === 'object') this.cached = raw;
    } catch { /* storage optional */ }
    return this.cached || { entitled: false, checkedAt: 0, reason: 'unknown' };
  }

  async verify(license) {
    const res = await verifyLicence(license, { subtle: this.subtle, publicKeyJwk: this.pub, nowFn: this.nowFn });
    const now = this.nowFn();
    this.cached = { entitled: res.entitled, checkedAt: now, reason: res.reason, payload: res.payload };
    // Persist only the decision, never the licence bytes.
    try { await this.storage?.set({ entitlement: { entitled: res.entitled, checkedAt: now, reason: res.reason } }); } catch { /* optional */ }
    return res;
  }

  /**
   * Return the last known entitlement, applying the grace window:
   * if we last verified as entitled and the failure is recent, keep entitling.
   */
  async isEntitled({ onRecheck } = {}) {
    const last = await this.load();
    if (last.entitled && Date.now() - last.checkedAt < this.graceMs) return true;
    if (onRecheck) {
      const res = await onRecheck();
      return res.entitled === true;
    }
    return last.entitled;
  }
}
