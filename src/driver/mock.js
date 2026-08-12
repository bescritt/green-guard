/**
 * driver/mock.js — the reference AnalyticsDriver implementation.
 *
 * PURE (no chrome.*). This is not a toy: it is the *conformance reference* and
 * the thing the whole extension is developed against while the real sidecar does
 * not exist (extension_requirements.md §12: "the extension can be fully built and
 * tested with a mock driver"). It therefore has to be:
 *
 *   - deterministic — same input, same output, seeded, no Date.now() in verdicts,
 *     so tests cannot flake
 *   - faithful — returns exactly the contract shapes, validated on the way out
 *   - hostile on demand — can be told to fail, time out, rate-limit, or return
 *     malformed garbage, because the fallback paths are the ones that keep users
 *     safe and they must be tested (driver_requirements.md §3 "The extension can
 *     simulate each error")
 */

import { TIER, ACTION } from '../core/tiers.js';
import {
  DriverError, ERROR_CODE, LIMITS,
  validatePageFeatures, validateClassificationResult, validateReportSubmission,
  validateSummaryResult,
} from '../core/contract.js';
import { BloomFilter } from '../core/bloom.js';
import { classifyHeuristically } from '../core/heuristics.js';

/** Domains the mock treats as known-bad, so tests have stable ground truth. */
export const MOCK_SCAM_DOMAINS = Object.freeze([
  'evil-scam.example',
  'phish-login.example',
  'tech-support-fraud.example',
  'crypto-doubler.example',
  'fake-av-alert.example',
]);

export const MOCK_IDEAL_DOMAINS = Object.freeze([
  'archive.example',
  'docs.example',
]);

export class MockDriver {
  /**
   * @param {object} [o]
   * @param {number} [o.latencyMs] simulated latency, applied via the injected clock
   * @param {object} [o.faults] see setFaults
   * @param {(ms:number)=>Promise<void>} [o.sleep] injectable sleep (tests pass a no-op)
   * @param {boolean} [o.entitled] premium entitlement answer
   */
  constructor({ latencyMs = 0, faults = {}, sleep, entitled = false } = {}) {
    this.latencyMs = latencyMs;
    this.faults = { ...faults };
    this.entitled = entitled;
    this._sleep = sleep || ((ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()));
    this.calls = { classifyPage: 0, summarizePage: 0, submitReport: 0, getThreatList: 0, healthCheck: 0, verifyEntitlement: 0 };
    this.reports = [];
    this.scamDomains = new Set(MOCK_SCAM_DOMAINS);
    this.driverVersion = 'mock-1.0.0';
  }

  /**
   * Configure failure injection.
   * @param {object} f
   * @param {string} [f.failMethod] method name to fail
   * @param {string} [f.code] error code to fail with
   * @param {number} [f.failTimes] fail only the first N calls (default: forever)
   * @param {boolean} [f.malformed] return contract-violating data instead of an error
   * @param {boolean} [f.down] every method fails with EXT_TRANSPORT_UNAVAILABLE
   * @param {boolean} [f.hang] never resolve (caller must have a timeout)
   */
  setFaults(f = {}) {
    this.faults = { ...f };
    this._failCounts = {};
    return this;
  }

  clearFaults() {
    this.faults = {};
    this._failCounts = {};
    return this;
  }

  async _gate(method) {
    this.calls[method] = (this.calls[method] || 0) + 1;
    const f = this.faults || {};

    if (f.hang) return new Promise(() => {}); // deliberately never settles

    if (f.down) {
      throw new DriverError(ERROR_CODE.EXT_TRANSPORT_UNAVAILABLE, 'mock driver is down');
    }

    if (f.failMethod === method) {
      this._failCounts = this._failCounts || {};
      const n = (this._failCounts[method] = (this._failCounts[method] || 0) + 1);
      if (f.failTimes === undefined || n <= f.failTimes) {
        throw new DriverError(f.code || ERROR_CODE.INTERNAL_ERROR, `mock fault on ${method}`);
      }
    }

    if (this.latencyMs > 0) await this._sleep(this.latencyMs);
  }

  async classifyPage(features) {
    await this._gate('classifyPage');
    if (this.faults.malformed) return { tier: 'DEFINITELY_BAD', confidence: 7.5 };

    const v = validatePageFeatures(features);
    if (!v.ok) {
      throw new DriverError(ERROR_CODE.INVALID_INPUT, `bad PageFeatures: ${v.errors.join('; ')}`, {
        details: { errors: v.errors },
      });
    }
    const f = v.value;

    let result;
    if (this.scamDomains.has(f.domain)) {
      result = {
        tier: TIER.KNOWN_SCAM,
        confidence: 0.97,
        suggestedActions: [ACTION.MUTE, ACTION.BLANK, ACTION.LOCK],
        details: 'Domain appears on the mock crowdsourced scam list',
      };
    } else if (MOCK_IDEAL_DOMAINS.includes(f.domain)) {
      result = {
        tier: TIER.IDEAL,
        confidence: 0.9,
        suggestedActions: [ACTION.NONE],
        details: 'Domain is on the mock curated-good list',
      };
    } else {
      // Reuse the heuristic engine so the mock's opinions are coherent with the
      // extension's own, but report as a driver-grade confidence.
      const h = classifyHeuristically(f);
      result = {
        tier: h.tier,
        confidence: Math.min(0.95, h.confidence + 0.05),
        suggestedActions: h.suggestedActions,
        details: `mock driver: ${h.details}`,
      };
    }

    const out = validateClassificationResult(result);
    if (!out.ok) throw new DriverError(ERROR_CODE.INTERNAL_ERROR, `mock produced invalid result: ${out.errors.join('; ')}`);
    return out.value;
  }

  async summarizePage(fullText) {
    await this._gate('summarizePage');
    if (!this.entitled) {
      throw new DriverError(ERROR_CODE.FEATURE_NOT_AVAILABLE, 'premium entitlement required');
    }
    if (typeof fullText !== 'string' || fullText.trim().length === 0) {
      throw new DriverError(ERROR_CODE.INVALID_INPUT, 'fullText must be a non-empty string');
    }
    if (fullText.length > LIMITS.FULL_TEXT_CHARS) {
      throw new DriverError(ERROR_CODE.INVALID_INPUT, `fullText exceeds ${LIMITS.FULL_TEXT_CHARS} chars`, {
        details: { length: fullText.length },
      });
    }
    if (this.faults.malformed) return { summary: 42 };

    // Deterministic extractive "summary": first sentences up to a budget.
    const sentences = fullText.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/);
    let summary = '';
    for (const s of sentences) {
      if ((summary + ' ' + s).trim().length > 400) break;
      summary = (summary + ' ' + s).trim();
    }
    if (!summary) summary = fullText.slice(0, 400);

    const out = validateSummaryResult({
      summary,
      model: 'mock-extractive-v1',
      tokensUsed: Math.ceil(fullText.length / 4),
    });
    if (!out.ok) throw new DriverError(ERROR_CODE.INTERNAL_ERROR, out.errors.join('; '));
    return out.value;
  }

  async submitReport(report) {
    await this._gate('submitReport');
    const v = validateReportSubmission(report);
    if (!v.ok) {
      throw new DriverError(ERROR_CODE.INVALID_INPUT, `bad ReportSubmission: ${v.errors.join('; ')}`, {
        details: { errors: v.errors },
      });
    }
    // Duplicate detection by pageHash, as driver_requirements.md §2.3 asks about.
    if (this.reports.some((r) => r.pageHash === v.value.pageHash)) {
      throw new DriverError(ERROR_CODE.INVALID_INPUT, 'duplicate report for this pageHash', {
        details: { pageHash: v.value.pageHash },
        retryable: false,
      });
    }
    this.reports.push(v.value);
    // Reported domains join the threat list, so the "report then refresh" flow
    // in §10.3 is actually observable in a test.
    try {
      this.scamDomains.add(new URL(v.value.url).hostname);
    } catch { /* url already validated as non-empty; ignore unparseable */ }
    return undefined; // Promise<void> per contract
  }

  async getThreatList() {
    await this._gate('getThreatList');
    if (this.faults.malformed) return 'not bytes';
    const f = BloomFilter.fromKeys([...this.scamDomains], 0.001, 0);
    return f.serialize();
  }

  async healthCheck() {
    await this._gate('healthCheck');
    return true;
  }

  async verifyEntitlement() {
    await this._gate('verifyEntitlement');
    return this.entitled === true;
  }
}

/** Convenience: a driver that is always unreachable. */
export function downDriver() {
  return new MockDriver({ faults: { down: true } });
}
