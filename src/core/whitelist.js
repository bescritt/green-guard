/**
 * core/whitelist.js — domain normalisation and the user whitelist.
 *
 * PURE (storage is injected).
 *
 * Domain normalisation is a security boundary, not a formatting nicety. If
 * `Example.COM.`, `www.example.com` and `example.com` normalise differently then
 * whitelisting one leaves the others blocked (infuriating) — or worse, a
 * blocklist check misses a variant (dangerous). So the rules are explicit and
 * property-tested for idempotence.
 *
 * Deliberate scope choice: a whitelist entry covers the registrable domain and
 * all its subdomains. Whitelisting `example.com` also trusts `shop.example.com`.
 * That matches user expectation ("I trust this site"). It is NOT applied in the
 * other direction: whitelisting `shop.example.com` does not trust `example.com`.
 */

/**
 * Public-suffix handling without shipping the full PSL (which is ~230 KB and
 * would need periodic updates — a maintenance liability for marginal gain).
 * We handle the common multi-part suffixes explicitly and treat everything else
 * as a two-label registrable domain.
 */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'lg.jp',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'gov.in', 'ac.in',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'co.za', 'org.za', 'net.za', 'gov.za', 'ac.za',
  'com.mx', 'org.mx', 'gob.mx', 'com.ar', 'org.ar', 'gob.ar',
  'com.sg', 'com.hk', 'com.tw', 'com.tr', 'com.pl', 'com.ua',
  'co.kr', 'or.kr', 'go.kr', 'ne.kr',
  'co.il', 'org.il', 'ac.il', 'gov.il',
  'com.ru', 'net.ru', 'org.ru',
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app',
  'netlify.app', 'herokuapp.com', 'firebaseapp.com', 'web.app',
  'blogspot.com', 'wordpress.com', 'tumblr.com', 's3.amazonaws.com',
]);

/**
 * Normalise a URL or hostname to a canonical lowercase hostname.
 * Returns '' for anything unusable — callers must treat '' as "no domain",
 * never as a wildcard.
 */
export function normaliseDomain(input) {
  if (typeof input !== 'string') return '';
  let host = input.trim();
  if (!host) return '';

  // Full URL? take its hostname. Bare host? use as-is.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      return '';
    }
  } else {
    // Strip anything after the authority for input like "example.com/path?q=1"
    host = host.split('/')[0].split('?')[0].split('#')[0];
    // Strip credentials and port
    const at = host.lastIndexOf('@');
    if (at >= 0) host = host.slice(at + 1);
  }

  // Strip a port that survived (URL parsing already removes it)
  host = host.replace(/:\d+$/, '');
  // IPv6 literals arrive bracketed
  if (host.startsWith('[') && host.endsWith(']')) return host.toLowerCase();

  host = host.toLowerCase();
  // A single trailing dot is the legal absolute-root form; it must not create a
  // distinct entry from the same name without it.
  while (host.endsWith('.')) host = host.slice(0, -1);

  if (!host) return '';
  // Reject anything that is not plausibly a hostname (spaces, control chars).
  if (/[\s\u0000-\u001f]/.test(host)) return '';
  return host;
}

/** True for a bare IPv4/IPv6 literal, which has no registrable domain. */
export function isIpLiteral(host) {
  if (!host) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(':') || (host.startsWith('[') && host.endsWith(']'));
}

/**
 * The registrable domain ("eTLD+1"): the part a whitelist entry should cover.
 * `shop.example.co.uk` → `example.co.uk`; `example.com` → `example.com`.
 */
export function registrableDomain(input) {
  const host = normaliseDomain(input);
  if (!host || isIpLiteral(host)) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;

  const lastTwo = parts.slice(-2).join('.');
  const lastThree = parts.slice(-3).join('.');
  if (MULTI_PART_SUFFIXES.has(lastThree)) return parts.slice(-4).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

/** Does `host` fall under whitelist entry `entry`? */
export function domainMatches(host, entry) {
  const h = normaliseDomain(host);
  const e = normaliseDomain(entry);
  if (!h || !e) return false;
  if (h === e) return true;
  return h.endsWith('.' + e); // subdomains inherit trust, never the reverse
}

/**
 * The whitelist, persisted through an injected storage adapter.
 * Kept small and bounded: an unbounded whitelist is a memory leak and, past a
 * few thousand entries, a linear-scan performance problem on every navigation.
 */
export class WhitelistStore {
  /**
   * @param {object} storage object with async get/set(key)
   * @param {object} [o]
   * @param {string} [o.key]
   * @param {number} [o.max] hard cap on entries
   */
  constructor(storage, { key = 'whitelist', max = 5000 } = {}) {
    this.storage = storage;
    this.key = key;
    this.max = max;
    this._cache = null;
  }

  async _load() {
    if (this._cache) return this._cache;
    let list = [];
    try {
      const got = await this.storage.get(this.key);
      const raw = got && got[this.key];
      if (Array.isArray(raw)) list = raw;
    } catch { /* unreadable storage must not break protection */ }
    this._cache = new Set(list.map(normaliseDomain).filter(Boolean));
    return this._cache;
  }

  async _persist() {
    await this.storage.set({ [this.key]: [...this._cache] });
  }

  async list() {
    return [...(await this._load())].sort();
  }

  async size() {
    return (await this._load()).size;
  }

  /** Is this host covered by any entry (exact or as a subdomain)? */
  async isWhitelisted(host) {
    const h = normaliseDomain(host);
    if (!h) return false;
    const set = await this._load();
    if (set.has(h)) return true;
    // Walk up the labels: cheaper than scanning every entry.
    const parts = h.split('.');
    for (let i = 1; i < parts.length; i++) {
      if (set.has(parts.slice(i).join('.'))) return true;
    }
    return false;
  }

  /** Add an entry. Stores the registrable domain so subdomains are covered. */
  async add(host, { exact = false } = {}) {
    const h = exact ? normaliseDomain(host) : registrableDomain(host);
    if (!h) return { ok: false, error: 'not a valid domain' };
    const set = await this._load();
    if (set.has(h)) return { ok: true, domain: h, alreadyPresent: true };
    if (set.size >= this.max) {
      return { ok: false, error: `whitelist is full (${this.max} entries)` };
    }
    set.add(h);
    await this._persist();
    return { ok: true, domain: h };
  }

  async remove(host) {
    const set = await this._load();
    const h = normaliseDomain(host);
    let removed = set.delete(h);
    // Also allow removing by registrable form for a subdomain-shaped input.
    const reg = registrableDomain(host);
    if (!removed && reg !== h) removed = set.delete(reg);
    if (removed) await this._persist();
    return { ok: removed, domain: h };
  }

  async clear() {
    this._cache = new Set();
    await this._persist();
  }

  /** Drop the memory cache so the next read re-reads storage. */
  invalidate() {
    this._cache = null;
  }
}
