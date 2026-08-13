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

  async function selectDiagnosisType() {
    const label = await waitFor(() => findLabel("Jenis Diagnosa"), "Dropdown Jenis Diagnosa tidak ditemukan.");
    const dropdown = label.parentElement.querySelector(".p-dropdown");
    if (!dropdown) throw new Error("Dropdown Jenis Diagnosa tidak siap.");
    dropdown.click();
    const option = await waitFor(() => [...document.querySelectorAll(".p-dropdown-item,[role='option']")]
      .find((element) => isVisible(element) && normalize(element.textContent) === "Diagnosa Awal"), "Pilihan Diagnosa Awal tidak ditemukan.");
    option.click();
  }

  async function fillDiagnosis(value) {
    await clickMenu("Diagnosis", () => findHeading("Diagnosis") && findLabel("Diagnosa Medis"));
    await selectDiagnosisType();
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

  async function runSoapImport(event) {
    event.preventDefault();
    if (running) return;
    const soapText = ui.textarea.value.trim();
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

      setStep(1, "active");
      await fillAnamnesis(response.result.s);
      setStep(2, "active");
      await fillPhysicalExam(response.result.o);
      setStep(3, "active");
      await fillDiagnosis(response.result.a);
      setStep(4, "active");
      await fillAssessment(response.result.a, response.result.p);
      ui.steps.forEach((step) => {
        step.dataset.state = "done";
        step.querySelector("small").textContent = "Selesai";
        step.removeAttribute("aria-current");
      });
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
    if (document.getElementById(BUTTON_ID)) return;
    const allergy = [...document.querySelectorAll("button")]
      .find((button) => normalize(button.textContent) === "Alergi");
    if (!allergy?.parentElement) return;

    const slot = document.createElement("div");
    slot.id = SLOT_ID;
    slot.className = "netmedic-rsdkh-soap-slot";
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.setAttribute("aria-label", "Input SOAP otomatis");
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 5h6M9 9h6M9 13h3M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg><span>Input SOAP</span>`;
    button.addEventListener("click", openModal);
    slot.append(button);
    allergy.parentElement.insertAdjacentElement("afterend", slot);
  }

  function queueInject() {
    if (injectQueued) return;
    injectQueued = true;
    requestAnimationFrame(injectButton);
  }

  new MutationObserver(queueInject).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("hashchange", queueInject);
  queueInject();
})();
