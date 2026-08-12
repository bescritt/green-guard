# Bitdefender TrafficLight 3.4.4 — Observed Driver Contract

**Extraction method (provenance):** All TypeScript sources were recovered from the
webpack `.map` files' `sourcesContent` arrays inside the read-only
`analytics_driver/` directory (e.g. `app.js.map`). Build-time placeholders such as
`[CloudServer]`, `[Version]`, `[FeedbackUrl]` are resolved by reading the
*minified* `analytics_driver/app.js`, where the bundler substituted real values.
Every claim below carries a file reference and a quoted snippet.

> Note on accuracy: where a string/constant exists only as a webpack placeholder in the
> readable source, the *resolved* value (from the minified bundle) is given and labelled
> `[resolved from minified app.js]`. Where a symbol is defined but never referenced by the
> extension, that is stated explicitly (it likely lives in the native desktop host).

---

## 1. NATIVE MESSAGING

### 1.1 Native host name
`com.extension.av.communication` — exactly as specified.
- Readable source `extensionConsts.ts`:
  `export const NATIVE_COMMUNICATION_APP_NAME: string = "com.extension.av.communication";`
- Resolved/minified `app.js`:
  `t.NATIVE_COMMUNICATION_APP_NAME="com.extension.av.communication"`

### 1.2 Send wrapper
`Browser.runtime.sendNativeMessage(BDTLL.NATIVE_COMMUNICATION_APP_NAME, message)`
(`messageService.ts`):
```ts
const rawResponse: IRawNativeResponse = await Browser.runtime.sendNativeMessage(
    BDTLL.NATIVE_COMMUNICATION_APP_NAME, message);
```

### 1.3 Message TYPE / command enum (`NativeAppMessageRequestType`)
`extensionConsts.ts`:
```ts
export enum NativeAppMessageRequestType {
    BLOCKED_PAGES = "blockedPages",
    SCANNED_PAGES = "scannedPages",
    PERMISSIONS_STATUS = "permissionsStatus",
    MALVERTISING_SUPPORT = "malvertisingSupport",
    SCAN_MESSAGES = "scanMessages",
    CHAT_PROTECTION_SETTINGS = "chatprotectionSettings"
}
```

### 1.4 Request JSON shape (per type)
Interface `INativeMessage` (`messageService.ts`):
```ts
export interface INativeMessage {
    request: BDTLL.NativeAppMessageRequestType,
    browser?: string,
    permissionsStatus?: BDTLL.PermissionsStatus,
    pagesBlocked?: BDTLL.WebPage[],
    scannedPages?: number,
    conversation?: BDTLL.IStoredConversationStatus,
}
```
Concrete examples observed in code:

- **BLOCKED_PAGES** (`session.ts` `sendBlockedPages`):
  ```ts
  const message: BDTLL.INativeMessage = {
      request: BDTLL.NativeAppMessageRequestType.BLOCKED_PAGES,
      browser: this.currentBrowser,
      pagesBlocked: blockedPages   // BDTLL.WebPage[]
  };
  ```
  `WebPage` shape (`session.ts`):
  ```ts
  class WebPage {
      url: string;
      threatStatus: BDTLL.PageStatus;
      scanned = false;
      sessionWhitelisted = false;
      trackerList: Array<string>;
      timestamp: number;
  }
  ```
- **SCANNED_PAGES** (`session.ts` `sendScannedPages`):
  ```ts
  const message: BDTLL.INativeMessage = {
      request: BDTLL.NativeAppMessageRequestType.SCANNED_PAGES,
      browser: this.currentBrowser,
      scannedPages: scannedPages
  }
  ```
- **PERMISSIONS_STATUS** (`app.ts` `sendPermissionsStatus`):
  ```ts
  const message: BDTLL.INativeMessage = {
      request: BDTLL.NativeAppMessageRequestType.PERMISSIONS_STATUS,
      browser: BDTLL.Utils.getCurrentBrowser(),
      permissionsStatus: status   // PermissionsStatus: -1 denied | 0 granted
  };
  ```
- **MALVERTISING_SUPPORT** (`session.ts` `checkMalvertisingSupport`):
  ```ts
  const message: BDTLL.INativeMessage = { request: BDTLL.NativeAppMessageRequestType.MALVERTISING_SUPPORT };
  ```
- **SCAN_MESSAGES** (`scanner.ts` `scanMessages`):
  ```ts
  await BDTLL.MessageService.sendNativeMessage({
      request: BDTLL.NativeAppMessageRequestType.SCAN_MESSAGES,
      conversation: conversation   // IStoredConversationStatus
  });
  ```
- **CHAT_PROTECTION_SETTINGS** (`scanner.ts` `getChatProtectionSettings`):
  ```ts
  await BDTLL.MessageService.sendNativeMessage({
      request: BDTLL.NativeAppMessageRequestType.CHAT_PROTECTION_SETTINGS
  });
  ```

### 1.5 Response JSON shape
`messageService.ts`:
```ts
interface IRawNativeResponse {
    request: string,            // echoed request type (see 1.6)
    service_status: number,
    service_result: INativeServiceResult
}
interface INativeServiceResult {
    enabled?: boolean,
    sms_result?: ILambadaSMSResponse[],
    chat_protection_settings?: IChatProtectionSettings
}
```
`ILambadaSMSResponse` (the documented SMS scan response):
```ts
export interface ILambadaSMSResponse {
    status_code: number,
    status_message: string[],
    ttl: number,
    sms_c: ISMSClusteringResponse,   // { status_code, status_message[], cluster_id }
    sndt: boolean,   // submit message text to cloud? see /lambada/osx/scam_alert/text
    sndnr: boolean,  // submit sender phone number? see /osx/scam_alert/nr
    _id: string,     // match id for text/number submissions
    url_status: IUrlStatusResponse[]
}
export interface IUrlStatusResponse {
    url: string,
    status_code: number,
    status_message: string[],
    domain_grey: boolean,
    ignore: boolean,
    ttl: number
}
```
The wrapper `MessageService.sendNativeMessage` maps this into `INativeResponse`:
```ts
response.request = rawResponse.request;
response.serviceStatus = rawResponse.service_status;
response.malvertisingSupportEnabled = rawResponse.service_result?.enabled || false;
response.chatProtectionSettings = rawResponse.service_result?.chat_protection_settings;
```

### 1.6 Request-id / correlation scheme
**NO explicit per-message `request-id`, sequence number, or correlation token exists.**
The only correlation is that the host **echoes the `request` type string back** in
`rawResponse.request` (`messageService.ts` line: `response.request = rawResponse.request;`).
Calls are issued one-at-a-time from the SW and the caller already knows which enum it sent,
so the echoed `request` string is the sole correlation key. `IStoredConversationStatus` /
`IScannedMessage` payloads carry their own `conversation`/`_id` match ids for SMS follow-up
submissions, but there is no generic message id.

### 1.7 Native service_status error codes
From `app.ts` (`handleServiceStatusResponse` / `sendPermissionsStatus`):
```ts
///     * -2: missing host
///     * -1: service unavailable
///     * 0: OK
```
`sendPermissionsStatus` returns `-2` when `sendNativeMessage` itself throws (host absent).
`PermissionsStatus` enum (`extensionConsts.ts`): `PERMISSIONS_DENIED = -1, PERMISSIONS_GRANTED = 0`.
`checkMalvertisingSupport` treats `response.serviceStatus === 0` as success
(`session.ts`).

---

## 2. CLOUD HTTP API (https://nimbus.bitdefender.net and https://trafficlight.bitdefender.com)

Base URL — readable `extensionConsts.ts`: `export const CLOUD_SERVER: string = "[CloudServer]"`
**[resolved from minified app.js]**: `t.CLOUD_SERVER="https://nimbus.bitdefender.net"`.

All cloud requests send header `'X-Nimbus-ClientId': <BROWSER_CLIENTID>` (resolved
`a4c35c82-b0b5-46c3-b641-41ed04075269`). See `cloudTalk.ts` `getRequestHeaders()` and
`update.ts` `requestInfoChrome`.

| # | Endpoint (path) | Method | Request body | Response body | Notes / evidence |
|---|---|---|---|---|---|
| 1 | `/url/status` | POST | `{ "url": string }` | `ICloudResponse` (see §4) | `CloudEndpoints.URL_STATUS="url/status"`. `cloudTalk.ts` `interogateCloud`. |
| 2 | `/batch/url/status` | POST | `[{ "url": string }, ...]` | `ICloudResponse[]` | `CloudEndpoints.URL_BATCH_STATUS="batch/url/status"`. Only URLs not already cached are sent. |
| 3 | `/bucket-testing` | POST | `IBucketTestingRequest` (JSON-RPC 2.0, see below) | `IBucketTestingResponse` | `CloudEndpoints.BUCKET_TESTING="bucket-testing"`. `cloudTalk.bucketTestingSettingsRequest`. |
| 4 | `/tll/update?file=ph_sign.slf` | GET | — | text (SLF rule file) | `update.ts` `requestInfoChrome`: `` `https://nimbus.bitdefender.net/tll/update?file=${filename}` ``. |
| 5 | `/tll/update?file=ph_white.txt` | GET | — | text (newline-delimited domains) | same `requestInfoChrome`; `file=` argument values are only `ph_sign.slf` and `ph_white.txt`. |
| 6 | `/report/aphish?JSVersion=J1&LID=N/A&PhDatsVersion=7&ProdInfo=…&ProdVers=…&PhASSLHitRules=…&Type=catch&Url=…` | GET | query params (URL-encoded) | `ICloudResponse` (json) | `utils.ts` `reportCatch` — fired when the local SLF rule engine flags a page as PHISHING. |
| 7 | `/report/aphish` | POST | JSON `{ProdInfo:"TLL", ProdVers:VERSION, Type:"fb_ads_full", adds:string}` | (ignored) | `utils.ts` `reportAnon`. Code comment: `// TODO: OEM change; unused ?!`. Header `X-Nimbus-ClientId`. |
| 8 | `/ads/malvertising` | POST | ad `data` (+`device_id` if available) | json | `index.ts` `submitAdData`/`sendPostRequest`. Header `'X-Nimbus-ClientID':'93f677ba-caf6-4233-b7eb-2547c442d30c'` (note: **ClientID** spelling, a *different* hardcoded client id than the rest). |
| 9 | `https://trafficlight.bitdefender.com/info?url=` | (link) | — | — | `Consts.SEARCH_INFO_URL` — base URL for the search-result "info" button. **Only referenced** by `feedbackEnabled()` length-check (`utils.ts`); not directly fetched in readable sources. **NOT FOUND** in extension usage beyond constant definition. |
| 10 | `https://nimbus.bitdefender.net/tll/feedback` | (link) | — | — | `Consts.FEEDBACK_URL` — feedback submission page. **NOT FOUND** directly POSTed in extension code; only used by `feedbackEnabled()` (`utils.ts:476` `return (BDTLL.Consts.FEEDBACK_URL?.length > 0);`). Likely opened in a tab via the `OPEN_FEEDBACK` command. |

### 2.1 Endpoints defined but NOT consumed by the extension (live in the native host)
These two `CloudServices` constants are defined but **never referenced** anywhere in the
extension JS (verified by searching every minified bundle — only the constant definition
appears, no `CloudServices.X` usage, no `CLOUD_SERVER + ...` concatenation):
- `CloudServices.SMS_MESSAGE_FILTER_ENDPOINT = "lambada/osx/scam_alert"`
- `CloudServices.NIMBUS_UUID_GENERATION_ENDPOINT = "services/genid"`

The `messageService.ts` doc-comment references child paths `/lambada/osx/scam_alert/text`
and `/osx/scam_alert/nr`, and the native `ILambadaSMSResponse` carries `sndt`/`sndnr`/`_id`
flags instructing submission — but the actual HTTP calls to those endpoints are performed by
the **native (desktop) AV host**, not by the extension. The extension only relays the
conversation to the host via `SCAN_MESSAGES`.

### 2.2 `/bucket-testing` request (JSON-RPC) shape
`bucketTesting.ts`:
```ts
const requestData: IBucketTestingRequest = {
    id: 1,
    jsonrpc: "2.0",
    method: BDTLL.BucketTestingMethod.GET_SETTINGS,   // "get_settings"
    params: {
        protocol_version: 1,
        metadata: {
            app_id: `com.${BDTLL.Consts.COMPANY_NAME}.tll`.toLowerCase(), // "com.bitdefender.tll"
            app_version: `${BDTLL.Consts.VERSION}`,                       // "3.4.4"
            current_buckets: currentBuckets
        },
        fields: { lang: BDTLL.Consts.DEFAULT_LOCALE }
    }
};
```
`IBucketTestingResponse`:
```ts
{ id: number, jsonrpc: string,
  result?: { settings: { fb_adds_state: boolean }, ids: string[] },
  error?:  { code: number, message: string, data: { code: number, message: string } } }
```
`BucketTestingMethod` also defines `REMOVE_USER = "remove_user"` (present in enum; GET_SETTINGS
is the only method observed in use).

---

## 3. THREAT LIST / URL-STATUS DECISION

A URL is judged "bad" by **two independent mechanisms** plus a user whitelist:

### 3.1 Cloud verdict (primary)
`scanner.scanLink` → `CloudTalk.interogateCloud(url)` POSTs to `/url/status` (or
`/batch/url/status` for many). The response `status_message` (array of `PageStatus` strings)
is reduced via `StatusPriority` to a single worst verdict (`cloudTalk.ts` `extractVerdict`).
A 5-minute in-memory cache (`CloudTalk.cloudCache`, keyed by URL or root domain) is used;
on fetch error the cloud path returns `SAFE` (`cloudTalk.ts` catch block). **No persisted
cloud cache** — cache is a static in-memory object, not `chrome.storage`.

### 3.2 Local signature engine (ASL/SLF) — phishing only
`scanner.scanPage` runs `assl.scan(...)` over `request.meta/body/title/url/domain/scripts`.
Rules come from `ph_sign.slf` (downloaded from `/tll/update?file=ph_sign.slf`, stored in
storage key `slfContent`) and parsed by `assl.createRegexes()` into `sign`/`nosign` rule
arrays. A rule whose `action == "PHISHING"` yields `PageStatus.PHISHING` and triggers
`Utils.reportCatch(url, "TLL", prodVersion, ruleName)` to `/report/aphish?...Type=catch`.
Rule DSL (`assl.ts`): `rule|metarule <name> { condition: match("regex", PART, PARAM[, FLAGS]); actions: mark("PHISHING", score); metadata: priority=N; }`,
where PART ∈ {`HTML::Body`, `HTML::Title`, `HTML::Url`, `HTML::Meta`, `HTML::Script`,
`Url::Path`, `Url::Params`, `Url::Host`}.

### 3.3 Whitelists (short-circuit to SAFE / WHITELISTED)
- `USER_WHITELIST` (`"userWhitelist"`) — user-added, checked in `scanner.scanLink`/`scanPage`
  via `appWhitelist.isWhitelisted`.
- `SESSION_WHITELIST` (`"sessionWhitelist"`) — "take me there anyway" / `Command.SESSION_WHITELIST`;
  stored as a `Record<url, WebPage>` Proxy (`session.ts`).
- `INTERNAL_WHITELIST` (`"internalWhitelist"`) — from `/tll/update?file=ph_white.txt`
  (newline-split domains); checked first in `scanner.scanLink`/`scanPage`.

### 3.4 Storage keys (`chrome.storage.local` via `Storage` class, `storage.ts`)
Enum `StorageKeys` (`extensionConsts.ts`), all confirmed persisted:
```ts
DATE="date", TIME="time",
USER_WHITELIST="userWhitelist", SESSION_WHITELIST="sessionWhitelist",
INTERNAL_WHITELIST="internalWhitelist",
SLF_CONTENT="slfContent",                 // the ph_sign.slf rule text
TLL_SP="tll_sp",                         // scanned-pages counter
LAST_MALVERTISING_STATUS="lastMalvStatus",
CURRENT_BUCKETS="currentBuckets",
BUCKET_TESTING_SETTINGS="lastValidServerResponse",
LAST_BUCKET_TESTING_REQUEST_TIME="lastBucketTestingRequestTime",
SCANNED_MESSAGES="scannedMessages",
UUID="userUniqueIdentifier"
```
`LocalStorageKeys` (`extensionConsts.ts`):
`USER_AGREEMENT_STATUS_PD="user_agreement_status_pd"`,
`USER_AGREEMENT_STATUS_AD="user_agreement_status_ad"`,
`USER_AGREEMENT_TAB_ID="user_agreement_tab_id"`.
Dynamic keys also used: `${platform}/${scannedMessages}/${conversationName}` for cached
scanned-message verdicts (`session.ts`), and `uuid` literal (see discrepancy below).

**Discrepancy (worth flagging for the adapter):** `uuid.ts` uses the **literal** `"uuid"` key,
not the `StorageKeys.UUID` enum value `"userUniqueIdentifier"`:
```ts
const existingUUID: string = (await Storage.get('uuid')) as string;
...
await Storage.set('uuid', newUUID);
```
So at runtime the UUId lives under storage key `"uuid"`.

### 3.5 Bloom filter / hash-prefix set
**NOT FOUND IN CODE.** There is no bloom filter, hash-prefix set, or Safe-Browsing-style
compressed list. The "threat list" is (a) the regex SLF file, (b) the plaintext whitelist
file, (c) live cloud verdicts. No IndexedDB usage for threat data was observed
(`Storage` wraps only `chrome.storage.local`).

---

## 4. URL-STATUS RESULT SHAPE (verdict / status enum)

### 4.1 Internal verdict enum — `PageStatus` (`extensionConsts.ts`)
```ts
export enum PageStatus {
    SAFE = "safe", MALWARE = "malware", PHISHING = "phishing", FRAUD = "fraud",
    MINER = "miner", PUA = "pua", MALVERTISING = "malvertising", SPAM = "spam",
    UNTRUSTED = "untrusted", WHITELISTED = "whitelisted",
    SESSION_WHITELISTED = "sessionWhitelisted", DISABLED = "disabled",
    SEARCH_ANALYZER_DISABLED = "searchAnalyzerDisabled"
}
```
This string enum is the **internal** verdict carried by `WebPage.threatStatus` and the
`status` query param of the blocked page.

### 4.2 Severity ordering — `StatusPriority` (`extensionConsts.ts`)
Index = severity. `extractVerdict` keeps the **max** index among reported statuses:
```ts
[ DISABLED, WHITELISTED, SAFE, UNTRUSTED, SPAM, PUA, MINER, FRAUD, PHISHING, MALWARE, MALVERTISING ]
```
(lowest → highest). `toBarIcon` maps each status to a toolbar icon; `MaliciousStatuses`:
```ts
const MaliciousStatuses = [ MALWARE, PHISHING, FRAUD, MINER, PUA, MALVERTISING ];
```
**Discrepancy (important for the adapter):** `SPAM` and `UNTRUSTED` are **NOT** in
`MaliciousStatuses`. The blocking predicate `isMaliciousPage` / `intercepter` uses
`BDTLL.MaliciousStatuses.indexOf(threatStatus) > -1`, so a cloud verdict of `spam` or
`untrusted` will NOT trigger the URL-blocking path, even though `blocked.tsx` has UI copy
mapped for them (they would only render if the page were redirected by some other route).
The blocked-page copy maps SPAM and UNTRUSTED both to the "untrusted" text.

### 4.3 Wire (numeric) status — `status_code`
The cloud / SMS responses carry a numeric `status_code`. Comment in `messageService.ts`:
```
"status_code": 1, // general verdict 0 = clean, any other value = malicious
```
The extension's decision logic, however, uses the **string `status_message`**, not
`status_code` (see `cloudTalk.extractVerdict` and `getTopThreatFromScanSMSResponseArray`).
So: numeric `status_code` exists on the wire (0 = clean) but is not the branch predicate.
`IUrlStatusResponse` additionally carries `domain_grey` (grey domains are not cached),
`ignore` (clean/whitelisted), and `ttl` (cache seconds, e.g. 1800).

### 4.4 Cloud response shape — `ICloudResponse` (`cloudTalk.ts`)
```ts
export interface ICloudResponse {
    categories: string[],
    domain_grey: boolean,
    status_code: number,
    status_message: string | string[]
}
```

### 4.5 Mapping to the blocked page
Block happens in `intercepter.ts` (`filterChrome`/`filterFirefox`) and `session.checkBlockedPage`:
```ts
const redirectURL = `/pages/blocked/blocked.html?status=${page.threatStatus}&url=${encodeURIComponent(page.url)}`;
```
`blocked.tsx` reads `status` (`PageStatus`) and `url` from the query and looks them up in a
`BlockedDetails` map. Mapped blocked copy:
`MALWARE, PHISHING, FRAUD, MINER, PUA, MALVERTISING` → each its own title/text;
`SPAM` and `UNTRUSTED` → the "untrusted" title/text;
`SAFE, WHITELISTED, SESSION_WHITELISTED, DISABLED, SEARCH_ANALYZER_DISABLED` → `undefined`
(no block page). The blocked page offers "take to safety" (`about:blank`), "ignore /
proceed anyway" (`Command.SESSION_WHITELIST`), and "whitelist" (`Command.WHITELIST_ADD`).
For non-main-frame malicious resources Chrome uses `declarativeNetRequest.updateDynamicRules`
to block `sub_frame`/`xmlhttprequest`/`other` of that hostname (`intercepter.ts`).

---

## 5. ERROR HANDLING (codes, timeouts, retry/backoff)

### 5.1 Native error codes
`service_status`: `-2` missing host, `-1` service unavailable, `0` OK (§1.7).
`PermissionsStatus`: `-1` denied, `0` granted.

### 5.2 Cloud fetch
- `CloudTalk.interogateCloud` has **no retry/backoff**. On any fetch error it returns
  `SAFE` (single url) / array of `SAFE` (batch) / `null` (`cloudTalk.ts` catch).
- `CloudTalk.cacheTimeout = 5*60*1000` (5 min) in-memory verdict cache
  (`cloudTalk.ts`).

### 5.3 Update scheduler
- `Update.interval = 14400000` ms = 4 h; `intervalInMInutes = 240`
  (`update.ts`). Chrome uses `alarms.create("tll-update-timer", {delayInMinutes:240, periodInMinutes:240})`.
- `Update.checkUpdate()` skips if `storedTime + interval >= now`.

### 5.4 Bucket-testing scheduler
- `BucketTesting.bucketTestingUpdateInterval = 24*60*60*1000` (24 h) (`bucketTesting.ts`).
- `MAX_TIMEOUT = 2147483647` clamp on `setTimeout` (avoids 32-bit overflow) (`bucketTesting.ts`).
- On error/exception returns last-known `fb_adds_state` fallback.

### 5.5 Scanned-pages reporting cadence
- `REPORT_SCANNED_PAGES_TIME_INTERVAL` = `5` (production) minutes
  (`extensionConsts.ts`; `process.env.ENVIRONMENT!=='production' ? 1 : 5`). Chrome alarm
  `tll-sp-timer` period = this value.

### 5.6 Permissions-status retry backoff (native)
`setInterval` cadence depends on last host response (`app.ts`):
- missing host → `4*60*60*1000` (4 h) in release, 3 min in debug
- service unavailable → `5*60*1000` (5 min) in release, 1 min in debug

### 5.7 Malvertising-ads POST retry (the only real retry loop)
`index.ts` `sendPostRequest`:
```ts
async function sendPostRequest(url, data, retries: number = 3, retryDelay: number = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        ...
        if (!response.ok) throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        return await response.json();
    } catch (error) {
        if (attempt < retries) await new Promise(r => setTimeout(r, retryDelay));
        else return false;
    }
}
```
→ **3 attempts, fixed 1000 ms linear delay (no exponential backoff).**

### 5.8 Telemetry / error reporting (out of threat path)
Sentry DSN (read-only observability): `dsn: 'https://5ce74b…e6db@catch-nimbus.bitdefender.net/144'`
release `Bitdefender-TrafficLight-production-mv3@3.4.4` (`sentryService.ts`). Not part of the
threat contract but part of observable egress.

---

## 6. VERSIONING / COMPAT REPORTING

All values resolved from minified `app.js` unless noted:

| Symbol | Value | Source |
|---|---|---|
| `Consts.VERSION` | `"3.4.4"` | `app.js`: `_.VERSION="3.4.4"` (placeholder `[Version]`) |
| `CLOUD_SERVER` | `https://nimbus.bitdefender.net` | `app.js`: `t.CLOUD_SERVER="https://nimbus.bitdefender.net"` |
| `BROWSER_CLIENTID` (NIMBUS_CLIENT_ID) | `a4c35c82-b0b5-46c3-b641-41ed04075269` | `app.js`: `BROWSER_CLIENTID:"a4c35c82-b0b5-46c3-b641-41ed04075269"` |
| Ads endpoint client id | `93f677ba-caf6-4233-b7eb-2547c442d30c` | `app.js` (header `X-Nimbus-ClientID` on `/ads/malvertising`) |
| `Consts.COMPANY_NAME` | `"Bitdefender"` | `app.js` |
| `Consts.PRODUCT_NAME` | `"TrafficLight"` | `app.js` |
| `Consts.DEFAULT_LOCALE` | `"en_US"` | `app.js` |
| Build `ENVIRONMENT` | `"production"` | `app.js` env blob |
| Build `DIST` | `2` | `app.js` env blob |
| `DEBUG_MODE` | `false` (production) | `app.js` `t.DEBUG_MODE=!1` |
| `MALVERTISING_ENABLED_DEFAULT_VALUE` | `false` | `app.js` env blob |
| `BUCKET_TESTING_ENABLED` | `true` | `app.js` env blob |
| `DISABLED_FEATURES` | `"[]"` | `app.js` |

Version strings sent on the wire:
- **Bucket-testing:** `app_id = "com.bitdefender.tll"` (=`com.${COMPANY_NAME}.tll`.toLowerCase()),
  `app_version = "3.4.4"`, `protocol_version = 1`, `fields.lang = "en_US"`
  (`bucketTesting.ts`).
- **Phishing catch report (`/report/aphish`):** `ProdVers` = `` `${Consts.VERSION}_chrome_${date}` ``
  e.g. `3.4.4_chrome_8/12/2026`; `JSVersion=J1`; `PhDatsVersion=7`; `ProdInfo="TLL"`
  (`scanner.ts` + `utils.ts` `reportCatch`).
- **Anon fb-ads report:** `ProdInfo:"TLL"`, `ProdVers:VERSION`, `Type:"fb_ads_full"`
  (`utils.ts` `reportAnon`).
- **Sentry release:** `Bitdefender-TrafficLight-production-mv3@3.4.4`, `dist:2`
  (`sentryService.ts`).

---

## Summary of observable contract surface

**Native message types (host `com.extension.av.communication`):**
`blockedPages`, `scannedPages`, `permissionsStatus`, `malvertisingSupport`,
`scanMessages`, `chatprotectionSettings`. Response echoes `request` (no request-id);
`service_status`: -2 missing host / -1 unavailable / 0 OK.

**Cloud endpoints (base `https://nimbus.bitdefender.net`):**
`/url/status` (POST), `/batch/url/status` (POST), `/bucket-testing` (POST, JSON-RPC 2.0),
`/tll/update?file=ph_sign.slf` & `=ph_white.txt` (GET), `/report/aphish` (GET catch + POST anon),
`/ads/malvertising` (POST, client id 93f677ba…). Plus link-only `https://trafficlight.bitdefender.com/info?url=`
and `https://nimbus.bitdefender.net/tll/feedback`.
**Defined-but-unused by the extension** (native-host only): `lambada/osx/scam_alert` and
`services/genid`.

**Verdict enum (string):** safe/malware/phishing/fraud/miner/pua/malvertising/spam/untrusted/
whitelisted/sessionWhitelisted/disabled/searchAnalyzerDisabled. Wire numeric `status_code`:
0 = clean. Blocking predicate `MaliciousStatuses` excludes `spam`/`untrusted` (UI copy exists
but they won't trigger the block path). Threat list = regex SLF + plaintext whitelist + live
cloud; **no bloom/hash-prefix list**.

**Key discrepancies for an adapter to handle:** (1) storage UUID key is literal `"uuid"` not the
enum `"userUniqueIdentifier"`; (2) `spam`/`untrusted` cloud verdicts are non-blocking per the
code despite having blocked-page UI; (3) `/tll/feedback` and `info?url=` are link targets, not
directly POSTed; (4) two separate `X-Nimbus-ClientId` values are used (general `a4c35c82…` vs
ads `93f677ba…`).
