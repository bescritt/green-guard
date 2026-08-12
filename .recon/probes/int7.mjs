import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeGlobal } from '../../tests/helpers/fake-chrome.mjs';
import { BrowserAdapter } from '../../src/platform/browser.js';
import { SafetyActions } from '../../src/runtime/actions.js';
import { Orchestrator, ALARM } from '../../src/runtime/orchestrator.js';
import { MockDriver } from '../../src/driver/mock.js';
import { DriverClient } from '../../src/driver/client.js';
import { WhitelistStore } from '../../src/core/whitelist.js';

test('dbg7', async () => {
  const { chrome, globalObj } = fakeGlobal({ manifestVersion: 3 });
  const browser = new BrowserAdapter(globalObj);
  const store = new WhitelistStore({ get:(k)=>chrome.storage.local.get(k), set:(v)=>chrome.storage.local.set(v) });
  const actions = new SafetyActions(browser, { i18n:(k)=>k });
  const driver = new DriverClient(new MockDriver({}));
  const orch = new Orchestrator({ browser, driver, actions, store });
  await orch.init();
  const alarms = await chrome.alarms.getAll();
  console.log('alarms:', JSON.stringify(alarms.map(a=>a.name)));
  await chrome.advance(360*60000); await new Promise(r=>setTimeout(r,20));
  const bytes = await chrome.storage.local.get('threat_bloom');
  console.log('type after store:', Array.isArray(bytes.threat_bloom), 'len:', bytes.threat_bloom? bytes.threat_bloom.length: 'none');
  console.log('driver calls getThreatList:', driver.transport.calls.getThreatList);
});
