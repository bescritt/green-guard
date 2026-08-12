// Injected by SafetyActions.safeView (§5.5 Low-Carbon Safe View).
// Runs after vendor/Readability.js has loaded. Extracts the main article and
// re-renders a clean, distraction-free reader. The original page is preserved
// in a detached clone so "exit safe view" can restore it.
//
// No network, no external calls — pure DOM. This is the privacy-safe
// replacement for reader mode.

(function () {
  if (window.__sbSafeViewActive) return;
  window.__sbSafeViewActive = true;

  const SAFE_VIEW_ID = 'sbplus-safe-view';
  const origHTML = document.documentElement.outerHTML;

  function render() {
    let article = null;
    try {
      const clone = document.cloneNode(true);
      const reader = new Readability(clone);
      article = reader.parse();
    } catch {
      article = null;
    }

    const container = document.createElement('div');
    container.id = SAFE_VIEW_ID;
    container.setAttribute('style',
      'all:initial;position:fixed;inset:0;z-index:2147483647;overflow:auto;' +
      'background:#fff;color:#111;font:16px/1.6 Georgia,serif;padding:5vh 10vw;');

    if (article && article.content) {
      const h = document.createElement('h1');
      h.textContent = article.title || document.title;
      const body = document.createElement('div');
      body.innerHTML = article.content;
      container.appendChild(h);
      container.appendChild(body);
    } else {
      const p = document.createElement('p');
      p.textContent = 'Could not extract a readable article from this page.';
      container.appendChild(p);
    }

    const btn = document.createElement('button');
    btn.textContent = 'Exit safe view';
    btn.setAttribute('style',
      'position:fixed;top:12px;right:12px;z-index:2147483647;padding:8px 12px;' +
      'background:#1a73e8;color:#fff;border:0;border-radius:6px;cursor:pointer;');
    btn.addEventListener('click', () => {
      if (confirm('Exit safe view and reload the original page?')) {
        window.__sbSafeViewActive = false;
        document.open(); document.write(origHTML); document.close();
      }
    });
    container.appendChild(btn);

    const style = document.createElement('style');
    style.textContent = 'html.sb-locked, html.sb-locked body { overflow:hidden !important; }';
    document.head.appendChild(style);
    document.documentElement.classList.add('sb-locked');
    document.body.appendChild(container);
  }

  if (typeof Readability === 'undefined') {
    // Readability must be injected before this file (actions.safeView lists it
    // first). If it is missing, surface a soft failure rather than throwing.
    const p = document.createElement('p');
    p.textContent = 'Safe view unavailable (reader engine missing).';
    document.body.appendChild(p);
    return;
  }
  render();
})();
