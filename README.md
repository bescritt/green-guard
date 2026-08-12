# SafeBrowsing+ (Green Guard)

Privacy-first page-safety extension for Chromium / Brave (MV3) with an MV2
(Firefox) fallback. Classifies pages through a degradation ladder — **whitelist
→ signed bloom threat list → analytics driver → on-device ML judge → local
heuristics** — and never invents a "safe" verdict out of an error.

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
npm test                  # 187 tests: unit + integration + e2e + scale
```

Coverage includes: tier/bloom/contract/heuristics/arbitrate units; driver
resilience (timeout/retry/circuit-breaker); content-script extraction; a
**real Brave 151 load** test; an **end-to-end** ladder test (whitelist/bloom/
driver-down/judge-down); and a **scale** test (bloom at 1,000,000 keys, 5,000
concurrent classifications).

```bash
npm run verify:crx        # CRX3 signature + integrity (tamper-rejected)
```

Premium licence signing (Ed25519, offline):

```bash
python3 build/tools/licence_sign.py sign   --key build/lic_key.pem --user alice@example.com --days 365 --out licence.json
python3 build/tools/licence_sign.py verify --key build/lic_pub.pem  --licence licence.json
```

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
closed, e2e + scale validation, 187/187 offline tests). See `VALIDATION_REPORT.md`.
