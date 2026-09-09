"use strict";

async function report(token, ok, error = "") {
  await chrome.runtime.sendMessage({ type: "rsdkh:clipboard-window-result", token, ok, error });
  window.close();
}

(async () => {
  const token = new URLSearchParams(location.search).get("token") || "";
  try {
    const transfer = await chrome.runtime.sendMessage({ type: "rsdkh:get-pending-clipboard-image", token });
    if (!transfer?.ok) throw new Error(transfer?.error || "Data capture tidak ditemukan.");
    const response = await fetch(transfer.dataUrl);
    const blob = await response.blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    await report(token, true);
  } catch (error) {
    document.getElementById("status").textContent = "Capture gagal disalin";
    await report(token, false, error.message || "Gambar gagal disalin ke clipboard.");
  }
})();
