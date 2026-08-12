import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeGlobal } from '../../tests/helpers/fake-chrome.mjs';
import { BrowserAdapter } from '../../src/platform/browser.js';
import { SafetyActions } from '../../src/runtime/actions.js';
import { Orchestrator } from '../../src/runtime/orchestrator.js';
import { MockDriver } from '../../src/driver/mock.js';
import { DriverClient } from '../../src/driver/client.js';
import { WhitelistStore } from '../../src/core/whitelist.js';

test('dbg7b', async () => {
  const { chrome, globalObj } = fakeGlobal({ manifestVersion: 3 });
  const browser = new BrowserAdapter(globalObj);
  const store = new WhitelistStore({ get:(k)=>chrome.storage.local.get(k), set:(v)=>chrome.storage.local.set(v) });
  const actions = new SafetyActions(browser, { i18n:(k)=>k });
  const driver = new DriverClient(new MockDriver({}));
  const events=[];
  const orch = new Orchestrator({ browser, driver, actions, store, onEvent:(e)=>events.push(e) });
  await orch.init();
  const r = await orch.updateThreatList();
  console.log('updateThreatList returned:', JSON.stringify(r));
  console.log('events:', JSON.stringify(events.filter(e=>e.type==='bloom')));
  const raw = await chrome.storage.local.get('threat_bloom');
  console.log('stored:', Array.isArray(raw.threat_bloom), raw.threat_bloom && raw.threat_bloom.length);
});
