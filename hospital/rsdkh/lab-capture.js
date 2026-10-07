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

  function cleanLines(lines = []) {
    return lines.map((line) => String(line || "").trim()).filter(Boolean);
  }

  function valueAfterLabels(lines, labels) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const lower = line.toLocaleLowerCase("id-ID");
      for (const label of labels) {
        const normalizedLabel = label.toLocaleLowerCase("id-ID");
        if (lower === normalizedLabel) return lines[index + 1] || "";
        if (lower.startsWith(normalizedLabel)) {
          const inlineValue = line.slice(label.length).replace(/^\s*[:\-]?\s*/, "").trim();
          if (inlineValue) return inlineValue;
        }
      }
    }
    return "";
  }

  function extractPatientIdentityFromLines(lines = []) {
    const cleaned = cleanLines(lines);
    return {
      name: valueAfterLabels(cleaned, ["Nama Pasien"]),
      medicalRecordNumber: valueAfterLabels(cleaned, ["No Rekam Medis", "Nomor Rekam Medis", "No. RM"])
    };
  }

  function extractLaboratoryMetadataFromLines(lines = []) {
    const cleaned = cleanLines(lines);
    const timestampPattern = /\b\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\b/;
    let completedAt = "";
    let labOfficer = "";
    for (let index = 0; index < cleaned.length; index += 1) {
      const match = cleaned[index].match(timestampPattern);
      if (!match) continue;
      const prefix = cleaned[index].slice(0, match.index).replace(/[,\s]+$/, "").trim();
      const previous = cleaned[index - 1] || "";
      const officer = prefix || (match[0] === cleaned[index] && /[A-Za-z]/.test(previous) ? previous : "");
      if (!officer || /(?:tgl|tanggal)\s+registrasi/i.test(officer)) continue;
      completedAt = match[0];
      labOfficer = officer;
    }
    return {
      registeredAt: valueAfterLabels(cleaned, ["Tgl Registrasi", "Tanggal Registrasi"]),
      completedAt,
      labOfficer,
      note: valueAfterLabels(cleaned, ["Catatan"])
    };
  }

  function readLaboratoryNote() {
    const labels = [...document.querySelectorAll("label, span, small, div")]
      .filter((element) => element.children.length === 0 && /^catatan\s*:?$/i.test(String(element.textContent || "").trim()));
    for (const label of labels) {
      let scope = label.parentElement;
      for (let depth = 0; scope && depth < 5; depth += 1, scope = scope.parentElement) {
        const textarea = scope.querySelector("textarea");
        if (textarea?.value.trim()) return textarea.value.trim();
      }
    }
    return "";
  }

  function readCaptureDetails() {
    const roots = [
      ...document.querySelectorAll("p-panel, .p-panel"),
      document.body
    ];
    for (const root of roots) {
      const identity = extractPatientIdentityFromLines(String(root.innerText || "").split(/\r?\n/));
      if (!identity.name || !identity.medicalRecordNumber) continue;
      const metadata = extractLaboratoryMetadataFromLines(String(document.body.innerText || "").split(/\r?\n/));
      return { ...identity, ...metadata, note: readLaboratoryNote() || metadata.note };
    }
    throw new Error("Nama pasien atau No. RM tidak ditemukan. Muat ulang halaman lalu coba lagi.");
  }

  function createCaptureIdentityHeader(details) {
    const header = document.createElement("section");
    header.className = "netmedic-rsdkh-lab-capture-identity";
    const title = document.createElement("div");
    title.className = "netmedic-rsdkh-lab-capture-title";
    title.textContent = "Hasil Laboratorium";
    const fields = document.createElement("div");
    fields.className = "netmedic-rsdkh-lab-capture-fields";
    [
      ["Nama Pasien", details.name],
      ["No. Rekam Medis", details.medicalRecordNumber],
      ["Tanggal Registrasi", details.registeredAt || "Belum tersedia"],
      ["Tanggal Selesai", details.completedAt || "Belum tersedia"]
    ].forEach(([label, value]) => {
      const field = document.createElement("div");
      const caption = document.createElement("span");
      const content = document.createElement("strong");
      caption.textContent = label;
      content.textContent = value;
      field.append(caption, content);
      fields.append(field);
    });
    const officer = document.createElement("div");
    officer.className = "netmedic-rsdkh-lab-capture-officer";
    const officerLabel = document.createElement("span");
    const officerName = document.createElement("strong");
    officerLabel.textContent = "Petugas Laboratorium";
    officerName.textContent = details.labOfficer || "Belum tersedia";
    officer.append(officerLabel, officerName);
    header.append(title, fields, officer);
    return header;
  }

  function createCaptureNoteFooter(note) {
    const footer = document.createElement("section");
    footer.className = "netmedic-rsdkh-lab-capture-note";
    const title = document.createElement("span");
    const content = document.createElement("p");
    title.textContent = "Catatan Laboratorium";
    content.textContent = note || "Tidak ada catatan.";
    footer.append(title, content);
    return footer;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Gambar PNG tidak dapat dibuat.")),
      "image/png"
    ));
  }

  function blobDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Gambar PNG tidak dapat dikirim ke clipboard."));
      reader.readAsDataURL(blob);
    });
  }

  async function writeImageToClipboard(blob) {
    if (navigator.clipboard?.write && globalThis.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return;
      } catch {
        // HTTP pages and browser policy can reject direct Clipboard API access.
      }
    }
    const response = await chrome.runtime.sendMessage({
      type: "rsdkh:copy-image-to-clipboard",
      dataUrl: await blobDataUrl(blob)
    });
    if (!response?.ok) throw new Error(response?.error || "Clipboard extension tidak tersedia.");
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

  async function captureTable(target, details) {
    if (typeof globalThis.html2canvas !== "function") throw new Error("Renderer capture belum siap. Muat ulang extension dan halaman.");
    const identityHeader = createCaptureIdentityHeader(details);
    const noteFooter = createCaptureNoteFooter(details.note);
    const previousStyle = {
      width: target.style.width,
      height: target.style.height,
      maxHeight: target.style.maxHeight,
      overflow: target.style.overflow
    };
    try {
      target.prepend(identityHeader);
      target.append(noteFooter);
      const width = target.scrollWidth;
      const height = target.scrollHeight;
      if (width < 1 || height < 1) throw new Error("Tabel hasil laboratorium tidak ditemukan.");
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
      identityHeader.remove();
      noteFooter.remove();
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
      const details = readCaptureDetails();
      const blob = await captureTable(table, details);
      await writeImageToClipboard(blob);
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
    module.exports = { captureScale, extractPatientIdentityFromLines, extractLaboratoryMetadataFromLines };
    if (require.main === module) {
      const assert = require("node:assert/strict");
      assert.equal(captureScale(0.5), 1);
      assert.equal(captureScale(1.5), 1.5);
      assert.equal(captureScale(3), 2);
      assert.deepEqual(extractPatientIdentityFromLines([
        "Info Pasien", "No Rekam Medis", "156811", "Nama Pasien", "ADIBA KHANZA AZZAHRA"
      ]), { name: "ADIBA KHANZA AZZAHRA", medicalRecordNumber: "156811" });
      assert.deepEqual(extractPatientIdentityFromLines([
        "Nama Pasien: BAYI NY. NAILA", "No. RM: 160001"
      ]), { name: "BAYI NY. NAILA", medicalRecordNumber: "160001" });
      assert.deepEqual(extractLaboratoryMetadataFromLines([
        "Tgl Registrasi", "2026-10-07 09:34:51", "Yuliana Yusup, Amd. AK 2026-10-07 10:49:22",
        "Catatan", "Hasil Leukosit sudah dikonfirmasi dengan Apusan darah"
      ]), {
        registeredAt: "2026-10-07 09:34:51",
        completedAt: "2026-10-07 10:49:22",
        labOfficer: "Yuliana Yusup, Amd. AK",
        note: "Hasil Leukosit sudah dikonfirmasi dengan Apusan darah"
      });
      console.log("lab capture self-check ok");
    }
    return;
  }

  new MutationObserver(queueInject).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("hashchange", queueInject);
  queueInject();
})();
