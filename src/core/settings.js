/**
 * core/settings.js — the user-facing configuration, with guarded defaults.
 *
 * PURE (storage injected). Settings flow through here so defaults are declared in
 * exactly one place and nothing in the extension reads a raw `storage.local`
 * value without a fallback (a missing key must never mean "block everything" or
 * "block nothing" by accident).
 *
 * Permission justification (CMP-05) is data, not prose: each setting ties to the
 * manifest permission it requires, so the compliance doc can be generated.
 */

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  enabled: true,                       // master switch
  protectionLevel: 'balanced',         // 'minimum' | 'balanced' | 'strict'
  bannerModeOnly: false,               // downgrade blank/lock to warn
  closeOnKnownScam: false,             // §5.4: opt-in only, never default
  safeViewEnabled: true,               // §5.5
  collectReports: false,               // §Privacy: opt-in, default off
  remoteDriverEnabled: false,          // §3.1: off for privacy by default
  premiumSummaries: false,             // gated by entitlement at runtime
  theme: 'auto',
});

/** Per-level, how each tier maps to an action set (the safe defaults). */
export const LEVEL_POLICY = Object.freeze({
  minimum:  { known_scam: ['mute', 'blank'], risky: [], mediocre: [], safe: [], ideal: [] },
  balanced: { known_scam: ['mute', 'blank', 'lock'], risky: ['warn'], mediocre: ['warn'], safe: [], ideal: [] },
  strict:   { known_scam: ['mute', 'blank', 'lock'], risky: ['mute', 'blank'], mediocre: ['warn'], safe: [], ideal: [] },
});

/** Which manifest permission each setting conceptually depends on (CMP-05). */
export const SETTING_PERMISSIONS = Object.freeze({
  enabled: [],
  protectionLevel: ['storage'],
  bannerModeOnly: ['storage'],
  closeOnKnownScam: ['tabs'],
  safeViewEnabled: ['tabs', 'scripting', 'storage'],
  collectReports: ['storage'],
  remoteDriverEnabled: ['nativeMessaging', 'storage'],
  premiumSummaries: ['storage'],
  theme: ['storage'],
});

export class SettingsStore {
  constructor(storage, { key = 'settings', maxBytes = 20000 } = {}) {
    this.storage = storage;
    this.key = key;
    this.maxBytes = maxBytes;
    this._cache = null;
  }

  async get() {
    if (this._cache) return this._cache;
    let merged = { ...DEFAULT_SETTINGS };
    try {
      const got = await this.storage.get(this.key);
      const raw = got && got[this.key];
      if (raw && typeof raw === 'object') merged = sanitise({ ...DEFAULT_SETTINGS, ...raw });
    } catch { /* unreadable → safe defaults */ }
    this._cache = merged;
    return merged;
  }

  async set(patch) {
    const current = await this.get();
    const next = sanitise({ ...current, ...patch });
    const serialised = JSON.stringify(next);
    if (serialised.length > this.maxBytes) {
      throw new RangeError(`settings exceed ${this.maxBytes} bytes`);
    }
    this._cache = next;
    await this.storage.set({ [this.key]: next });
    return next;
  }

  async reset() {
    this._cache = { ...DEFAULT_SETTINGS };
    await this.storage.set({ [this.key]: this._cache });
    return this._cache;
  }

  invalidate() { this._cache = null; }

  /** Policy action set for a tier under the current level. */
  async policyFor(tier) {
    const s = await this.get();
    const level = LEVEL_POLICY[s.protectionLevel] ? s.protectionLevel : 'balanced';
    return LEVEL_POLICY[level][tier] || [];
  }
}

/** Drop unknown keys and coerce types so a corrupt blob cannot change behaviour. */
export function sanitise(raw) {
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    const def = DEFAULT_SETTINGS[k];
    const val = raw[k];
    // protectionLevel is a string, but only a fixed set of values is valid; an
    // invalid string must reset to the default even though its type matches.
    if (k === 'protectionLevel') {
      out[k] = ['minimum', 'balanced', 'strict'].includes(val) ? val : def;
      continue;
    }
    if (typeof val === typeof def) out[k] = val;
    else if (typeof def === 'boolean' && (val === 'true' || val === 'false')) out[k] = val === 'true';
    else out[k] = def;
  }
  // closeOnKnownScam must never be silently enabled.
  out.closeOnKnownScam = Boolean(out.closeOnKnownScam);
  return out;
}
