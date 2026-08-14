importScripts("hospital/rsdkh/ai.js");

function enableSidePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(enableSidePanel);
chrome.runtime.onStartup.addListener(enableSidePanel);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const action = {
    "rsdkh:parse-soap": () => self.RSDKHAi.generateSoapParts(message.soapText),
    "rsdkh:generate-prescription": () => self.RSDKHAi.generatePrescription(message.mode, message.prescriptionText)
  }[message?.type];
  if (!action) return false;
  action()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "Proses AI gagal." }));
  return true;
});
