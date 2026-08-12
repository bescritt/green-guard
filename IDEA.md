## Project Vision

SafeBrowsing+ is a privacy-first browser extension for Chrome, Brave, and Firefox that automatically classifies every visited page into one of five safety tiers — **ideal**, **safe**, **mediocre**, **risky**, or **known scam** — and then takes appropriate protective actions. The goal is to shield users from malicious, deceptive, or resource-wasting websites while also offering a low-carbon reading mode and premium AI page summarization.

The extension leverages **crowdsourced reports**, **local bloom filters**, and **lightweight on-device LLM inference** to make real-time decisions without sending browsing history to a server. All heavy data-pipeline work (report aggregation, threat list generation, premium features) is delegated to a black-box **Analytics Driver** (sidecar), keeping the extension itself thin, compliant, and easy to maintain.

---

## Broad Design

### Architecture

```
┌───────────────────────────────────────┐
│        Browser Extension (MV3)         │
│  ┌─────────────────────────────────┐  │
│  │   Background Service Worker     │  │  ← orchestrates everything
│  │  - Tab events                   │  │
│  │  - Safety actions               │  │
│  │  - AnalyticsDriver client       │  │
│  └──────────────┬──────────────────┘  │
│                 │                     │
│  ┌──────────────▼──────────────────┐  │
│  │  Content Scripts (on-demand)    │  │  ← extract features, inject UI
│  └──────────────┬──────────────────┘  │
│                 │                     │
│  ┌──────────────▼──────────────────┐  │
│  │  Offscreen Document (ML)        │  │  ← local LLM inference
│  └─────────────────────────────────┘  │
│                 │                     │
│  ┌──────────────▼──────────────────┐  │
│  │  Popup / Options UI             │  │  ← user controls, reports
│  └─────────────────────────────────┘  │
└─────────────────┬─────────────────────┘
                  │
        ┌─────────▼─────────┐
        │  Analytics Driver  │  ← black-box sidecar
        │  (local or remote) │
        └───────────────────┘
```

### Key Components

1. **Page Classification Pipeline**  
   - **Bloom Filter** (local) quickly flags known scam domains.  
   - **Heuristic Feature Extractor** (content script) collects visible text, autoplay, popups, fullscreen attempts, etc.  
   - **Offscreen Document** runs a quantized transformer model for deeper text classification when needed.  
   - **Analytics Driver** provides crowdsourced/aggregated intelligence and premium summaries via a clean async interface.

2. **Safety Actions**  
   - **Mute** tab (`chrome.tabs.update({ muted: true })`).  
   - **Lock page** (inject `pointer-events: none` + block keys).  
   - **Blank page** (full-viewport overlay with “Proceed anyway” button).  
   - **Close tab** (`chrome.tabs.remove(tabId)`).  
   - **Low-Carbon Safe View** (custom reader mode using Readability.js, replacing the page with minimal dark HTML — no images, scripts, or external resources).  
   - **AI Page Summary** (premium; uses `AnalyticsDriver.summarizePage`).

3. **Analytics Driver Contract**  
   The extension talks to the driver through a TypeScript interface (`AnalyticsDriver`) with methods:  
   `classifyPage`, `summarizePage`, `submitReport`, `getThreatList`, `healthCheck`, `verifyEntitlement`.  
   Transport is pluggable: **Native Messaging** (local sidecar) or **Remote HTTP** (serverless fallback). This isolates all heavy intelligence and data pipeline work from the extension.

4. **Monetization**  
   - **Free tier**: basic protection, Safe View, local heuristics, manual reports.  
   - **Premium tier**: AI summaries, driver-based advanced classification, faster threat updates.  
   - Payment via external processor (Stripe/Paddle) with license key verification — Chrome Web Store’s built-in payments are deprecated.  
   - Donations allowed but not feature-gating.

5. **Privacy**  
   - All page text and URLs are processed **on-device** unless the user explicitly submits a report or uses premium remote features.  
   - Reports are opt-in and contain only URL, report type, and optional comment.  
   - Threat lists are downloaded as binary bloom filters (not code), so no remote code execution.  
   - Strict permission minimization and transparent privacy policy required for store approval.

### Cross-Browser Strategy

- **Chrome / Brave (MV3)**: service worker, offscreen documents, native messaging.  
- **Firefox (MV2 fallback)**: background page instead of service worker, polyfill for API differences.  
  The same core logic is shared, with environment detection.

### Current Status

The design is **finalized**. All safety actions, reader mode, bloom filter integration, and the Analytics Driver interface are specified. The extension can be built against a **mock driver** now, while the black-box sidecar is developed in parallel. Remaining unknowns are primarily in the driver’s internal implementation (transport, authentication, exact threat list format) and premium licensing logistics.