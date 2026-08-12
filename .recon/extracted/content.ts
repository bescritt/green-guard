(function injectScript() {

  function addScript() {
    if (!document.head) {
      setTimeout(addScript, 50);
      return;
    }

    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("src/content/interceptor.js");
      document.head.appendChild(script);
    } catch (error) {
      console.error("Failed to inject script:", error);
    }
  }

  addScript();
})();

let port = chrome.runtime.connect({ name: "content-script" });
let portDisconnected = false;

function connectPort() {
  port = chrome.runtime.connect({ name: "content-script" });
  portDisconnected = false;
  port.onDisconnect.addListener(() => {
    portDisconnected = true;
  });
}

connectPort();

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.type !== "GRAPHQL_API_RESPONSE") {
    return;
  }

  if (portDisconnected) {
    return;
  }

  try {
    port.postMessage({
      type: event.data.type,
      data: event.data.data,
    });
  } catch (error) {
    console.error("Failed to send message to background script:", error);
  }
});