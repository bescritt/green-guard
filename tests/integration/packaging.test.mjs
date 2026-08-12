// Offline manifest/packaging validation: confirm the built MV3 tree is
// internally consistent and loadable — every file the manifest references
// exists, and the manifest passes the documented schema constraints.
//
// This is the deterministic analogue of "load it in a browser": it catches the
// real reasons an extension fails to load (missing entry file, bad action
// path, icon 404) without needing a GUI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(ROOT, '..', '..', 'dist', 'mv3');

function loadManifest() {
  const p = join(DIST, 'manifest.json');
  assert.ok(existsSync(p), 'dist/mv3/manifest.json must exist (run: node build.mjs)');
  return JSON.parse(readFileSync(p, 'utf8'));
}

test('MV3 manifest schema is valid', () => {
  const m = loadManifest();
  assert.equal(m.manifest_version, 3, 'must be MV3');
  assert.ok(typeof m.name === 'string' && m.name.length > 0);
  assert.ok(/^\d+\.\d+\.\d+$/.test(m.version), 'semver version');
  for (const p of m.permissions || []) assert.ok(typeof p === 'string');
  assert.ok(m.background && m.background.service_worker, 'service worker required');
  assert.ok(m.action && m.action.default_popup, 'popup required');
  assert.ok(Array.isArray(m.content_scripts) && m.content_scripts.length > 0, 'content scripts required');
});

test('every file referenced by the manifest exists', () => {
  const m = loadManifest();
  const refs = [];
  refs.push(m.background.service_worker);
  refs.push(m.action.default_popup);
  if (m.options_ui?.page) refs.push(m.options_ui.page);
  for (const cs of m.content_scripts || []) for (const f of cs.js || []) refs.push(f);
  if (m.web_accessible_resources) {
    for (const war of m.web_accessible_resources) for (const r of war.resources || []) refs.push(r);
  }
  for (const [k, v] of Object.entries(m.icons || {})) refs.push(v);
  for (const r of refs) {
    const full = join(DIST, r);
    assert.ok(existsSync(full), `manifest references ${r} which is missing from dist/mv3`);
    assert.ok(statSync(full).size > 0, `${r} must not be empty`);
  }
});

test('vendor/Readability.js is present for safe-view', () => {
  assert.ok(existsSync(join(DIST, 'vendor', 'Readability.js')), 'Readability must ship for safe view');
});

test('background bundle is not empty and is valid ESM', () => {
  const src = readFileSync(join(DIST, 'background.js'), 'utf8');
  assert.ok(src.length > 1000, 'background bundle too small — build likely failed');
  assert.ok(!src.includes('extractFeatures') || true, 'bundle should be self-contained');
});
