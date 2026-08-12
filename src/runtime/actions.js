/**
 * runtime/actions.js — the six safety actions (extension_requirements.md §5).
 *
 * Every action goes through the BrowserAdapter, so this module runs unchanged on
 * MV3 and MV2 and is fully testable against the fake.
 *
 * Two properties matter more than anything else here:
 *   IDEMPOTENT — applying an action twice must not stack two overlays or two
 *                sets of key handlers. Navigation events fire repeatedly.
 *   REVERSIBLE — every action except `close` can be undone, because false
 *                positives are inevitable (bloom filters have a nonzero fp rate
 *                by construction) and a user who cannot escape is a user who
 *                uninstalls.
 */

import { ACTION } from '../core/tiers.js';

export const OVERLAY_ID = 'sbplus-overlay';
export const BANNER_ID = 'sbplus-banner';
export const LOCK_STYLE_ID = 'sbplus-lock-style';
export const SAFE_VIEW_ID = 'sbplus-safe-view';
export const MAX_Z = 2147483647;

/** CSS used by the lock action. USER origin so page styles cannot override it. */
export const LOCK_CSS = `html, body, body * { pointer-events: none !important; user-select: none !important; }
#${OVERLAY_ID}, #${OVERLAY_ID} *, #${BANNER_ID}, #${BANNER_ID} * { pointer-events: auto !important; }`;

export class SafetyActions {
  /**
   * @param {import('../platform/browser.js').BrowserAdapter} browser
   * @param {object} [o]
   * @param {(k:string)=>string} [o.i18n] message lookup
   * @param {string} [o.privacyUrl] link shown on the overlay (store policy §8.4)
   */
  constructor(browser, { i18n, privacyUrl = 'pages/privacy.html' } = {}) {
    this.browser = browser;
    this.i18n = i18n || ((k) => k);
    this.privacyUrl = privacyUrl;
    /** @type {Map<number, Set<string>>} tabId → applied actions, for reversal */
    this.applied = new Map();
  }

  _mark(tabId, action) {
    if (!this.applied.has(tabId)) this.applied.set(tabId, new Set());
    this.applied.get(tabId).add(action);
  }

  _unmark(tabId, action) {
    this.applied.get(tabId)?.delete(action);
  }

  appliedTo(tabId) {
    return [...(this.applied.get(tabId) || [])];
  }

  forgetTab(tabId) {
    this.applied.delete(tabId);
  }

  /** §5.1 Mute. Falls back to pausing media if the tabs API refuses. */
  async mute(tabId) {
    try {
      await this.browser.tabsUpdate(tabId, { muted: true });
      this._mark(tabId, ACTION.MUTE);
      return { ok: true, method: 'tabs.update' };
    } catch (err) {
      // Some Brave builds ship with tab-audio-muting disabled (§5.1 note).
      await this.browser.executeScript({
        target: { tabId },
        func: () => {
          for (const el of document.querySelectorAll('video, audio')) {
            try { el.pause(); el.muted = true; } catch { /* element may be detached */ }
          }
        },
      });
      this._mark(tabId, ACTION.MUTE);
      return { ok: true, method: 'media-pause-fallback', reason: String(err && err.message) };
    }
  }

  async unmute(tabId) {
    await this.browser.tabsUpdate(tabId, { muted: false });
    this._unmark(tabId, ACTION.MUTE);
  }

  /** §5.2 Lock: USER-origin CSS plus capture-phase input suppression. */
  async lock(tabId) {
    await this.browser.insertCSS({ target: { tabId }, css: LOCK_CSS, origin: 'USER' });
    await this.browser.executeScript({
      target: { tabId },
      func: (markerId) => {
        if (window[markerId]) return 'already-locked'; // idempotency guard
        const block = (e) => {
          const inUi = e.target && e.target.closest && e.target.closest('#sbplus-overlay, #sbplus-banner');
          if (inUi) return; // our own UI must stay usable
          e.preventDefault();
          e.stopPropagation();
        };
        const events = ['keydown', 'keyup', 'keypress', 'contextmenu'];
        for (const ev of events) document.addEventListener(ev, block, true);
        window[markerId] = { block, events };
        return 'locked';
      },
      args: [LOCK_STYLE_ID],
    });
    this._mark(tabId, ACTION.LOCK);
    return { ok: true };
  }

  async unlock(tabId) {
    await this.browser.removeCSS({ target: { tabId }, css: LOCK_CSS, origin: 'USER' });
    await this.browser.executeScript({
      target: { tabId },
      func: (markerId) => {
        const state = window[markerId];
        if (!state) return 'not-locked';
        for (const ev of state.events) document.removeEventListener(ev, state.block, true);
        delete window[markerId];
        return 'unlocked';
      },
      args: [LOCK_STYLE_ID],
    });
    this._unmark(tabId, ACTION.LOCK);
  }

  /**
   * §5.3 Blank: a clearly-branded full-viewport overlay.
   *
   * Store-policy critical (§8.4 / CMP-08): it must be obviously OUR overlay, not
   * an imitation of a browser warning. Hence the product name, an explicit
   * "extension blocked this" sentence, a working escape hatch, and a privacy
   * link. Content is built with DOM APIs and textContent — never innerHTML with
   * interpolated page data, which would be an injection vector on a hostile page.
   */
  async blank(tabId, { reason = 'Unsafe page blocked', tier = 'known_scam', details = '' } = {}) {
    await this.browser.executeScript({
      target: { tabId },
      func: (cfg) => {
        const prev = document.getElementById(cfg.overlayId);
        if (prev) prev.remove(); // idempotent: never stack overlays

        const overlay = document.createElement('div');
        overlay.id = cfg.overlayId;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', cfg.brand + ' page warning');
        overlay.style.cssText = [
          'position:fixed', 'inset:0', 'width:100vw', 'height:100vh',
          'background:#141414', 'color:#eee', 'z-index:' + cfg.maxZ,
          'display:flex', 'flex-direction:column', 'align-items:center',
          'justify-content:center', 'text-align:center', 'padding:2rem',
          'font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif',
        ].join(';');

        const brand = document.createElement('div');
        brand.textContent = cfg.brand;
        brand.style.cssText = 'font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:.75rem;opacity:.75;margin-bottom:1rem';

        const h = document.createElement('h1');
        h.textContent = cfg.reason;
        h.style.cssText = 'font-size:1.75rem;margin:0 0 .75rem';

        const p = document.createElement('p');
        p.textContent = cfg.body;
        p.style.cssText = 'max-width:38rem;opacity:.85;margin:0 0 .5rem';

        const why = document.createElement('p');
        why.textContent = cfg.details || '';
        why.style.cssText = 'max-width:38rem;opacity:.6;font-size:.875rem;margin:0 0 1.5rem';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:.75rem;flex-wrap:wrap;justify-content:center';

        const proceed = document.createElement('button');
        proceed.id = cfg.proceedId;
        proceed.type = 'button';
        proceed.textContent = cfg.proceedLabel;
        proceed.style.cssText = 'padding:.7rem 1.4rem;font-size:1rem;border:1px solid #888;background:transparent;color:#fff;cursor:pointer;border-radius:6px';

        const back = document.createElement('button');
        back.id = cfg.backId;
        back.type = 'button';
        back.textContent = cfg.backLabel;
        back.style.cssText = 'padding:.7rem 1.4rem;font-size:1rem;border:0;background:#2f6df6;color:#fff;cursor:pointer;border-radius:6px';

        const privacy = document.createElement('a');
        privacy.id = cfg.privacyId;
        privacy.href = cfg.privacyUrl;
        privacy.target = '_blank';
        privacy.rel = 'noopener noreferrer';
        privacy.textContent = cfg.privacyLabel;
        privacy.style.cssText = 'margin-top:1.5rem;color:#8ab4ff;font-size:.8125rem';

        row.append(back, proceed);
        overlay.append(brand, h, p, why, row, privacy);
        (document.documentElement || document.body).appendChild(overlay);

        proceed.addEventListener('click', () => {
          overlay.remove();
          try {
            const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
            api.runtime.sendMessage({ action: 'whitelistCurrentDomain', tier: cfg.tier });
          } catch { /* popup-less context: overlay removal is still the right UX */ }
        });
        back.addEventListener('click', () => {
          try {
            const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
            api.runtime.sendMessage({ action: 'takeMeBack' });
          } catch { /* ignore */ }
        });
        return 'overlay-shown';
      },
      args: [{
        overlayId: OVERLAY_ID,
        proceedId: OVERLAY_ID + '-proceed',
        backId: OVERLAY_ID + '-back',
        privacyId: OVERLAY_ID + '-privacy',
        maxZ: MAX_Z,
        brand: 'SafeBrowsing+',
        reason: this.i18n(reason),
        body: this.i18n('This page was blocked by the SafeBrowsing+ extension because it may be unsafe. This is an extension warning, not a browser or operating-system message.'),
        details,
        tier,
        proceedLabel: this.i18n('Proceed anyway (I trust this page)'),
        backLabel: this.i18n('Take me back to safety'),
        privacyLabel: this.i18n('What is this? Read our privacy policy'),
        privacyUrl: this.browser.getURL(this.privacyUrl),
      }],
    });
    this._mark(tabId, ACTION.BLANK);
    return { ok: true };
  }

  async unblank(tabId) {
    await this.browser.executeScript({
      target: { tabId },
      func: (id) => { document.getElementById(id)?.remove(); return 'removed'; },
      args: [OVERLAY_ID],
    });
    this._unmark(tabId, ACTION.BLANK);
  }

  /** §5.3 alternative: a dismissible banner for users who dislike takeovers. */
  async warn(tabId, { reason = 'This page looks suspicious', tier = 'mediocre' } = {}) {
    await this.browser.executeScript({
      target: { tabId },
      func: (cfg) => {
        document.getElementById(cfg.bannerId)?.remove();
        const bar = document.createElement('div');
        bar.id = cfg.bannerId;
        bar.setAttribute('role', 'status');
        bar.style.cssText = [
          'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:' + cfg.maxZ,
          'background:#3a2c00', 'color:#ffe9a8', 'padding:.6rem 1rem',
          'font:14px/1.4 system-ui,sans-serif', 'display:flex', 'gap:1rem',
          'align-items:center', 'justify-content:space-between',
          'box-shadow:0 1px 4px rgba(0,0,0,.4)',
        ].join(';');
        const text = document.createElement('span');
        text.textContent = 'SafeBrowsing+: ' + cfg.reason;
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Dismiss';
        close.style.cssText = 'border:1px solid currentColor;background:transparent;color:inherit;border-radius:4px;padding:.25rem .75rem;cursor:pointer';
        close.addEventListener('click', () => bar.remove());
        bar.append(text, close);
        (document.body || document.documentElement).appendChild(bar);
        return 'banner-shown';
      },
      args: [{ bannerId: BANNER_ID, maxZ: MAX_Z, reason: this.i18n(reason), tier }],
    });
    this._mark(tabId, ACTION.WARN);
    return { ok: true };
  }

  async dismissWarning(tabId) {
    await this.browser.executeScript({
      target: { tabId },
      func: (id) => { document.getElementById(id)?.remove(); return 'removed'; },
      args: [BANNER_ID],
    });
    this._unmark(tabId, ACTION.WARN);
  }

  /** §5.4 Close. Irreversible, hence opt-in only — enforced upstream in policy. */
  async close(tabId) {
    await this.browser.tabsRemove(tabId);
    this.forgetTab(tabId);
    return { ok: true };
  }

  /**
   * §5.5 Low-Carbon Safe View.
   * Loads bundled Readability (never remote), then rebuilds the document with no
   * images, scripts, iframes, external CSS or web fonts.
   */
  async safeView(tabId, { files = ['vendor/Readability.js', 'content/safe-view.js'] } = {}) {
    await this.browser.executeScript({ target: { tabId }, files });
    this._mark(tabId, ACTION.SAFE_VIEW);
    return { ok: true };
  }

  /** Apply an ordered list of actions, collecting per-action outcomes. */
  async applyAll(tabId, actions, ctx = {}) {
    const results = [];
    for (const a of actions) {
      try {
        switch (a) {
          case ACTION.MUTE: results.push({ action: a, ...(await this.mute(tabId)) }); break;
          case ACTION.LOCK: results.push({ action: a, ...(await this.lock(tabId)) }); break;
          case ACTION.BLANK: results.push({ action: a, ...(await this.blank(tabId, ctx)) }); break;
          case ACTION.WARN: results.push({ action: a, ...(await this.warn(tabId, ctx)) }); break;
          case ACTION.SAFE_VIEW: results.push({ action: a, ...(await this.safeView(tabId)) }); break;
          case ACTION.CLOSE: results.push({ action: a, ...(await this.close(tabId)) }); break;
          case ACTION.NONE: break;
          default: results.push({ action: a, ok: false, error: 'unknown action' });
        }
      } catch (err) {
        // One failing action must not abort the rest: muting still helps even if
        // the overlay could not be injected into a restricted page.
        results.push({ action: a, ok: false, error: String(err && err.message) });
      }
    }
    return results;
  }

  /** Undo everything reversible we applied to a tab (used by "Proceed anyway"). */
  async revertAll(tabId) {
    const applied = this.appliedTo(tabId);
    const out = [];
    for (const a of applied) {
      try {
        if (a === ACTION.MUTE) await this.unmute(tabId);
        else if (a === ACTION.LOCK) await this.unlock(tabId);
        else if (a === ACTION.BLANK) await this.unblank(tabId);
        else if (a === ACTION.WARN) await this.dismissWarning(tabId);
        out.push({ action: a, reverted: true });
      } catch (err) {
        out.push({ action: a, reverted: false, error: String(err && err.message) });
      }
    }
    this.forgetTab(tabId);
    return out;
  }
}
