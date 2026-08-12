/**
 * core/contract.js — the AnalyticsDriver contract as runtime-checked schemas.
 *
 * PURE. No chrome.*, no I/O.
 *
 * extension_requirements.md §3 defines the contract in TypeScript. TypeScript
 * types evaporate at runtime, and the driver is a *black box* on the other side
 * of a process/network boundary — exactly the place where you must not trust a
 * compile-time type. So the contract is re-expressed here as validators that run
 * in both directions:
 *
 *   - outbound: we never send the driver a malformed PageFeatures
 *   - inbound:  we never let a malformed ClassificationResult reach the action
 *               dispatcher, where a bad `tier` could close the user's tab
 *
 * Every validator returns {ok:true, value} with a *normalised* value, or
 * {ok:false, errors:[...]} listing every problem (not just the first — a black
 * box deserves a complete bug report).
 */

import { ALL_TIERS, ALL_ACTIONS, isTier } from './tiers.js';

/** Error codes from driver_requirements.md §3. */
export const ERROR_CODE = Object.freeze({
  AUTH_INVALID: 'AUTH_INVALID',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  FEATURE_NOT_AVAILABLE: 'FEATURE_NOT_AVAILABLE',
  // Extension-side codes; namespaced so they can never collide with driver codes.
  EXT_TRANSPORT_UNAVAILABLE: 'EXT_TRANSPORT_UNAVAILABLE',
  EXT_MALFORMED_RESPONSE: 'EXT_MALFORMED_RESPONSE',
  EXT_ABORTED: 'EXT_ABORTED',
});

export const ALL_ERROR_CODES = Object.freeze(Object.values(ERROR_CODE));

/** Which errors a caller may sensibly retry (driver_requirements.md §3). */
export const RETRYABLE = Object.freeze(
  new Set([
    ERROR_CODE.RATE_LIMITED,
    ERROR_CODE.TIMEOUT,
    ERROR_CODE.INTERNAL_ERROR,
    ERROR_CODE.EXT_TRANSPORT_UNAVAILABLE,
  ]),
);

export const REPORT_TYPES = Object.freeze(['phishing', 'scam', 'spam', 'malware', 'fraud']);

/** Method names on the contract (extension_requirements.md §3). */
export const DRIVER_METHODS = Object.freeze([
  'classifyPage',
  'summarizePage',
  'submitReport',
  'getThreatList',
  'healthCheck',
  'verifyEntitlement',
]);

/** Hard caps. A black box must never be able to make us allocate without bound. */
export const LIMITS = Object.freeze({
  TEXT_SAMPLE_BYTES: 8 * 1024, // §3 PageFeatures.textSample "first 8 KB"
  FULL_TEXT_CHARS: 100_000, // driver_requirements.md §2.2
  SUMMARY_CHARS: 20_000,
  DETAILS_CHARS: 2_000,
  COMMENT_CHARS: 1_000,
  URL_CHARS: 2_048,
  TITLE_CHARS: 1_024,
  PERMISSION_ITEMS: 32,
  SUGGESTED_ACTIONS: ALL_ACTIONS.length,
  THREAT_LIST_BYTES: 8 * 1024 * 1024,
});

/** A structured driver error. Carries a machine code plus retryability. */
export class DriverError extends Error {
  constructor(code, message, { retryable, details = {}, cause } = {}) {
    super(message || code);
    this.name = 'DriverError';
    this.code = ALL_ERROR_CODES.includes(code) ? code : ERROR_CODE.INTERNAL_ERROR;
    this.retryable = typeof retryable === 'boolean' ? retryable : RETRYABLE.has(this.code);
    this.details = details;
    if (cause !== undefined) this.cause = cause;
  }

  /** Serialise to the §3 error envelope. */
  toEnvelope() {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        details: this.details,
      },
    };
  }

  /** Parse a §3 error envelope back into a DriverError. */
  static fromEnvelope(obj) {
    const e = obj && obj.error;
    if (!e || typeof e !== 'object') {
      return new DriverError(ERROR_CODE.EXT_MALFORMED_RESPONSE, 'not an error envelope');
    }
    return new DriverError(e.code, typeof e.message === 'string' ? e.message : String(e.code), {
      retryable: e.retryable,
      details: e.details && typeof e.details === 'object' ? e.details : {},
    });
  }
}

export function isErrorEnvelope(obj) {
  return !!obj && typeof obj === 'object' && !!obj.error && typeof obj.error === 'object'
    && typeof obj.error.code === 'string';
}

// ── primitive helpers ────────────────────────────────────────────────────────

const ok = (value) => ({ ok: true, value, errors: [] });
const fail = (errors) => ({ ok: false, value: undefined, errors });

function clampString(v, max) {
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function checkString(errs, obj, key, { required = true, max = 4096, allowEmpty = true } = {}) {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (required) errs.push(`${key}: required`);
    return undefined;
  }
  if (typeof v !== 'string') {
    errs.push(`${key}: expected string, got ${typeof v}`);
    return undefined;
  }
  if (!allowEmpty && v.length === 0) {
    errs.push(`${key}: must not be empty`);
    return undefined;
  }
  return clampString(v, max);
}

function checkBool(errs, obj, key, dflt = false) {
  const v = obj[key];
  if (v === undefined || v === null) return dflt;
  if (typeof v !== 'boolean') {
    errs.push(`${key}: expected boolean, got ${typeof v}`);
    return dflt;
  }
  return v;
}

function checkInt(errs, obj, key, { min = 0, max = Number.MAX_SAFE_INTEGER, dflt = 0, required = false } = {}) {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (required) errs.push(`${key}: required`);
    return required ? undefined : dflt;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errs.push(`${key}: expected finite number, got ${typeof v}`);
    return required ? undefined : dflt;
  }
  const n = Math.trunc(v);
  if (n < min || n > max) {
    errs.push(`${key}: ${n} out of range [${min},${max}]`);
    return required ? undefined : dflt;
  }
  return n;
}

// ── PageFeatures (outbound) ──────────────────────────────────────────────────

/**
 * Normalise + validate PageFeatures before it crosses the boundary.
 * Truncates textSample to exactly the documented 8 KB budget (UTF-8 bytes, not
 * JS characters — an 8 KB promise measured in UTF-16 units would be a lie for
 * any non-Latin page).
 */
export function validatePageFeatures(input) {
  const errs = [];
  if (!input || typeof input !== 'object') return fail(['PageFeatures: expected object']);

  const url = checkString(errs, input, 'url', { max: LIMITS.URL_CHARS, allowEmpty: false });
  let domain = checkString(errs, input, 'domain', { required: false, max: 255 });
  const title = checkString(errs, input, 'title', { required: false, max: LIMITS.TITLE_CHARS }) ?? '';
  const rawSample = checkString(errs, input, 'textSample', { required: false, max: 64 * 1024 }) ?? '';

  if (url && !domain) {
    try {
      domain = new URL(url).hostname;
    } catch {
      errs.push('url: not parseable, and domain not supplied');
    }
  }

  let permissionRequests = [];
  if (input.permissionRequests !== undefined && input.permissionRequests !== null) {
    if (!Array.isArray(input.permissionRequests)) {
      errs.push('permissionRequests: expected array');
    } else {
      permissionRequests = input.permissionRequests
        .filter((p) => typeof p === 'string')
        .slice(0, LIMITS.PERMISSION_ITEMS)
        .map((p) => clampString(p, 64));
    }
  }

  const value = {
    url: url ?? '',
    domain: domain ?? '',
    textSample: truncateUtf8(rawSample, LIMITS.TEXT_SAMPLE_BYTES),
    title,
    hasAutoplayMedia: checkBool(errs, input, 'hasAutoplayMedia'),
    hasPopups: checkBool(errs, input, 'hasPopups'),
    fullscreenAttempts: checkInt(errs, input, 'fullscreenAttempts', { max: 1e6 }),
    focusGrabs: checkInt(errs, input, 'focusGrabs', { max: 1e6 }),
    permissionRequests,
  };
  return errs.length ? fail(errs) : ok(value);
}

/**
 * Build a normalised PageFeatures from raw signals (e.g. those gathered by the
 * content script from a live DOM). Fills defaults for any field the caller did
 * not supply, then runs validatePageFeatures. Returns the value object on
 * success; throws if the structural shape is unrecoverable (no url, bad types).
 */
export function extractFeatures(raw = {}) {
  const withDefaults = {
    url: '',
    domain: '',
    title: '',
    textSample: '',
    hasAutoplayMedia: false,
    hasPopups: false,
    fullscreenAttempts: 0,
    focusGrabs: 0,
    permissionRequests: [],
    ...raw,
  };
  const res = validatePageFeatures(withDefaults);
  if (!res.ok) throw new Error('extractFeatures: ' + res.errors.join('; '));
  return res.value;
}

/** Truncate to at most `maxBytes` UTF-8 bytes without splitting a code point. */
export function truncateUtf8(str, maxBytes) {
  const enc = new TextEncoder();
  const bytes = enc.encode(str);
  if (bytes.length <= maxBytes) return str;
  // Decode the prefix with a lenient decoder, then drop any replacement char
  // introduced by cutting mid-sequence.
  const slice = bytes.subarray(0, maxBytes);
  let out = new TextDecoder('utf-8', { fatal: false }).decode(slice);
  if (out.endsWith('\uFFFD')) out = out.slice(0, -1);
  return out;
}

// ── ClassificationResult (inbound) ───────────────────────────────────────────

/**
 * Validate a ClassificationResult from the black box.
 * A bad `tier` is fatal (we refuse to guess what the driver meant); a bad
 * confidence or unknown suggested action is repaired conservatively, because
 * discarding an otherwise-valid verdict over a cosmetic field would degrade
 * protection for no security benefit.
 */
export function validateClassificationResult(input) {
  const errs = [];
  if (!input || typeof input !== 'object') return fail(['ClassificationResult: expected object']);

  const tier = input.tier;
  if (!isTier(tier)) {
    errs.push(`tier: expected one of ${ALL_TIERS.join('|')}, got ${JSON.stringify(tier)}`);
  }

  let confidence = input.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    errs.push(`confidence: expected finite number, got ${JSON.stringify(input.confidence)}`);
    confidence = 0;
  } else if (confidence < 0 || confidence > 1) {
    // Clamp rather than reject: out-of-range confidence is a driver bug, but the
    // tier is still actionable.
    confidence = Math.min(1, Math.max(0, confidence));
  }

  let suggestedActions = [];
  if (input.suggestedActions !== undefined && input.suggestedActions !== null) {
    if (!Array.isArray(input.suggestedActions)) {
      errs.push('suggestedActions: expected array');
    } else {
      suggestedActions = input.suggestedActions
        .filter((a) => ALL_ACTIONS.includes(a))
        .slice(0, LIMITS.SUGGESTED_ACTIONS);
    }
  }

  const details =
    typeof input.details === 'string' ? clampString(input.details, LIMITS.DETAILS_CHARS) : '';

  if (!isTier(tier)) return fail(errs);
  return errs.length ? fail(errs) : ok({ tier, confidence, suggestedActions, details });
}

export function validateSummaryResult(input) {
  const errs = [];
  if (!input || typeof input !== 'object') return fail(['SummaryResult: expected object']);
  const summary = checkString(errs, input, 'summary', {
    max: LIMITS.SUMMARY_CHARS,
    allowEmpty: false,
  });
  const model = checkString(errs, input, 'model', { required: false, max: 128 }) ?? 'unknown';
  const tokensUsed = checkInt(errs, input, 'tokensUsed', { max: 1e9, required: true });
  return errs.length ? fail(errs) : ok({ summary, model, tokensUsed });
}

export function validateReportSubmission(input) {
  const errs = [];
  if (!input || typeof input !== 'object') return fail(['ReportSubmission: expected object']);
  const url = checkString(errs, input, 'url', { max: LIMITS.URL_CHARS, allowEmpty: false });
  const reportType = input.reportType;
  if (!REPORT_TYPES.includes(reportType)) {
    errs.push(`reportType: expected one of ${REPORT_TYPES.join('|')}, got ${JSON.stringify(reportType)}`);
  }
  const comment = checkString(errs, input, 'comment', {
    required: false,
    max: LIMITS.COMMENT_CHARS,
  });
  const pageHash = checkString(errs, input, 'pageHash', { max: 128, allowEmpty: false });
  if (pageHash !== undefined && !/^[0-9a-f]{64}$/.test(pageHash)) {
    errs.push('pageHash: expected 64 lowercase hex chars (sha256)');
  }
  const value = { url, reportType, pageHash };
  if (comment !== undefined && comment !== '') value.comment = comment;
  return errs.length ? fail(errs) : ok(value);
}

/** Validate raw threat-list bytes (shape only; bloom parsing happens in bloom.js). */
export function validateThreatListBytes(input) {
  if (!(input instanceof Uint8Array)) {
    if (Array.isArray(input) && input.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      input = Uint8Array.from(input); // native messaging JSON cannot carry binary
    } else if (input && input.buffer instanceof ArrayBuffer) {
      input = new Uint8Array(input.buffer, input.byteOffset ?? 0, input.byteLength);
    } else {
      return fail(['getThreatList: expected Uint8Array or byte array']);
    }
  }
  if (input.length === 0) return fail(['getThreatList: empty']);
  if (input.length > LIMITS.THREAT_LIST_BYTES) {
    return fail([`getThreatList: ${input.length} bytes exceeds cap ${LIMITS.THREAT_LIST_BYTES}`]);
  }
  return ok(input);
}

/**
 * Assert an object structurally implements AnalyticsDriver.
 * Used by the conformance suite so every transport is held to one standard.
 */
export function conformsToDriver(obj) {
  const errors = [];
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) {
    return fail(['driver: expected object']);
  }
  for (const m of DRIVER_METHODS) {
    if (typeof obj[m] !== 'function') errors.push(`missing method: ${m}`);
  }
  return errors.length ? fail(errors) : ok(obj);
}
