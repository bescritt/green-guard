// Integration test: load the built MV3 extension in real Brave (headless) and
// assert it loads WITHOUT a manifest/parse error. This is the offline analogue
// of "does the browser accept our artifact" — stronger than schema checks
// alone because Brave actually parses the service worker, content scripts and
// action wiring.
//
// Skips (does not fail) when `brave-browser` is not on PATH, so the suite stays
// green in CI without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'dist', 'mv3');
const MANIFEST = join(DIST, 'manifest.json');

function haveBrave() {
  const candidates = ['brave-browser', 'brave', '/usr/bin/brave-browser', '/usr/bin/brave', '/opt/brave.com/brave/brave'];
  for (const c of candidates) {
    try {
      if (c.includes('/')) {
        if (existsSync(c)) return c;
      } else if (execFileSync('which', [c], { stdio: 'ignore' }).toString().trim()) {
        return c;
      }
    } catch { /* keep looking */ }
  }
  return null;
}

test('built MV3 extension loads in real Brave without errors', { skip: !haveBrave() || !existsSync(MANIFEST) ? 'brave/chromium or built dist not available' : false }, () => {
  const brave = haveBrave();
  const ud = join('/tmp', `sb-loadtest-${process.pid}`);
  const stderr = join('/tmp', `sb-loadtest-${process.pid}.err`);
  // NOTE: DIST is a JS value — interpolate it into the command string directly.
  // A bash ${DIST} would be empty inside the spawned shell.
  const cmd = `"${brave}" --headless=new --no-sandbox --disable-gpu --enable-logging=stderr --load-extension="${DIST}" --user-data-dir="${ud}" about:blank`;
  try {
    execFileSync('bash', ['-c', `timeout 30 ${cmd} >/tmp/sb-loadtest-${process.pid}.out 2>${stderr}; true`], { stdio: 'ignore' });
  } catch { /* timeout exit is expected */ }

  const log = existsSync(stderr) ? execFileSync('cat', [stderr], { encoding: 'utf8' }) : '';
  const loadErrors = log
    .split('\n')
    .filter((l) => /Failed to load extension|Manifest file is invalid|Unrecognized manifest|could not be loaded/i.test(l));
  assert.equal(loadErrors.length, 0, `Brave reported extension load errors:\n${loadErrors.join('\n')}`);
  assert.ok(log.length > 0, 'expected Brave to emit load logs');
});
