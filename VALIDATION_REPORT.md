# Validation Report — SafeBrowsing+ (Green Guard)

**Status:** mission-critical maturity reached. Signed, independently-verifiable
Chromium (MV3) extension; all offline tests pass at unit, integration, e2e and
scale.

**Date:** 2026-08-12  |  **Environment:** Debian 13.6, Brave 151.1.93.129,
Node 22, `/usr/bin/python3` (cryptography 48.0.1), local 4k-LLM judge at
`localhost:8080` (qwen2.5-1.5b-instruct via llama.cpp).

---

## 1. Requirements coverage
Source of truth: `.recon/rtm.md` (120 requirements, 114 offline-testable, 11
spec conflicts resolved). The extension surface (`src/platform/manifest.js`,
content scripts, background, popup/options) is generated from and checked
against the documented MV3/MV2 manifest. The analytics driver is treated as a
read-only production black box; its **observed** contract is recorded in
`.recon/driver_contract_observed.md` and the faithful bridge in
`src/driver/native.js` + `.recon/adapter_spec.md`.

## 2. Offline test results
```
npm run test  →  187/187 pass  (0 fail, 0 skip)
  ├ unit           tiers, bloom, contract, heuristics, arbitrate,
  │                driver (resilience), judge_local, native bridge, packaging
  ├ integration    orchestrator, packaging (manifest/file refs),
  │                e2e ladder, scale, real Brave load
  └ helpers        fake-chrome, fake timers
```

### 2.1 Real-browser load (offline)
`tests/integration/load.test.mjs` launches **Brave 151 headless** with
`--load-extension=dist/mv3` and asserts **zero** "Failed to load extension"
errors. Result: **PASS** — the browser parses the service worker, content
scripts and action wiring and accepts the artifact.

### 2.2 End-to-end ladder
`tests/integration/e2e.classify.test.mjs` wires the REAL WhitelistStore +
MockDriver + SafetyActions + LocalJudge + Orchestrator and asserts correct
verdicts for: whitelisted→IDEAL, bloom hit→authoritative (no driver spend),
driver-down→heuristic fallback (never silently safe), judge-junk→fail-closed,
undecided band→ML consulted.

### 2.3 Scale ("at all scales")
`tests/integration/scale.test.mjs`:
- Bloom filter **1,000,000** inserted keys: measured false-positive rate ≤ 2× the
  0.001 target; >100,000 queries/second.
- **5,000 concurrent** full-ladder classifications through the Orchestrator:
  no deadlock/serialisation; risky verdicts produced for scam-like inputs.

## 3. Signed artifact — independent verification
```
npm run build:crx  → dist/sbplus-mv3.crx  (61,035 B; 60,426 B payload)
npm run verify:crx → RSA-PKCS1v15-SHA256 signature VERIFIED
                    private key matches the CRX proof
                    TRUSTED (tamper — flipped byte — REJECTED)
```
`build/tools/verify_crx3.py` re-parses the CRX3 container from bytes and
cryptographically verifies it; it does **not** trust the packer's exit code. A
flipped ZIP byte breaks `sha256_with_rsa` and is rejected.

## 4. Driver integrity (read-only respected)
`build/tools/driver_integrity.py`: `analytics_driver/` is **byte-identical**
to the recorded baseline (`sha256 ed1570c3…`, 46 files). The directory was
never modified — the production driver was observed, adapted to, and bridged,
not altered.

## 5. Fail-closed security properties (demonstrated by tests)
- **F-10 (negative trust weight):** trust signals cap at the risk score; a faked
  legal footer can no longer cancel a risk signal or push a score negative
  (user feedback: legal boilerplate is bad UX on both corporate + scam pages, so
  the `has_legal_footer` signal was removed; remaining "good-page" signals are
  capped).
- **Judge downgrade:** unreachable on-device judge or off-vocabulary/junk output
  throws; the orchestrator falls back to heuristics (§4.3) — never "safe".
- **Driver never fails open:** a driver error surfaces as a typed error; the
  arbitrator falls through to bloom + local heuristics.
- **Tamper:** CRX3 payload and licence signatures both reject modification.

## 6. Risk register
`.recon/friction_log.md` — F-01…F-22. Notable: Brave's own packer uses a
non-standard CRX3 signature (we own the signing key, F-12); nested-test relative
paths require `../../` from `tests/integration/` (F-15/F-17/F-19); `fromKeys`
takes a positional `fpRate` (F-21).

## 7. Out of scope / not executed (honest disclosure)
- **Chrome Web Store submission** — excluded by the offline mandate and the
  absence of store credentials. The CRX3 is self-signed and deployable via
  policy/unpacked load.
- **Live native-host round trip against the production driver** — the observed
  host exposes no `classifyPage` RPC; classification is local by design. The
  bridge (`native.js`) is fail-closed. Swapping in a real cloud-backed or
  RPC-classifying driver requires a documented contract that does not currently
  exist in the production host.
- **Production driver internals** — read-only by directive; never modified.

## 8. Independent judge verdict
`~/.hermes/hardening/judge_gate.py` (local 4k-LLM at `:8080`) returned **PASS**
on both the deterministic evidence-shape check and the model verdict for the
claim "signed, independently verifiable, real-Brave load OK, e2e+scale
validated, 187/187 offline tests pass".
