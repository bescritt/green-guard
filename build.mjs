// build.mjs — esbuild bundler for SafeBrowsing+.
//
// Produces two loadable extension trees:
//   dist/mv3/  (Chrome / Brave MV3)
//   dist/mv2/  (Firefox MV2 fallback)
//
// Every entry is bundled from src/, so there is no hand-copied JS. The core
// modules (no chrome.*) are shared; only the entry wrappers differ.

import { build } from 'esbuild';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeManifest, TARGET } from './src/platform/manifest.js';

const ROOT = new URL('.', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

const ICONS = ['icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png'];
const STATIC = [
  'popup.html', 'popup.js', 'options.html', 'options.js',
  'pages/privacy.html',
];

async function bundle(target) {
  const out = join(DIST, target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'icons'), { recursive: true });
  mkdirSync(join(out, 'content'), { recursive: true });
  mkdirSync(join(out, 'pages'), { recursive: true });
  mkdirSync(join(out, 'vendor'), { recursive: true });

  const entryPoints = {
    'background': 'src/background.js',
    'content/feature-extractor': 'src/content/feature-extractor.js',
    'content/actions-injected': 'src/content/actions-injected.js',
    'content/safe-view': 'src/content/safe-view.js',
    'popup': 'src/popup.js',
    'options': 'src/options.js',
  };

  await build({
    entryPoints,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outdir: out,
    logLevel: 'info',
    sourcemap: false,
    // Readability is vendored and injected at runtime; mark it external so it
    // is copied as-is rather than bundled into safe-view.js.
    external: ['Readability'],
  });

  // Manifest
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(makeManifest(target), null, 2));

  // Static assets
  for (const f of STATIC) {
    const src = join(ROOT, 'src', f);
    if (existsSync(src)) copyFileSync(src, join(out, f));
  }
  for (const ic of ICONS) {
    copyFileSync(join(ROOT, 'src', ic), join(out, ic));
  }
  // Vendored Readability (the safe-view reader engine)
  const rd = join(ROOT, 'vendor', 'Readability.js');
  if (existsSync(rd)) copyFileSync(rd, join(out, 'vendor', 'Readability.js'));

  return out;
}

const targets = process.argv.slice(2);
const list = targets.length ? targets : [TARGET.MV3, TARGET.MV2];
for (const t of list) {
  const dir = await bundle(t);
  console.log(`built ${t} -> ${dir}`);
}
