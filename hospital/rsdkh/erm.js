(() => {
  "use strict";

  const BUTTON_ID = "netmedic-rsdkh-input-soap";
  const SLOT_ID = `${BUTTON_ID}-slot`;
  const UI_ID = `${BUTTON_ID}-ui`;
  const STEP_LABELS = [
    "Memilah S, O, A, dan P",
    "Mengisi Anamnesis",
    "Mengisi Pemeriksaan Fisik",
    "Mengisi Diagnosis",
    "Menyiapkan Asesment IGD 2"
  ];

  let ui;
  let running = false;
  let currentStep = -1;
  let savedSections = [];
  let injectQueued = false;

  const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ");
  const isVisible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function isErmPage() {
    return location.hash.startsWith("#/rekam-medis/");
  }

  function getCurrentPatientIdentity() {
    if (!isErmPage()) return "";

    const age = [...document.querySelectorAll("small.tag.is-danger.is-rounded")]
      .find((element) => isVisible(element) && /^\d+\s*thn(?:\s+\d+\s*bln)?(?:\s+\d+\s*hari)?$/i.test(normalize(element.textContent)));
    const gender = [...document.querySelectorAll("small.tag.is-info.is-rounded")]
      .find((element) => isVisible(element) && /^(?:laki[ -]?laki|perempuan)$/i.test(normalize(element.textContent)));

    if (!age || !gender) return "";
    return `${normalize(gender.textContent)} ${normalize(age.textContent)}`;
  }

  function isReportMedicalRecord(value) {
    return /^\d{5,8}$/.test(normalize(value));
  }

  function isReportPatientName(value) {
    const text = normalize(value);
    const excluded = /^(?:INFO REGISTRASI|GAWAT DARURAT|PLAFON|TAGIHAN|ALERGI|WEIGHT|HEIGHT|NON KELAS|I-CARE)$/i;
    return text.length >= 3
      && text.length <= 60
      && /[A-Z]/.test(text)
      && !/\d/.test(text)
      && text === text.toLocaleUpperCase("id-ID")
      && !excluded.test(text);
  }

  function getCurrentPatientReportIdentity() {
    if (!isErmPage()) return null;

    const age = [...document.querySelectorAll("small.tag.is-danger.is-rounded")]
      .find((element) => isVisible(element) && /^\d+\s*thn(?:\s+\d+\s*bln)?(?:\s+\d+\s*hari)?$/i.test(normalize(element.textContent)));
    const gender = [...document.querySelectorAll("small.tag.is-info.is-rounded")]
      .find((element) => isVisible(element) && /^(?:laki[ -]?laki|perempuan)$/i.test(normalize(element.textContent)));
    if (!age || !gender) return null;

    let scope = age.parentElement;
    while (scope && scope !== document.body) {
      const text = normalize(scope.innerText);
      if (/INFO REGISTRASI/i.test(text) && /\b\d{5,8}\b/.test(text)) break;
      scope = scope.parentElement;
    }
    scope = scope || document.body;

    const leaves = [...scope.querySelectorAll("*")]
      .filter((element) => isVisible(element) && !element.children.length && normalize(element.textContent));
    const medicalRecord = leaves.find((element) => isReportMedicalRecord(element.textContent));
    if (!medicalRecord) return null;

    const names = leaves.filter((element) => isReportPatientName(element.textContent));
    const name = names.filter((element) => element.compareDocumentPosition(medicalRecord) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1)
      || names[0];
    if (!name) return null;

    return {
      name: normalize(name.textContent),
      gender: normalize(gender.textContent),
      age: normalize(age.textContent).replace(/\bthn\b/i, "tahun"),
      medicalRecordNumber: normalize(medicalRecord.textContent)
    };
  }

  function identityFacts(value) {
    const identity = normalize(value);
    const age = Number(identity.match(/\b(\d{1,3})\s*(?:tahun|thn|th)\b/i)?.[1]);
    const male = /\b(?:laki[ -]?laki|pria)\b/i.test(identity)
      || /(?:^|[\s,])(?:tn|tuan|bpk|bapak|sdr)\.?(?=\s|,|$)/i.test(identity);
    const female = /\b(?:perempuan|wanita)\b/i.test(identity)
      || /(?:^|[\s,])(?:ny|nyonya|nn|nona|ibu)\.?(?=\s|,|$)/i.test(identity);
    if (!Number.isFinite(age) || male === female) return null;
    return { age, gender: male ? "male" : "female" };
  }

  function findButton(label, scope = document) {
    return [...scope.querySelectorAll("button")].find((button) => isVisible(button) && normalize(button.textContent) === label);
  }

  function findMenu(label) {
    const text = [...document.querySelectorAll(".p-menuitem-text")]
      .find((element) => isVisible(element) && normalize(element.textContent) === label);
    return text?.closest('[role="menuitem"]') || null;
  }

  function findHeading(label) {
    return [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .find((heading) => isVisible(heading) && normalize(heading.textContent) === label);
  }

  function findLabel(label, scope = document) {
    return [...scope.querySelectorAll("label")]
      .find((element) => isVisible(element) && normalize(element.textContent) === label);
  }

  async function waitFor(getter, errorMessage, timeout = 20000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const result = getter();
      if (result) return result;
      await sleep(100);
    }
    throw new Error(errorMessage);
  }

  async function clickMenu(label, ready) {
    const item = await waitFor(() => findMenu(label), `Menu ${label} tidak ditemukan.`);
    item.click();
    await waitFor(ready, `Halaman ${label} tidak siap.`);
  }

  function setControlValue(control, value) {
    if (!control) throw new Error("Kolom tujuan tidak ditemukan.");
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    control.focus();
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(control, value);
    control.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.blur();
  }

  function fieldByLabel(label, scope = document) {
    return findLabel(label, scope)?.parentElement?.querySelector("textarea,input") || null;
  }

  async function saveForm(scope, completion, sectionName) {
    const save = findButton("Simpan", scope);
    if (!save) throw new Error(`Tombol Simpan ${sectionName} tidak ditemukan.`);
    save.click();
    await waitFor(completion, `${sectionName} belum berhasil disimpan.`);
    savedSections.push(sectionName);
  }

  async function fillAnamnesis(value) {
    await clickMenu("Anamnesis", () => findHeading("Anamnesis") && findButton("Tambah"));
    findButton("Tambah").click();
    const field = await waitFor(() => fieldByLabel("Keluhan Utama"), "Kolom Keluhan Utama tidak ditemukan.");
    setControlValue(field, value);
    await saveForm(document, () => findButton("Tambah") && !findLabel("Keluhan Utama"), "Anamnesis");
  }

  async function fillPhysicalExam(value) {
    await clickMenu("Pemeriksaan Fisik", () => findHeading("Pemeriksaan Fisik") && findButton("Tambah"));
    findButton("Tambah").click();
    const field = await waitFor(() => {
      const heading = [...document.querySelectorAll("b")]
        .find((element) => isVisible(element) && normalize(element.textContent) === "Pemeriksaan Lokal");
      if (!heading) return null;
      const panel = heading.closest(".p-panel-content") || document;
      const textareas = [...panel.querySelectorAll("textarea")].filter(isVisible);
      return textareas.at(-1) || null;
    }, "Kolom Pemeriksaan Lokal tidak ditemukan.");
    setControlValue(field, value);
    await saveForm(document, () => findButton("Tambah") && !findHeading("Pemeriksaan Lokal"), "Pemeriksaan Fisik");
  }

  function diagnosisTypeFor(patientStatus) {
    if (patientStatus === "rawat_jalan") return "Primary / utama";
    if (patientStatus === "rawat_inap") return "Diagnosa Awal";
    throw new Error("Rencana status pasien belum dipilih.");
  }

  async function selectDiagnosisType(patientStatus) {
    const diagnosisType = diagnosisTypeFor(patientStatus);
    const label = await waitFor(() => findLabel("Jenis Diagnosa"), "Dropdown Jenis Diagnosa tidak ditemukan.");
    const dropdown = label.parentElement.querySelector(".p-dropdown");
    if (!dropdown) throw new Error("Dropdown Jenis Diagnosa tidak siap.");
    dropdown.click();
    const option = await waitFor(() => [...document.querySelectorAll(".p-dropdown-item,[role='option']")]
      .find((element) => isVisible(element) && normalize(element.textContent) === diagnosisType), `Pilihan ${diagnosisType} tidak ditemukan.`);
    option.click();
  }

  async function fillDiagnosis(value, patientStatus) {
    await clickMenu("Diagnosis", () => findHeading("Diagnosis") && findLabel("Diagnosa Medis"));
    await selectDiagnosisType(patientStatus);
    const label = findLabel("Diagnosa Medis");
    const panel = label.closest(".p-panel-content") || document;
    const field = fieldByLabel("Diagnosa Medis", panel);
    setControlValue(field, value);
    const beforeRows = panel.querySelectorAll("tbody tr").length;
    const save = findButton("Simpan", panel);
    if (!save) throw new Error("Tombol Simpan Diagnosis tidak ditemukan.");
    save.click();
    await sleep(350);
    await waitFor(() => panel.querySelectorAll("tbody tr").length > beforeRows || !field.value, "Diagnosis belum berhasil disimpan.");
    savedSections.push("Diagnosis");
  }

  function instructionRows() {
    return [...document.querySelectorAll("tr")].filter((row) => (
      isVisible(row)
      && row.querySelector("textarea")
      && row.querySelector('input[placeholder="Perawat"]')
    ));
  }

  function assessmentDiagnosisField() {
    return [...document.querySelectorAll('textarea[placeholder="Diagnosa Kerja"]')].find(isVisible) || null;
  }

  function instructionAddButton() {
    const marker = [...document.querySelectorAll("th,td,label,span,b,h3,h4")]
      .find((element) => isVisible(element) && /^(?:instruksi|intruksi) dokter$/i.test(normalize(element.textContent)));
    const scope = marker?.closest(".p-panel-content") || marker?.closest("p-panel") || document;
    const buttons = [...scope.querySelectorAll("button")]
      .filter((button) => isVisible(button) && normalize(button.textContent) === "Tambah");
    return buttons.at(-1) || null;
  }

  async function fillStableAssessment(valueA, valueP, planningIndex) {
    const getDiagnosis = assessmentDiagnosisField;
    const getPlanning = () => instructionRows()[planningIndex]?.querySelector("textarea") || null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const diagnosis = await waitFor(getDiagnosis, "Kolom Diagnosa Kerja tidak ditemukan.");
      const planning = await waitFor(getPlanning, "Kolom Instruksi Dokter tidak ditemukan.");
      if (diagnosis.value !== valueA) setControlValue(diagnosis, valueA);
      if (planning.value !== valueP) setControlValue(planning, valueP);
      await sleep(650);

      if (getDiagnosis()?.value === valueA && getPlanning()?.value === valueP) {
        await sleep(900);
        if (getDiagnosis()?.value === valueA && getPlanning()?.value === valueP) return getPlanning();
      }
    }

    throw new Error("Diagnosa Kerja atau Instruksi Dokter berubah setelah diisi. Silakan coba lagi.");
  }

  async function fillAssessment(valueA, valueP) {
    const parent = await waitFor(() => findMenu("Asesment IGD"), "Menu Asesment IGD tidak ditemukan.");
    parent.click();
    const child = await waitFor(() => findMenu("Asesment IGD 2"), "Pilihan Asesment IGD 2 tidak ditemukan.");
    child.click();
    await waitFor(() => findHeading("Asesment IGD 2") && findButton("Tambah"), "Halaman Asesment IGD 2 tidak siap.");
    findButton("Tambah").click();
    await waitFor(assessmentDiagnosisField, "Kolom Diagnosa Kerja tidak ditemukan.");

    const before = instructionRows().length;
    const addInstruction = await waitFor(instructionAddButton, "Tombol Tambah instruksi dokter tidak ditemukan.");
    if (!addInstruction) throw new Error("Tombol Tambah instruksi dokter tidak ditemukan.");
    addInstruction.click();
    const rows = await waitFor(() => instructionRows().length > before ? instructionRows() : null, "Baris Instruksi Dokter tidak berhasil ditambahkan.");
    const emptyIndex = rows.map((row) => row.querySelector("textarea")?.value.trim()).lastIndexOf("");
    const planningIndex = emptyIndex >= 0 ? emptyIndex : rows.length - 1;
    await sleep(500);
    const planning = await fillStableAssessment(valueA, valueP, planningIndex);
    planning.scrollIntoView({ behavior: "smooth", block: "center" });
    planning.focus();
  }

  function setStep(index, state) {
    currentStep = index;
    ui.steps.forEach((step, stepIndex) => {
      const nextState = stepIndex < index ? "done" : stepIndex === index ? state : "pending";
      step.dataset.state = nextState;
      step.querySelector("small").textContent = nextState === "done" ? "Selesai" : nextState === "active" ? "Sedang berjalan" : nextState === "error" ? "Gagal" : "Menunggu";
      if (nextState === "active") step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    ui.status.dataset.state = state === "error" ? "error" : "loading";
    ui.status.textContent = state === "error" ? `Proses berhenti pada: ${STEP_LABELS[index]}` : STEP_LABELS[index];
  }

  function resetModal() {
    currentStep = -1;
    savedSections = [];
    ui.form.hidden = false;
    ui.stepsWrap.hidden = true;
    ui.status.hidden = true;
    ui.error.hidden = true;
    ui.generate.disabled = false;
    ui.generate.querySelector("span").textContent = "Generate";
    ui.cancel.disabled = false;
    ui.cancel.textContent = "Batal";
    ui.patientStatus.querySelector('input[value="rawat_inap"]').checked = true;
    ui.steps.forEach((step) => {
      step.dataset.state = "pending";
      step.querySelector("small").textContent = "Menunggu";
      step.removeAttribute("aria-current");
    });
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "netmedic-rsdkh-soap-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.append(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 220);
    }, 6000);
  }

  function validateSoapParts(value) {
    const soap = value && typeof value === "object" ? value : {};
    const result = Object.fromEntries(["s", "o", "a", "p"].map((key) => [key, String(soap[key] || "").trim()]));
    const missing = Object.entries(result).filter(([, text]) => !text).map(([key]) => key.toUpperCase());
    if (missing.length) throw new Error(`Bagian ${missing.join(", ")} belum berisi hasil.`);
    return result;
  }

  async function fillSoapParts(soap, patientStatus) {
    diagnosisTypeFor(patientStatus);
    setStep(1, "active");
    await fillAnamnesis(soap.s);
    setStep(2, "active");
    await fillPhysicalExam(soap.o);
    setStep(3, "active");
    await fillDiagnosis(soap.a, patientStatus);
    setStep(4, "active");
    await fillAssessment(soap.a, soap.p);
    ui.steps.forEach((step) => {
      step.dataset.state = "done";
      step.querySelector("small").textContent = "Selesai";
      step.removeAttribute("aria-current");
    });
  }

  async function importSoapPartsFromSidePanel(value, expectedIdentity, patientStatus) {
    if (running) throw new Error("Input SOAP lain masih berjalan.");
    if (!isErmPage()) throw new Error("Halaman aktif bukan eRM pasien.");
    const expected = identityFacts(expectedIdentity);
    const current = identityFacts(getCurrentPatientIdentity());
    if (!expected || !current) throw new Error("Identitas pasien tidak dapat diverifikasi pada eRM aktif.");
    if (expected.age !== current.age || expected.gender !== current.gender) {
      throw new Error("Umur atau jenis kelamin pasien eRM aktif berbeda dari identitas side panel.");
    }
    createUi();
    resetModal();
    if (ui.dialog.open) ui.dialog.close();
    const soap = validateSoapParts(value);
    running = true;
    try {
      await fillSoapParts(soap, patientStatus);
      showToast("SOAP selesai diinput. Periksa Asesment IGD 2, lalu simpan secara manual.");
      return { ok: true };
    } catch (error) {
      setStep(Math.max(currentStep, 0), "error");
      const detail = savedSections.length
        ? `${error.message} ${savedSections.join(" dan ")} sudah tersimpan. Periksa eRM sebelum mencoba kembali.`
        : error.message;
      showToast(`Input SOAP berhenti: ${detail}`);
      throw new Error(detail);
    } finally {
      running = false;
    }
  }

  async function runSoapImport(event) {
    event.preventDefault();
    if (running) return;
    const soapText = ui.textarea.value.trim();
    const patientStatus = ui.patientStatus.querySelector("input:checked")?.value;
    if (!soapText) {
      ui.error.hidden = false;
      ui.error.textContent = "Tempel SOAP terlebih dahulu.";
      ui.textarea.focus();
      return;
    }

    running = true;
    ui.form.hidden = true;
    ui.stepsWrap.hidden = false;
    ui.status.hidden = false;
    ui.error.hidden = true;
    ui.generate.disabled = true;
    ui.generate.querySelector("span").textContent = "Memproses...";
    ui.cancel.disabled = true;

    try {
      setStep(0, "active");
      const response = await chrome.runtime.sendMessage({ type: "rsdkh:parse-soap", soapText });
      if (!response?.ok) throw new Error(response?.error || "AI gagal memilah SOAP.");

      await fillSoapParts(validateSoapParts(response.result), patientStatus);
      ui.textarea.value = "";
      ui.dialog.close();
      showToast("SOAP selesai diinput. Periksa Asesment IGD 2, lalu simpan secara manual.");
    } catch (error) {
      setStep(Math.max(currentStep, 0), "error");
      ui.error.hidden = false;
      ui.error.textContent = savedSections.length
        ? `${error.message} ${savedSections.join(" dan ")} sudah tersimpan. Periksa eRM sebelum mencoba kembali.`
        : error.message;
      ui.cancel.disabled = false;
      ui.cancel.textContent = "Tutup";
      ui.cancel.focus();
    } finally {
      running = false;
    }
  }

  function createUi() {
    if (ui) return ui;
    const host = document.createElement("div");
    host.id = UI_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <link rel="stylesheet" href="${chrome.runtime.getURL("hospital/rsdkh/erm.css")}">
      <dialog class="soap-dialog" aria-labelledby="soap-dialog-title">
        <form class="soap-shell" method="dialog">
          <header class="soap-header">
            <span class="soap-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M9 5h6M9 9h6M9 13h3M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg>
            </span>
            <div><p>NETMEDIC RSDKH</p><h2 id="soap-dialog-title">Input SOAP otomatis</h2></div>
          </header>
          <div class="soap-form">
            <fieldset class="soap-patient-status">
              <legend>Rencana status pasien?</legend>
              <label><input type="radio" name="patientStatus" value="rawat_jalan" required><span>Rawat jalan</span></label>
              <label><input type="radio" name="patientStatus" value="rawat_inap" required checked><span>Rawat inap</span></label>
            </fieldset>
            <label for="rsdkh-soap-source">Copy paste SOAP-mu ke sini</label>
            <textarea id="rsdkh-soap-source" rows="10" required placeholder="S: ...&#10;O: ...&#10;A: ...&#10;P: ..."></textarea>
            <p class="soap-privacy">SOAP dikirim ke provider API yang aktif. Anamnesis, Pemeriksaan Fisik, dan Diagnosis disimpan otomatis; Asesment IGD 2 ditinjau sebelum disimpan manual.</p>
          </div>
          <section class="soap-progress" hidden aria-label="Progres input SOAP">
            <ol>${STEP_LABELS.map((label, index) => `<li data-state="pending"><span>${index + 1}</span><p>${label}</p><small>Menunggu</small></li>`).join("")}</ol>
          </section>
          <p class="soap-status" hidden role="status" aria-live="polite"></p>
          <p class="soap-error" hidden role="alert"></p>
          <footer class="soap-actions">
            <button type="button" class="secondary soap-cancel">Batal</button>
            <button type="submit" class="primary soap-generate"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m13 2-1 7h7l-8 13 1-8H5l8-12Z"/></svg><span>Generate</span></button>
          </footer>
        </form>
      </dialog>`;
    document.documentElement.append(host);

    const dialog = shadow.querySelector("dialog");
    ui = {
      dialog,
      form: shadow.querySelector(".soap-form"),
      patientStatus: shadow.querySelector(".soap-patient-status"),
      textarea: shadow.querySelector("textarea"),
      stepsWrap: shadow.querySelector(".soap-progress"),
      steps: [...shadow.querySelectorAll(".soap-progress li")],
      status: shadow.querySelector(".soap-status"),
      error: shadow.querySelector(".soap-error"),
      generate: shadow.querySelector(".soap-generate"),
      cancel: shadow.querySelector(".soap-cancel")
    };
    shadow.querySelector("form").addEventListener("submit", runSoapImport);
    ui.cancel.addEventListener("click", () => dialog.close());
    dialog.addEventListener("cancel", (event) => { if (running) event.preventDefault(); });
    return ui;
  }

  function openModal() {
    createUi();
    resetModal();
    ui.dialog.showModal();
    ui.textarea.focus();
  }

  function injectButton() {
    injectQueued = false;
    if (!isErmPage()) {
      document.getElementById(SLOT_ID)?.remove();
      return;
    }
    const menu = findMenu("Riwayat Registrasi")?.closest("ul.p-menubar-root-list");
    if (!menu) return;

    let slot = document.getElementById(SLOT_ID);
    if (!slot) {
      slot = document.createElement("li");
      slot.id = SLOT_ID;
      slot.className = "p-menuitem netmedic-rsdkh-soap-slot";
      slot.setAttribute("role", "none");

      const button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-label", "Input SOAP otomatis");
      button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 5h6M9 9h6M9 13h3M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg><span>Input SOAP</span>`;
      button.addEventListener("click", openModal);
      slot.append(button);
    }

    if (menu.firstElementChild !== slot) menu.prepend(slot);
  }

  function queueInject() {
    if (injectQueued) return;
    injectQueued = true;
    requestAnimationFrame(injectButton);
  }

  if (typeof module !== "undefined") {
    module.exports = { diagnosisTypeFor, isReportMedicalRecord, isReportPatientName };
    if (require.main === module) {
      const assert = require("node:assert/strict");
      assert.equal(diagnosisTypeFor("rawat_inap"), "Diagnosa Awal");
      assert.equal(diagnosisTypeFor("rawat_jalan"), "Primary / utama");
      assert.throws(() => diagnosisTypeFor(""), /belum dipilih/);
      assert.equal(isReportMedicalRecord("051462"), true);
      assert.equal(isReportMedicalRecord("2608000067"), false);
      assert.equal(isReportMedicalRecord("1978"), false);
      assert.equal(isReportPatientName("SALIMUDDIN"), true);
      assert.equal(isReportPatientName("INFO REGISTRASI"), false);
      assert.equal(isReportPatientName("A09.9 - GEA/DIARRHEA"), false);
      console.log("RSDKH eRM self-check ok");
    }
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "rsdkh:get-current-patient-identity") {
      const identity = getCurrentPatientIdentity();
      sendResponse(identity ? { ok: true, identity } : { ok: false });
      return false;
    }
    if (message?.type === "rsdkh:get-current-patient-report-identity") {
      const identity = getCurrentPatientReportIdentity();
      sendResponse(identity
        ? { ok: true, identity }
        : { ok: false, error: "Nama, jenis kelamin, umur, atau nomor RM tidak ditemukan pada header pasien." });
      return false;
    }
    if (message?.type === "rsdkh:input-soap-parts") {
      importSoapPartsFromSidePanel(message.soap, message.identity, message.patientStatus)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message || "Input SOAP gagal." }));
      return true;
    }
    return false;
  });

  new MutationObserver(queueInject).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("hashchange", queueInject);
  queueInject();
})();
