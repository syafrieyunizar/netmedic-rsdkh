importScripts("hospital/rsdkh/ai.js");

function enableSidePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(enableSidePanel);
chrome.runtime.onStartup.addListener(enableSidePanel);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "rsdkh:parse-soap") return false;
  self.RSDKHAi.generateSoapParts(message.soapText)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "Gagal memilah SOAP." }));
  return true;
});
