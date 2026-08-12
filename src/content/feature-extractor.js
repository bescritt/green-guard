// Content script: extract PageFeatures from the live DOM and forward to the
// background service worker. Runs in the page realm (document_idle).
//
// This is the ONLY place that reads raw page content. Everything downstream
// (heuristics, bloom, driver) consumes the serialisable PageFeatures object,
// never the DOM — which keeps the core fully testable in Node.
//
// We deliberately cap the text sample at the first 8 KB (extension_requirements
// §4.2) and never exfiltrate it beyond the background worker. The page is
// notified via a postMessage reply so the iframe/report flows stay local.

import { extractFeatures } from '../core/contract.js';

function first8k(text) {
  const NORMALISE = /\s+/g;
  const t = String(text || '').replace(NORMALISE, ' ').trim();
  return t.length > 8192 ? t.slice(0, 8192) : t;
}

function collect() {
  const doc = document;
  const url = location.href;
  const domain = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();

  // Visible text sample: walk text nodes, skip script/style/noscript.
  let sample = '';
  const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const parts = [];
  let n = walker.nextNode();
  while (n && sample.length < 8192) {
    const s = n.nodeValue || '';
    if (s.trim()) parts.push(s);
    sample = parts.join(' ');
    n = walker.nextNode();
  }

  const features = extractFeatures({
    url,
    domain,
    title: doc.title || '',
    textSample: first8k(sample),
    hasAutoplayMedia: !!doc.querySelector('video[autoplay], audio[autoplay]'),
    hasPopups: false, // set by the click-guard injected script when a popup fires
    fullscreenAttempts: window.__sb_fullscreenAttempts || 0,
    focusGrabs: window.__sb_focusGrabs || 0,
    permissionRequests: window.__sb_permissions || [],
  });

  return features;
}

// Observe DOM mutations? No — we extract once at idle and again on a cheap
// 2s timer for SPA navigations, then stop. Keeps the content script cheap.
function send() {
  const features = collect();
  try {
    chrome.runtime.sendMessage({ type: 'FEATURES', features });
  } catch {
    /* background not ready — ignore */
  }
}

send();
const spaTimer = setInterval(send, 2000);
setTimeout(() => clearInterval(spaTimer), 10000);

// Listen for a re-extract request (e.g. after a tab becomes visible).
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'EXTRACT_NOW') {
    const f = collect();
    reply?.({ type: 'FEATURES', features: f });
  }
});
