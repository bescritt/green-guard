// Manifest generators for SafeBrowsing+ (Green Guard).
//
// Two targets, both derived from the single source of truth in
// extension_requirements.md §2. We never hand-edit a JSON manifest: every
// build calls makeManifest(TARGET) so MV3 and MV2 cannot drift apart.
//
// Offline note: nativeMessaging is an *optional* permission (requested at
// runtime only when the user opts into the local sidecar). The base install
// ships without it, which keeps the store-privacy footprint minimal.

export const TARGET = Object.freeze({ MV3: 'mv3', MV2: 'mv2' });

const BASE = {
  name: 'SafeBrowsing+',
  version: '1.0.0',
  description:
    'Layered privacy/phishing protection: local bloom pre-filter, heuristic ' +
    'guard, crowdsourced driver, and an offline-degradable safety ladder.',
  // Single deterministic version-code source; bump only here.
  version_code: 1,
};

const COMMON_ICONS = {
  16: 'icons/icon16.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png',
};

const COMMON_CONTENT_SCRIPTS = [
  {
    matches: ['<all_urls>'],
    js: ['content/feature-extractor.js'],
    run_at: 'document_idle',
  },
];

function mv3Manifest() {
  return {
    manifest_version: 3,
    name: BASE.name,
    version: BASE.version,
    description: BASE.description,
    icons: COMMON_ICONS,
    permissions: [
      'tabs',
      'scripting',
      'storage',
      'alarms',
      'offscreen',
      'unlimitedStorage',
    ],
    optional_permissions: ['nativeMessaging'],
    host_permissions: ['<all_urls>'],
    background: { service_worker: 'background.js', type: 'module' },
    action: { default_popup: 'popup.html', default_icon: COMMON_ICONS },
    // Chrome MV3 registers the options UI via `options_page`; `options_ui` is
    // Firefox-only. Both point at the same page so the gear icon works everywhere.
    options_page: 'options.html',
    options_ui: {
      page: 'options.html',
      open_in_tab: false,
    },
    content_scripts: COMMON_CONTENT_SCRIPTS,
    web_accessible_resources: [
      {
        resources: ['content/actions-injected.js'],
        matches: ['<all_urls>'],
      },
    ],
  };
}

function mv2Manifest() {
  // Firefox MV2 fallback. No service worker, no offscreen doc, no
  // optional_permissions in the MV3 sense (Firefox uses permissions array).
  return {
    manifest_version: 2,
    name: BASE.name,
    version: BASE.version,
    description: BASE.description,
    icons: COMMON_ICONS,
    permissions: [
      'tabs',
      'storage',
      'alarms',
      '<all_urls>',
      'nativeMessaging',
    ],
    background: { scripts: ['background.js'], persistent: false },
    browser_action: { default_popup: 'popup.html', default_icon: COMMON_ICONS },
    options_page: 'options.html',
    options_ui: { page: 'options.html', open_in_tab: false },
    content_scripts: COMMON_CONTENT_SCRIPTS,
    web_accessible_resources: ['content/actions-injected.js'],
  };
}

export function makeManifest(target) {
  if (target === TARGET.MV3) return mv3Manifest();
  if (target === TARGET.MV2) return mv2Manifest();
  throw new RangeError(`unknown manifest target: ${target}`);
}

export function manifestVersionOf(target) {
  return target === TARGET.MV3 ? 3 : 2;
}
