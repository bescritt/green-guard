/**
 * platform/browser.js — the ONE place the extension touches a browser API.
 *
 * Why this exists (XBR-03): every other module in `src/` is pure and testable in
 * plain Node. All environment coupling — MV3 service worker vs MV2 background
 * page, `chrome.*` vs `browser.*`, callbacks vs promises — is confined here.
 * Swap this adapter and the same core runs anywhere, including in tests against
 * a fake.
 *
 * Rules:
 *  - never throw on a *missing* API; report the capability as absent so callers
 *    can degrade (Firefox has no chrome.offscreen; Android has no native messaging)
 *  - always return promises, even where MV2 uses callbacks
 *  - never leak the raw API object to callers
 */

/** Resolve the extension API namespace across engines. */
function detectApi(globalObj) {
  const g = globalObj || (typeof globalThis !== 'undefined' ? globalThis : {});
  if (g.browser && g.browser.runtime) return g.browser; // Firefox / polyfilled
  if (g.chrome && g.chrome.runtime) return g.chrome; // Chrome / Brave
  return null;
}

export const ENGINE = Object.freeze({
  CHROMIUM_MV3: 'chromium-mv3',
  FIREFOX_MV2: 'firefox-mv2',
  UNKNOWN: 'unknown',
});

/**
 * Promisify a possibly-callback-style API call.
 * Chrome MV3 returns promises; MV2 and older Chrome use callbacks with
 * `runtime.lastError`. Handle both without the caller ever knowing.
 */
function invoke(api, fn, thisArg, args) {
  if (typeof fn !== 'function') {
    return Promise.reject(new Error('api method unavailable'));
  }
  let result;
  try {
    result = fn.apply(thisArg, args);
  } catch (err) {
    return Promise.reject(err);
  }
  if (result && typeof result.then === 'function') return result;

  // Callback style: re-invoke with a callback appended.
  return new Promise((resolve, reject) => {
    try {
      fn.apply(thisArg, [
        ...args,
        (value) => {
          const le = api && api.runtime && api.runtime.lastError;
          if (le) reject(new Error(le.message || String(le)));
          else resolve(value);
        },
      ]);
    } catch (err) {
      reject(err);
    }
  });
}

export class BrowserAdapter {
  /** @param {object} [globalObj] injectable global (tests pass a fake) */
  constructor(globalObj) {
    this.api = detectApi(globalObj);
    this.available = this.api !== null;
  }

  /** Which engine are we on? Derived from real capabilities, not user-agent. */
  get engine() {
    if (!this.available) return ENGINE.UNKNOWN;
    const mv = this.manifestVersion();
    if (mv === 3) return ENGINE.CHROMIUM_MV3;
    if (mv === 2) return ENGINE.FIREFOX_MV2;
    return ENGINE.UNKNOWN;
  }

  manifestVersion() {
    try {
      const m = this.api.runtime.getManifest();
      return m && m.manifest_version;
    } catch {
      return undefined;
    }
  }

  /** Capability probes — callers branch on these, never on a browser name. */
  get capabilities() {
    const a = this.api || {};
    return {
      offscreen: !!(a.offscreen && typeof a.offscreen.createDocument === 'function'),
      nativeMessaging: !!(a.runtime && typeof a.runtime.connectNative === 'function'),
      scripting: !!(a.scripting && typeof a.scripting.executeScript === 'function'),
      declarativeNetRequest: !!a.declarativeNetRequest,
      alarms: !!(a.alarms && typeof a.alarms.create === 'function'),
      sessionStorage: !!(a.storage && a.storage.session),
      tabsMute: !!(a.tabs && typeof a.tabs.update === 'function'),
    };
  }

  // ── storage ────────────────────────────────────────────────────────────────

  async storageGet(keys, area = 'local') {
    const store = this.api?.storage?.[area];
    if (!store) throw new Error(`storage.${area} unavailable`);
    return invoke(this.api, store.get, store, [keys]);
  }

  async storageSet(items, area = 'local') {
    const store = this.api?.storage?.[area];
    if (!store) throw new Error(`storage.${area} unavailable`);
    return invoke(this.api, store.set, store, [items]);
  }

  async storageRemove(keys, area = 'local') {
    const store = this.api?.storage?.[area];
    if (!store) throw new Error(`storage.${area} unavailable`);
    return invoke(this.api, store.remove, store, [keys]);
  }

  // ── tabs ───────────────────────────────────────────────────────────────────

  async tabsGet(tabId) {
    return invoke(this.api, this.api?.tabs?.get, this.api.tabs, [tabId]);
  }

  async tabsUpdate(tabId, props) {
    return invoke(this.api, this.api?.tabs?.update, this.api.tabs, [tabId, props]);
  }

  async tabsRemove(tabId) {
    return invoke(this.api, this.api?.tabs?.remove, this.api.tabs, [tabId]);
  }

  onTabUpdated(listener) {
    this.api?.tabs?.onUpdated?.addListener?.(listener);
    return () => this.api?.tabs?.onUpdated?.removeListener?.(listener);
  }

  onTabRemoved(listener) {
    this.api?.tabs?.onRemoved?.addListener?.(listener);
    return () => this.api?.tabs?.onRemoved?.removeListener?.(listener);
  }

  // ── scripting (MV3) with an MV2 tabs.* fallback ────────────────────────────

  async executeScript(injection) {
    if (this.capabilities.scripting) {
      return invoke(this.api, this.api.scripting.executeScript, this.api.scripting, [injection]);
    }
    // MV2 path: tabs.executeScript takes code or a file, not a function.
    const tabId = injection?.target?.tabId;
    const files = injection?.files;
    if (files && files.length) {
      const out = [];
      for (const file of files) {
        out.push(await invoke(this.api, this.api?.tabs?.executeScript, this.api.tabs, [tabId, { file }]));
      }
      return out;
    }
    if (typeof injection?.func === 'function') {
      const args = injection.args || [];
      const code = `(${injection.func.toString()}).apply(null, ${JSON.stringify(args)});`;
      return invoke(this.api, this.api?.tabs?.executeScript, this.api.tabs, [tabId, { code }]);
    }
    throw new Error('executeScript: nothing to inject');
  }

  async insertCSS(injection) {
    if (this.api?.scripting?.insertCSS) {
      return invoke(this.api, this.api.scripting.insertCSS, this.api.scripting, [injection]);
    }
    const tabId = injection?.target?.tabId;
    return invoke(this.api, this.api?.tabs?.insertCSS, this.api.tabs, [
      tabId,
      { code: injection.css, cssOrigin: (injection.origin || 'author').toLowerCase() },
    ]);
  }

  async removeCSS(injection) {
    if (this.api?.scripting?.removeCSS) {
      return invoke(this.api, this.api.scripting.removeCSS, this.api.scripting, [injection]);
    }
    const tabId = injection?.target?.tabId;
    return invoke(this.api, this.api?.tabs?.removeCSS, this.api.tabs, [
      tabId,
      { code: injection.css, cssOrigin: (injection.origin || 'author').toLowerCase() },
    ]);
  }

  // ── alarms ─────────────────────────────────────────────────────────────────

  createAlarm(name, info) {
    this.api?.alarms?.create?.(name, info);
  }

  async clearAlarm(name) {
    if (!this.api?.alarms?.clear) return false;
    return invoke(this.api, this.api.alarms.clear, this.api.alarms, [name]);
  }

  onAlarm(listener) {
    this.api?.alarms?.onAlarm?.addListener?.(listener);
    return () => this.api?.alarms?.onAlarm?.removeListener?.(listener);
  }

  // ── messaging ──────────────────────────────────────────────────────────────

  onMessage(listener) {
    this.api?.runtime?.onMessage?.addListener?.(listener);
    return () => this.api?.runtime?.onMessage?.removeListener?.(listener);
  }

  async sendMessage(message) {
    return invoke(this.api, this.api?.runtime?.sendMessage, this.api.runtime, [message]);
  }

  connectNative(name) {
    if (!this.capabilities.nativeMessaging) throw new Error('nativeMessaging unavailable');
    return this.api.runtime.connectNative(name);
  }

  async sendNativeMessage(name, message) {
    if (!this.api?.runtime?.sendNativeMessage) throw new Error('sendNativeMessage unavailable');
    return invoke(this.api, this.api.runtime.sendNativeMessage, this.api.runtime, [name, message]);
  }

  // ── offscreen (MV3 only) ───────────────────────────────────────────────────

  async createOffscreenDocument(opts) {
    if (!this.capabilities.offscreen) throw new Error('offscreen unavailable');
    return invoke(this.api, this.api.offscreen.createDocument, this.api.offscreen, [opts]);
  }

  async closeOffscreenDocument() {
    if (!this.capabilities.offscreen) throw new Error('offscreen unavailable');
    return invoke(this.api, this.api.offscreen.closeDocument, this.api.offscreen, []);
  }

  // ── misc ───────────────────────────────────────────────────────────────────

  getURL(path) {
    return this.api?.runtime?.getURL ? this.api.runtime.getURL(path) : path;
  }

  getManifest() {
    try {
      return this.api.runtime.getManifest();
    } catch {
      return null;
    }
  }

  /** i18n with a safe fallback so a missing string can never blank the UI. */
  getMessage(key, substitutions) {
    const msg = this.api?.i18n?.getMessage?.(key, substitutions);
    return msg || key;
  }
}

/** Default adapter bound to the ambient global. */
export function createBrowserAdapter(globalObj) {
  return new BrowserAdapter(globalObj);
}
