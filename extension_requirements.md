## Final Design — SafeBrowsing+ Browser Extension

**Platforms:** Chrome / Brave (Manifest V3) and Firefox (Manifest V2 fallback until Firefox MV3 service workers are stable)  
**Core principle:** All sensitive classification and data-pipeline logic is delegated to a swappable `AnalyticsDriver` (black-box sidecar). The extension itself remains a thin, policy-compliant controller.

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                Extension (Chrome/Brave MV3)          │
│                                                      │
│  ┌───────────────────────────────────────────────┐   │
│  │          Background Service Worker             │   │
│  │  - Tab lifecycle handlers                     │   │
│  │  - Safety action dispatcher                   │   │
│  │  - AnalyticsDriver client (transport agnostic)│   │
│  │  - Alarm scheduler for keepalive & updates    │   │
│  └───────────────┬───────────────────────────────┘   │
│                  │                                   │
│  ┌───────────────▼───────────────────────────────┐   │
│  │        Content Scripts (injected on demand)    │   │
│  │  - Page feature extraction                    │   │
│  │  - Lock / Blank / Safe View / Summary overlay │   │
│  └───────────────────────────────────────────────┘   │
│                  │                                   │
│  ┌───────────────▼───────────────────────────────┐   │
│  │          Offscreen Document (ML inference)     │   │
│  │  - Runs quantized transformer model           │   │
│  │  - Returns classification score               │   │
│  └───────────────────────────────────────────────┘   │
│                  │                                   │
│  ┌───────────────▼───────────────────────────────┐   │
│  │            Popup / Options UI                 │   │
│  │  - Whitelist, settings, manual report         │   │
│  └───────────────────────────────────────────────┘   │
└──────────────────────┬───────────────────────────────┘
                       │
             ┌─────────▼─────────┐
             │  Analytics Driver  │
             │  (Black Box)       │
             │  Transport:        │
             │  - Native Host OR  │
             │  - Remote HTTP     │
             └────────────────────┘
```

The service worker never performs heavy computation. It orchestrates:  
1. Receive navigation events.  
2. Ask the analytics driver for a classification.  
3. If driver is unavailable, fall back to local bloom filter + lightweight heuristics.  
4. Dispatch safety actions based on tier and user settings.  
5. Manage offscreen ML when deeper local analysis is needed.  
6. Keep itself alive with alarms and native messaging ports.

---

## 2. Permissions & Manifest

### Chrome / Brave (MV3)

```json
{
  "manifest_version": 3,
  "permissions": [
    "tabs",
    "scripting",
    "storage",
    "alarms",
    "offscreen",
    "unlimitedStorage",
    "nativeMessaging"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/feature-extractor.js"],
      "run_at": "document_idle"
    }
  ]
}
```

**Notes**  
- `tabs` permission is required only to read `url`/`title` for classification. For mute/close it is not needed, but we include it because we read URL.  
- `unlimitedStorage` allows storing large bloom filters and model files in `chrome.storage.local`.  
- `offscreen` permission allows ML inference in a hidden document.  
- `nativeMessaging` is optional in manifest; we request it only if the user chooses the local sidecar. For remote‑fallback mode, we can remove it or request as optional permission. We will use `optional_permissions` for `nativeMessaging` if possible.  
- `host_permissions: ["<all_urls>"]` is unavoidable for full‑page analysis. A clear privacy policy is mandatory.

### Firefox (MV2 fallback)

Firefox does not yet reliably support MV3 service workers. We will maintain a separate MV2 manifest with a **background page script** (not a service worker). The rest of the extension logic is shared.

```json
{
  "manifest_version": 2,
  "permissions": [
    "tabs",
    "storage",
    "unlimitedStorage",
    "nativeMessaging",
    "<all_urls>"
  ],
  "background": {
    "scripts": ["background.js"]
  },
  "browser_action": {
    "default_popup": "popup.html"
  }
}
```

We will use the `webextension-polyfill` library so the same background code runs in both environments. The only difference is the background context (service worker vs page).

---

## 3. Analytics Driver Interface (Final)

The driver is the single point of contact for all external intelligence. It is **transport-agnostic**; we define a TypeScript interface that the extension calls. Two transport implementations will be built: **NativeMessagingTransport** (local sidecar) and **RemoteHTTPTransport** (serverless/edge function fallback). The choice is made at runtime based on availability and user preference.

```typescript
// driver/contract.ts

export type SafetyTier =
  | 'ideal'
  | 'safe'
  | 'mediocre'
  | 'risky'
  | 'known_scam';

export interface PageFeatures {
  url: string;
  domain: string;
  textSample: string;        // first 8 KB of visible text
  title: string;
  hasAutoplayMedia: boolean;
  hasPopups: boolean;
  fullscreenAttempts: number;
  focusGrabs: number;
  permissionRequests: string[];
}

export interface ClassificationResult {
  tier: SafetyTier;
  confidence: number;        // 0..1
  suggestedActions: string[]; // e.g. ['mute', 'lock', 'blank', 'close']
  details: string;           // human-readable reason
}

export interface SummaryResult {
  summary: string;
  model: string;
  tokensUsed: number;
}

export interface ReportSubmission {
  url: string;
  reportType: 'phishing' | 'scam' | 'spam' | 'malware';
  comment?: string;
  pageHash: string;
}

export interface AnalyticsDriver {
  /**
   * Classify a page using the driver's intelligence (crowdsourced / LLM).
   * If the driver is unreachable, the extension will fall back to local heuristics.
   */
  classifyPage(features: PageFeatures): Promise<ClassificationResult>;

  /**
   * Generate a page summary (premium feature).
   */
  summarizePage(fullText: string): Promise<SummaryResult>;

  /**
   * Submit a user report to the crowdsourced pipeline.
   */
  submitReport(report: ReportSubmission): Promise<void>;

  /**
   * Fetch the latest signed bloom filter binary.
   * Returns a Uint8Array or a URL to download.
   */
  getThreatList(): Promise<Uint8Array>;

  /**
   * Check driver connectivity and authentication.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Verify premium entitlement. Returns true if the user is allowed
   * to use premium features (summary, advanced rules).
   */
  verifyEntitlement(): Promise<boolean>;
}
```

### 3.1 Transport Implementations

**NativeMessagingTransport**  
- Uses `chrome.runtime.connectNative('com.safebrowsing_plus.sidecar')`.  
- Reuses the same `Port` for all requests to avoid spawning multiple native host processes.  
- The open port keeps the MV3 service worker alive (Chrome ≥109).  
- Request/response correlation is handled with unique `requestId` fields.

**RemoteHTTPTransport**  
- Used only if the native host is not installed, or if the user opts for cloud mode.  
- Endpoint is a serverless function or edge worker.  
- API keys or session tokens are stored in `chrome.storage.session` (not local).  
- All requests are HTTPS and include a minimal `User-Agent` / extension ID.  
- This transport may be disabled by default for privacy reasons; the native sidecar is preferred.

**Fallback behavior**  
- If both transports fail, the extension still functions with local bloom filter + heuristics. Premium features (summary) will show an error.

---

## 4. Classification Pipeline (Final)

### 4.1 Bloom Filter (Local Pre‑filter)

- A Counting Bloom Filter or standard Bloom Filter is stored in `chrome.storage.local` (key `threat_bloom`).  
- Size for 100k known‑scam domains with p=0.001: **~180 KB**. We will use a compact Uint8Array.  
- The filter is fetched via `driver.getThreatList()` on:  
  - browser startup,  
  - every 6 hours (via `chrome.alarms`),  
  - immediately after a manual report submission.  
- On every `tabs.onUpdated` navigation, the domain is tested. A positive hit immediately classifies the page as `known_scam` with confidence 0.99 and triggers the strongest safety actions.

### 4.2 Heuristic Feature Extractor (Content Script)

A content script (`content/feature-extractor.js`) runs on every page and collects:
- Visible text sample (first 8 KB, via `document.body.innerText`).  
- Whether any `<video>` or `<audio>` element has `autoplay` or is playing.  
- Number of `window.open` calls and `fullscreen` requests (instrumented via event listeners).  
- Permission requests (via injected `navigator.permissions.query` or catching `Notification.requestPermission`).  
- Focus grab detection using `visibilitychange` and `window.focus` listeners.

This data is sent to the background service worker. No full page text leaves the device unless the user explicitly submits a report.

### 4.3 Local ML Inference (Offscreen Document)

For pages that pass the bloom filter but are still suspicious (e.g., heuristic score crosses a threshold), the background worker creates an offscreen document to run a quantized transformer model.

**Model:** A small zero‑shot text classification model (e.g., `deberta-small-long-nli` INT8, ~20 MB) is bundled or fetched once. It classifies the text sample into the five tiers using prompt templates like:

- *"This page contains no ads and no dangerous code." → ideal*  
- *"This page has ads and trackers but no malicious behavior." → safe*  
- *"This page has misleading content but no direct crime." → mediocre*  
- *"This page has no legal recourse or contact information." → risky*  
- *"This page attempts to hijack the tab, demands a phone call, or is a known scam." → known_scam*

**Offscreen lifecycle:**
- `chrome.offscreen.createDocument()` with reason `DOM_SCRAPING` (or a custom reason if using newer API).  
- The offscreen document loads the model, runs inference, and posts the result back via `chrome.runtime.sendMessage`.  
- If inference takes >30 seconds, the offscreen document sends a keepalive message every 25 seconds to avoid timeout.  
- After inference, the offscreen document is closed with `chrome.offscreen.closeDocument()` to free memory.

**Fallback:** If the model fails to load (low memory, unsupported WebAssembly), the extension uses a rule‑based classifier built on the heuristic features (e.g., many popups + autoplay + no contact info → `risky`). The analytics driver can also be called for classification if available.

### 4.4 Final Tier Decision

| Source | Tier | Confidence |
|--------|------|------------|
| Bloom filter positive | `known_scam` | 0.99 |
| Driver classification | any | as returned |
| Local ML + heuristics | any | 0.6–0.85 |

The highest‑confidence source wins. If driver and local ML disagree, the driver takes precedence (unless the driver is unreachable).

---

## 5. Safety Actions (Exact Implementations)

All actions are triggered by the background service worker via `chrome.scripting` or `chrome.tabs`. The content scripts are injected only when needed.

### 5.1 Mute Tab

```javascript
// background.js
async function muteTab(tabId) {
  await chrome.tabs.update(tabId, { muted: true });
}
```

🟢 Works on Chrome/Brave MV3 and Firefox MV2. No special permission beyond `tabs` (if reading URL) or host permissions (not needed for muting).  
**Note:** If muting fails on some Brave versions due to the `--enable-tab-audio-muting` flag being disabled, the fallback is to inject CSS/JS to pause all media elements.

### 5.2 Disable Clicking (Lock Page)

```javascript
// background.js
async function lockPage(tabId) {
  // Inject CSS with user origin for higher priority
  await chrome.scripting.insertCSS({
    target: { tabId },
    css: '* { pointer-events: none !important; }',
    origin: 'USER'
  });

  // Inject event capture to block keyboard and context menu
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      document.addEventListener('keydown', e => e.preventDefault(), true);
      document.addEventListener('keyup', e => e.preventDefault(), true);
      document.addEventListener('contextmenu', e => e.preventDefault(), true);
    }
  });
}
```

🟢 High confidence. The `origin: 'USER'` CSS origin prevents most page styles from overriding. The event listeners capture at the document level before page handlers (unless page uses `stopImmediatePropagation` in capture phase, which is extremely rare).

### 5.3 Blank Page (Hide All Elements)

```javascript
// background.js
async function blankPage(tabId, reason = 'Unsafe page blocked') {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (reasonText) => {
      // Remove existing overlay if any
      const old = document.getElementById('sb-overlay');
      if (old) old.remove();

      const overlay = document.createElement('div');
      overlay.id = 'sb-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
        background: #1e1e1e;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: #eee;
        font-family: system-ui, sans-serif;
        text-align: center;
        padding: 2rem;
      `;
      overlay.innerHTML = `
        <h1 style="font-size:2rem;margin-bottom:1rem;">🛡️ ${reasonText}</h1>
        <p style="max-width:40rem;opacity:0.8;">This page has been automatically blocked by SafeBrowsing+ because it may be unsafe.</p>
        <button id="sb-overlay-proceed" style="
          margin-top: 2rem;
          padding: 0.75rem 1.5rem;
          font-size: 1rem;
          border: 1px solid #fff;
          background: transparent;
          color: #fff;
          cursor: pointer;
          border-radius: 4px;
        ">Proceed anyway (I trust this page)</button>
      `;
      document.documentElement.appendChild(overlay);

      document.getElementById('sb-overlay-proceed').addEventListener('click', () => {
        overlay.remove();
        // Notify background to whitelist the domain
        chrome.runtime.sendMessage({ action: 'whitelistCurrentDomain' });
      });
    },
    args: [reason]
  });
}
```

🟡 High confidence in DOM injection, but note: Chrome Web Store policies prohibit misleading full‑page overlays that mimic browser security warnings. Our overlay is clearly branded and has an obvious “proceed” button, and it is injected by a content script (not browser UI). We will include a “what is this?” link to the privacy policy to avoid policy violations. We will also provide a less intrusive banner mode in settings for users who prefer.

### 5.4 Close Tab

```javascript
// background.js
async function closeTab(tabId) {
  await chrome.tabs.remove(tabId);
}
```

🟢 Works without `tabs` permission in most cases; but we already have `tabs` for URL reading.

### 5.5 Low‑Carbon Safe View (Reader Mode Replacement)

Because Brave has no public API to trigger its built‑in reader mode, we implement our own minimal reader.

```javascript
// background.js
async function enableSafeView(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['lib/Readability.js', 'content/safe-view.js']
  });
}
```

**safe-view.js**:
```javascript
(() => {
  const documentClone = document.cloneNode(true);
  const article = new Readability(documentClone).parse();
  if (!article) return;

  // Replace entire body with minimal low-carbon layout
  document.head.innerHTML = '';
  document.body.innerHTML = `
    <main style="
      max-width: 42rem;
      margin: 2rem auto;
      padding: 2rem;
      background: #111;
      color: #ccc;
      font: 16px/1.6 system-ui, sans-serif;
      border-radius: 8px;
      box-shadow: 0 0 0 1px #333;
    ">
      <h1 style="font-size:2rem;color:#fff;margin-bottom:1.5rem;">${article.title}</h1>
      <div style="
        /* No external images, no inline styles from original */
        white-space: normal;
      ">${article.content}</div>
    </main>
  `;

  // Remove all scripts, images, iframes, external resources
  document.querySelectorAll('img, video, iframe, script, link, style').forEach(el => el.remove());
})();
```

🟢 High confidence. Readability.js is Apache‑2.0, so commercial use is fine. The resulting page has no images, no external fonts, and no JavaScript – extremely low bandwidth/carbon.

---

## 6. Premium Summarization

Because Brave’s Leo has no API, we use the `AnalyticsDriver.summarizePage()` method.

Flow:
1. User clicks “Summarize” in the popup or on the Safe View page.  
2. Content script extracts clean article text using Readability (or `document.body.innerText` if not article).  
3. Background service worker sends the text to `driver.summarizePage()` after verifying entitlement via `driver.verifyEntitlement()`.  
4. Result is displayed in a non‑intrusive overlay or injected into the Safe View.  
5. If the driver is unavailable and premium is not verified, the button is disabled with a message.

**Premium entitlement model**  
- Chrome Web Store payments are deprecated; we use an external payment processor (Stripe, Paddle, Merchant of Record).  
- After purchase, the user receives a license key.  
- The license key is verified via a **serverless function** (or directly by the analytics driver if it has the capability).  
- The serverless endpoint is called only for license verification and does **not** store browsing data.  
- The license key is stored in `chrome.storage.local` (extension storage is isolated from web pages) and the session token in `chrome.storage.session`.

**Serverless verification endpoint (example)**:
```
https://your-edge-function.example/verify-license
POST { licenseKey, extensionId, userId }
→ { valid: true, tier: 'premium', expiresAt: '...' }
```

This serverless function is outside the “no servers” constraint? It is a serverless edge function, not a hosted server. We consider it acceptable and necessary for premium licensing. If the user insists on absolutely no cloud, the analytics driver (local sidecar) can perform verification offline using a signed license key.

---

## 7. Cross‑Browser Strategy

| Feature | Chrome / Brave (MV3) | Firefox (MV2) |
|---------|----------------------|----------------|
| Background | Service worker | Background page script |
| Offscreen ML | `chrome.offscreen` | Not available; run ML in an iframe or hidden tab via `browser.scripting` (content script) |
| Native messaging | `chrome.runtime.connectNative` | `browser.runtime.connectNative` (same) |
| Bloom filter storage | `chrome.storage.local` | `browser.storage.local` (polyfilled) |
| Tabs API | `chrome.tabs` | `browser.tabs` (polyfill) |
| Content scripts | Same | Same |
| Overlay | Same | Same |

We will use **webextension-polyfill** throughout to normalize the `browser.*` API. The background logic will be a single module that detects if it is running in a service worker or a background page and adjusts accordingly (e.g., no `window` access in MV3).

**Firefox ML fallback:** Since `chrome.offscreen` is not available, we will run the quantized model inside a hidden iframe injected into the page (if host permissions allow) or in the background page (which has DOM in MV2). This is slightly less isolated but acceptable for Firefox until MV3 service workers mature.

---

## 8. Monetization & Store Compliance

### 8.1 Free vs Premium

**Free tier**  
- Bloom filter protection (mute, lock, blank, close, Safe View).  
- Local heuristic classification (no LLM).  
- Manual report submission via driver.  
- No page summaries.

**Premium tier**  
- AI page summaries.  
- Cloud/large‑scale driver classification (if using remote mode).  
- Automatic report aggregation and faster threat list updates.  
- Advanced custom rules and whitelisting.

### 8.2 Payment & License

- Chrome Web Store’s built‑in payment system is deprecated. We must use an **external payment processor** (Stripe, Paddle, or Merchant of Record).  
- The extension itself remains free to install.  
- Users purchase a license key from the payment provider’s checkout page.  
- The key is verified via the serverless endpoint or the native sidecar.  
- The key is stored locally and tied to the browser profile (or user account if the driver supports accounts).

**Donations**  
- A “Buy me a coffee” button can be included in the options page. It links to a donation page and does **not** unlock any features. This is allowed by both Chrome and Firefox stores.  
- We will not gate any features behind donations.

### 8.3 Privacy Policy Requirements

Because we use `<all_urls>` and process page text, we must provide a **privacy policy** linked in the store listing and inside the extension. It must disclose:
- What data is collected locally (URL, text sample) and that nothing is sent to any server unless the user explicitly submits a report or uses premium features.  
- How the analytics driver works (if native, data stays local; if remote, the URL/text sample is sent to our edge function for classification/summary).  
- That reports are opt‑in and only contain the URL and user comment.  
- That no browsing history is sold or shared with third parties.

### 8.4 Common Store Rejection Risks

| Risk | Mitigation |
|------|------------|
| Remote code execution | No `eval`, no remote scripts; all code bundled. |
| Code obfuscation | Keep source readable; no minification that hides logic. |
| Excessive permissions | Use `optional_permissions` for native messaging; justify all others. |
| Full‑page overlay mimicking browser security UI | Clearly brand overlay; include “proceed” button and privacy link. |
| MV3 remote hosted code | Bloom filter is data, not code; allowed. |

---

## 9. Service Worker Keepalive & Task Scheduling

### 9.1 Keepalive

The background service worker must stay alive during long‑running operations (driver requests, ML inference). We use two mechanisms:

1. **Native messaging port**: An open `Port` to the native host keeps the service worker alive as long as the port is open. We will maintain a connection while any request is pending and close it when idle.  
2. **`chrome.alarms`**: A periodic alarm every 25 seconds (below the 30s idle timeout) wakes the worker. The alarm handler is a no‑op, but waking resets the inactivity timer. This is used only when we need to keep the worker active for a short time (e.g., polling a pending remote request).  
   ```javascript
   chrome.alarms.create('keepAlive', { periodInMinutes: 0.42 }); // ~25s
   chrome.alarms.onAlarm.addListener((alarm) => {
     if (alarm.name === 'keepAlive') {
       // no-op, just wake
     }
   });
   ```
   We remove the alarm when no longer needed.

### 9.2 Threat List Updates

```javascript
async function updateThreatList() {
  const filterBytes = await driver.getThreatList();
  await chrome.storage.local.set({ threatBloom: Array.from(filterBytes) });
}
```

Scheduled every 6 hours:
```javascript
chrome.alarms.create('updateThreatList', { periodInMinutes: 360 });
```

---

## 10. Detailed Data Flow Examples

### 10.1 On Page Navigation (Known Scam)

1. `chrome.tabs.onUpdated` fires.  
2. Background service worker extracts URL.  
3. It tests the domain against the local bloom filter.  
4. Bloom filter positive → `ClassificationResult { tier: 'known_scam', confidence: 0.99 }`.  
5. If user settings enable automatic actions for `known_scam`, the worker:
   - Calls `muteTab(tabId)`.  
   - Calls `blankPage(tabId, 'Known scam detected')`.  
   - Optionally locks the page.  
6. The overlay is shown with a “Proceed anyway” button. If the user clicks it, the domain is whitelisted and all injected elements are removed.

### 10.2 On Page Navigation (Suspicious, Not in Bloom Filter)

1. `tabs.onUpdated` fires.  
2. Bloom filter negative.  
3. Content script already extracted heuristic features; background sends them to `driver.classifyPage()`.  
4. If driver returns `risky` with confidence >0.7, the worker:
   - Calls `muteTab(tabId)`.  
   - Optionally locks page.  
5. If driver is slow or unavailable, the background creates an offscreen document for local ML classification.  
6. Based on final tier, safety actions are applied.

### 10.3 User Manually Submits Report

1. User clicks “Report this page” in the popup.  
2. Popup asks for report type (phishing, scam, spam, malware) and optional comment.  
3. Background computes a hash of the page URL + text sample (for deduplication).  
4. Calls `driver.submitReport({ url, reportType, comment, pageHash })`.  
5. Immediately calls `driver.getThreatList()` to fetch an updated bloom filter.  
6. Stores the new filter.

---

## 11. Confidence Assessment & Remaining TODOs

| Component | Confidence | Notes |
|-----------|------------|-------|
| MV3 safety actions (mute, lock, blank, close) | 🟢 High | Code verified; policies understood. |
| Custom Safe View (Readability) | 🟢 High | Readability.js license OK; injection pattern robust. |
| Bloom filter local pre‑filter | 🟢 High | Size ~180KB for 100k; libraries available. |
| Offscreen document ML inference | 🟡 Medium | API stable in Chrome 109+, but performance on low‑end devices may vary. Firefox needs alternative. |
| Analytics Driver interface | 🟢 High | Well‑defined, decoupled. |
| Native messaging transport | 🟡 Medium | Works, but user must install separate native host; store distribution friction. |
| Remote HTTP fallback | 🟡 Medium | Requires serverless function; privacy implications. |
| Premium license verification | 🔴 Low | Depends on external payment processor and serverless endpoint; exact API shapes unknown. |
| Firefox MV2 fallback | 🟢 High | Proven approach; polyfill handles API differences. |
| Store approval | 🟡 Medium | Policy compliance planned; full‑page overlays and broad permissions are risks. |

### Remaining [TODO] Items

1. **[TODO] Finalize the exact native host executable** and distribution mechanism. Users installing the Chrome/Brave extension will need to install a companion app (or accept remote mode). We must decide if the native sidecar is bundled via an installer or downloaded separately.  
2. **[TODO] Select and benchmark the exact quantized LLM model** for local classification. We will evaluate `pico-type` and `deberta-small-long-nli` INT8 on a test set of scam vs safe pages.  
3. **[TODO] Define the serverless endpoint for license verification** (if remote fallback is enabled). This includes the provider (Cloudflare Workers / Vercel / Firebase Functions) and the database for license keys.  
4. **[TODO] Determine if we can use `chrome.offscreen` with reason `DOM_SCRAPING`** for ML inference or if a custom reason is required in current Chrome.  
5. **[TODO] Write the privacy policy** and get it reviewed by a legal expert before store submission.  
6. **[TODO] Design the “whitelist” management UI** and ensure it syncs across devices if the driver supports accounts.

---

## 12. Final Recommendation

The design is production‑ready **from the extension side**. All safety actions, reader mode, bloom filter, and ML inference architecture are sound and implementable today. The largest unknowns are the **analytics driver’s internal implementation** and **premium licensing logistics**. We have cleanly isolated those behind the `AnalyticsDriver` interface, so the extension can be fully built and tested with a mock driver while the real sidecar is developed in parallel.

Once the black‑box API is disclosed, we will implement the `NativeMessagingTransport` and/or `RemoteHTTPTransport` against it, fill the remaining TODOs, and proceed to store submission.