// Unit tests for the new packaging-surface modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeManifest, TARGET, manifestVersionOf } from '../../src/platform/manifest.js';
import { extractFeatures, validatePageFeatures } from '../../src/core/contract.js';

test('makeManifest(MV3) matches the spec §2 manifest', () => {
  const m = makeManifest(TARGET.MV3);
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(
    m.permissions.sort(),
    ['alarms', 'offscreen', 'scripting', 'storage', 'tabs', 'unlimitedStorage'].sort(),
  );
  assert.ok(m.optional_permissions.includes('nativeMessaging'), 'nativeMessaging must be optional');
  assert.equal(m.background.service_worker, 'background.js');
  assert.equal(m.action.default_popup, 'popup.html');
  assert.equal(m.content_scripts[0].js[0], 'content/feature-extractor.js');
  assert.equal(m.host_permissions[0], '<all_urls>');
  assert.ok(Array.isArray(m.web_accessible_resources));
});

test('makeManifest(MV2) is the Firefox fallback', () => {
  const m = makeManifest(TARGET.MV2);
  assert.equal(m.manifest_version, 2);
  assert.ok(m.background.scripts.includes('background.js'));
  assert.ok(m.browser_action, 'MV2 uses browser_action');
  assert.ok(m.permissions.includes('nativeMessaging'));
  assert.ok(Array.isArray(m.web_accessible_resources));
});

test('manifestVersionOf tracks target', () => {
  assert.equal(manifestVersionOf(TARGET.MV3), 3);
  assert.equal(manifestVersionOf(TARGET.MV2), 2);
});

test('makeManifest rejects unknown targets', () => {
  assert.throws(() => makeManifest('mv4'));
});

test('extractFeatures fills defaults and validates', () => {
  const f = extractFeatures({ url: 'https://example.com/' });
  assert.equal(f.url, 'https://example.com/');
  assert.equal(f.domain, 'example.com');
  assert.equal(f.hasAutoplayMedia, false);
  assert.equal(f.focusGrabs, 0);
  assert.deepEqual(f.permissionRequests, []);
  assert.equal(typeof f.textSample, 'string');
});

test('extractFeatures throws on a structurally invalid page feature', () => {
  assert.throws(() => extractFeatures({ url: 42 }), /extractFeatures/);
});

test('extractFeatures truncates oversized text sample to 8 KB', () => {
  const big = 'x'.repeat(20000);
  const f = extractFeatures({ url: 'https://e.com', textSample: big });
  assert.ok(f.textSample.length <= 8192, 'textSample must be capped at 8 KB');
});

test('validatePageFeatures rejects a non-object', () => {
  const r = validatePageFeatures(null);
  assert.equal(r.ok, false);
});
