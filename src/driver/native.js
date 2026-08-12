/**
 * driver/native.js — the production bridge to the analytics driver's native
 * messaging host (`com.extension.av.communication`).
 *
 * IMPORTANT — faithful to the OBSERVED contract, not invented:
 *   The recovered production host (Bitdefender TrafficLight 3.4.4) exposes only
 *   session/telemetry/feature-flag native messages (BLOCKED_PAGES, SCANNED_PAGES,
 *   PERMISSIONS_STATUS, MALVERTISING_SUPPORT, SCAN_MESSAGES, CHAT_PROTECTION_
 *   SETTINGS). It does NOT expose a `classifyPage` / `summarizePage` RPC — page
 *   classification in TrafficLight happens in the extension's own JS, and the
 *   host is used for reporting + cloud sync (see .recon/driver_contract_observed.md
 *   §1.4–§1.5). Therefore this transport implements what the host actually
 *   supports and fails CLOSED on the methods it does not, so the orchestrator's
 *   degradation ladder (bloom → heuristics → on-device judge) fully protects
 *   the user instead of trusting a fabricated "safe" reply.
 *
 *   We never return a synthetic classification. A method with no native
 *   counterpart throws DriverError(FEATURE_NOT_AVAILABLE); DriverClient turns
 *   that into an unreachable verdict and the orchestrator falls back locally.
 *
 * Uniquely among the driver modules, this one touches `browser.
 * sendNativeMessage` (the only chrome.* surface it needs). It receives the
 * BrowserAdapter so it stays unit-testable behind a fake.
 *
 * Conforms to AnalyticsDriver (src/core/contract.js) so DriverClient accepts it.
 */

import { DriverError, ERROR_CODE } from '../core/contract.js';

export const NATIVE_APP_NAME = 'com.extension.av.communication';

/** Lightest documented request type — used purely as a liveness probe. */
const PROBE_REQUEST = 'MALVERTISING_SUPPORT';

export class NativeMessagingTransport {
  /**
   * @param {import('../platform/browser.js').BrowserAdapter} browser
   */
  constructor(browser) {
    this.browser = browser;
  }

  async _probe() {
    // sendNativeMessage throws (or the host is absent) → host not reachable.
    // The observed host echoes `request` back in the response; a successful
    // round-trip (even with an empty payload) proves the host is alive.
    const res = await this.browser.sendNativeMessage(NATIVE_APP_NAME, { request: PROBE_REQUEST });
    return res && typeof res === 'object' ? res : {};
  }

  // ── supported: reachability ───────────────────────────────────────────────
  async healthCheck() {
    try {
      await this._probe();
      return { ok: true, reachable: true };
    } catch (err) {
      // Host absent or refused the channel.
      throw new DriverError(ERROR_CODE.EXT_TRANSPORT_UNAVAILABLE, `native host unreachable: ${err && err.message}`, { retryable: true });
    }
  }

  // ── unsupported by the production host: fail CLOSED ───────────────────────
  // The host has no classify/summarize/report/entitlement native RPC. Returning
  // a fabricated result here would be the worst kind of lie for a safety tool,
  // so we surface a typed, non-retryable "not available" error and let the
  // orchestrator rely on local signals.
  async classifyPage() {
    throw new DriverError(ERROR_CODE.FEATURE_NOT_AVAILABLE, 'production native host does not expose a classifyPage RPC');
  }

  async summarizePage() {
    throw new DriverError(ERROR_CODE.FEATURE_NOT_AVAILABLE, 'production native host does not expose a summarizePage RPC');
  }

  async submitReport() {
    throw new DriverError(ERROR_CODE.FEATURE_NOT_AVAILABLE, 'production native host does not expose a submitReport RPC');
  }

  async verifyEntitlement() {
    throw new DriverError(ERROR_CODE.FEATURE_NOT_AVAILABLE, 'production native host does not expose a verifyEntitlement RPC');
  }

  async getThreatList() {
    // The SLF/whitelist rule files are fetched from Bitdefender's CDN over HTTP
    // (nimbus.bitdefender.net), which is a network operation and would violate
    // the offline mandate. We do not silently hit the network; callers that
    // need the local threat list use the bundled bloom filter instead.
    throw new DriverError(ERROR_CODE.FEATURE_NOT_AVAILABLE, 'threat-list sync requires network; use the bundled bloom filter offline');
  }
}
