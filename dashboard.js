"use strict";

const SHIFT = globalThis.NetmedicShift;
const $ = (selector) => document.querySelector(selector);
let shiftState = SHIFT.normalizeState({});
let searchTerm = "";
let dashboardView = "shift";
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
  return [patient.name, patient.medicalRecordNumber, patient.registrationNumber, patient.bed]
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

async function updatePatientTask(patient, taskKey, active) {
  try {
    shiftState = await extensionAction("rsdkh:shift-update-patient", {
      patientKey: SHIFT.patientKey(patient),
      patch: { tasks: { ...patient.tasks, [taskKey]: active } }
    });
    render();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function updateCustomTask(patient, customTask) {
  try {
    shiftState = await extensionAction("rsdkh:shift-update-patient", {
      patientKey: SHIFT.patientKey(patient),
      patch: { customTask }
    });
    render();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function editCustomTask(patient) {
  const value = window.prompt("Nama item Lain-lain (kosongkan untuk menghapus):", patient.customTask.label);
  if (value === null) return;
  const label = value.trim().replace(/\s+/g, " ").slice(0, 40);
  updateCustomTask(patient, { label, active: label ? patient.customTask.active : false });
}

async function updatePatientPlan(patient, plan) {
  try {
    shiftState = await extensionAction("rsdkh:shift-update-patient", {
      patientKey: SHIFT.patientKey(patient),
      patch: { plan }
    });
    render();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function togglePatientCompleted(patient) {
  const returningToActive = patient.completed;
  try {
    shiftState = await extensionAction("rsdkh:shift-update-patient", {
      patientKey: SHIFT.patientKey(patient),
      patch: { completed: !patient.completed }
    });
    render();
    showToast(returningToActive
      ? `${patient.name} dikembalikan menjadi pasien aktif.`
      : `${patient.name} telah selesai.`);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function createPatientRow(patient) {
  const row = document.createElement("div");
  row.className = "patient-row";
  row.dataset.completed = String(patient.completed);

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
    patient.registrationNumber ? `Reg ${patient.registrationNumber}` : "",
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
  SHIFT.PATIENT_TASKS.forEach(({ key, label }) => {
    const task = document.createElement("button");
    const active = patient.tasks[key] === true;
    task.className = "patient-task-toggle";
    task.type = "button";
    task.setAttribute("aria-pressed", String(active));
    task.setAttribute("aria-label", `${active ? "Nonaktifkan" : "Aktifkan"} ${label} untuk ${patient.name}`);
    task.title = `${active ? "Nonaktifkan" : "Aktifkan"} ${label}`;
    task.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
    const text = document.createElement("span");
    text.textContent = label;
    task.append(text);
    task.addEventListener("click", () => updatePatientTask(patient, key, !active));
    actions.append(task);
  });

  if (patient.customTask.label) {
    const customGroup = document.createElement("div");
    customGroup.className = "patient-custom-task";
    const customToggle = document.createElement("button");
    customToggle.className = "patient-task-toggle";
    customToggle.type = "button";
    customToggle.setAttribute("aria-pressed", String(patient.customTask.active));
    customToggle.setAttribute("aria-label", `${patient.customTask.active ? "Nonaktifkan" : "Aktifkan"} ${patient.customTask.label} untuk ${patient.name}`);
    customToggle.title = `${patient.customTask.active ? "Nonaktifkan" : "Aktifkan"} ${patient.customTask.label}`;
    customToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
    const customText = document.createElement("span");
    customText.textContent = patient.customTask.label;
    customToggle.append(customText);
    customToggle.addEventListener("click", () => updateCustomTask(patient, {
      ...patient.customTask,
      active: !patient.customTask.active
    }));
    const editButton = document.createElement("button");
    editButton.className = "patient-custom-edit";
    editButton.type = "button";
    editButton.setAttribute("aria-label", `Ubah item Lain-lain untuk ${patient.name}`);
    editButton.title = "Ubah Lain-lain";
    editButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>';
    editButton.addEventListener("click", () => editCustomTask(patient));
    customGroup.append(customToggle, editButton);
    actions.append(customGroup);
  } else {
    const addCustom = document.createElement("button");
    addCustom.className = "patient-task-toggle patient-custom-add";
    addCustom.type = "button";
    addCustom.textContent = "+ Lain-lain";
    addCustom.setAttribute("aria-label", `Tambah item Lain-lain untuk ${patient.name}`);
    addCustom.title = "Tambah item Lain-lain";
    addCustom.addEventListener("click", () => editCustomTask(patient));
    actions.append(addCustom);
  }

  const completion = document.createElement("div");
  completion.className = "patient-completion";
  const completeButton = document.createElement("button");
  completeButton.className = "patient-complete";
  completeButton.type = "button";
  completeButton.setAttribute("aria-pressed", String(patient.completed));
  completeButton.setAttribute("aria-label", patient.completed ? "Kembalikan pasien ke aktif" : "Tandai pasien selesai");
  completeButton.title = patient.completed ? "Kembalikan pasien ke aktif" : "Tandai pasien selesai";
  completeButton.innerHTML = patient.completed
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
  completeButton.addEventListener("click", () => togglePatientCompleted(patient));

  const plan = document.createElement("label");
  plan.className = "patient-plan";
  const planLabel = document.createElement("span");
  planLabel.textContent = "Rencana?";
  const planSelect = document.createElement("select");
  planSelect.setAttribute("aria-label", `Rencana pelayanan ${patient.name}`);
  SHIFT.PATIENT_PLANS.forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = patient.plan === value;
    planSelect.append(option);
  });
  planSelect.addEventListener("change", () => updatePatientPlan(patient, planSelect.value));
  plan.append(planLabel, planSelect);
  completion.append(completeButton, plan);
  row.append(patientCell, actions, completion);
  return row;
}

function renderPatientList() {
  const activeShift = SHIFT.getActiveShift(shiftState);
  const patients = SHIFT.sortPatients(activeShift?.patients).filter(patientMatchesSearch);
  const unfinished = patients.filter((patient) => !patient.completed);
  const completed = patients.filter((patient) => patient.completed);
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
  const hasCustomTask = Boolean(patient.customTask.label);
  const completedTasks = SHIFT.PATIENT_TASKS.filter(({ key }) => patient.tasks[key]).length
    + Number(hasCustomTask && patient.customTask.active);
  const totalTasks = SHIFT.PATIENT_TASKS.length + Number(hasCustomTask);
  const planLabel = SHIFT.PATIENT_PLANS.find(({ value }) => value === patient.plan)?.label;
  status.textContent = `${completedTasks}/${totalTasks} langkah${patient.completed ? " · Selesai" : ""}${patient.plan ? ` · ${planLabel}` : ""}`;
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
  const historyVisible = dashboardView === "history";
  $("#historySection").hidden = !historyVisible;
  $("#noActiveShift").hidden = historyVisible || Boolean(active);
  $("#activeShift").hidden = historyVisible || !active;
  if (active) {
    const patientCount = Object.keys(active.patients).length;
    $("#activeShiftDate").textContent = formatDate(active.startedAt);
    $("#activeShiftMeta").textContent = `Mulai ${formatTime(active.startedAt)} · ${patientCount} pasien`;
    $("#activePatientCount").textContent = `${patientCount} pasien dalam sesi`;
    document.title = historyVisible ? "Riwayat Jaga IGD" : `Jaga IGD · ${patientCount} pasien`;
    renderPatientList();
  } else {
    document.title = historyVisible ? "Riwayat Jaga IGD" : "Dashboard Jaga IGD";
  }
  renderHistory();
}

async function startShift() {
  const button = $("#startShift");
  button.disabled = true;
  try {
    shiftState = await extensionAction("rsdkh:shift-start");
    dashboardView = "shift";
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
    dashboardView = "history";
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
document.querySelectorAll(".show-shift-history").forEach((button) => {
  button.addEventListener("click", () => {
    dashboardView = "history";
    render();
  });
});
$("#backToShift").addEventListener("click", () => {
  dashboardView = "shift";
  render();
});
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
