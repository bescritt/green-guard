// Click-guard + behaviour sensors, injected as a web_accessible_resource so the
// background can optionally load it to harden risky pages. Counts the signals
// the heuristic extractor reads (§4.2): fullscreen attempts, focus grabs,
// permission requests. Values are exposed on window.__sb_* for the feature
// extractor; nothing leaves the page.
//
// Loaded by content/feature-extractor.js only when a page is already flagged
// mediocre+; it is intentionally inert on safe pages.

(function () {
  if (window.__sbSensorsInstalled) return;
  window.__sbSensorsInstalled = true;
  window.__sb_fullscreenAttempts = 0;
  window.__sb_focusGrabs = 0;
  window.__sb_permissions = [];

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) window.__sb_fullscreenAttempts++;
  });

  // Focus grabs: window steals focus repeatedly (e.g. popunders, fake dialogs).
  let lastFocus = 0;
  window.addEventListener('focus', () => {
    const now = Date.now();
    if (now - lastFocus < 800) window.__sb_focusGrabs++;
    lastFocus = now;
  });

  const _request = window.Notification?.requestPermission
    ? window.Notification.requestPermission.bind(window.Notification)
    : null;
  if (_request) {
    window.Notification.requestPermission = function (...args) {
      window.__sb_permissions.push('notification');
      return _request(...args);
    };
  }
  const _geo = navigator?.geolocation?.getCurrentPosition
    ? navigator.geolocation.getCurrentPosition.bind(navigator.geolocation)
    : null;
  if (_geo) {
    navigator.geolocation.getCurrentPosition = function (...args) {
      window.__sb_permissions.push('geolocation');
      return _geo(...args);
    };
  }
})();
