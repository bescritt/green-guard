// Unit tests for the production native-messaging bridge (driver/native.js).
//
// The transport must be HONEST about the observed contract: the production host
// has no classify RPC, so classify/summarize/report/entitlement/getThreatList
// fail CLOSED (typed FEATURE_NOT_AVAILABLE), while healthCheck probes real
// reachability. We test both the host-present and host-absent paths, and that
// DriverClient correctly reports the driver as unreachable (so the orchestrator
// falls back to local signals rather than trusting a fabricated "safe").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeMessagingTransport, NATIVE_APP_NAME } from '../../src/driver/native.js';
import { DriverClient } from '../../src/driver/client.js';
import { DriverError, ERROR_CODE } from '../../src/core/contract.js';
import { conformsToDriver } from '../../src/core/contract.js';

const HOST_PRESENT = {
  engine: 'chrome',
  async sendNativeMessage(name, msg) {
    assert.equal(name, NATIVE_APP_NAME);
    return { request: msg.request, service_status: 0, service_result: {} };
  },
};
const HOST_ABSENT = {
  engine: 'chrome',
  async sendNativeMessage() { throw new Error('host not installed'); },
};

test('NativeMessagingTransport conforms to AnalyticsDriver', () => {
  const t = new NativeMessagingTransport(HOST_PRESENT);
  assert.equal(conformsToDriver(t).ok, true);
});

test('healthCheck succeeds when the native host is reachable', async () => {
  const t = new NativeMessagingTransport(HOST_PRESENT);
  const r = await t.healthCheck();
  assert.equal(r.ok, true);
  assert.equal(r.reachable, true);
});

test('healthCheck throws EXT_TRANSPORT_UNAVAILABLE when host is absent', async () => {
  const t = new NativeMessagingTransport(HOST_ABSENT);
  await assert.rejects(() => t.healthCheck(), (e) => e instanceof DriverError && e.code === ERROR_CODE.EXT_TRANSPORT_UNAVAILABLE);
});

test('classification methods fail CLOSED (FEATURE_NOT_AVAILABLE), never return a synthetic verdict', async () => {
  const t = new NativeMessagingTransport(HOST_PRESENT);
  for (const m of ['classifyPage', 'summarizePage', 'submitReport', 'verifyEntitlement', 'getThreatList']) {
    await assert.rejects(
      () => t[m]({}),
      (e) => e instanceof DriverError && e.code === ERROR_CODE.FEATURE_NOT_AVAILABLE,
      `expected ${m} to throw FEATURE_NOT_AVAILABLE, not return a verdict`,
    );
  }
});

test('DriverClient reports the native driver unreachable → orchestrator falls back locally', async () => {
  const t = new NativeMessagingTransport(HOST_ABSENT);
  const client = new DriverClient(t, { name: 'native' });
  // classifyPage must surface a typed error (not a fake "safe"). The orchestrator
  // catches this and records the driver as unreachable, falling back to bloom +
  // local heuristics. A permanent "not available" error must NOT trip the
  // breaker (that is reserved for transient failures).
  await assert.rejects(
    () => client.classifyPage({ url: 'https://x.test' }),
    (e) => e instanceof DriverError,
  );
  assert.equal(client.state, 'closed', 'a non-retryable driver error must not open the breaker');
});

test('DriverClient with a present host still cannot classify (no RPC) → classify rejects', async () => {
  const t = new NativeMessagingTransport(HOST_PRESENT);
  const client = new DriverClient(t, { name: 'native' });
  await assert.rejects(() => client.classifyPage({ url: 'https://x.test' }));
});
