/**
 * driver/client.js — the resilience layer wrapped around any transport.
 *
 * PURE (no chrome.*, injectable clock). Everything that talks to the black box
 * goes through here, so the policy lives in exactly one place:
 *
 *   timeout → retry with full-jitter backoff → circuit breaker → typed error
 *
 * Design rules that are NOT negotiable, each learned from a specific failure mode:
 *
 *  1. NEVER FAIL OPEN ON CLASSIFY. The observed production driver returns "safe"
 *     when its cloud fetch throws (.recon/driver_contract_observed.md §5.2). That
 *     turns a network blip into a silent "this page is fine" — the worst possible
 *     lie for a security tool. We surface a typed error instead and let the
 *     arbitrator fall through to bloom + local heuristics.
 *  2. RETRY ONLY WHAT IS RETRYABLE. Retrying INVALID_INPUT or AUTH_INVALID just
 *     multiplies the damage; the contract marks retryability explicitly.
 *  3. FULL JITTER, NOT FIXED BACKOFF. Synchronised retries from many tabs are a
 *     self-inflicted denial of service. delay = random(0, base * 2**attempt).
 *  4. A TIMEOUT MUST ACTUALLY ABANDON THE CALL. A promise that never settles
 *     pins the MV3 service worker awake and leaks memory, so every call races an
 *     abort timer.
 *  5. THE BREAKER MUST SELF-HEAL. It half-opens after a cooldown and one probe
 *     decides; a breaker that never retries is just an outage you chose.
 */

import { DriverError, ERROR_CODE, RETRYABLE, conformsToDriver, DRIVER_METHODS } from '../core/contract.js';

export const BREAKER = Object.freeze({ CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' });

/** Per-method timeout budgets, from driver_requirements.md §2 latency specs. */
export const DEFAULT_TIMEOUTS = Object.freeze({
  classifyPage: 5000,      // §2.1 remote p99 < 5 s
  summarizePage: 15000,    // §2.2 p95 < 5 s, allow headroom for long articles
  submitReport: 2000,      // §2.3 < 2 s
  getThreatList: 10000,    // §2.4 < 5 s, allow for a slow disk/CDN
  healthCheck: 1000,       // §2.5 within 1 s
  verifyEntitlement: 3000, // §2.6 < 3 s
});

export const DEFAULT_RETRIES = Object.freeze({
  classifyPage: 1,
  summarizePage: 1,
  submitReport: 2,
  getThreatList: 2,
  healthCheck: 0,
  verifyEntitlement: 1,
});

export class DriverClient {
  /**
   * @param {object} transport an object implementing AnalyticsDriver
   * @param {object} [o]
   * @param {object} [o.timeouts]
   * @param {object} [o.retries]
   * @param {number} [o.baseBackoffMs]
   * @param {number} [o.maxBackoffMs]
   * @param {number} [o.breakerThreshold] consecutive hard failures before opening
   * @param {number} [o.breakerCooldownMs]
   * @param {()=>number} [o.now] injectable clock
   * @param {(ms:number)=>Promise<void>} [o.sleep] injectable sleep
   * @param {()=>number} [o.random] injectable RNG (tests pin jitter)
   * @param {(evt:object)=>void} [o.onEvent] telemetry sink (local only)
   */
  constructor(transport, {
    timeouts = {},
    retries = {},
    baseBackoffMs = 250,
    maxBackoffMs = 8000,
    breakerThreshold = 3,
    breakerCooldownMs = 30000,
    now = () => Date.now(),
    sleep,
    random = Math.random,
    onEvent = null,
  } = {}) {
    const conf = conformsToDriver(transport);
    if (!conf.ok) throw new TypeError(`transport does not implement AnalyticsDriver: ${conf.errors.join('; ')}`);

    this.transport = transport;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
    this.retries = { ...DEFAULT_RETRIES, ...retries };
    this.baseBackoffMs = baseBackoffMs;
    this.maxBackoffMs = maxBackoffMs;
    this.breakerThreshold = breakerThreshold;
    this.breakerCooldownMs = breakerCooldownMs;
    this._now = now;
    this._sleep = sleep || ((ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()));
    this._random = random;
    this._onEvent = onEvent;

    this.state = BREAKER.CLOSED;
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.stats = { calls: 0, failures: 0, timeouts: 0, retries: 0, shortCircuits: 0 };

    // Expose the contract methods as thin, guarded wrappers.
    for (const m of DRIVER_METHODS) {
      this[m] = (...args) => this.call(m, ...args);
    }
  }

  _emit(evt) {
    if (this._onEvent) {
      try { this._onEvent(evt); } catch { /* telemetry must never break the call */ }
    }
  }

  /** Breaker gate. Transitions OPEN → HALF_OPEN once the cooldown has elapsed. */
  _checkBreaker() {
    if (this.state === BREAKER.OPEN) {
      if (this._now() - this.openedAt >= this.breakerCooldownMs) {
        this.state = BREAKER.HALF_OPEN;
        this._emit({ type: 'breaker', state: this.state });
      } else {
        this.stats.shortCircuits++;
        throw new DriverError(
          ERROR_CODE.EXT_TRANSPORT_UNAVAILABLE,
          'driver circuit breaker is open',
          { details: { retryAfterMs: this.breakerCooldownMs - (this._now() - this.openedAt) } },
        );
      }
    }
  }

  _onSuccess() {
    this.consecutiveFailures = 0;
    if (this.state !== BREAKER.CLOSED) {
      this.state = BREAKER.CLOSED;
      this._emit({ type: 'breaker', state: this.state });
    }
  }

  _onFailure() {
    this.consecutiveFailures++;
    this.stats.failures++;
    if (this.state === BREAKER.HALF_OPEN || this.consecutiveFailures >= this.breakerThreshold) {
      this.state = BREAKER.OPEN;
      this.openedAt = this._now();
      this._emit({ type: 'breaker', state: this.state, consecutiveFailures: this.consecutiveFailures });
    }
  }

  /** Race a call against its timeout budget. */
  async _withTimeout(method, fn) {
    const ms = this.timeouts[method] ?? 5000;
    if (!(ms > 0)) return fn();

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new DriverError(ERROR_CODE.TIMEOUT, `${method} exceeded ${ms}ms`, { details: { ms } })),
        ms,
      );
      // DO NOT unref() this timer.
      //
      // Measured bug: with timer.unref(), a transport that never settles (a hung
      // native host — precisely what this guard exists for) let the event loop
      // drain to empty. Node then tore the process down with "Promise resolution
      // is still pending but the event loop has already resolved" instead of the
      // timeout firing. The timer must hold the loop open until it fires or is
      // cleared; the `finally` below clears it the instant the race settles, so
      // it can never outlive the call.
    });

    try {
      return await Promise.race([fn(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Full-jitter backoff: random(0, min(max, base * 2**attempt)). */
  _backoffFor(attempt) {
    const ceiling = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** attempt);
    return Math.floor(this._random() * ceiling);
  }

  /** Normalise anything thrown into a DriverError. */
  static _toDriverError(err) {
    if (err instanceof DriverError) return err;
    if (err && typeof err === 'object' && err.error) return DriverError.fromEnvelope(err);
    const msg = err && err.message ? err.message : String(err);
    // A transport that reports "no such native application" is unavailable, not broken.
    if (/no such native application|not a function|disconnected port|receiving end does not exist/i.test(msg)) {
      return new DriverError(ERROR_CODE.EXT_TRANSPORT_UNAVAILABLE, msg, { cause: err });
    }
    if (/abort/i.test(msg)) return new DriverError(ERROR_CODE.EXT_ABORTED, msg, { cause: err });
    return new DriverError(ERROR_CODE.INTERNAL_ERROR, msg, { cause: err });
  }

  /**
   * Invoke a contract method with the full resilience policy.
   * Always throws a DriverError on failure — never a bare Error, never a
   * fabricated "safe" verdict.
   */
  async call(method, ...args) {
    if (!DRIVER_METHODS.includes(method)) {
      throw new DriverError(ERROR_CODE.INVALID_INPUT, `unknown driver method: ${method}`);
    }
    this.stats.calls++;
    this._checkBreaker();

    const maxRetries = this.retries[method] ?? 0;
    let lastErr;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this._withTimeout(method, () => this.transport[method](...args));
        this._onSuccess();
        this._emit({ type: 'call', method, attempt, ok: true });
        return res;
      } catch (raw) {
        const err = DriverClient._toDriverError(raw);
        lastErr = err;
        if (err.code === ERROR_CODE.TIMEOUT) this.stats.timeouts++;
        this._emit({ type: 'call', method, attempt, ok: false, code: err.code });

        const canRetry = attempt < maxRetries && (err.retryable || RETRYABLE.has(err.code));
        if (!canRetry) {
          // Only transport-level trouble should trip the breaker. A rejected
          // input or a missing premium feature says nothing about driver health.
          if (isHealthSignal(err.code)) this._onFailure();
          throw err;
        }
        this.stats.retries++;
        await this._sleep(this._backoffFor(attempt));
      }
    }
    throw lastErr; // unreachable, kept for total-function honesty
  }

  /** Cheap reachability probe that never throws. */
  async isHealthy() {
    try {
      return (await this.call('healthCheck')) === true;
    } catch {
      return false;
    }
  }

  snapshot() {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      ...this.stats,
    };
  }

  /** Force the breaker shut (used when the user explicitly retries from the UI). */
  reset() {
    this.state = BREAKER.CLOSED;
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    return this;
  }
}

/** Codes that say something about *driver health* rather than about the request. */
function isHealthSignal(code) {
  return (
    code === ERROR_CODE.TIMEOUT ||
    code === ERROR_CODE.INTERNAL_ERROR ||
    code === ERROR_CODE.EXT_TRANSPORT_UNAVAILABLE ||
    code === ERROR_CODE.EXT_MALFORMED_RESPONSE ||
    code === ERROR_CODE.AUTH_EXPIRED ||
    code === ERROR_CODE.AUTH_INVALID
  );
}
