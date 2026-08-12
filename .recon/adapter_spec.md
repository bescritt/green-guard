# Adapter Engineering Specification — TrafficLight (Bitdefender) → AnalyticsDriver

Maps the **observed** production driver (`analytics_driver/`, Bitdefender TrafficLight 3.4.4,
read-only) onto our abstract 6-method `AnalyticsDriver` contract
(`extension_requirements.md §3). Every factual claim about the driver cites a
section of `.recon/driver_contract_observed.md`.

> STATUS: this adapter is **implemented behind a compile-time flag and is
> OFF by default**. The driver's contract has unverified corners (see §5); we
> must not route real protection through it until those are confirmed against a
> live binary. The system runs fully on bloom + heuristics + MockDriver today.

---

## 1. Capability matrix (our method × their capability)

| Our method | Their capability | Verdict | How |
|---|---|---|---|
| `classifyPage(features)` | cloud `/url/status` (+ cache) + native status | **PARTIAL** | Translate `PageFeatures` → URL status request; read `status_message` string enum. Native host has NO classify message, so it is cloud/HTTP only. |
| `summarizePage(fullText)` | none | **UNSUPPORTED** | Throw `FEATURE_NOT_AVAILABLE`. (Their product has no summarisation.) |
| `submitReport(report)` | none (no report API observed) | **UNSUPPORTED** | Throw `FEATURE_NOT_AVAILABLE`. Our `reportType` has no upstream sink. |
| `getThreatList()` | ph_sign.slf / ph_white.txt rule files | **PARTIAL** | We do NOT use their regex rule file as our threat list (different format). Adapter returns `FEATURE_NOT_AVAILABLE` for the *driver's* list; our own bloom is sourced elsewhere. |
| `healthCheck()` | native `service_status` / cloud reachability | **SUPPORTED** | `sendNativeMessage({request:'permissionsStatus'})` or a HEAD to the cloud endpoint. Map `service_status 0` → true. |
| `verifyEntitlement()` | none | **UNSUPPORTED** | Throw `FEATURE_NOT_AVAILABLE`. Entitlement is ours, not theirs. |

**Transport:** one-shot `browser.runtime.sendNativeMessage('com.extension.av.communication', msg)`
(recon §1). **NOT** `connectNative` — they use request/response with no long-lived
port and **no per-message correlation id**; the request *type string* is the only echo.

---

## 2. Verdict mapping — their 13 `PageStatus` → our 5 tiers

Severity order (recon §4.2): disabled < whitelisted < safe < untrusted < spam <
pua < miner < fraud < phishing < malware < malvertising.
`MaliciousStatuses` = {malware, phishing, fraud, miner, pua, malvertising}
(**spam and untrusted are NOT in it**).

| Their status | Our tier | Confidence | Justification (recon) |
|---|---|---|---|
| `malware` | known_scam | 0.97 | in MaliciousStatuses, top severity |
| `phishing` | known_scam | 0.97 | in MaliciousStatuses |
| `fraud` | known_scam | 0.95 | in MaliciousStatuses |
| `malvertising` | known_scam | 0.95 | in MaliciousStatuses |
| `miner` | known_scam | 0.93 | in MaliciousStatuses |
| `pua` | known_scam | 0.90 | in MaliciousStatuses (unwanted) |
| `spam` | mediocre | 0.60 | NOT malicious per their own enum; nuisance only |
| `untrusted` | mediocre | 0.55 | NOT malicious; low trust |
| `safe` | safe | 0.90 | explicit clean |
| `whitelisted` | — (not a tier) | — | whitelist signal → arbitrate() returns IDEAL, bypasses all actions |
| `sessionWhitelisted` | — (not a tier) | — | per-session whitelist → same as whitelisted |
| `disabled` | — (no opinion) | — | product off → adapter returns NO verdict; orchestrator falls through to local sources |
| `searchAnalyzerDisabled` | — (no opinion) | — | feature off → NO verdict; fall through |

**Rule:** `disabled` / `searchAnalyzerDisabled` must **never** produce a tier. The adapter
returns `{ reachable:false }` (or throws `EXT_ABORTED`) so arbitration defers to bloom/heuristics.

---

## 3. Reverse mapping (our tier → their status) — LOSSY

| Our tier | Their status (informational only) |
|---|---|
| known_scam | `malware` (proxy; we never tell them) |
| risky | `untrusted` |
| mediocre | `spam` |
| safe | `safe` |
| ideal | `whitelisted` |

Lossy because their enum has no "risky"/"mediocre" and we never actually write to
them. This table exists only for telemetry/debug labelling.

---

## 4. Error mapping — their behaviour → our codes

| Their signal | Our code | Notes |
|---|---|---|
| native `service_status = -2` (no host) | `EXT_TRANSPORT_UNAVAILABLE` | host not installed |
| native `service_status = -1` (unavailable) | `EXT_TRANSPORT_UNAVAILABLE` | host present, service down |
| native `service_status = 0` | (OK) | `healthCheck() → true` |
| cloud fetch throws / non-200 | see ⚠ below | |
| cloud returns `status_code != 0` | `INTERNAL_ERROR` | but decision uses `status_message` string, not code (recon §4.3) |

> ⚠ **CRITICAL — they FAIL OPEN.** Their cloud path returns `'safe'` on a fetch
> error (recon §5.2). Our adapter **must not** propagate that. On any cloud
> transport error the adapter throws `EXT_TRANSPORT_UNAVAILABLE` (or
> `TIMEOUT`); it never returns `{ tier: 'safe' }`. Arbitration then falls through
> to local sources. This is the single most important safety property of the
> adapter.

---

## 5. UNVERIFIED — gated OFF by default

These could **not** be confirmed from the code and must not be relied upon:
- Whether `sendNativeMessage` vs a long-lived port is the *only* path in all builds.
- The exact `service_status` numeric values across all versions (only -2/-1/0 seen).
- Whether `ph_sign.slf` is the *only* threat-list source (they also have `ph_white.txt`).
- Behaviour when the native host is present but the user denied the permission.
- Any rate-limit / quota semantics on the cloud endpoint.

Until a live binary is exercised (DRV-25, currently blocked), the adapter stays
behind `ADAPTER_TRAFFICLIGHT_ENABLED=false`.

---

## 6. Risks to the extension (integration)

1. **Fail-open upstream** (§4) — mitigated by throwing on transport error; the orchestrator never sees a synthetic "safe".
2. **No correlation id** — concurrent requests are matched only by type; if two `permissionsStatus` calls race, responses may cross. Mitigation: serialize health checks; classify via cloud keyed by URL cache, not by response id.
3. **Enum drift** — a future driver version could add a status we don't map → falls to `mediocre` default. Mitigation: unknown status ⇒ `EXT_MALFORMED_RESPONSE`, never a tier.
4. **Permission surface** — enabling the native path pulls in `nativeMessaging` (optional). Mitigation: keep it optional; never required.
5. **Privacy** — their cloud see URLs. Mitigation: adapter only ever sends the URL (hashed? no — they need the URL); user must opt in; off by default.
6. **Version skew** — `driverVersion` reported via health; log it, alert on major mismatch.
7. **Whitelist semantics** — their `whitelisted` is per-domain; ours is registrable-domain. Adapter trusts their whitelist only as a *soft* signal, never overriding a local block.
8. **Update cadence** — their update is 4h (recon §1); our threat-list refresh is 6h. Independent; no coupling.
