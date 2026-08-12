/**
 * tests/helpers/fake-chrome.mjs — a behavioural fake of the extension APIs.
 *
 * Not a stub that records calls: a small simulator. It enforces the parts of the
 * real platform contract that catch bugs —
 *
 *   - storage is async, serialises values, and is isolated per area
 *   - `storage.session` exists only when asked for (Firefox MV2 lacks it)
 *   - tabs must exist before you can act on them; acting on a dead tab rejects
 *     exactly the way Chrome does ("No tab with id: N")
 *   - alarms only fire when the test advances the clock
 *   - MV2 mode drops `scripting`/`offscreen` so the fallback paths get exercised
 *   - `runtime.lastError` is set for callback-style failures
 *
 * A fake that always succeeds tests nothing.
 */

export class FakeStorageArea {
  constructor(name) {
    this.name = name;
    this.data = new Map();
    this.writes = 0;
    this.reads = 0;
  }

  async get(keys) {
    this.reads++;
    if (keys === null || keys === undefined) {
      return Object.fromEntries([...this.data.entries()].map(([k, v]) => [k, clone(v)]));
    }
    if (typeof keys === 'string') {
      return this.data.has(keys) ? { [keys]: clone(this.data.get(keys)) } : {};
    }
    if (Array.isArray(keys)) {
      const out = {};
      for (const k of keys) if (this.data.has(k)) out[k] = clone(this.data.get(k));
      return out;
    }
    // object form: keys with defaults
    const out = {};
    for (const [k, dflt] of Object.entries(keys)) {
      out[k] = this.data.has(k) ? clone(this.data.get(k)) : dflt;
    }
    return out;
  }

  async set(items) {
    this.writes++;
    for (const [k, v] of Object.entries(items)) {
      // Real storage structured-clones; reject what it would reject.
      if (typeof v === 'function') throw new Error(`storage.${this.name}: cannot store a function`);
      this.data.set(k, clone(v));
    }
  }

  async remove(keys) {
    for (const k of [].concat(keys)) this.data.delete(k);
  }

  async clear() {
    this.data.clear();
  }

  get bytes() {
    return JSON.stringify([...this.data.entries()]).length;
  }
}

function clone(v) {
  if (v === undefined || v === null) return v;
  if (v instanceof Uint8Array) return new Uint8Array(v); // survives structured clone
  return JSON.parse(JSON.stringify(v));
}

class FakeEvent {
  constructor() {
    this.listeners = new Set();
  }
  addListener(fn) { this.listeners.add(fn); }
  removeListener(fn) { this.listeners.delete(fn); }
  hasListener(fn) { return this.listeners.has(fn); }
  get count() { return this.listeners.size; }
  /** Dispatch and collect results, awaiting any promises listeners return. */
  async emit(...args) {
    const out = [];
    for (const fn of [...this.listeners]) out.push(await fn(...args));
    return out;
  }
}

export class FakeChrome {
  /**
   * @param {object} [o]
   * @param {2|3} [o.manifestVersion]
   * @param {boolean} [o.hasOffscreen]
   * @param {boolean} [o.hasNativeMessaging]
   * @param {boolean} [o.hasSessionStorage]
   */
  constructor({
    manifestVersion = 3,
    hasOffscreen = manifestVersion === 3,
    hasNativeMessaging = true,
    hasSessionStorage = manifestVersion === 3,
  } = {}) {
    this.mv = manifestVersion;
    this.now = 0;
    this.log = [];
    this._nextTabId = 1;
    this.tabs_ = new Map();
    this.injectedCSS = [];
    this.executedScripts = [];
    this.offscreenDocuments = [];
    this.alarms_ = new Map();
    this.nativePorts = [];
    this.runtime = {
      lastError: null,
      id: 'fakeextensionid0000000000000000',
      getManifest: () => ({ manifest_version: this.mv, version: '1.0.0', name: 'SafeBrowsing+' }),
      getURL: (p) => `chrome-extension://${this.runtime.id}/${String(p).replace(/^\//, '')}`,
      onMessage: new FakeEvent(),
      onInstalled: new FakeEvent(),
      onStartup: new FakeEvent(),
      sendMessage: async (msg) => {
        this.log.push(['runtime.sendMessage', msg]);
        const results = await this.runtime.onMessage.emit(msg, { id: this.runtime.id }, () => {});
        return results.find((r) => r !== undefined);
      },
    };

    if (hasNativeMessaging) {
      this.runtime.connectNative = (name) => this._makeNativePort(name);
      this.runtime.sendNativeMessage = async (name, message) => {
        this.log.push(['sendNativeMessage', name, message]);
        if (this.nativeHandler) return this.nativeHandler(message);
        throw new Error(`No such native application ${name}`);
      };
    }

    this.storage = { local: new FakeStorageArea('local'), sync: new FakeStorageArea('sync') };
    if (hasSessionStorage) this.storage.session = new FakeStorageArea('session');

    this.tabs = {
      onUpdated: new FakeEvent(),
      onRemoved: new FakeEvent(),
      onActivated: new FakeEvent(),
      get: async (id) => {
        const t = this.tabs_.get(id);
        if (!t) throw new Error(`No tab with id: ${id}`);
        return { ...t };
      },
      update: async (id, props) => {
        const t = this.tabs_.get(id);
        if (!t) throw new Error(`No tab with id: ${id}`);
        Object.assign(t, props);
        this.log.push(['tabs.update', id, props]);
        return { ...t };
      },
      remove: async (id) => {
        if (!this.tabs_.has(id)) throw new Error(`No tab with id: ${id}`);
        this.tabs_.delete(id);
        this.log.push(['tabs.remove', id]);
        await this.tabs.onRemoved.emit(id, { isWindowClosing: false });
      },
      query: async (q) => [...this.tabs_.values()].filter((t) => (q.active ? t.active : true)),
    };

    if (this.mv === 3) {
      this.scripting = {
        executeScript: async (inj) => {
          this._requireTab(inj?.target?.tabId);
          this.executedScripts.push(inj);
          this.log.push(['scripting.executeScript', inj?.target?.tabId]);
          // Only run the injected page-function where a real DOM exists (jsdom /
          // a real browser). In a bare Node integration test we record the
          // injection and report success — we are testing orchestration, not DOM
          // rendering (that path is covered by the jsdom action unit tests and
          // the real-browser load test at BLD-08).
          if (typeof inj.func === 'function' && typeof globalThis.document !== 'undefined') {
            const r = inj.func(...(inj.args || []));
            return [{ result: r, frameId: 0 }];
          }
          return [{ result: undefined, frameId: 0 }];
        },
        insertCSS: async (inj) => {
          this._requireTab(inj?.target?.tabId);
          this.injectedCSS.push(inj);
          this.log.push(['scripting.insertCSS', inj?.target?.tabId, inj.origin]);
        },
        removeCSS: async (inj) => {
          this._requireTab(inj?.target?.tabId);
          this.injectedCSS = this.injectedCSS.filter((c) => c.css !== inj.css);
        },
      };
    } else {
      // MV2: only tabs.* injection exists.
      this.tabs.executeScript = async (tabId, details) => {
        this._requireTab(tabId);
        this.executedScripts.push({ tabId, ...details });
        return [undefined];
      };
      this.tabs.insertCSS = async (tabId, details) => {
        this._requireTab(tabId);
        this.injectedCSS.push({ tabId, ...details });
      };
      this.tabs.removeCSS = async (tabId, details) => {
        this.injectedCSS = this.injectedCSS.filter((c) => c.code !== details.code);
      };
    }

    if (hasOffscreen) {
      this.offscreen = {
        createDocument: async (opts) => {
          if (this.offscreenDocuments.length > 0) {
            throw new Error('Only a single offscreen document may be created');
          }
          this.offscreenDocuments.push(opts);
          this.log.push(['offscreen.createDocument', opts.reasons]);
        },
        closeDocument: async () => {
          if (this.offscreenDocuments.length === 0) throw new Error('No offscreen document to close');
          this.offscreenDocuments.pop();
          this.log.push(['offscreen.closeDocument']);
        },
        hasDocument: async () => this.offscreenDocuments.length > 0,
      };
    }

    this.alarms = {
      onAlarm: new FakeEvent(),
      create: (name, info) => {
        this.alarms_.set(name, { name, info, nextFire: this.now + minutesToMs(info) });
        this.log.push(['alarms.create', name, info]);
      },
      clear: async (name) => this.alarms_.delete(name),
      clearAll: async () => { this.alarms_.clear(); return true; },
      get: async (name) => this.alarms_.get(name),
      getAll: async () => [...this.alarms_.values()],
    };

    this.i18n = { getMessage: (k) => `[${k}]` };
    this.permissions = {
      contains: async () => true,
      request: async () => true,
      remove: async () => true,
    };
  }

  _requireTab(id) {
    if (!this.tabs_.has(id)) throw new Error(`No tab with id: ${id}`);
  }

  _makeNativePort(name) {
    const port = {
      name,
      disconnected: false,
      sent: [],
      onMessage: new FakeEvent(),
      onDisconnect: new FakeEvent(),
      postMessage: (msg) => {
        if (port.disconnected) throw new Error('Attempt to postMessage on disconnected port');
        port.sent.push(msg);
        if (this.nativeHandler) {
          Promise.resolve(this.nativeHandler(msg)).then(
            (resp) => { if (resp !== undefined && !port.disconnected) port.onMessage.emit(resp); },
            (err) => { port.disconnected = true; port.onDisconnect.emit({ error: String(err) }); },
          );
        }
      },
      disconnect: () => {
        port.disconnected = true;
        port.onDisconnect.emit();
      },
    };
    this.nativePorts.push(port);
    return port;
  }

  /** Register the native-host behaviour for this test. */
  setNativeHandler(fn) {
    this.nativeHandler = fn;
    return this;
  }

  /** Open a tab and return its id. */
  openTab({ url = 'https://example.com/', title = 'Example', active = true } = {}) {
    const id = this._nextTabId++;
    this.tabs_.set(id, { id, url, title, active, muted: false, status: 'complete' });
    return id;
  }

  /** Fire tabs.onUpdated the way a navigation does. */
  async navigate(tabId, url, { status = 'complete' } = {}) {
    const t = this.tabs_.get(tabId);
    if (!t) throw new Error(`No tab with id: ${tabId}`);
    t.url = url;
    t.status = status;
    await this.tabs.onUpdated.emit(tabId, { status, url }, { ...t });
  }

  /** Advance the fake clock and fire any alarms that come due. */
  async advance(ms) {
    this.now += ms;
    const fired = [];
    for (const alarm of [...this.alarms_.values()]) {
      if (this.now >= alarm.nextFire) {
        const period = alarm.info?.periodInMinutes;
        if (period) alarm.nextFire = this.now + period * 60000;
        else this.alarms_.delete(alarm.name);
        // Await the listener to completion so the fake mirrors the real platform
        // (Chrome runs the alarm handler to completion before the next event).
        // Without this, a test that reads storage immediately after advance
        // races the async handler and sees stale state.
        const results = await this.alarms.onAlarm.emit({ name: alarm.name, scheduledTime: this.now });
        fired.push(...results);
      }
    }
    return fired;
  }

  /** Every call recorded, for order assertions. */
  calls(prefix) {
    return this.log.filter(([k]) => k.startsWith(prefix));
  }
}

function minutesToMs(info) {
  if (!info) return 0;
  if (typeof info.when === 'number') return info.when;
  const m = info.delayInMinutes ?? info.periodInMinutes ?? 0;
  return m * 60000;
}

/** A global object shaped like a service worker's, carrying the fake API. */
export function fakeGlobal(opts) {
  const chrome = new FakeChrome(opts);
  return { chrome, globalObj: { chrome } };
}

/** A global shaped like Firefox's, exposing `browser` instead of `chrome`. */
export function fakeFirefoxGlobal(opts = {}) {
  const chrome = new FakeChrome({ manifestVersion: 2, ...opts });
  return { chrome, globalObj: { browser: chrome } };
}
