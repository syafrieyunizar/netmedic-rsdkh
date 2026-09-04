(() => {
  "use strict";

  const BUTTON_ID = "netmedic-rsdkh-input-soap";
  const SLOT_ID = `${BUTTON_ID}-slot`;
  const UI_ID = `${BUTTON_ID}-ui`;
  const RESUME_BUTTON_ID = "netmedic-rsdkh-resume-ai";
  const RESUME_SLOT_ID = `${RESUME_BUTTON_ID}-slot`;
  const RESUME_UNDO_CLASS = "netmedic-rsdkh-resume-undo";
  const ICD9_BUTTON_ID = "netmedic-rsdkh-icd9-quick";
  const ICD9_SLOT_ID = `${ICD9_BUTTON_ID}-slot`;
  const ICD9_UI_ID = `${ICD9_BUTTON_ID}-ui`;
  const ICD9_GROUPS = [
    { label: "Penunjang", items: [
      { id: "ekg", label: "EKG", value: "EKG" },
      { id: "lab-darah", label: "Lab darah", value: "Pemeriksaan laboratorium darah", aliases: ["lab", "pemeriksaan darah"] },
      { id: "cek-ul", label: "Cek UL", value: "Pemeriksaan urinalisis", aliases: ["urinalisis", "cek urine"] },
      { id: "foto-thorax", label: "Foto thorax", value: "Foto thorax", aliases: ["rontgen", "rontgen thorax", "rontgen thorax ap"] },
      { id: "usg-fast", label: "USG/FAST", value: "USG/FAST", aliases: ["usg", "fast"] },
      { id: "ct-scan", label: "CT Scan", value: "CT Scan" }
    ] },
    { label: "Pernapasan", items: [
      { id: "oksigen", label: "Oksigen", value: "Oksigen" },
      { id: "nebul", label: "Nebul", value: "Nebulisasi", aliases: ["nebul"] },
      { id: "suction", label: "Suction", value: "Suction" }
    ] },
    { label: "Resusitasi", items: [
      { id: "rjp", label: "RJP", value: "RJP" },
      { id: "intubasi", label: "Intubasi", value: "Intubasi" },
      { id: "venti", label: "Venti", value: "Ventilator", aliases: ["venti"] }
    ] },
    { label: "Obat/Terapi", items: [
      { id: "infus", label: "Infus", value: "Infus" },
      { id: "injeksi-obat", label: "Inj. obat", value: "Injeksi obat", aliases: ["inj obat"] },
      { id: "injeksi-antibiotik", label: "Inj. antibiotik", value: "Injeksi antibiotik", aliases: ["inj antibiotik"] },
      { id: "vasopresor", label: "Vasopresor", value: "Vasopresor", aliases: ["vasopressor"] },
      { id: "fibrinolitik", label: "Fibrinolitik", value: "Fibrinolitik" },
      { id: "prc", label: "PRC", value: "Transfusi PRC", aliases: ["prc"] },
      { id: "albumin", label: "Albumin", value: "Pemberian albumin", aliases: ["albumin", "transfusi albumin"] }
    ] },
    { label: "Tindakan", items: [
      { id: "dc", label: "DC", value: "Pemasangan DC", aliases: ["dc"] },
      { id: "ngt", label: "NGT", value: "Pemasangan NGT", aliases: ["ngt"] },
      { id: "hecting", label: "Hecting", value: "Hecting", aliases: ["penjahitan luka"] },
      { id: "dressing", label: "Dressing", value: "Dressing", aliases: ["perawatan luka"] },
      { id: "debridement", label: "Debridement", value: "Debridement" },
      { id: "ekstraksi-corpal", label: "Ekstraksi Corpal", value: "Ekstraksi Corpal" }
    ] }
  ];
  const ICD9_ITEMS = ICD9_GROUPS.flatMap((group) => group.items);
  const STEP_LABELS = [
    "Memilah S, O, A, dan P",
    "Mengisi Anamnesa",
    "Mengisi Pemeriksaan Fisik",
    "Mengisi Diagnosis free-text",
    "Mengisi Planning"
  ];

  let ui;
  let icd9Ui;
  let running = false;
  let resumeRunning = false;
  let icd9Saving = false;
  let currentStep = -1;
  let diagnosisSaved = false;
  let injectQueued = false;
  let forcedTabTitle = "";
  let forcedPatientMedicalRecord = "";
  let originalTabTitle = "";
  let lastAssessmentReport = "";

  const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ");
  const isVisible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function assessmentStateFromValues(pageReady, values) {
    if (!pageReady) return "unknown";
    const meaningful = (values || []).some((value) => {
      const text = normalize(value);
      return text && !/^(?:-|tidak ada data|data tidak ditemukan|no data|no records)$/i.test(text);
    });
    return meaningful ? "complete" : "empty";
  }

  function isErmPage() {
    return location.hash.startsWith("#/rekam-medis/");
  }

  function isDoctorAssessmentPage() {
    return isErmPage() && Boolean(findHeading("Pengkajian Dokter IGD"));
  }

  function isResumePage() {
    return isErmPage() && location.hash.includes("/resume-new");
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
    const name = text.replace(/\s*[.,]?\s*(?:Tn|Ny|Nn|An|By|Sdr)\.?$/i, "").trim();
    const excluded = /^(?:BPJS\b|JKN\b|PBI\b|NON PBI\b|UMUM\b|PEGAWAI SWASTA\b|INFO REGISTRASI|GAWAT DARURAT|PLAFON|TAGIHAN|ALERGI|WEIGHT|HEIGHT|NON KELAS|I-CARE)/i;
    return name.length >= 3
      && text.length <= 60
      && /[A-Z]/.test(name)
      && !/\d/.test(name)
      && name === name.toLocaleUpperCase("id-ID")
      && !excluded.test(name);
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

    const nameSpans = [...scope.querySelectorAll("span")]
      .filter((element) => isVisible(element) && !element.children.length && isReportPatientName(element.textContent));
    const names = nameSpans.length ? nameSpans : leaves.filter((element) => isReportPatientName(element.textContent));
    let demographicScope = age.parentElement;
    let name = null;
    while (demographicScope && scope.contains(demographicScope)) {
      const nearbyNames = names.filter((element) => demographicScope.contains(element));
      if (nearbyNames.length) {
        name = nearbyNames[0];
        break;
      }
      if (demographicScope === scope) break;
      demographicScope = demographicScope.parentElement;
    }
    name = name
      || names.filter((element) => element.compareDocumentPosition(medicalRecord) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1)
      || names[0];
    if (!name) return null;

    return {
      name: normalize(name.textContent),
      gender: normalize(gender.textContent),
      age: normalize(age.textContent).replace(/\bthn\b/i, "tahun"),
      medicalRecordNumber: normalize(medicalRecord.textContent)
    };
  }

  function setForcedPatientTabTitle(title, medicalRecordNumber) {
    const nextTitle = normalize(title);
    const previousTitle = forcedTabTitle;
    if (nextTitle && !previousTitle) originalTabTitle = document.title;
    forcedTabTitle = nextTitle;
    forcedPatientMedicalRecord = normalize(medicalRecordNumber);
    if (nextTitle) document.title = nextTitle;
    else if (previousTitle && document.title === previousTitle) document.title = originalTabTitle || "Netmedic";
  }

  function enforcePatientTabTitle() {
    if (!forcedTabTitle) return;
    if (!isErmPage()) {
      setForcedPatientTabTitle("", "");
      return;
    }
    const patient = getCurrentPatientReportIdentity();
    if (patient && patient.medicalRecordNumber !== forcedPatientMedicalRecord) {
      setForcedPatientTabTitle("", "");
      return;
    }
    if (document.title !== forcedTabTitle) document.title = forcedTabTitle;
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
    const marker = findLabel(label, scope);
    return marker?.parentElement?.querySelector("textarea,input")
      || marker?.closest(".p-col-12")?.querySelector("textarea,input")
      || null;
  }

  function resumeRoot() {
    return isResumePage() ? document.querySelector("app-resume-new") : null;
  }

  function resumeFields() {
    const root = resumeRoot();
    if (!root) return null;
    const historyField = (suffix) => root.querySelector(`input[id$='${suffix}']`)
      ?.closest(".p-col-12,[class*='p-col']")
      ?.querySelector("textarea") || null;
    return {
      lab: historyField("riwLab"),
      radiology: historyField("riwRad"),
      therapy: fieldByLabel("Terapi pengobatan selama di rumah sakit", root)
    };
  }

  function resumeProgressStage(seconds) {
    return ["Merapikan laboratorium", "Merapikan radiologi", "Merapikan terapi"]
      [Math.min(2, Math.max(1, seconds) - 1)];
  }

  function panelByTitle(title) {
    const marker = [...document.querySelectorAll(".p-panel-title")]
      .find((element) => isVisible(element) && normalize(element.textContent) === title);
    return marker?.closest(".p-panel") || marker?.closest("p-panel") || null;
  }

  const icd9ActionKey = (value) => normalize(value).toLocaleLowerCase("id-ID").replace(/[.]/g, "");

  function splitIcd9Actions(value) {
    return String(value || "").split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
  }

  function findIcd9Item(value) {
    const key = icd9ActionKey(value);
    return ICD9_ITEMS.find((item) => [item.label, item.value, ...(item.aliases || [])]
      .some((alias) => icd9ActionKey(alias) === key));
  }

  function mergeIcd9Actions(existing, selectedIds) {
    const values = splitIcd9Actions(existing);
    const seen = new Set(values.map((value) => findIcd9Item(value)?.id || icd9ActionKey(value)));
    for (const item of ICD9_ITEMS.filter(({ id }) => selectedIds.includes(id))) {
      if (seen.has(item.id)) continue;
      values.push(item.value);
      seen.add(item.id);
    }
    return values.join(", ");
  }

  function icd9Panel() {
    return panelByTitle("ICD (9) FreeText");
  }

  function createIcd9Ui() {
    if (icd9Ui) return icd9Ui;
    const host = document.createElement("div");
    host.id = ICD9_UI_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <link rel="stylesheet" href="${chrome.runtime.getURL("hospital/rsdkh/erm.css")}">
      <dialog class="soap-dialog icd9-dialog" aria-labelledby="icd9-dialog-title">
        <form class="soap-shell icd9-shell" method="dialog">
          <header class="soap-header icd9-header">
            <div><p>ICD 9 CEPAT</p><h2 id="icd9-dialog-title">Pilih tindakan</h2></div>
            <button type="button" class="icd9-close" aria-label="Tutup"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="icd9-groups">
            ${ICD9_GROUPS.map((group) => `
              <section><h3>${group.label}</h3><div class="icd9-chips">
                ${group.items.map((item) => `<button type="button" class="icd9-chip" data-id="${item.id}" aria-pressed="false"><span>${item.label}</span><b aria-hidden="true">&#10003;</b></button>`).join("")}
              </div></section>`).join("")}
          </div>
          <p class="soap-error icd9-error" hidden role="alert"></p>
          <footer class="soap-actions icd9-actions">
            <button type="button" class="secondary icd9-cancel">Batal</button>
            <button type="submit" class="primary icd9-submit">Masukkan ICD 9</button>
          </footer>
        </form>
      </dialog>`;
    document.documentElement.append(host);

    const dialog = shadow.querySelector("dialog");
    icd9Ui = {
      dialog,
      chips: [...shadow.querySelectorAll(".icd9-chip")],
      error: shadow.querySelector(".icd9-error"),
      submit: shadow.querySelector(".icd9-submit"),
      cancel: shadow.querySelector(".icd9-cancel"),
      close: shadow.querySelector(".icd9-close")
    };
    icd9Ui.chips.forEach((chip) => chip.addEventListener("click", () => {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
      icd9Ui.error.hidden = true;
    }));
    shadow.querySelector("form").addEventListener("submit", runIcd9Import);
    const close = () => { if (!icd9Saving) dialog.close(); };
    icd9Ui.cancel.addEventListener("click", close);
    icd9Ui.close.addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => { if (icd9Saving) event.preventDefault(); });
    return icd9Ui;
  }

  async function openIcd9Modal() {
    const panel = icd9Panel();
    if (panel?.querySelector(".p-panel-toggler[aria-expanded='false']")) {
      panel.querySelector(".p-panel-toggler").click();
    }
    const field = panel && await waitFor(() => fieldByLabel("Diagnosa Tindakan", panel), "Kolom Diagnosa Tindakan belum tersedia.", 3000).catch(() => null);
    if (!field) {
      showToast("Kolom Diagnosa Tindakan belum tersedia.");
      return;
    }
    createIcd9Ui();
    const selected = new Set(splitIcd9Actions(field.value).map((value) => findIcd9Item(value)?.id).filter(Boolean));
    icd9Ui.chips.forEach((chip) => chip.setAttribute("aria-pressed", String(selected.has(chip.dataset.id))));
    icd9Ui.error.hidden = true;
    icd9Ui.submit.disabled = false;
    icd9Ui.submit.textContent = "Masukkan ICD 9";
    if (icd9Ui.dialog.open) return;
    icd9Ui.dialog.showModal();
    icd9Ui.chips[0]?.focus();
  }

  async function runIcd9Import(event) {
    event.preventDefault();
    if (icd9Saving) return;
    const selectedIds = icd9Ui.chips
      .filter((chip) => chip.getAttribute("aria-pressed") === "true")
      .map((chip) => chip.dataset.id);
    if (!selectedIds.length) {
      icd9Ui.error.hidden = false;
      icd9Ui.error.textContent = "Pilih sedikitnya satu tindakan.";
      return;
    }

    try {
      const panel = icd9Panel();
      const field = panel && fieldByLabel("Diagnosa Tindakan", panel);
      const save = panel && findButton("Simpan", panel);
      if (!field || !save) throw new Error("Kolom atau tombol Simpan ICD 9 tidak ditemukan.");
      const value = mergeIcd9Actions(field.value, selectedIds);
      const beforeRows = panel.querySelectorAll("tbody tr").length;
      icd9Saving = true;
      icd9Ui.submit.disabled = true;
      icd9Ui.submit.textContent = "Menyimpan...";
      icd9Ui.error.hidden = true;
      setControlValue(field, value);
      await sleep(120);
      save.click();
      await waitFor(() => {
        const currentPanel = icd9Panel();
        const currentField = currentPanel && fieldByLabel("Diagnosa Tindakan", currentPanel);
        return Boolean(currentPanel && (
          currentPanel.querySelectorAll("tbody tr").length > beforeRows
          || (currentField && !currentField.value.trim())
        ));
      }, "eRM belum mengonfirmasi penyimpanan ICD 9.", 10000);
      icd9Ui.dialog.close();
      showToast("Tindakan ICD 9 berhasil disimpan.");
    } catch (error) {
      icd9Ui.error.hidden = false;
      icd9Ui.error.textContent = error.message || "Tindakan ICD 9 gagal disimpan.";
      icd9Ui.submit.disabled = false;
      icd9Ui.submit.textContent = "Coba lagi";
    } finally {
      icd9Saving = false;
    }
  }

  async function fillAnamnesis(value) {
    const field = await waitFor(() => fieldByLabel("Anamnesa"), "Kolom Anamnesa tidak ditemukan.");
    setControlValue(field, value);
  }

  async function fillPhysicalExam(value) {
    const field = await waitFor(() => fieldByLabel("Pemeriksaan Fisik"), "Kolom Pemeriksaan Fisik tidak ditemukan.");
    setControlValue(field, value);
  }

  function diagnosisTypeFor(patientStatus) {
    if (patientStatus === "rawat_jalan") return "Primary / utama";
    if (patientStatus === "rawat_inap") return "Diagnosa Awal";
    throw new Error("Rencana status pasien belum dipilih.");
  }

  async function selectDiagnosisType(patientStatus, panel) {
    const diagnosisType = diagnosisTypeFor(patientStatus);
    const label = await waitFor(() => findLabel("Jenis Diagnosa", panel), "Dropdown Jenis Diagnosa tidak ditemukan.");
    const dropdown = label.parentElement.querySelector(".p-dropdown");
    if (!dropdown) throw new Error("Dropdown Jenis Diagnosa tidak siap.");
    dropdown.click();
    const option = await waitFor(() => [...document.querySelectorAll(".p-dropdown-item,[role='option']")]
      .find((element) => isVisible(element) && normalize(element.textContent) === diagnosisType), `Pilihan ${diagnosisType} tidak ditemukan.`);
    option.click();
    await waitFor(() => {
      const currentPanel = panelByTitle("ICD 10 FreeText");
      const currentLabel = currentPanel && findLabel("Jenis Diagnosa", currentPanel);
      return normalize(currentLabel?.parentElement?.querySelector(".p-dropdown")?.textContent).includes(diagnosisType);
    }, `Pilihan ${diagnosisType} belum diterapkan.`);
  }

  async function fillDiagnosis(value, patientStatus) {
    const panel = await waitFor(() => panelByTitle("ICD 10 FreeText"), "Panel ICD 10 FreeText tidak ditemukan.");
    await selectDiagnosisType(patientStatus, panel);
    const field = await waitFor(() => fieldByLabel("Diagnosa Medis", panelByTitle("ICD 10 FreeText")), "Kolom Diagnosa Medis tidak ditemukan.");
    setControlValue(field, value);
    const beforeRows = panelByTitle("ICD 10 FreeText")?.querySelectorAll("tbody tr").length || 0;
    const save = findButton("Simpan", panelByTitle("ICD 10 FreeText"));
    if (!save) throw new Error("Tombol Simpan pada ICD 10 FreeText tidak ditemukan.");
    save.click();
    await waitFor(() => {
      const currentPanel = panelByTitle("ICD 10 FreeText");
      const currentField = currentPanel && fieldByLabel("Diagnosa Medis", currentPanel);
      return Boolean(currentPanel && (currentPanel.querySelectorAll("tbody tr").length > beforeRows || !currentField?.value.trim()));
    }, "Diagnosis belum berhasil disimpan.");
    diagnosisSaved = true;
  }

  function planningTable() {
    return [...document.querySelectorAll("p-table")].find((table) => (
      [...table.querySelectorAll("th")]
        .some((header) => /^(?:instruksi|intruksi) dokter$/i.test(normalize(header.textContent)))
    )) || null;
  }

  function instructionRows() {
    const table = planningTable();
    if (!table) return [];
    return [...table.querySelectorAll("tbody tr")].filter((row) => (
      isVisible(row)
      && row.querySelector("textarea")
      && row.querySelector('input[placeholder="Perawat"]')
    ));
  }

  function currentAssessmentIgdState() {
    const heading = findHeading("Pengkajian Dokter IGD");
    if (!heading) return "unknown";
    const scope = heading.closest("app-pengkajian-dokter-igd") || heading.closest(".card-w-title") || document;
    const textareas = [...scope.querySelectorAll("textarea")]
      .filter(isVisible)
      .map((field) => field.value);
    const savedRows = [...scope.querySelectorAll("tbody tr")]
      .filter((row) => isVisible(row) && !row.querySelector("textarea,input"))
      .map((row) => row.innerText);
    return assessmentStateFromValues(true, [...textareas, ...savedRows]);
  }

  function reportAssessmentIgdState() {
    const patient = getCurrentPatientReportIdentity();
    const assessmentState = currentAssessmentIgdState();
    if (!patient || assessmentState === "unknown") return;
    const signature = `${patient.medicalRecordNumber}:${assessmentState}`;
    if (signature === lastAssessmentReport) return;
    lastAssessmentReport = signature;
    chrome.runtime.sendMessage({
      type: "rsdkh:assessment-status-observed",
      medicalRecordNumber: patient.medicalRecordNumber,
      assessmentState
    }).catch(() => {
      if (lastAssessmentReport === signature) lastAssessmentReport = "";
    });
  }

  function planningAddButton() {
    const scope = planningTable()?.parentElement;
    return scope ? findButton("Tambah", scope) : null;
  }

  async function fillStablePlanning(value, planningIndex) {
    const getPlanning = () => instructionRows()[planningIndex]?.querySelector("textarea") || null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const planning = await waitFor(getPlanning, "Kolom Instruksi Dokter tidak ditemukan.");
      if (planning.value !== value) setControlValue(planning, value);
      await sleep(650);

      if (getPlanning()?.value === value) return getPlanning();
    }

    throw new Error("Isi Planning berubah setelah diisi. Silakan coba lagi.");
  }

  async function fillPlanning(value) {
    await waitFor(planningTable, "Tabel Instruksi Dokter tidak ditemukan.");
    let rows = instructionRows();
    let planningIndex = rows.map((row) => row.querySelector("textarea")?.value.trim()).lastIndexOf("");
    if (planningIndex < 0) {
      const before = rows.length;
      const addInstruction = await waitFor(planningAddButton, "Tombol Tambah Planning tidak ditemukan.");
      addInstruction.click();
      rows = await waitFor(() => instructionRows().length > before ? instructionRows() : null, "Baris Planning tidak berhasil ditambahkan.");
      planningIndex = rows.map((row) => row.querySelector("textarea")?.value.trim()).lastIndexOf("");
      if (planningIndex < 0) planningIndex = rows.length - 1;
    }
    const planning = await fillStablePlanning(value, planningIndex);
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
    diagnosisSaved = false;
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

  function setResumeProgress(button, percent, status) {
    button.style.setProperty("--resume-progress", `${percent}%`);
    const detail = button.querySelector("small");
    detail.hidden = !status;
    detail.textContent = status;
  }

  function addResumeUndo(field, original, label) {
    const container = field.closest(".p-col-12,[class*='p-col']") || field.parentElement;
    container?.querySelector(`.${RESUME_UNDO_CLASS}`)?.remove();
    const button = document.createElement("button");
    button.type = "button";
    button.className = RESUME_UNDO_CLASS;
    button.title = `Kembalikan ${label} ke isi sebelum dirapikan`;
    button.setAttribute("aria-label", button.title);
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`;
    button.addEventListener("click", () => {
      if (!field.isConnected) return;
      setControlValue(field, original);
      button.remove();
      showToast(`${label} dikembalikan ke isi sebelum dirapikan.`);
    });
    field.insertAdjacentElement("beforebegin", button);
  }

  async function runResumeSummary(event) {
    const button = event.currentTarget;
    if (resumeRunning || running) return;
    const fields = resumeFields();
    if (!fields || Object.values(fields).some((field) => !field)) {
      showToast("Kolom penunjang atau terapi pada Resume Medis tidak ditemukan.");
      return;
    }
    const source = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value.trim()]));
    if (!Object.values(source).some(Boolean)) {
      showToast("Laboratorium, radiologi, dan terapi masih kosong.");
      return;
    }

    resumeRunning = true;
    button.disabled = true;
    button.dataset.loading = "true";
    button.setAttribute("aria-busy", "true");
    setResumeProgress(button, 6, "Merapikan laboratorium...");
    let seconds = 0;
    let completed = false;
    const timer = setInterval(() => {
      seconds += 1;
      setResumeProgress(button, Math.min(92, 8 + seconds * 4), `${resumeProgressStage(seconds)}... ${seconds}s`);
    }, 1000);

    try {
      const [response] = await Promise.all([
        chrome.runtime.sendMessage({ type: "rsdkh:summarize-resume", sections: source }),
        sleep(3100)
      ]);
      if (!response?.ok) throw new Error(response?.error || "AI gagal merapikan Resume Medis.");
      const labels = { lab: "Laboratorium", radiology: "Radiologi", therapy: "Terapi" };
      for (const [key, field] of Object.entries(fields)) {
        const next = String(response.result?.[key] || "").trim();
        if (next === field.value.trim()) continue;
        const original = field.value;
        setControlValue(field, next);
        addResumeUndo(field, original, labels[key]);
      }
      completed = true;
      setResumeProgress(button, 100, `Selesai - ${Math.max(1, seconds)}s`);
      showToast("Laboratorium, radiologi, dan terapi sudah dirapikan. Tinjau hasil sebelum menyimpan Resume Medis.");
    } catch (error) {
      setResumeProgress(button, 0, "Gagal merapikan");
      showToast(error.message || "AI gagal merapikan Resume Medis.");
    } finally {
      clearInterval(timer);
      await sleep(completed ? 700 : 1200);
      if (button.isConnected) {
        button.disabled = false;
        button.dataset.loading = "false";
        button.removeAttribute("aria-busy");
        setResumeProgress(button, 0, "");
      }
      resumeRunning = false;
    }
  }

  function importErrorMessage(error) {
    const message = error?.message || "Input SOAP gagal.";
    return diagnosisSaved
      ? `${message} Diagnosis sudah tersimpan; periksa eRM sebelum mencoba kembali.`
      : message;
  }

  function validateSoapParts(value) {
    const soap = value && typeof value === "object" ? value : {};
    const result = Object.fromEntries(["s", "o", "a", "p"].map((key) => [key, String(soap[key] || "").trim()]));
    const missing = Object.entries(result).filter(([, text]) => !text).map(([key]) => key.toUpperCase());
    if (missing.length) throw new Error(`Bagian ${missing.join(", ")} belum berisi hasil.`);
    return result;
  }

  async function confirmSoapOverwrite() {
    await waitFor(isDoctorAssessmentPage, "Buka halaman Pengkajian Dokter IGD terlebih dahulu.");
    const diagnosisPanel = await waitFor(() => panelByTitle("ICD 10 FreeText"), "Panel ICD 10 FreeText tidak ditemukan.");
    const fields = [
      ["Anamnesa", fieldByLabel("Anamnesa")],
      ["Pemeriksaan Fisik", fieldByLabel("Pemeriksaan Fisik")],
      ["Diagnosa Medis", fieldByLabel("Diagnosa Medis", diagnosisPanel)]
    ];
    const filled = fields.filter(([, field]) => field?.value.trim()).map(([label]) => label);
    if (!filled.length) return true;
    return window.confirm(`${filled.join(", ")} sudah berisi data. Timpa isi tersebut dengan hasil SOAP?`);
  }

  async function fillSoapParts(soap, patientStatus) {
    diagnosisSaved = false;
    diagnosisTypeFor(patientStatus);
    if (!await confirmSoapOverwrite()) return false;
    setStep(1, "active");
    await fillAnamnesis(soap.s);
    setStep(2, "active");
    await fillPhysicalExam(soap.o);
    setStep(3, "active");
    await fillDiagnosis(soap.a, patientStatus);
    setStep(4, "active");
    await fillPlanning(soap.p);
    ui.steps.forEach((step) => {
      step.dataset.state = "done";
      step.querySelector("small").textContent = "Selesai";
      step.removeAttribute("aria-current");
    });
    return true;
  }

  async function importSoapPartsFromSidePanel(value, expectedIdentity, patientStatus) {
    if (running) throw new Error("Input SOAP lain masih berjalan.");
    if (!isErmPage()) throw new Error("Halaman aktif bukan eRM pasien.");
    await waitFor(isDoctorAssessmentPage, "Buka halaman Pengkajian Dokter IGD pasien terlebih dahulu.");
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
      if (!await fillSoapParts(soap, patientStatus)) {
        return { ok: false, cancelled: true, error: "Input SOAP dibatalkan. Isian eRM tidak diubah." };
      }
      showToast("Diagnosis tersimpan. Tinjau S, O, dan P lalu simpan Pengkajian Dokter IGD melalui eRM.");
      return { ok: true };
    } catch (error) {
      setStep(Math.max(currentStep, 0), "error");
      const detail = importErrorMessage(error);
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

      if (!await fillSoapParts(validateSoapParts(response.result), patientStatus)) {
        ui.form.hidden = false;
        ui.stepsWrap.hidden = true;
        ui.status.hidden = true;
        ui.error.hidden = false;
        ui.error.textContent = "Input SOAP dibatalkan. Isian eRM tidak diubah.";
        ui.generate.disabled = false;
        ui.generate.querySelector("span").textContent = "Generate";
        ui.cancel.disabled = false;
        ui.textarea.focus();
        return;
      }
      ui.textarea.value = "";
      ui.dialog.close();
      showToast("Diagnosis tersimpan. Tinjau S, O, dan P lalu simpan Pengkajian Dokter IGD melalui eRM.");
    } catch (error) {
      setStep(Math.max(currentStep, 0), "error");
      ui.error.hidden = false;
      ui.error.textContent = importErrorMessage(error);
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
            <p class="soap-privacy">SOAP dikirim ke provider API yang aktif lalu diisikan ke Pengkajian Dokter IGD. Diagnosis disimpan melalui ICD 10 FreeText; S, O, dan P tetap ditinjau sebelum Pengkajian disimpan melalui eRM.</p>
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
    const heading = findHeading("Pengkajian Dokter IGD");
    if (!isErmPage() || !heading) {
      document.getElementById(SLOT_ID)?.remove();
      return;
    }

    let slot = document.getElementById(SLOT_ID);
    if (slot?.tagName !== "SPAN") {
      slot?.remove();
      slot = document.createElement("span");
      slot.id = SLOT_ID;
      slot.className = "netmedic-rsdkh-soap-slot";

      const button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.setAttribute("aria-label", "Input SOAP otomatis");
      button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 5h6M9 9h6M9 13h3M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg><span>Input SOAP</span>`;
      button.addEventListener("click", openModal);
      slot.append(button);
    }

    heading.classList.add("netmedic-rsdkh-soap-heading");
    if (heading.nextElementSibling !== slot) heading.insertAdjacentElement("afterend", slot);
  }

  function injectResumeButton() {
    const slot = document.getElementById(RESUME_SLOT_ID);
    const fields = resumeFields();
    const target = fields?.lab?.closest(".p-col-12,[class*='p-col']");
    if (!target) {
      slot?.remove();
      return;
    }

    let nextSlot = slot;
    if (!nextSlot) {
      nextSlot = document.createElement("div");
      nextSlot.id = RESUME_SLOT_ID;
      nextSlot.className = "netmedic-rsdkh-resume-slot";
      const button = document.createElement("button");
      button.id = RESUME_BUTTON_ID;
      button.type = "button";
      button.dataset.loading = "false";
      button.innerHTML = `
        <span class="netmedic-rsdkh-resume-button-content">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9.5 4A2.5 2.5 0 0 0 7 6.5v.2a3 3 0 0 0-1.5 5.6 3 3 0 0 0 .5 5.4A2.5 2.5 0 0 0 9.5 20Z"/>
            <path d="M14.5 4A2.5 2.5 0 0 1 17 6.5v.2a3 3 0 0 1 1.5 5.6 3 3 0 0 1-.5 5.4 2.5 2.5 0 0 1-3.5 2.3Z"/>
            <path d="M12 5v14M7 16a3 3 0 0 0 3-3M17 16a3 3 0 0 1-3-3"/>
          </svg>
          <span>Rapikan Penunjang dan Terapi</span>
        </span>
        <small hidden aria-live="polite"></small>`;
      button.addEventListener("click", runResumeSummary);
      nextSlot.append(button);
    }
    if (target.previousElementSibling !== nextSlot) target.insertAdjacentElement("beforebegin", nextSlot);
  }

  function injectIcd9Button() {
    const slot = document.getElementById(ICD9_SLOT_ID);
    const panel = isDoctorAssessmentPage() && icd9Panel();
    const header = panel?.querySelector(".p-panel-header");
    const icons = header?.querySelector(".p-panel-icons");
    if (!header) {
      slot?.remove();
      return;
    }

    let nextSlot = slot;
    if (!nextSlot) {
      nextSlot = document.createElement("span");
      nextSlot.id = ICD9_SLOT_ID;
      const button = document.createElement("button");
      button.id = ICD9_BUTTON_ID;
      button.type = "button";
      button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Isi ICD 9</span>`;
      button.addEventListener("click", openIcd9Modal);
      nextSlot.append(button);
    }
    if (nextSlot.parentElement !== header || nextSlot.nextElementSibling !== icons) header.insertBefore(nextSlot, icons || null);
  }

  function queueInject() {
    if (injectQueued) return;
    injectQueued = true;
    requestAnimationFrame(() => {
      injectButton();
      injectResumeButton();
      injectIcd9Button();
      enforcePatientTabTitle();
      reportAssessmentIgdState();
    });
  }

  if (typeof module !== "undefined") {
    module.exports = { diagnosisTypeFor, isReportMedicalRecord, isReportPatientName, assessmentStateFromValues, resumeProgressStage, mergeIcd9Actions };
    if (require.main === module) {
      const assert = require("node:assert/strict");
      assert.equal(diagnosisTypeFor("rawat_inap"), "Diagnosa Awal");
      assert.equal(diagnosisTypeFor("rawat_jalan"), "Primary / utama");
      assert.throws(() => diagnosisTypeFor(""), /belum dipilih/);
      assert.equal(isReportMedicalRecord("051462"), true);
      assert.equal(isReportMedicalRecord("2608000067"), false);
      assert.equal(isReportMedicalRecord("1978"), false);
      assert.equal(isReportPatientName("SALIMUDDIN"), true);
      assert.equal(isReportPatientName("ARNIYATI. Ny."), true);
      assert.equal(isReportPatientName("INFO REGISTRASI"), false);
      assert.equal(isReportPatientName("BPJS - - -"), false);
      assert.equal(isReportPatientName("JKN NON PBI"), false);
      assert.equal(isReportPatientName("A09.9 - GEA/DIARRHEA"), false);
      assert.equal(assessmentStateFromValues(false, ["Diagnosa kerja"]), "unknown");
      assert.equal(assessmentStateFromValues(true, ["", "-"]), "empty");
      assert.equal(assessmentStateFromValues(true, ["", "Pantoprazole 40 mg"]), "complete");
      assert.equal(resumeProgressStage(1), "Merapikan laboratorium");
      assert.equal(resumeProgressStage(2), "Merapikan radiologi");
      assert.equal(resumeProgressStage(3), "Merapikan terapi");
      assert.equal(mergeIcd9Actions("EKG, Infus", ["ekg", "injeksi-obat"]), "EKG, Infus, Injeksi obat");
      assert.equal(mergeIcd9Actions("lab", ["lab-darah"]), "lab");
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
        ? { ok: true, identity: { ...identity, assessmentState: currentAssessmentIgdState() }, ermUrl: location.href }
        : { ok: false, error: "Nama, jenis kelamin, umur, atau nomor RM tidak ditemukan pada header pasien." });
      return false;
    }
    if (message?.type === "rsdkh:set-patient-tab-title") {
      const patient = getCurrentPatientReportIdentity();
      if (!patient || (message.medicalRecordNumber && patient.medicalRecordNumber !== normalize(message.medicalRecordNumber))) {
        sendResponse({ ok: false, error: "Nomor RM pada tab aktif tidak cocok." });
        return false;
      }
      setForcedPatientTabTitle(message.title, patient.medicalRecordNumber);
      sendResponse({ ok: true });
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

  new MutationObserver(queueInject).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener("input", queueInject, true);
  document.addEventListener("change", queueInject, true);
  addEventListener("hashchange", queueInject);
  queueInject();
})();
