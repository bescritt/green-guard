import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeChrome } from '../../tests/helpers/fake-chrome.mjs';
import { BrowserAdapter } from '../../src/platform/browser.js';
import { SafetyActions } from '../../src/runtime/actions.js';
import { Orchestrator } from '../../src/runtime/orchestrator.js';
import { MockDriver } from '../../src/driver/mock.js';
import { DriverClient } from '../../src/driver/client.js';
import { WhitelistStore } from '../../src/core/whitelist.js';
import { BloomFilter } from '../../src/core/bloom.js';
import { TIER, ACTION } from '../../src/core/tiers.js';
import { MOCK_SCAM_DOMAINS } from '../../src/driver/mock.js';

test('dbg', async () => {
  const chrome = new FakeChrome({ manifestVersion: 3 });
  const browser = new BrowserAdapter(chrome.globalObj);
  const store = new WhitelistStore({ get:(k)=>chrome.storage.local.get(k), set:(v)=>chrome.storage.local.set(v) });
  const actions = new SafetyActions(browser, { i18n:(k)=>k });
  const driver = new DriverClient(new MockDriver({}));
  const orch = new Orchestrator({ browser, driver, actions, store });
  const f = BloomFilter.fromKeys(MOCK_SCAM_DOMAINS, 0.001, 0);
  await chrome.storage.local.set({ threat_bloom: Array.from(f.serialize()) });
  await orch.init();
  const tabId = chrome.openTab({ url:`https://${MOCK_SCAM_DOMAINS[0]}/x` });
  const out = await orch.handleNavigation(tabId, { status:'complete', url:`https://${MOCK_SCAM_DOMAINS[0]}/x` }, { url:`https://${MOCK_SCAM_DOMAINS[0]}/x` });
  console.log('tier=', out?.decision?.tier, 'actions=', out?.actions, 'results=', JSON.stringify(out?.results));
});
