(() => {
  "use strict";

  const BUTTON_ID = "netmedic-rsdkh-lab-capture";
  const TOAST_ID = `${BUTTON_ID}-toast`;
  let captureRunning = false;
  let injectQueued = false;
  let toastTimer;

  function isLaboratoryResultPage() {
    return location.hash.startsWith("#/hasil-laboratorium/");
  }

  function captureScale(value) {
    const scale = Number(value);
    return Number.isFinite(scale) ? Math.min(2, Math.max(1, scale)) : 1;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Gambar PNG tidak dapat dibuat.")),
      "image/png"
    ));
  }

  function showToast(message, state = "success") {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.append(toast);
    }
    clearTimeout(toastTimer);
    toast.dataset.state = state;
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
  }

  function setButtonState(button, state) {
    const icon = button.querySelector(".p-button-icon");
    button.dataset.state = state;
    button.disabled = state === "loading";
    icon.className = `p-button-icon pi ${state === "loading" ? "pi-spin pi-spinner" : state === "success" ? "pi-check" : state === "error" ? "pi-times" : "pi-camera"}`;
    button.title = state === "loading" ? "Memproses capture..." : state === "success" ? "Tersalin ke clipboard" : state === "error" ? "Capture gagal" : "Capture hasil";
  }

  async function captureTable(target) {
    if (typeof globalThis.html2canvas !== "function") throw new Error("Renderer capture belum siap. Muat ulang extension dan halaman.");
    const width = target.scrollWidth;
    const height = target.scrollHeight;
    if (width < 1 || height < 1) throw new Error("Tabel hasil laboratorium tidak ditemukan.");
    const previousStyle = {
      width: target.style.width,
      height: target.style.height,
      maxHeight: target.style.maxHeight,
      overflow: target.style.overflow
    };
    try {
      target.style.width = `${width}px`;
      target.style.height = `${height}px`;
      target.style.maxHeight = "none";
      target.style.overflow = "visible";
      await document.fonts?.ready;
      const canvas = await globalThis.html2canvas(target, {
        backgroundColor: "#ffffff",
        scale: captureScale(devicePixelRatio),
        useCORS: true,
        allowTaint: false,
        logging: false,
        width,
        height,
        windowWidth: Math.max(document.documentElement.clientWidth, width),
        windowHeight: Math.max(document.documentElement.clientHeight, height)
      });
      return canvasBlob(canvas);
    } finally {
      Object.assign(target.style, previousStyle);
    }
  }

  async function captureResults(button) {
    if (captureRunning) return;
    const table = button.closest(".p-datatable")?.querySelector(".p-datatable-wrapper");
    if (!table) {
      showToast("Tabel hasil laboratorium tidak ditemukan.", "error");
      return;
    }
    captureRunning = true;
    setButtonState(button, "loading");
    try {
      const blob = await captureTable(table);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setButtonState(button, "success");
      showToast("Hasil laboratorium disalin ke clipboard. Tekan Ctrl+V untuk menempelkan.");
    } catch (error) {
      setButtonState(button, "error");
      showToast(error.message || "Capture hasil laboratorium gagal.", "error");
    } finally {
      captureRunning = false;
      setTimeout(() => setButtonState(button, "idle"), 1800);
    }
  }

  function injectButton() {
    if (!isLaboratoryResultPage() || document.getElementById(BUTTON_ID)) return;
    const xlsButton = [...document.querySelectorAll(".p-datatable-header .p-d-flex > button")]
      .find((button) => button.getAttribute("ptooltip") === "XLS" || button.getAttribute("ng-reflect-text") === "XLS" || button.querySelector(".pi-file-excel"));
    if (!xlsButton) return;
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "p-button-info p-ripple p-button p-component p-button-icon-only";
    button.title = "Capture hasil";
    button.setAttribute("aria-label", "Capture hasil laboratorium ke clipboard");
    button.innerHTML = '<span class="p-button-icon pi pi-camera" aria-hidden="true"></span><span aria-hidden="true" class="p-button-label">&nbsp;</span>';
    button.addEventListener("click", () => captureResults(button));
    xlsButton.insertAdjacentElement("afterend", button);
  }

  function queueInject() {
    if (injectQueued) return;
    injectQueued = true;
    requestAnimationFrame(() => {
      injectQueued = false;
      injectButton();
    });
  }

  if (typeof module !== "undefined") {
    module.exports = { captureScale };
    if (require.main === module) {
      const assert = require("node:assert/strict");
      assert.equal(captureScale(0.5), 1);
      assert.equal(captureScale(1.5), 1.5);
      assert.equal(captureScale(3), 2);
      console.log("lab capture self-check ok");
    }
    return;
  }

  new MutationObserver(queueInject).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("hashchange", queueInject);
  queueInject();
})();
