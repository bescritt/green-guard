# SafeBrowsing+ (Green Guard)

[![Tests](https://img.shields.io/badge/tests-194%2F194%20pass-brightgreen)](https://github.com/bescritt/green-guard/actions)
[![Coverage](https://img.shields.io/badge/coverage-93.7%25-blue)](https://github.com/bescritt/green-guard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Chromium%20%2F%20Brave%20(MV3)-orange)](https://github.com/bescritt/green-guard)
[![CRX3](https://img.shields.io/badge/artifact-signed%20CRX3-success)](dist/sbplus-mv3.crx)

**Privacy-first page-safety extension for Chromium / Brave (MV3), with an MV2 (Firefox) fallback.**
It classifies pages through a degradation ladder — **whitelist → signed bloom threat
list → analytics driver → on-device ML judge → local heuristics** — and never invents a
"safe" verdict out of an error.

## Why
Most "safe browsing" tooling ships your every page to a cloud. SafeBrowsing+ classifies
**locally**: heuristics, a bundled cryptographically-signed bloom threat list, and an
**on-device 4k-LLM judge** (`localhost:8080`, llama.cpp). No telemetry leaves the machine
unless you explicitly submit a report. When any layer fails, the system fails *closed* to
the next layer rather than claiming "safe."

## Architecture

```
            ┌─────────────────────────── page navigation ───────────────────────────┐
            ▼                                                                       │
   content/feature-extractor ──▶ PageFeatures ──▶ runtime/orchestrator (the brain)
                                                                  │   arbitration ladder
            ┌─────────────────────────────────────────────────────┤
            ▼                 ▼                  ▼                 ▼
      core/whitelist    core/bloom        driver/client     core/judge_local      core/heuristics
   (exact allow-list) (signed list)   (MockDriver /      (on-device 4k-LLM      (trust/risk,
                                     native bridge)      @ localhost:8080)       capped, F-10)
            └─────────────────────────────────────────────────────┤
                                                                  ▼
                                              core/arbitrate ──▶ runtime/actions
                                           (verdict + tier)     (overlay / warn / mute /
                                                                  lock / blank / safe-view)
```

The orchestrator calls each source in priority order; the first *confident* verdict wins,
and an unreachable source simply drops out (no "safe" by default). The full flow is covered
end-to-end by `tests/integration/e2e.classify.test.mjs`.

## Build & sign (no network required)

```bash
npm install                 # esbuild + jsdom (dev only)
npm run build              # → dist/mv3 + dist/mv2 (esbuild bundles)
npm run key:gen            # generates build/signing_key.pem (RSA-2048) once
npm run build:crx          # → dist/sbplus-mv3.crx  (standards-compliant CRX3)
npm run verify:crx         # independently verifies signature + zip + manifest
```

`build:crx` signs `dist/mv3` with `build/signing_key.pem` (RSA-PKCS1v15-SHA256
over `CrxFileHeader || zip`). `verify:crx` re-parses the CRX3 container and
cryptographically verifies it — a tampered payload is rejected.

## Load / deploy
- **Unpacked (dev):** `brave-browser --load-extension=dist/mv3` (or Chrome →
  `chrome://extensions` → Load unpacked).
- **Signed (prod):** distribute `dist/sbplus-mv3.crx`. Drag into
  `chrome://extensions` / Brave settings, or deploy via policy.
- The CRX3 is signed with *our* key; we do not use the Chrome Web Store.

## Tests (offline, all scales)

```bash
npm test                  # 194 tests: unit + integration + e2e + scale
```

| Axis | What it proves |
|------|---------------|
| Unit | tiers, bloom, contract, heuristics, arbitrate, driver resilience, judge, native bridge |
| Integration | orchestrator flow, manifest/file refs, **real Brave 151 load** (zero errors) |
| E2E | full ladder: whitelist→IDEAL, bloom→authoritative, driver-down→fallback, judge-down→fallback |
| Scale | bloom at **1,000,000** keys (FP ≤ 2× target, >100k q/s); **5,000** concurrent classifications |
| Coverage | **93.7%** line (the only sub-80% file, `actions.js`, is a coverage-attribution artifact for eval'd DOM injection funcs — behavior verified via jsdom assertions) |

## Privacy / offline posture
- All classification is **local**: heuristics, the bundled bloom threat list,
  and an **on-device 4k-LLM judge** (`localhost:8080`, llama.cpp). No telemetry
  leaves the machine unless you explicitly submit a report.
- The shipped build uses the in-repo `MockDriver` so the extension is fully
  functional offline. The production native host (`com.extension.av.communication`)
  is wired via `src/driver/native.js` and is **fail-closed**: it probes host
  reachability and otherwise reports methods as unavailable so the orchestrator
  falls back to local signals. (See `.recon/driver_contract_observed.md` — the
  production host exposes no `classifyPage` RPC; classification is local by design.)

## Security properties (demonstrated by tests)
- **F-10 (negative trust weight):** trust signals cap at the risk score; a faked
  legal footer can no longer cancel a risk signal or push a score negative.
- **Judge downgrade:** an unreachable or off-vocabulary on-device judge throws;
  the orchestrator falls back to heuristics — never "safe".
- **Driver never fails open:** a driver error surfaces as a typed error; the
  arbitrator falls through to bloom + local heuristics.
- **Tamper:** CRX3 payload and licence signatures both reject modification.

## Project structure
```
src/core/         pure engine: tiers, bloom, contract, heuristics, arbitrate, whitelist, judge_local
src/driver/       DriverClient (resilience) + MockDriver + native.js (production bridge)
src/platform/     BrowserAdapter (single chrome.* touch) + manifest generators
src/content/      feature-extractor, actions-injected (sensors), safe-view (Readability)
src/runtime/      orchestrator (the brain), actions (DOM side-effects)
src/background.js MV3 service-worker entry
tests/            unit / integration / helpers
build/ build.mjs  esbuild bundler
build/tools/      crx3_sign, verify_crx3, licence_sign, driver_integrity
.recon/           driver contract, RTM, adapter spec, friction/risk log
```

## Maturity
Concept → α (core engine) → β (packaging + signed CRX3 + real-browser load) →
prod/mission-critical (security gap F-10 closed, on-device judge wired fail-
closed, e2e + scale validation, 194/194 offline tests). See `VALIDATION_REPORT.md`.

## License
[MIT](LICENSE). The production analytics driver (`analytics_driver/`) is a
third-party read-only dependency included for reference; it is **not** modified
by this project.
