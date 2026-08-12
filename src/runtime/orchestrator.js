/**
 * runtime/orchestrator.js — the background brain (extension_requirements.md §1, §10).
 *
 * Navigation → classify → act, with the driver treated as an untrusted, possibly
 * absent participant.
 *
 * MV3 reality shapes this design (R-05): the service worker can be killed at any
 * moment, including mid-classification. So:
 *   - no long-lived in-memory state is authoritative; decisions are persisted
 *   - work is keyed by tabId+url so a resumed worker can tell "already handled"
 *     from "never started"
 *   - the keepalive alarm exists only while work is pending, then is removed
 *
 * The degradation ladder, in order, and never skipping a rung:
 *   whitelist → bloom filter → driver → local ML → heuristics
 * A failure at any rung falls through to the next. Nothing here can invent a
 * "safe" verdict out of an error.
 */

import { TIER, resolveActions } from '../core/tiers.js';
import { arbitrate, SOURCE } from '../core/arbitrate.js';
import { classifyHeuristically, needsDeepAnalysis } from '../core/heuristics.js';
import { BloomFilter } from '../core/bloom.js';
import { validateClassificationResult, validatePageFeatures } from '../core/contract.js';
import { normaliseDomain } from '../core/whitelist.js';

export const STORAGE_KEYS = Object.freeze({
  THREAT_BLOOM: 'threat_bloom',
  BLOOM_META: 'threat_bloom_meta',
  WHITELIST: 'whitelist',
  SETTINGS: 'settings',
  PENDING: 'pending_classifications',
  STATS: 'stats',
  SCHEMA_VERSION: 'schema_version',
});

export const ALARM = Object.freeze({
  KEEPALIVE: 'sbplus-keepalive',
  UPDATE_THREATLIST: 'sbplus-update-threatlist',
});

/** §9.1: below the 30 s idle timeout. 0.42 min ≈ 25 s. */
export const KEEPALIVE_PERIOD_MIN = 0.42;
/** §9.2: every 6 hours. */
export const THREATLIST_PERIOD_MIN = 360;

export class Orchestrator {
  /**
   * @param {object} deps
   * @param {import('../platform/browser.js').BrowserAdapter} deps.browser
   * @param {import('../driver/client.js').DriverClient} [deps.driver]
   * @param {import('./actions.js').SafetyActions} deps.actions
   * @param {object} [deps.store] settings/whitelist store
   * @param {object} [deps.mlHost] offscreen inference host
   * @param {object} [deps.settings]
   * @param {(e:object)=>void} [deps.onEvent]
   */
  constructor({ browser, driver = null, actions, store, settingsStore, mlHost = null, settings = {}, onEvent = null }) {
    this.browser = browser;
    this.driver = driver;
    this.actions = actions;
    this.store = store;                 // whitelist store
    this.settingsStore = settingsStore; // settings store (may equal store in trivial setups)
    this.mlHost = mlHost;
    this.settings = settings;
    this._onEvent = onEvent;

    this.bloom = null;
    this.pendingCount = 0;
    this._keepaliveActive = false;
    /** tabId → last handled url, so repeated onUpdated events are cheap */
    this.lastHandled = new Map();
    this.stats = { navigations: 0, classified: 0, blocked: 0, driverCalls: 0, driverFailures: 0, bloomHits: 0 };
  }

  _emit(evt) {
    if (this._onEvent) { try { this._onEvent(evt); } catch { /* never break on telemetry */ } }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /** Wire listeners and load persisted state. Safe to call again after a restart. */
  async init() {
    await this.loadBloom();
    this.browser.onTabUpdated((tabId, info, tab) => {
      // Return the promise so the platform waits for handling to settle, but
      // never let a rejection escape into the event loop.
      return Promise.resolve(this.handleNavigation(tabId, info, tab)).catch((err) =>
        this._emit({ type: 'error', where: 'onTabUpdated', message: String(err && err.message) }),
      );
    });
    this.browser.onTabRemoved((tabId) => {
      this.lastHandled.delete(tabId);
      this.actions.forgetTab(tabId);
    });
    this.browser.onAlarm((alarm) => {
      // Return the promise so the environment (real browser, or the fake's
      // event emitter) waits for the handler to run to completion. We still
      // shield the event loop from rejections, but we do NOT swallow the
      // completion: a swallowed chain would let a test read storage before the
      // alarm's work has actually persisted.
      return Promise.resolve(this.handleAlarm(alarm)).catch((err) =>
        this._emit({ type: 'error', where: 'onAlarm', message: String(err && err.message) }),
      );
    });
    this.browser.createAlarm(ALARM.UPDATE_THREATLIST, {
      periodInMinutes: THREATLIST_PERIOD_MIN,
      delayInMinutes: THREATLIST_PERIOD_MIN,
    });
    this._emit({ type: 'init', engine: this.browser.engine });
    return this;
  }

  /** §9.1 keepalive: only while work is outstanding. */
  _acquireKeepalive() {
    this.pendingCount++;
    if (!this._keepaliveActive) {
      this.browser.createAlarm(ALARM.KEEPALIVE, { periodInMinutes: KEEPALIVE_PERIOD_MIN });
      this._keepaliveActive = true;
      this._emit({ type: 'keepalive', state: 'on' });
    }
  }

  async _releaseKeepalive() {
    this.pendingCount = Math.max(0, this.pendingCount - 1);
    if (this.pendingCount === 0 && this._keepaliveActive) {
      await this.browser.clearAlarm(ALARM.KEEPALIVE);
      this._keepaliveActive = false;
      this._emit({ type: 'keepalive', state: 'off' });
    }
  }

  async handleAlarm(alarm) {
    if (!alarm) return;
    if (alarm.name === ALARM.UPDATE_THREATLIST) await this.updateThreatList();
    // KEEPALIVE is intentionally a no-op: waking the worker is the whole point.
  }

  // ── threat list ────────────────────────────────────────────────────────────

  async loadBloom() {
    try {
      const got = await this.browser.storageGet(STORAGE_KEYS.THREAT_BLOOM);
      const raw = got && got[STORAGE_KEYS.THREAT_BLOOM];
      if (!raw) return null;
      const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
      this.bloom = BloomFilter.deserialize(bytes);
      this._emit({ type: 'bloom', state: 'loaded', bits: this.bloom.bits, count: this.bloom.count });
      return this.bloom;
    } catch (err) {
      // A corrupt filter must not brick startup — drop it and carry on unfiltered.
      this.bloom = null;
      this._emit({ type: 'bloom', state: 'corrupt', message: String(err && err.message) });
      return null;
    }
  }

  /** §4.1/§9.2 fetch and persist a fresh list. Returns false when unavailable. */
  async updateThreatList() {
    if (!this.driver) return false;
    this._acquireKeepalive();
    try {
      const bytes = await this.driver.getThreatList();
      const filter = BloomFilter.deserialize(
        bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes),
      );
      // Persist as a plain array: chrome.storage cannot round-trip a typed array.
      await this.browser.storageSet({
        [STORAGE_KEYS.THREAT_BLOOM]: Array.from(filter.serialize()),
        [STORAGE_KEYS.BLOOM_META]: { updatedAt: Date.now(), count: filter.count, bits: filter.bits },
      });
      this.bloom = filter;
      this._emit({ type: 'bloom', state: 'updated', count: filter.count });
      return true;
    } catch (err) {
      this.stats.driverFailures++;
      this._emit({ type: 'bloom', state: 'update-failed', message: String(err && err.message) });
      return false;
    } finally {
      await this._releaseKeepalive();
    }
  }

  // ── classification ─────────────────────────────────────────────────────────

  /** Should this URL be examined at all? */
  static isClassifiable(url) {
    if (typeof url !== 'string' || url.length === 0) return false;
    return /^https?:\/\//i.test(url); // never touch chrome://, about:, file:, extension pages
  }

  /**
   * The full ladder for one page.
   * @returns {Promise<object>} the arbitrated decision (never throws)
   */
  async classify(features) {
    const v = validatePageFeatures(features);
    const f = v.ok ? v.value : { ...features, domain: features?.domain || '' };
    const domain = normaliseDomain(f.domain || f.url);
    const verdicts = [];

    // 1. whitelist — checked by the caller too, but belt and braces
    const whitelisted = this.store ? await this.store.isWhitelisted(domain) : false;
    if (whitelisted) {
      return arbitrate([], { whitelisted: true });
    }

    // 2. bloom filter (local, authoritative, no network)
    if (this.bloom && domain && this.bloom.has(domain)) {
      this.stats.bloomHits++;
      verdicts.push({
        source: SOURCE.BLOOM,
        tier: TIER.KNOWN_SCAM,
        confidence: 0.99,
        details: 'Domain appears on the local threat list',
        suggestedActions: ['mute', 'blank', 'lock'],
      });
      // A bloom hit is decisive; do not spend a driver call or an ML pass on it.
      return arbitrate(verdicts, { whitelisted: false });
    }

    // 3. local heuristics — always computed: they are free and they are the floor
    const h = classifyHeuristically(f);
    verdicts.push({
      source: SOURCE.HEURISTIC,
      tier: h.tier,
      confidence: h.confidence,
      details: h.details,
      suggestedActions: h.suggestedActions,
    });

    // 4. driver, if we have one
    if (this.driver) {
      this.stats.driverCalls++;
      try {
        const raw = await this.driver.classifyPage(f);
        const cv = validateClassificationResult(raw);
        if (cv.ok) {
          verdicts.push({ source: SOURCE.DRIVER, ...cv.value, reachable: true });
        } else {
          this.stats.driverFailures++;
          this._emit({ type: 'driver', state: 'malformed', errors: cv.errors });
        }
      } catch (err) {
        this.stats.driverFailures++;
        this._emit({ type: 'driver', state: 'failed', code: err && err.code });
        // Explicitly record unreachability; arbitration must know not to defer.
        verdicts.push({
          source: SOURCE.DRIVER, tier: TIER.MEDIOCRE, confidence: 0,
          reachable: false, details: 'driver unavailable',
        });
      }
    }

    // 5. local ML, only when the cheap signals are undecided
    if (this.mlHost && needsDeepAnalysis(h)) {
      try {
        const ml = await this.mlHost.classify(f);
        const mv = validateClassificationResult(ml);
        if (mv.ok) verdicts.push({ source: SOURCE.ML, ...mv.value });
      } catch (err) {
        this._emit({ type: 'ml', state: 'failed', message: String(err && err.message) });
        // Falling through with heuristics only is the documented §4.3 fallback.
      }
    }

    return arbitrate(verdicts, { whitelisted: false });
  }

  // ── navigation handling ────────────────────────────────────────────────────

  /**
   * §10.1/§10.2: react to a navigation.
   * Idempotent per (tabId, url) so the repeated onUpdated events Chrome emits
   * during a single navigation cost one classification, not five.
   */
  async handleNavigation(tabId, info, tab) {
    const url = (info && info.url) || (tab && tab.url);
    if (info && info.status && info.status !== 'complete') return null;
    if (!Orchestrator.isClassifiable(url)) return null;
    if (this.lastHandled.get(tabId) === url) return null;

    this.lastHandled.set(tabId, url);
    this.stats.navigations++;
    this._acquireKeepalive();

    try {
      const settings = this.settingsStore ? await this.settingsStore.get() : this.settings;
      if (settings && settings.enabled === false) return null;

      const domain = normaliseDomain(url);
      const features = {
        url,
        domain,
        title: (tab && tab.title) || '',
        textSample: '',
        hasAutoplayMedia: false,
        hasPopups: false,
        fullscreenAttempts: 0,
        focusGrabs: 0,
        permissionRequests: [],
        ...(this.pendingFeatures?.get(tabId) || {}),
      };

      const decision = await this.classify(features);
      this.stats.classified++;

      const whitelisted = this.store ? await this.store.isWhitelisted(domain) : false;
      const actions = resolveActions({
        tier: decision.tier,
        whitelisted,
        settings,
        suggestedActions: decision.suggestedActions,
      });

      let results = [];
      if (actions.length) {
        this.stats.blocked++;
        results = await this.actions.applyAll(tabId, actions, {
          reason: reasonFor(decision.tier),
          tier: decision.tier,
          details: decision.details,
        });
      }

      const outcome = { tabId, url, domain, decision, actions, results };
      this._emit({ type: 'navigation', ...outcome });
      return outcome;
    } finally {
      await this._releaseKeepalive();
    }
  }

  /** Content scripts push extracted features here (§4.2). */
  setFeatures(tabId, features) {
    if (!this.pendingFeatures) this.pendingFeatures = new Map();
    this.pendingFeatures.set(tabId, features);
  }

  /** §10.1: "Proceed anyway" — whitelist the domain and undo everything. */
  async whitelistAndRevert(tabId, url) {
    const domain = normaliseDomain(url);
    if (this.store) await this.store.add(domain);
    const reverted = await this.actions.revertAll(tabId);
    this.lastHandled.delete(tabId);
    this._emit({ type: 'whitelist', domain, reverted });
    return { domain, reverted };
  }

  /** §10.3: submit a report, then immediately refresh the threat list. */
  async submitReport(report) {
    if (!this.driver) return { ok: false, error: 'no driver available' };
    this._acquireKeepalive();
    try {
      await this.driver.submitReport(report);
      const refreshed = await this.updateThreatList();
      return { ok: true, refreshed };
    } catch (err) {
      return { ok: false, error: String(err && err.message), code: err && err.code };
    } finally {
      await this._releaseKeepalive();
    }
  }
}

function reasonFor(tier) {
  switch (tier) {
    case TIER.KNOWN_SCAM: return 'Known scam detected';
    case TIER.RISKY: return 'This page looks risky';
    case TIER.MEDIOCRE: return 'This page looks questionable';
    default: return 'Page flagged';
  }
}
