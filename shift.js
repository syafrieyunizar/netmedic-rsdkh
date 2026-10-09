(function initNetmedicShift(scope) {
  "use strict";

  const STORAGE_KEY = "dutyShiftState";
  const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
  const PATIENT_TASKS = [
    { key: "whatsapp", label: "Ketikan WA" },
    { key: "inputSoap", label: "Input SOAP" },
    { key: "orderLab", label: "Order Lab" },
    { key: "orderRontgen", label: "Order Rontgen" },
    { key: "hasilLab", label: "Hasil lab" },
    { key: "hasilRontgen", label: "Hasil Rontgen" },
    { key: "ekg", label: "EKG" },
    { key: "konsul", label: "Konsul" },
    { key: "advis", label: "Advis" },
    { key: "resepPergantian", label: "Resep Pergantian" },
    { key: "resepRanap", label: "Resep Ranap" }
  ];
  const PATIENT_PLANS = [
    { value: "", label: "Pilih" },
    { value: "rawat_inap", label: "Rawat inap" },
    { value: "rawat_jalan", label: "Rawat jalan" }
  ];

  const clean = (value) => String(value || "").trim().replace(/\s+/g, " ");

  function patientKey(patient) {
    const medicalRecordNumber = clean(patient?.medicalRecordNumber);
    if (!medicalRecordNumber) return "";
    const encounter = clean(patient?.visitId || patient?.registrationNumber);
    return encounter ? `${medicalRecordNumber}:${encounter}` : medicalRecordNumber;
  }

  function localDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function normalizePatientTasks(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return Object.fromEntries(PATIENT_TASKS.map(({ key }) => [key, source[key] === true]));
  }

  function normalizeCustomTask(value) {
    const label = clean(value?.label).slice(0, 40);
    return { label, active: Boolean(label && value?.active === true) };
  }

  function normalizePatientPlan(value) {
    const plan = clean(value);
    return PATIENT_PLANS.some((option) => option.value === plan) ? plan : "";
  }

  function normalizePatient(patient) {
    const medicalRecordNumber = clean(patient?.medicalRecordNumber);
    if (!medicalRecordNumber) return null;
    return {
      medicalRecordNumber,
      registrationNumber: clean(patient.registrationNumber),
      visitId: clean(patient.visitId),
      name: clean(patient.name) || "Tanpa nama",
      gender: clean(patient.gender),
      age: clean(patient.age),
      bed: clean(patient.bed),
      tasks: normalizePatientTasks(patient.tasks),
      customTask: normalizeCustomTask(patient.customTask),
      plan: normalizePatientPlan(patient.plan),
      completed: patient.completed === true,
      tabId: Number.isInteger(patient.tabId) ? patient.tabId : null,
      ermUrl: clean(patient.ermUrl),
      arrivedAt: clean(patient.arrivedAt),
      updatedAt: clean(patient.updatedAt)
    };
  }

  function normalizeShift(shift) {
    if (!shift?.id || !shift.startedAt) return null;
    const patients = {};
    Object.values(shift.patients || {}).forEach((patient) => {
      const normalized = normalizePatient(patient);
      if (normalized) patients[patientKey(normalized)] = normalized;
    });
    return {
      id: clean(shift.id),
      unit: clean(shift.unit) || "IGD",
      dateKey: clean(shift.dateKey) || localDateKey(shift.startedAt),
      startedAt: clean(shift.startedAt),
      endedAt: clean(shift.endedAt),
      status: shift.status === "completed" ? "completed" : "active",
      patients
    };
  }

  function normalizeState(value, now = Date.now()) {
    const cutoff = now - RETENTION_MS;
    const shifts = (Array.isArray(value?.shifts) ? value.shifts : [])
      .map(normalizeShift)
      .filter(Boolean)
      .filter((shift) => {
        const timestamp = new Date(shift.endedAt || shift.startedAt).getTime();
        return Number.isFinite(timestamp) && (shift.status === "active" || timestamp >= cutoff);
      })
      .sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt));
    const requestedActiveId = clean(value?.activeShiftId);
    const activeShift = shifts.find((shift) => shift.id === requestedActiveId && shift.status === "active")
      || shifts.find((shift) => shift.status === "active");
    shifts.forEach((shift) => {
      if (activeShift && shift.id !== activeShift.id && shift.status === "active") {
        shift.status = "completed";
        shift.endedAt = shift.endedAt || shift.startedAt;
      }
    });
    return { version: 1, activeShiftId: activeShift?.id || "", shifts };
  }

  function getActiveShift(state) {
    return state?.shifts?.find((shift) => shift.id === state.activeShiftId && shift.status === "active") || null;
  }

  function startShift(state, now = new Date()) {
    const current = normalizeState(state, now.getTime());
    if (getActiveShift(current)) return current;
    const startedAt = now.toISOString();
    const shift = {
      id: globalThis.crypto?.randomUUID?.() || `${now.getTime()}-${Math.random().toString(16).slice(2)}`,
      unit: "IGD",
      dateKey: localDateKey(now),
      startedAt,
      endedAt: "",
      status: "active",
      patients: {}
    };
    return { ...current, activeShiftId: shift.id, shifts: [shift, ...current.shifts] };
  }

  function finishShift(state, now = new Date()) {
    const current = normalizeState(state, now.getTime());
    const active = getActiveShift(current);
    if (!active) return current;
    const shifts = current.shifts.map((shift) => shift.id === active.id
      ? { ...shift, status: "completed", endedAt: now.toISOString() }
      : shift);
    return { ...current, activeShiftId: "", shifts };
  }

  function deleteShift(state, shiftId, now = new Date()) {
    const current = normalizeState(state, now.getTime());
    const key = clean(shiftId);
    if (!key) return current;
    const target = current.shifts.find((shift) => shift.id === key);
    if (!target || target.status !== "completed") return current;
    return { ...current, shifts: current.shifts.filter((shift) => shift.id !== key) };
  }

  function patientFieldsChanged(existing, incoming) {
    return ["registrationNumber", "visitId", "name", "gender", "age", "bed", "tabId", "ermUrl", "plan", "completed"]
      .some((field) => existing[field] !== incoming[field])
      || PATIENT_TASKS.some(({ key }) => existing.tasks[key] !== incoming.tasks[key])
      || existing.customTask.label !== incoming.customTask.label
      || existing.customTask.active !== incoming.customTask.active;
  }

  function upsertPatient(state, patient, now = new Date()) {
    const current = normalizeState(state, now.getTime());
    const active = getActiveShift(current);
    const incoming = normalizePatient(patient);
    if (!active || !incoming) return current;
    const key = patientKey(incoming);
    const legacyKey = incoming.medicalRecordNumber;
    const existingKey = active.patients[key] ? key : key !== legacyKey && active.patients[legacyKey] ? legacyKey : "";
    const existing = active.patients[existingKey];
    const timestamp = now.toISOString();
    const nextPatientBase = {
      ...existing,
      ...incoming,
      tasks: existing?.tasks || incoming.tasks,
      customTask: existing?.customTask || incoming.customTask,
      plan: existing ? existing.plan : incoming.plan,
      completed: existing?.completed ?? incoming.completed,
      arrivedAt: existing?.arrivedAt || timestamp
    };
    if (existingKey === key && !patientFieldsChanged(existing, nextPatientBase)) return current;
    const nextPatient = {
      ...nextPatientBase,
      updatedAt: timestamp
    };
    const patients = { ...active.patients, [key]: nextPatient };
    if (key !== legacyKey) delete patients[legacyKey];
    const nextShift = { ...active, patients };
    return {
      ...current,
      shifts: current.shifts.map((shift) => shift.id === nextShift.id ? nextShift : shift)
    };
  }

  function updatePatient(state, patientReference, patch, now = new Date()) {
    const current = normalizeState(state, now.getTime());
    const active = getActiveShift(current);
    const key = typeof patientReference === "string" ? clean(patientReference) : patientKey(patientReference);
    const existing = active?.patients?.[key];
    if (!active || !existing) return current;
    const candidate = normalizePatient({ ...existing, ...patch });
    if (!candidate || !patientFieldsChanged(existing, candidate)) return current;
    const nextPatient = { ...candidate, arrivedAt: existing.arrivedAt, updatedAt: now.toISOString() };
    const nextShift = { ...active, patients: { ...active.patients, [key]: nextPatient } };
    return {
      ...current,
      shifts: current.shifts.map((shift) => shift.id === nextShift.id ? nextShift : shift)
    };
  }

  function sortPatients(patients) {
    return Object.values(patients || {}).sort((left, right) => {
      const leftBed = left.bed || "ZZZ";
      const rightBed = right.bed || "ZZZ";
      return leftBed.localeCompare(rightBed, "id", { numeric: true, sensitivity: "base" })
        || left.name.localeCompare(right.name, "id", { sensitivity: "base" });
    });
  }

  const api = {
    STORAGE_KEY,
    RETENTION_MS,
    PATIENT_TASKS,
    PATIENT_PLANS,
    patientKey,
    localDateKey,
    normalizePatientTasks,
    normalizeCustomTask,
    normalizePatientPlan,
    normalizeState,
    getActiveShift,
    startShift,
    finishShift,
    deleteShift,
    upsertPatient,
    updatePatient,
    sortPatients
  };

  scope.NetmedicShift = api;
  if (typeof module !== "undefined") module.exports = api;

  if (typeof module !== "undefined" && require.main === module) {
    const assert = require("node:assert/strict");
    const started = new Date(2026, 7, 25, 19, 0);
    let state = startShift({}, started);
    assert.equal(getActiveShift(state).dateKey, "2026-08-25");
    state = upsertPatient(state, { medicalRecordNumber: "051462", visitId: "visit-a", name: "SALIMUDDIN", bed: "6" }, started);
    assert.equal(sortPatients(getActiveShift(state).patients)[0].name, "SALIMUDDIN");
    const unchanged = upsertPatient(state, { medicalRecordNumber: "051462", visitId: "visit-a", name: "SALIMUDDIN", bed: "6" }, started);
    assert.deepEqual(unchanged, state);
    assert.equal(getActiveShift(state).patients["051462:visit-a"].tasks.whatsapp, false);
    state = updatePatient(state, "051462:visit-a", {
      tasks: { ...getActiveShift(state).patients["051462:visit-a"].tasks, whatsapp: true }
    }, new Date(2026, 7, 25, 20, 0));
    assert.equal(getActiveShift(state).patients["051462:visit-a"].tasks.whatsapp, true);
    state = updatePatient(state, "051462:visit-a", {
      customTask: { label: "Observasi", active: true },
      plan: "rawat_inap"
    }, new Date(2026, 7, 25, 20, 2));
    assert.deepEqual(getActiveShift(state).patients["051462:visit-a"].customTask, { label: "Observasi", active: true });
    assert.equal(getActiveShift(state).patients["051462:visit-a"].plan, "rawat_inap");
    state = upsertPatient(state, { medicalRecordNumber: "051462", visitId: "visit-a", name: "SALIMUDDIN", bed: "6" }, started);
    assert.equal(getActiveShift(state).patients["051462:visit-a"].tasks.whatsapp, true);
    assert.deepEqual(getActiveShift(state).patients["051462:visit-a"].customTask, { label: "Observasi", active: true });
    assert.equal(getActiveShift(state).patients["051462:visit-a"].plan, "rawat_inap");
    state = updatePatient(state, "051462:visit-a", { completed: true }, new Date(2026, 7, 25, 20, 5));
    assert.equal(getActiveShift(state).patients["051462:visit-a"].completed, true);
    state = upsertPatient(state, { medicalRecordNumber: "051462", visitId: "visit-b", name: "SALIMUDDIN", bed: "9" }, started);
    assert.equal(Object.keys(getActiveShift(state).patients).length, 2);
    let migrated = startShift({}, started);
    migrated = upsertPatient(migrated, { medicalRecordNumber: "090533", name: "ARNIYATI", bed: "2" }, started);
    migrated = upsertPatient(migrated, { medicalRecordNumber: "090533", visitId: "visit-new", name: "ARNIYATI", bed: "2" }, started);
    assert.deepEqual(Object.keys(getActiveShift(migrated).patients), ["090533:visit-new"]);
    state = finishShift(state, new Date(2026, 7, 26, 7, 0));
    assert.equal(state.activeShiftId, "");
    assert.equal(state.shifts[0].dateKey, "2026-08-25");
    const completedShiftId = state.shifts[0].id;
    state = deleteShift(state, completedShiftId, new Date(2026, 7, 26, 7, 1));
    assert.equal(state.shifts.length, 0);
    console.log("shift self-check ok");
  }
})(typeof self !== "undefined" ? self : globalThis);
