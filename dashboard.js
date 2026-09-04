"use strict";

const SHIFT = globalThis.NetmedicShift;
const $ = (selector) => document.querySelector(selector);
let shiftState = SHIFT.normalizeState({});
let searchTerm = "";
let toastTimer;

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tanggal tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function showToast(message, state = "ready") {
  const toast = $("#dashboardToast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.state = state;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

async function extensionAction(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Operasi extension gagal.");
  return response.result;
}

function patientMatchesSearch(patient) {
  if (!searchTerm) return true;
  return [patient.name, patient.medicalRecordNumber, patient.bed]
    .some((value) => String(value || "").toLocaleLowerCase("id-ID").includes(searchTerm));
}

async function openPatient(patient) {
  try {
    await extensionAction("rsdkh:focus-patient", { patient });
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function editPatientBed(patient) {
  const value = window.prompt("Pasien diletakkan di bed berapa?", patient.bed || "");
  if (value === null) return;
  const bed = value.trim();
  if (!bed) {
    showToast("Nama atau nomor BED wajib diisi.", "error");
    return;
  }
  try {
    shiftState = await extensionAction("rsdkh:patient-bed-update", { patient, bed });
    render();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function updatePatientStatus(patient, status) {
  try {
    shiftState = await extensionAction("rsdkh:shift-update-patient", {
      medicalRecordNumber: patient.medicalRecordNumber,
      patch: { status }
    });
    render();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function createPatientRow(patient) {
  const row = document.createElement("div");
  row.className = "patient-row";
  row.dataset.status = patient.status;

  const patientCell = document.createElement("div");
  patientCell.className = "patient-open";

  const main = document.createElement("div");
  main.className = "patient-main";
  const bed = document.createElement("button");
  bed.className = "patient-bed";
  bed.type = "button";
  bed.textContent = patient.bed ? `BED ${patient.bed}` : "ATUR BED";
  bed.title = `Ubah BED ${patient.name}`;
  bed.addEventListener("click", (event) => {
    event.stopPropagation();
    editPatientBed(patient);
  });
  const openButton = document.createElement("button");
  openButton.className = "patient-record";
  openButton.type = "button";
  openButton.setAttribute("aria-label", `Buka pasien ${patient.name}`);
  openButton.addEventListener("click", () => openPatient(patient));
  const name = document.createElement("span");
  name.className = "patient-name";
  name.textContent = patient.name;
  openButton.append(name);
  main.append(bed, openButton);

  const meta = document.createElement("div");
  meta.className = "patient-meta";
  [
    `RM ${patient.medicalRecordNumber}`,
    [patient.gender, patient.age].filter(Boolean).join(" · "),
    `Masuk ${formatTime(patient.arrivedAt)}`
  ].filter(Boolean).forEach((value) => {
    const item = document.createElement("span");
    item.textContent = value;
    meta.append(item);
  });
  openButton.append(meta);
  patientCell.append(main);

  const actions = document.createElement("div");
  actions.className = "patient-actions";
  const assessmentComplete = patient.assessmentState === "complete";
  const assessment = document.createElement("div");
  assessment.className = "assessment-state";
  assessment.dataset.state = assessmentComplete ? "complete" : "empty";
  assessment.setAttribute("role", "status");
  assessment.setAttribute("aria-label", assessmentComplete ? "Pengkajian IGD terisi" : "Pengkajian IGD belum terisi");
  assessment.title = patient.assessmentState === "unknown"
    ? "Pengkajian IGD belum terkonfirmasi dari halaman eRM."
    : assessmentComplete ? "Pengkajian IGD sudah terisi." : "Pengkajian IGD masih kosong.";
  assessment.innerHTML = assessmentComplete
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span>Pengkajian IGD</span>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg><span>Pengkajian IGD</span>';
  const status = document.createElement("select");
  status.setAttribute("aria-label", `Status ${patient.name}`);
  SHIFT.STATUS_OPTIONS.forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = patient.status === value;
    status.append(option);
  });
  status.addEventListener("change", () => updatePatientStatus(patient, status.value));
  actions.append(assessment, status);
  row.append(patientCell, actions);
  return row;
}

function renderPatientList() {
  const activeShift = SHIFT.getActiveShift(shiftState);
  const patients = SHIFT.sortPatients(activeShift?.patients).filter(patientMatchesSearch);
  const unfinished = patients.filter((patient) => !SHIFT.FINAL_STATUSES.has(patient.status));
  const completed = patients.filter((patient) => SHIFT.FINAL_STATUSES.has(patient.status));
  const activeList = $("#activePatientList");
  const completedList = $("#completedPatientList");
  activeList.replaceChildren(...unfinished.map(createPatientRow));
  completedList.replaceChildren(...completed.map(createPatientRow));
  $("#activePatientEmpty").textContent = searchTerm ? "Tidak ada pasien yang cocok." : "Belum ada pasien pada sesi ini.";
  $("#activePatientEmpty").hidden = unfinished.length > 0;
  $("#unfinishedPatientCount").textContent = `${unfinished.length} pasien`;
  $("#completedPatientCount").textContent = `${completed.length} pasien`;
  $("#completedPatientSection").hidden = completed.length === 0;
}

function historyPatientRow(patient) {
  const row = document.createElement("div");
  row.className = "history-patient";
  const bed = document.createElement("strong");
  bed.textContent = patient.bed ? `BED ${patient.bed}` : "Tanpa BED";
  const name = document.createElement("span");
  name.textContent = patient.name;
  const status = document.createElement("span");
  status.textContent = SHIFT.patientStatusLabel(patient.status);
  row.append(bed, name, status);
  return row;
}

async function deleteShiftHistory(shift) {
  const patientCount = Object.keys(shift.patients).length;
  const label = `${formatDate(shift.startedAt)}, ${formatTime(shift.startedAt)} (${patientCount} pasien)`;
  if (!window.confirm(`Hapus riwayat jaga ${label}? Tindakan ini tidak dapat dibatalkan.`)) return;
  try {
    shiftState = await extensionAction("rsdkh:shift-delete", { shiftId: shift.id });
    render();
    showToast("Riwayat jaga berhasil dihapus.");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderHistory() {
  const completed = shiftState.shifts.filter((shift) => shift.status === "completed");
  const history = $("#shiftHistory");
  history.replaceChildren();
  $("#shiftHistoryEmpty").hidden = completed.length > 0;
  history.hidden = completed.length === 0;
  const grouped = new Map();
  completed.forEach((shift) => {
    if (!grouped.has(shift.dateKey)) grouped.set(shift.dateKey, []);
    grouped.get(shift.dateKey).push(shift);
  });

  grouped.forEach((shifts) => {
    const section = document.createElement("section");
    section.className = "history-date";
    const heading = document.createElement("h3");
    heading.textContent = formatDate(shifts[0].startedAt);
    section.append(heading);
    shifts.forEach((shift) => {
      const patients = SHIFT.sortPatients(shift.patients);
      const historyRow = document.createElement("div");
      historyRow.className = "shift-history-row";
      const details = document.createElement("details");
      details.className = "shift-history-details";
      const summary = document.createElement("summary");
      const line = document.createElement("span");
      line.className = "shift-summary-line";
      const label = document.createElement("strong");
      label.textContent = `Jaga ${shift.unit} · ${formatTime(shift.startedAt)}–${formatTime(shift.endedAt)}`;
      const count = document.createElement("span");
      count.textContent = `${patients.length} pasien`;
      line.append(label, count);
      summary.append(line);
      const deleteButton = document.createElement("button");
      deleteButton.className = "history-delete";
      deleteButton.type = "button";
      deleteButton.setAttribute("aria-label", `Hapus riwayat jaga ${formatDate(shift.startedAt)} pukul ${formatTime(shift.startedAt)}`);
      deleteButton.title = "Hapus riwayat jaga";
      deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 11v5m4-5v5"/></svg>';
      deleteButton.addEventListener("click", () => deleteShiftHistory(shift));
      const list = document.createElement("div");
      list.className = "history-patients";
      list.append(...patients.map(historyPatientRow));
      details.append(summary, list);
      historyRow.append(details, deleteButton);
      section.append(historyRow);
    });
    history.append(section);
  });
}

function render() {
  shiftState = SHIFT.normalizeState(shiftState);
  const active = SHIFT.getActiveShift(shiftState);
  $("#noActiveShift").hidden = Boolean(active);
  $("#activeShift").hidden = !active;
  if (active) {
    const patientCount = Object.keys(active.patients).length;
    $("#activeShiftDate").textContent = formatDate(active.startedAt);
    $("#activeShiftMeta").textContent = `Mulai ${formatTime(active.startedAt)} · ${patientCount} pasien`;
    $("#activePatientCount").textContent = `${patientCount} pasien dalam sesi`;
    document.title = `Jaga IGD · ${patientCount} pasien`;
    renderPatientList();
  } else {
    document.title = "Dashboard Jaga IGD";
  }
  renderHistory();
}

async function startShift() {
  const button = $("#startShift");
  button.disabled = true;
  try {
    shiftState = await extensionAction("rsdkh:shift-start");
    render();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function finishShift() {
  const active = SHIFT.getActiveShift(shiftState);
  if (!active || !window.confirm(`Selesaikan sesi jaga dengan ${Object.keys(active.patients).length} pasien?`)) return;
  try {
    shiftState = await extensionAction("rsdkh:shift-finish");
    render();
    showToast("Sesi jaga selesai dan masuk ke riwayat.");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function initialize() {
  await extensionAction("rsdkh:dashboard-ready");
  shiftState = await extensionAction("rsdkh:shift-get");
  render();
}

$("#startShift").addEventListener("click", startShift);
$("#finishShift").addEventListener("click", finishShift);
$("#patientSearch").addEventListener("input", (event) => {
  searchTerm = event.currentTarget.value.trim().toLocaleLowerCase("id-ID");
  renderPatientList();
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[SHIFT.STORAGE_KEY]) return;
  shiftState = SHIFT.normalizeState(changes[SHIFT.STORAGE_KEY].newValue);
  render();
});

initialize().catch((error) => showToast(error.message, "error"));
