// Background service worker entry (MV3) / background script (MV2).
//
// Responsibilities (extension_requirements.md §9):
//   - install/upgrade the threat-list alarm (handled by Orchestrator.init)
//   - classify each navigation + each content-script feature push
//     (bloom → driver → heuristics → arbitrate → resolveActions → apply)
//   - surface popup/options message handlers
//   - degrade gracefully: driver unreachable ⇒ local bloom + heuristics still protect
//
// Everything goes through BrowserAdapter — there is no raw chrome.* here.

import { createBrowserAdapter } from './platform/browser.js';
import { Orchestrator } from './runtime/orchestrator.js';
import { SafetyActions } from './runtime/actions.js';
import { WhitelistStore } from './core/whitelist.js';
import { SettingsStore } from './core/settings.js';
import { DriverClient } from './driver/client.js';
import { MockDriver } from './driver/mock.js';
import { createLocalJudge } from './core/judge_local.js';

// Self-contained build ships the MockDriver so the extension is fully
// functional offline. A real deployment swaps in NativeMessagingTransport or
// RemoteHTTPTransport here.
const driver = new DriverClient(new MockDriver(), { name: 'mock' });

const browser = createBrowserAdapter(globalThis);

// Tiny storage adapter matching the { get(key), set(obj) } interface the
// *Store classes expect, backed by BrowserAdapter's storage calls.
function storageAdapter(key) {
  return {
    async get() {
      const all = await browser.storageGet({}, 'local');
      return all[key];
    },
    async set(obj) {
      await browser.storageSet({ [key]: obj }, 'local');
    },
  };
}

const whitelist = new WhitelistStore(storageAdapter('whitelist'));
const settingsStore = new SettingsStore(storageAdapter('settings'), { key: 'settings' });

const actions = new SafetyActions(browser, {
  i18n: (k) => browser.getMessage?.(k) || k,
});

const orchestrator = new Orchestrator({
  browser,
  driver,
  actions,
  store: whitelist,
  settingsStore,
  // On-device 4k-LLM judge (Tenet 7). If it is unreachable, classify() throws
  // and the orchestrator falls back to heuristics (§4.3) — never silently safe.
  mlHost: createLocalJudge({ baseUrl: 'http://localhost:8080' }),
  settings: await settingsStore.get(),
  onEvent: (e) => {
    try { browser.api?.runtime?.sendMessage?.({ type: 'EVENT', event: e }); } catch { /* noop */ }
  },
});

await orchestrator.init();

// Message router (popup / options / content scripts).
browser.api?.runtime?.onMessage?.addListener((msg, sender, reply) => {
  if (!msg || !msg.type) return undefined;
  switch (msg.type) {
    case 'FEATURES': {
      const tabId = sender?.tab?.id;
      if (tabId == null || !msg.features) return undefined;
      orchestrator.setFeatures(tabId, msg.features);
      // Re-run classification now that we have content-derived features.
      orchestrator.handleNavigation(tabId, { url: msg.features.url, status: 'complete' }, { url: msg.features.url, title: msg.features.title });
      return undefined;
    }
    case 'GET_STATE':
      reply?.({ type: 'STATE', stats: orchestrator.stats, settings: orchestrator.settings });
      return true;
    case 'SET_SETTINGS':
      settingsStore.set(msg.patch).then((s) => { orchestrator.settings = s; reply?.({ type: 'SETTINGS', settings: s }); });
      return true;
    case 'REPORT':
      driver.submitReport(msg.report).then(() => reply?.({ ok: true })).catch((e) => reply?.({ ok: false, error: String(e) }));
      return true;
    default:
      return undefined;
  }
});

// Force an immediate threat-list refresh on first install/upgrade.
browser.api?.runtime?.onInstalled?.addListener((details) => {
  if (details?.reason === 'install' || details?.reason === 'update') {
    orchestrator.handleAlarm({ name: 'UPDATE_THREATLIST' }).catch(() => {});
  }
});

// MV3 offscreen ML host wiring (§4.3) — only if the capability exists.
if (browser.capabilities.offscreen) {
  // The offscreen document loads content/safe-view.js; we create it lazily
  // when a premium summary is requested. Kept minimal here; the bundle
  // includes the offscreen entry for the build to wire.
  void browser.createOffscreenDocument;
}
