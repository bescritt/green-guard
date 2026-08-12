# Requirements Traceability Matrix — SafeBrowsing+

Sources: `IDEA.md` (vision), `extension_requirements.md` (final design §1–§12),
`analytics_driver/driver_requirements.md` (driver deliverables §1–§8).

Acceptance criteria are **machine-checkable offline**. `Test` names the automated
check that proves it. Priority: MUST / SHOULD / MAY.

## MAN — manifest & permissions (§2)

| ID | Requirement | Source | Acceptance | Offline | Pri |
|---|---|---|---|---|---|
| MAN-01 | Ship `manifest_version: 3` for Chrome/Brave | §2 | static: `manifest.json.manifest_version === 3` | YES | MUST |
| MAN-02 | Declare exactly the permissions the code uses: tabs, scripting, storage, alarms, offscreen, unlimitedStorage | §2 | static: declared set ⊇ used set, and no permission is unused | YES | MUST |
| MAN-03 | Request `nativeMessaging` as an **optional** permission, not a required one | §2 note | static: appears in `optional_permissions`, absent from `permissions` | YES | MUST |
| MAN-04 | Declare `host_permissions: ["<all_urls>"]` | §2 | static assertion | YES | MUST |
| MAN-05 | Background is a service worker of type module | §2 | static: `background.service_worker` set, `type: "module"` | YES | MUST |
| MAN-06 | Declare an action popup | §2 | static: `action.default_popup` exists as a file | YES | MUST |
| MAN-07 | Register the feature-extractor content script at `document_idle` on `<all_urls>` | §2, §4.2 | static: content_scripts entry + file exists | YES | MUST |
| MAN-08 | Declare an options page | §2 | static + file exists | YES | MUST |
| MAN-09 | Every file referenced by the manifest exists in the package | §2 | build check: resolve all manifest paths | YES | MUST |
| MAN-10 | Ship an explicit CSP with no `unsafe-eval`/`unsafe-inline` | §8.4 | static: CSP string matches allow-list | YES | MUST |
| MAN-11 | Declare icons at 16/48/128 | store req | static + file exists + PNG magic bytes | YES | MUST |
| MAN-12 | Declare `default_locale` and ship `_locales/en_US/messages.json` | i18n | static + JSON parses | YES | MUST |
| MAN-13 | Version is semver-shaped and matches package.json | release | static: regex + equality | YES | MUST |
| MAN-14 | Web-accessible resources limited to what the overlays need | §5.3 | static: list ⊆ allow-list, no `*` wildcard over all files | YES | SHOULD |
| MAN-15 | No `update_url` in the packaged manifest | store | static: key absent | YES | MUST |

## XBR — cross-browser (§7)

| ID | Requirement | Source | Acceptance | Offline | Pri |
|---|---|---|---|---|---|
| XBR-01 | Ship a Firefox MV2 manifest with a background **page**, not a service worker | §2 FF, §7 | static: `manifest_version===2`, `background.scripts` present, no `service_worker` | YES | MUST |
| XBR-02 | Both manifests are generated from one source of truth | §7 | build: single generator module produces both; drift test compares shared fields | YES | MUST |
| XBR-03 | Core logic contains zero direct `chrome.*` / `browser.*` references | §7 | static: grep `src/core/` and `src/driver/` for `chrome.`/`browser.` → 0 hits | YES | MUST |
| XBR-04 | Bundle `webextension-polyfill` and route all API calls through one adapter | §7 | static: vendor file present + hash-pinned; adapter unit tests | YES | MUST |
| XBR-05 | Firefox MV2 substitutes a hidden-document ML path for `chrome.offscreen` | §7 FF ML | integration: ML host reports backend `mv2-fallback` under the MV2 adapter | YES | SHOULD |
| XBR-06 | MV2 manifest declares `browser_action` (not `action`) | §2 FF | static assertion | YES | MUST |
| XBR-07 | Firefox package declares an add-on id | AMO | static: `browser_specific_settings.gecko.id` present | YES | MUST |
| XBR-08 | Same core test suite passes against both browser adapters | §7 | runner: adapter-parameterised suite green for both | YES | MUST |

## DRV — AnalyticsDriver contract & transports (§3)

| ID | Requirement | Source | Acceptance | Offline | Pri |
|---|---|---|---|---|---|
| DRV-01 | Define the 6-method contract exactly: classifyPage, summarizePage, submitReport, getThreatList, healthCheck, verifyEntitlement | §3 | `conformsToDriver()` unit test over every transport | YES | MUST |
| DRV-02 | Validate `PageFeatures` before it crosses the boundary | §3 | unit: malformed input rejected with INVALID_INPUT | YES | MUST |
| DRV-03 | Truncate `textSample` to 8 KB **UTF-8 bytes** without splitting a code point | §3 | unit: byte-length assertion + astral-plane case | YES | MUST |
| DRV-04 | Validate every inbound `ClassificationResult`; a bad `tier` is fatal | §3 | unit: garbage rejected, never dispatched to actions | YES | MUST |
| DRV-05 | Clamp `confidence` into 0..1 rather than trusting the driver | §3 | unit: 7.5 → 1, −3 → 0 | YES | MUST |
| DRV-06 | Implement `NativeMessagingTransport` reusing one long-lived port | §3.1 | integration vs fake port: one connect for N requests | YES | MUST |
| DRV-07 | Correlate native requests by unique `requestId` | §3.1 | integration: interleaved responses resolve to the right callers | YES | MUST |
| DRV-08 | Keep the MV3 worker alive while a native port is open | §3.1, §9.1 | integration: keepalive engaged while a request is pending | YES | MUST |
| DRV-09 | Implement `RemoteHTTPTransport` over `fetch` with auth headers | §3.1 | integration vs fake fetch | YES | MUST |
| DRV-10 | Store remote session tokens in `storage.session`, never `storage.local` | §3.1, §6 | unit: token write targets session area; static grep | YES | MUST |
| DRV-11 | Remote transport disabled by default for privacy | §3.1 | unit: default settings assertion | YES | MUST |
| DRV-12 | Select transport at runtime: native → remote → none | §3.1 | integration: ladder test with both down | YES | MUST |
| DRV-13 | On total driver failure keep working with bloom + heuristics | §3.1 fallback | integration: driver down, page still classified and acted on | YES | MUST |
| DRV-14 | **Never** report a `safe` verdict as a result of a driver error | §3.1, observed §5.2 | unit: down driver ⇒ throws, never `{tier:safe}` | YES | MUST |
| DRV-15 | Enforce per-method timeout budgets (health 1s, report 2s, entitle 3s, classify 5s) | driver §2 | unit: hang ⇒ TIMEOUT within budget | YES | MUST |
| DRV-16 | Retry only retryable errors, with full-jitter exponential backoff | driver §3 | unit: RATE_LIMITED retried, INVALID_INPUT not; jitter bounds | YES | MUST |
| DRV-17 | Open a circuit breaker after N consecutive transport failures | reliability | unit: opens, short-circuits without touching transport | YES | MUST |
| DRV-18 | Half-open the breaker after cooldown; one probe decides | reliability | unit: recovers to CLOSED; failed probe re-opens | YES | MUST |
| DRV-19 | Request-level errors must not trip the breaker | reliability | unit: 5× INVALID_INPUT leaves it CLOSED | YES | MUST |
| DRV-20 | Ship a MockDriver implementing the full contract with fault injection | §12 | conformance suite runs against it | YES | MUST |
| DRV-21 | Provide a TrafficLight compatibility adapter derived only from observed evidence | observed recon | adapter conformance suite; unverified paths default off | YES | SHOULD |
| DRV-22 | Cap `getThreatList` size to prevent unbounded allocation | driver §2.4 | unit: oversize rejected | YES | MUST |
| DRV-23 | Verify threat-list integrity before use | driver §2.4 | unit: checksum tamper rejected | YES | MUST |
| DRV-24 | Surface a driver version for compat logging | driver §5 | unit: healthCheck path records version | YES | SHOULD |
| DRV-25 | Real native host binary integration | driver §1.1 | — | **NO-needs-driver-binary** | MUST |
| DRV-26 | Real remote endpoint + OpenAPI conformance | driver §1.2 | — | **NO-needs-network** | MUST |

## CLS — classification pipeline (§4)

| ID | Requirement | Source | Acceptance | Offline | Pri |
|---|---|---|---|---|---|
| CLS-01 | Store the threat list as a compact `Uint8Array` bloom filter under `threat_bloom` | §4.1 | unit + storage key assertion | YES | MUST |
| CLS-02 | Size for 100k domains at p=0.001 in ~180–200 KB | §4.1 | scale test: measured fp ≤ 0.001 at n=100000, size reported | YES | MUST |
| CLS-03 | Zero false negatives for every inserted domain | bloom invariant | property test over 5k keys | YES | MUST |
| CLS-04 | Test the domain on every navigation; a hit ⇒ `known_scam` @0.99 | §4.1, §4.4 | integration: bloom hit drives the strongest actions | YES | MUST |
| CLS-05 | Refresh the list at startup, every 6 h, and after a report | §4.1 | integration with fake alarms | YES | MUST |
| CLS-06 | Extract visible text (first 8 KB), autoplay, popups, fullscreen, focus grabs, permission requests | §4.2 | DOM integration test per signal | YES | MUST |
| CLS-07 | Page text must not leave the device without explicit user action | §4.2, §Privacy | static: no network call carries textSample unless report/premium; unit | YES | MUST |
| CLS-08 | Run deeper analysis only when heuristics are undecided | §4.3 | unit: `needsDeepAnalysis` band | YES | SHOULD |
| CLS-09 | Create an offscreen document for ML, keepalive >25 s, close after inference | §4.3 | integration: lifecycle order asserted | YES | MUST |
| CLS-10 | Fall back to the rule classifier when the model cannot load | §4.3 | integration: backend throws ⇒ heuristic verdict still produced | YES | MUST |
| CLS-11 | Bundle no remote model code; inference backend is swappable and local | §4.3, §8.4 | static: no remote fetch of executable code | YES | MUST |
| CLS-12 | Arbitrate sources: whitelist > bloom > driver > ML > heuristics | §4.4 | unit: precedence lattice, incl. documented conflict resolution | YES | MUST |
| CLS-13 | Ties in confidence break toward the safer verdict | §4.4 (resolved) | property test | YES | MUST |
| CLS-14 | Heuristic confidence stays in the 0.6–0.85 band | §4.4 table | unit assertion over many inputs | YES | MUST |
| CLS-15 | Classification never throws, whatever the input | robustness | property test: fuzzed features, no exception | YES | MUST |
| CLS-16 | Real quantized transformer model benchmarked on scam/safe pages | §4.3, TODO 2 | — | **NO-needs-network** (no model binary offline) | SHOULD |

## ACT — safety actions (§5)

| ID | Requirement | Source | Acceptance | Offline | Pri |
|---|---|---|---|---|---|
| ACT-01 | Mute via `tabs.update({muted:true})`, with a media-pause fallback | §5.1 | integration vs fake chrome; fallback path asserted | YES | MUST |
| ACT-02 | Lock via USER-origin CSS `pointer-events:none` + capturing key/context blockers | §5.2 | integration: insertCSS origin USER; listeners registered capture-phase | YES | MUST |
| ACT-03 | Blank with a branded full-viewport overlay at max z-index | §5.3 | DOM test: overlay present, z-index 2147483647 | YES | MUST |
| ACT-04 | Overlay must carry brand, reason, "Proceed anyway", and a privacy link | §5.3, §8.4 | DOM test asserts all four elements | YES | MUST |
| ACT-05 | "Proceed anyway" removes the overlay and whitelists the domain | §5.3, §10.1 | integration: message → whitelist write → overlay gone | YES | MUST |
| ACT-06 | Close tab via `tabs.remove`, only when the user opted in | §5.4 | unit: never in defaults; integration when enabled | YES | MUST |
| ACT-07 | Safe View replaces the page using bundled Readability, no external resources | §5.5 | DOM test: no img/script/iframe/link remain; text preserved | YES | MUST |
| ACT-08 | Safe View is low-carbon: no images, scripts, fonts or network fetches | §5.5 | DOM test counts remaining resource nodes = 0 | YES | MUST |
| ACT-09 | Actions are idempotent — applying twice leaves one overlay | robustness | DOM test | YES | MUST |
| ACT-10 | Actions are ordered least→most destructive | safety | unit: ordering invariant | YES | MUST |
| ACT-11 | Offer a less intrusive banner mode in settings | §5.3 | unit: bannerModeOnly downgrades blank/lock to warn | YES | MUST |
| ACT-12 | Every action is reversible except close, and reversal is offered | UX/safety | integration: unlock/unblank restore the page | YES | SHOULD |

## PRM — premium, summarisation, licensing (§6, §8)

| ID | Requirement | Source | Acceptance | Offline | Pri |
|---|---|---|---|---|---|
| PRM-01 | Gate `summarizePage` behind `verifyEntitlement` | §6 | unit: unentitled ⇒ FEATURE_NOT_AVAILABLE | YES | MUST |
| PRM-02 | Enforce the 100 000-char input cap | driver §2.2 | unit: oversize rejected | YES | MUST |
| PRM-03 | Extract article text with Readability before summarising | §6 | integration: extractor output feeds the call | YES | MUST |
| PRM-04 | Disable the summarise button with a message when unavailable | §6 | DOM test: disabled + explanatory text | YES | MUST |
| PRM-05 | Verify a signed licence key **offline** (Ed25519) | §6, driver §2.6 TODO 5 | unit: valid/invalid/expired/tampered vectors | YES | MUST |
| PRM-06 | Store the licence key in extension storage, session token in session storage | §6 | unit: storage targets | YES | MUST |
| PRM-07 | Treat verification-network-failure as *not entitled*, never as entitled | driver §2.6 | unit: error ⇒ false, with grace window documented | YES | MUST |
| PRM-08 | Donations must not gate any feature | §8.2 | static: no feature check references donation state | YES | MUST |
| PRM-09 | Live payment-processor integration | §8.2 | — | **NO-needs-network** (no Stripe/Paddle account) | MUST |
| PRM-10 | Serverless licence-verification endpoint | §6 | — | **NO-needs-network** | SHOULD |

## REL — reliability, keepalive, scheduling (§9)

| ID | Requirement | Source | Acceptance | Offline | Pri |
|---|---|---|---|---|---|
| REL-01 | Keep the worker alive with an alarm while work is pending, and remove it after | §9.1 | integration: alarm created then cleared | YES | MUST |
| REL-02 | Keepalive period must be under the 30 s idle timeout | §9.1 | unit: period ≤ 0.42 min | YES | MUST |
| REL-03 | Schedule threat-list updates every 6 h via `alarms` | §9.2 | integration: alarm registered with 360 min | YES | MUST |
| REL-04 | Persist in-flight classification state so worker death cannot lose it | MV3 reality, R-05 | integration: simulated termination mid-flight then resume | YES | MUST |
| REL-05 | All storage writes are namespaced and versioned with a migration path | robustness | unit: migration from v0 → current | YES | MUST |
| REL-06 | No unhandled promise rejection under any fault-injection scenario | robustness | chaos suite with a rejection listener asserting zero | YES | MUST |
| REL-07 | Bounded memory: caches and session state have explicit caps | robustness | unit: LRU/size caps enforced | YES | MUST |
| REL-08 | 24 h operation without exhausting rate limits | driver §5 | integration: simulated 24 h of navigation vs budget | YES | SHOULD |

## ERR — errors & degradation (driver §3)

| ID | Requirement | Source | Acceptance | Offline | Pri |
|---|---|---|---|---|---|
| ERR-01 | Implement the exact error envelope `{error:{code,message,retryable,details}}` | driver §3 | unit: round-trip both directions | YES | MUST |
| ERR-02 | Support all 7 documented codes plus namespaced extension codes | driver §3 | unit: enumeration test | YES | MUST |
| ERR-03 | Unknown codes degrade to INTERNAL_ERROR, never propagate raw | driver §3 | unit assertion | YES | MUST |
| ERR-04 | Every error maps to a user-facing message and a fallback behaviour | driver §3 | unit: total mapping, no code unmapped | YES | MUST |
| ERR-05 | Simulate each error code without crashing | driver §3 acceptance | fault-injection suite covers every code | YES | MUST |
| ERR-06 | Native `service_status` −2/−1/0 maps to typed errors | observed §1.7 | adapter unit test | YES | SHOULD |

## CMP — compliance & privacy (§8)

| ID | Requirement | Source | Acceptance | Offline | Pri |
|---|---|---|---|---|---|
| CMP-01 | No `eval`, no `new Function`, no remote script loading anywhere | §8.4 | static scanner over the built package | YES | MUST |
| CMP-02 | Source ships readable — no logic-hiding minification | §8.4 | static: no single-line bundle over N chars without a map | YES | MUST |
| CMP-03 | Threat list is data, never code | §8.4, Privacy | static: only bytes parsed by bloom, never executed | YES | MUST |
| CMP-04 | Ship a privacy policy disclosing local processing, opt-in reports, premium data flow | §8.3 | file exists + required sections present | YES | MUST |
| CMP-05 | Justify every permission 1:1 in a shipped document | §8.4 | check: each manifest permission has a justification entry | YES | MUST |
| CMP-06 | Reports are opt-in and contain only url, type, optional comment, pageHash | §Privacy, driver §2.3 | unit: payload shape has no extra fields | YES | MUST |
| CMP-07 | No browsing history persisted beyond the bloom filter and licence key | §Privacy | static + unit: storage schema allow-list | YES | MUST |
| CMP-08 | Overlay must not imitate browser/OS security UI | §8.4 | DOM test: brand present, no chrome-like styling tokens | YES | MUST |
| CMP-09 | Bundled third-party code retains its licence text | licence hygiene | check: licence file per vendored file | YES | MUST |
| CMP-10 | Actual Chrome Web Store / AMO approval | §8 | — | **NO-needs-store** | MUST |

## BLD — build, signing, release

| ID | Requirement | Source | Acceptance | Offline | Pri |
|---|---|---|---|---|---|
| BLD-01 | Produce a Chromium `.crx` (CRX3) signed with a local RSA-2048 key | deliverable | independent verifier parses header + checks signature | YES | MUST |
| BLD-02 | CRX3 header must contain a valid protobuf with matching `crx_id` | CRX3 format | verifier: crx_id == first 16 bytes of sha256(pubkey) | YES | MUST |
| BLD-03 | A tampered CRX must fail verification | integrity | verifier returns non-zero on a flipped byte | YES | MUST |
| BLD-04 | Signing key never enters the package or the repo history | security | check: key path gitignored, absent from zip | YES | MUST |
| BLD-05 | Build is reproducible: two runs yield identical bytes | release quality | build twice, compare sha256 | YES | MUST |
| BLD-06 | Also emit an unpacked dist for load-testing and review | dev/QA | dir exists, manifest loads in Brave | YES | MUST |
| BLD-07 | Emit a Firefox XPI | §7 | zip structure test | YES | MUST |
| BLD-08 | Extension loads in real Chromium/Brave with zero errors | validation | headless Brave load log shows no extension error | YES | MUST |
| BLD-09 | `analytics_driver/` byte-identical before and after the whole build | user constraint | recursive sha256 manifest diff | YES | MUST |

## Coverage by prefix

| Prefix | Rows | Offline-testable | Blocked |
|---|---|---|---|
| MAN | 15 | 15 | 0 |
| XBR | 8 | 8 | 0 |
| DRV | 26 | 24 | 2 (DRV-25 driver binary, DRV-26 network) |
| CLS | 16 | 15 | 1 (CLS-16 model binary) |
| ACT | 12 | 12 | 0 |
| PRM | 10 | 8 | 2 (PRM-09, PRM-10 network/processor) |
| REL | 8 | 8 | 0 |
| ERR | 6 | 6 | 0 |
| CMP | 10 | 9 | 1 (CMP-10 store) |
| BLD | 9 | 9 | 0 |
| **Total** | **120** | **114** | **6** |

## Explicitly untestable offline

| ID | Why |
|---|---|
| DRV-25 | No native host executable exists. The transport is tested against a faithful fake port; the real binary is out of scope (production driver, read-only). |
| DRV-26 | No live endpoint and no credentials. Tested against a fake `fetch` implementing the documented contract. |
| CLS-16 | A real quantized transformer (~20 MB) is not available offline; the ML *host*, its contract, and its fallback are fully tested with a deterministic backend. No performance numbers are claimed for a model we did not run. |
| PRM-09 | No Stripe/Paddle account. Offline signed-licence verification is implemented and tested instead. |
| PRM-10 | No serverless deployment target; the remote verifier sits behind a port with a stub. |
| CMP-10 | No store account. Every store policy we *can* express as a static check is enforced; approval itself is not claimed. |

## Spec conflicts and ambiguities

| ID | Conflict | Sources | Resolution taken |
|---|---|---|---|
| CONFLICT-01 | `nativeMessaging` is listed in required `permissions` but the note says use `optional_permissions` | §2 list vs §2 notes | Optional. A required native-messaging permission is a store-review risk and the extension must work without a sidecar. |
| CONFLICT-02 | §4.4 states BOTH "the highest-confidence source wins" AND "the driver takes precedence" — different rules whenever the driver is less confident | §4.4 sentence 1 vs 2 | Explicit lattice: whitelist > bloom > driver (when reachable and ≥0.5) > highest-confidence, ties break safer. Documented in `arbitrate.js`. |
| CONFLICT-03 | "No servers / on-device only" versus a serverless licence-verification endpoint | §Privacy, IDEA §5 vs §6 | Offline signed-licence verification is the default path; any remote verifier is opt-in and carries no browsing data. |
| CONFLICT-04 | Firefox MV2 has no `chrome.offscreen`; §7 offers "hidden iframe **in the page**" which would leak page-text processing into an untrusted origin | §7 FF ML | Run the MV2 ML path in the extension's own background page/hidden document — never injected into the host page. |
| CONFLICT-05 | `tabs` permission is called "required only to read url/title", but §5.1/§5.4 mute and close tabs | §2 notes vs §5 | Keep `tabs`, and justify it as URL reading *and* tab control in CMP-05. |
| CONFLICT-06 | Bloom filter false positives are permanent until the next full list, yet no removal mechanism is specified | §4.1 vs driver §2.4 TODO | Whitelist always overrides the bloom filter; "Proceed anyway" writes a whitelist entry immediately. |
| CONFLICT-07 | Threat list must be "signed" but no signing scheme or public key is specified | driver §2.4 | Self-describing header with an integrity checksum now; an Ed25519 detached-signature slot is defined but disabled until a real key exists. |
| CONFLICT-08 | Storage: §Privacy says store nothing but licence + threat list, while §9/§10 require whitelist, settings and dedup state | §Privacy vs §9/§10 | Allow-list of storage keys, each justified; no URLs or page text persisted. |
| CONFLICT-09 | `status_code` numeric vs `status_message` string as the verdict predicate in the observed driver | observed §4.3 | Adapter reads the string enum (as the production code does) and treats `status_code` as advisory only. |
| CONFLICT-10 | Observed driver returns `safe` when its cloud fetch fails (fail-open) | observed §5.2 vs our §3 fallback | Our adapter **must not** propagate that: a transport error becomes a typed error so arbitration falls back to local sources. |
| CONFLICT-11 | 6 unresolved TODOs in §11 and 8 open questions in driver §8 block a real integration | §11, driver §8 | Every one is either implemented behind the Mock/adapter boundary or recorded as a driver-blocked risk (R-14). No guessed wire format is enabled by default. |
