## Deliverables Required from the Analytics Driver Blackbox

This document specifies the exact technical deliverables the blackbox analytics driver must provide so the extension can implement the `AnalyticsDriver` interface with zero ambiguity. Each item includes a clear acceptance criterion. Items marked `[TODO]` require clarification from the driver team before implementation.

---

## 1. Transport & Connectivity Deliverables

### 1.1 Native Messaging Host (if local sidecar)

**Deliverable:**  
- A compiled executable or installer for Windows, macOS, Linux (or at least the two platforms we target).  
- A native messaging host manifest (JSON) that includes:
  - `"name"` (e.g., `"com.safebrowsing_plus.sidecar"`)
  - `"description"`
  - `"path"` (absolute path to executable)
  - `"type"`: `"stdio"`
  - `"allowed_origins"`: array containing the extension IDs for Chrome/Brave and Firefox (e.g., `"chrome-extension://<EXTENSION_ID>/"` and `"moz-extension://<EXTENSION_ID>/"`).
- Installation instructions (silent install flags, if any) and uninstall behavior.

**Acceptance:** The extension can call `chrome.runtime.connectNative('com.safebrowsing_plus.sidecar')` and receive a valid port, with no additional user prompts after installation.

### 1.2 Remote HTTP API (if cloud fallback)

**Deliverable:**  
- Base URL for the serverless/edge endpoint(s).  
- OpenAPI/Swagger specification for every endpoint.  
- Required headers (e.g., `Authorization: Bearer <token>` or custom API key header).  
- CORS policy: must allow requests from extension origins? (Note: MV3 service workers are not subject to CORS for `fetch`? Actually extension pages are, service worker? We need to confirm. But we'll specify endpoint must handle extension's `Origin` header if needed.)  
- Any IP allowlisting or API key rotation policy.

**Acceptance:** The extension can send a test `classifyPage` request via `fetch` and get a valid JSON response without hitting CORS or authentication errors.

### 1.3 Authentication & Key Management

**Deliverable:**  
- Method for obtaining user-specific or device-specific credentials (license key, API token, or short-lived session token).  
- If using API keys: how they are issued, revoked, and scoped.  
- If using native sidecar: does the sidecar handle its own authentication to a remote backend? (The extension should not need to know details.)  
- Specification for storing the token in `chrome.storage.session` vs `chrome.storage.local`.  
- Error response for invalid/expired token (HTTP 401 with a machine-readable code).

**Acceptance:** The extension can authenticate to the driver using the provided method and receive a clear error when credentials are invalid.

---

## 2. Interface Method Deliverables

For each method in `AnalyticsDriver`, the blackbox must provide:

### 2.1 `classifyPage(features: PageFeatures): Promise<ClassificationResult>`

**Deliverable:**  
- Exact JSON request schema for `PageFeatures`. The extension will send exactly this shape; the driver must accept it without modification.  
- Exact JSON response schema for `ClassificationResult`. Must include:
  - `tier`: enum string `"ideal" | "safe" | "mediocre" | "risky" | "known_scam"`.
  - `confidence`: number between `0.0` and `1.0`.
  - `suggestedActions`: array of strings, each one of `["none", "mute", "lock", "blank", "close", "safe_view", "warn"]`. The extension will map these to its internal action functions.
  - `details`: string (optional but recommended, not shown to user unless developer mode).
- Expected latency:
  - Local native sidecar: `< 500 ms` for a typical page (8 KB text sample).
  - Remote HTTP: `< 2 s` p95, `< 5 s` p99.
- Rate limits (if remote): how many requests per minute per user/extension instance.  
- Error behavior: if classification cannot be performed (timeout, model failure), the driver should return a structured error object rather than throwing (to allow extension fallback to local heuristics).

**Acceptance:** The extension can call `classifyPage` with a mock `PageFeatures` and get back a valid `ClassificationResult` within the latency budget.

**TODO**  
- Does the driver require additional feature fields beyond our current `PageFeatures` (e.g., full HTML, screenshot, TLS certificate info)? If yes, provide the exact schema additions.  
- How does the driver expect the `textSample` to be encoded (plain text, HTML, truncated)? We assume plain text.  
- Should we include page metadata like `permissionRequests` as a list of strings, or a structured object? Current schema uses `string[]`; confirm if that is sufficient.

---

### 2.2 `summarizePage(fullText: string): Promise<SummaryResult>`

**Deliverable:**  
- Input: `fullText` string (plain text, extracted by Readability). What is the maximum length? Expected: up to 100,000 characters?  
- Output schema:
  ```json
  {
    "summary": "string",
    "model": "string",
    "tokensUsed": 123
  }
  ```
- Summary length target: e.g., 3–5 sentences, or configurable.  
- Latency: `< 5 s` p95 for remote, `< 2 s` for native sidecar.  
- Rate limits (premium feature): likely stricter; specify limits.  
- Error behavior if page text is too short, too long, or not summarizable.

**Acceptance:** The extension can send a sample article and receive a high-quality summary within the time budget.

**TODO**  
- Can the driver handle very long texts (>500 KB) via chunking/streaming? If not, what is the hard limit?  
- Does the summary model support multiple languages? If not, how should non-English pages be handled?  
- Is the summary returned as plain text or Markdown? We assume plain text.

---

### 2.3 `submitReport(report: ReportSubmission): Promise<void>`

**Deliverable:**  
- Input schema:
  ```json
  {
    "url": "https://example.com",
    "reportType": "phishing",
    "comment": "optional string",
    "pageHash": "sha256 hex string"
  }
  ```
- What happens after submission? The driver should acknowledge receipt and, if possible, trigger an immediate threat list update for that URL/domain.  
- Response: a simple `200 OK` with empty body or `{ "status": "accepted" }`.  
- Error codes for invalid report type, duplicate submission, rate limited.  
- Latency: `< 2 s` (fire-and-forget acceptable, but must return a promise).  

**Acceptance:** A test report can be submitted and the extension receives a success response; the URL is then added to the bloom filter within a reasonable time (if the driver controls the filter).

**TODO**  
- How does the driver deduplicate reports? Does it require a `userId` or installation ID to prevent spam? We currently omit user identification in the report to preserve privacy; confirm if acceptable.  
- Should the extension compute `pageHash` using a specific algorithm (e.g., SHA-256 of normalized URL + title + first 1KB of text)? Provide the exact method to ensure consistent dedup.

---

### 2.4 `getThreatList(): Promise<Uint8Array>`

**Deliverable:**  
- Format of the binary threat list. We currently assume a standard Bloom Filter bit array. Specify:
  - How is the Bloom Filter encoded? (raw Uint8Array? base64? protobuf?)  
  - Parameters: expected false positive rate (we assume 0.001), expected capacity (we assume 100,000 domains).  
  - Whether the list includes exact URLs, domains, or both.  
  - Whether it is a Counting Bloom Filter or standard. If standard, can the driver provide a full replacement on every update?  
  - Maximum size in bytes. Based on our estimate, 180 KB, but confirm the driver's actual size.  
- Update frequency: how often does the driver publish a new list?  
- Signing/verification: The extension must verify the list is authentic. Does the driver provide a signature (e.g., Ed25519) and public key? Or do we rely on the transport security (native host / HTTPS)?  
- Latency: `< 5 s` to fetch the list. For native sidecar, read from local disk; for remote, download from CDN.

**Acceptance:** The extension can call `getThreatList` and load the returned bytes into a Bloom Filter that correctly tests known-bad domains (test vectors provided by driver).

**TODO**  
- Does the driver use a standard Bloom Filter or a learned structure (e.g., binary classifier)? If not a standard Bloom Filter, provide the API for querying it instead (e.g., a `queryUrl` method) or the algorithm to rebuild it locally.  
- What is the exact serialization format? We need to parse the `Uint8Array`; provide a sample byte layout or a protobuf schema.  
- How are removals handled? If a URL is falsely flagged and later cleared, does the driver provide a removal list or require a Counting Bloom Filter? We currently assume full replacement each update.

---

### 2.5 `healthCheck(): Promise<boolean>`

**Deliverable:**  
- Simple endpoint or native message that returns `{ "status": "ok" }` within 1 second.  
- Definition of "healthy": driver is reachable, authenticated, and can respond to a trivial request.  
- If the driver is in degraded mode (e.g., remote backend down but local cache available), should it return `true` or `false`? We expect `true` if at least basic classification is possible.  
- No additional data required.

**Acceptance:** The extension can call `healthCheck` on startup and after any error to determine if the driver is usable.

---

### 2.6 `verifyEntitlement(): Promise<boolean>`

**Deliverable:**  
- Method to check if the current user/installation is entitled to premium features.  
- Input: none (the extension will pass a stored license key or token internally).  
- Output: boolean `true` if premium, `false` otherwise.  
- How the driver verifies entitlement:
  - If remote: it queries a license server (using an API key or user token).  
  - If native sidecar: it may verify a signed license key offline, or phone home.  
- Error behavior: if verification fails due to network issues, should the extension treat as not entitled (`false`) or throw? We prefer `false` to avoid blocking premium features when offline, but allow a grace period? Confirm.  
- Latency: `< 3 s`.  
- Rate limit: one call per session/hour.

**Acceptance:** The extension can call `verifyEntitlement` after user enters a license key and receive accurate `true`/`false`.

**TODO**  
- Does the driver manage license keys directly, or does it delegate to a third-party service (e.g., Stripe)? If the latter, the extension must integrate with that service's SDK or API; provide details.  
- How are license keys generated and distributed to users? We need a secure key format (e.g., JWT signed by a private key).  
- Is there a trial period? If so, how is it tracked?

---

## 3. Error Handling & Contract Envelope

**Deliverable:**  
- A consistent error response format for all driver methods. Example:
  ```json
  {
    "error": {
      "code": "DRIVER_TIMEOUT",
      "message": "Classification timed out after 5s",
      "retryable": true,
      "details": {}
    }
  }
  ```
- Enumerate all possible error codes, especially:
  - `AUTH_INVALID`
  - `AUTH_EXPIRED`
  - `RATE_LIMITED`
  - `TIMEOUT`
  - `INTERNAL_ERROR`
  - `INVALID_INPUT`
  - `FEATURE_NOT_AVAILABLE`
- For native messaging, the same structure is serialized as JSON over the stdio port.  
- The extension will map these to user-friendly messages and fallback behavior.

**Acceptance:** The extension can simulate each error and implement appropriate fallback without crashing.

---

## 4. Data Privacy & Security Deliverables

**Deliverable:**  
- A privacy policy specific to the driver that the extension can link to.  
- If the driver processes page text/URLs remotely, it must state:
  - What data is stored, for how long, and with whom shared.  
  - Whether data is anonymized or aggregated.  
  - How users can request deletion of their reports.  
- If the driver is a local sidecar, it must ensure no data leaves the device except for explicit report submissions.  
- The native host must not have any open network listeners or insecure permissions.  
- The extension will not store any data in `chrome.storage.local` beyond the user's license key and threat list (no page text, no URLs beyond the bloom filter).

**Acceptance:** The combined extension+driver privacy policy meets Chrome Web Store and Firefox Add-ons requirements, and the user can find the policy easily.

---

## 5. Performance & Reliability Deliverables

**Deliverable:**  
- Service Level Agreement (SLA) for the driver:
  - Uptime: 99.9% (if remote).  
  - Latency percentiles as specified per method.  
  - Rate limits: e.g., 100 `classifyPage` calls per hour per installation, 10 `summarizePage` per day.  
- Versioning: The driver must expose a version identifier (e.g., `driverVersion`) in `healthCheck` so the extension can log compatibility issues.  
- Backward compatibility: The driver must support at least one previous version of the interface.  
- Graceful degradation: If the driver is unreachable, the extension falls back to local heuristics; the driver should not cause the extension to hang or crash.

**Acceptance:** The extension can run for 24 hours under normal usage without exhausting rate limits or causing unresponsive UI.

---

## 6. Test Vectors & Documentation

**Deliverable:**  
- A set of test inputs and expected outputs for each method:
  - Sample `PageFeatures` for a known scam, safe page, etc.  
  - Expected `ClassificationResult`.  
  - Sample article text and expected summary.  
  - A small threat list binary with known-bad and known-good URLs to validate Bloom Filter loading.  
- API documentation for all endpoints / native messages, including authentication examples.  
- Example code (in JavaScript/TypeScript) showing how to implement the driver client, if the driver team has a reference implementation.

**Acceptance:** The extension team can write unit tests against the driver without needing access to the production backend.

---

## 7. Deliverables Summary Checklist

| Deliverable | Required? | Format |
|-------------|-----------|--------|
| Native host manifest + executable | Yes (if local sidecar) | JSON + binary |
| Remote API base URL + OpenAPI spec | Yes (if remote fallback) | URL + YAML/JSON |
| Authentication method & token lifecycle | Yes | Docs |
| `classifyPage` schema + latency + errors | Yes | JSON Schema |
| `summarizePage` schema + latency + errors | Yes | JSON Schema |
| `submitReport` schema + ack behavior | Yes | JSON Schema |
| `getThreatList` binary format + signing method | Yes | Docs + sample bytes |
| `healthCheck` response | Yes | JSON |
| `verifyEntitlement` method + license key format | Yes | Docs |
| Consistent error envelope + error codes | Yes | JSON Schema |
| Privacy policy for driver | Yes | Text/PDF |
| SLA & rate limits | Yes | Docs |
| Test vectors | Yes | JSON + binary files |
| Reference client implementation (optional) | Recommended | Code |

---

## 8. Open Questions [TODO]

1. **Exact transport**: Is the primary driver local (native messaging) or remote (HTTP)? The extension must be built to support both, but we need to know which is the default and how fallback should work.  
2. **Authentication granularity**: Does each user have a unique API key, or is there a shared extension key? For premium features, how is the user identified without compromising privacy?  
3. **Threat list update mechanism**: Does the driver push updates (e.g., via long-polling or WebSocket) or does the extension always pull? We currently assume pull via `getThreatList`.  
4. **Bloom filter algorithm details**: Confirm whether the filter is standard or counting, and provide the exact hash function seed(s).  
5. **License verification offline**: If the native sidecar is used, can it verify a license without any network access? We need to know for airplane mode.  
6. **Data retention for reports**: How long does the driver retain submitted URLs/comments? Is there a way to delete a report?  
7. **Rate limit specifics**: Exact numbers per method, and whether they are per user, per IP, or per extension installation.  
8. **Firefox native messaging**: Does the driver support Firefox's native messaging protocol? (It uses the same stdio JSON format, but the manifest is different.) Confirm compatibility.

---

**Once these deliverables are provided, the extension can be implemented against the `AnalyticsDriver` interface with full confidence.** Until then, we will build against a mock driver that implements the same contract, allowing development to proceed in parallel.