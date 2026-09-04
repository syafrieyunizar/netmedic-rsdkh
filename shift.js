(function initNetmedicShift(scope) {
  "use strict";

  const STORAGE_KEY = "dutyShiftState";
  const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
  const STATUS_OPTIONS = [
    { value: "baru", label: "Baru" },
    { value: "soap_ready", label: "SOAP siap" },
    { value: "soap_input", label: "Sudah diinput" },
    { value: "waiting", label: "Menunggu advis" },
    { value: "inpatient", label: "Rawat inap" },
    { value: "discharged", label: "Pulang" },
    { value: "done", label: "Selesai" }
  ];
  const FINAL_STATUSES = new Set(["inpatient", "discharged", "done"]);
  const ASSESSMENT_STATES = new Set(["unknown", "empty", "complete"]);

  const clean = (value) => String(value || "").trim().replace(/\s+/g, " ");

  function localDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function normalizePatient(patient) {
    const medicalRecordNumber = clean(patient?.medicalRecordNumber);
    if (!medicalRecordNumber) return null;
    const status = STATUS_OPTIONS.some(({ value }) => value === patient?.status) ? patient.status : "baru";
    const assessmentState = ASSESSMENT_STATES.has(patient?.assessmentState) ? patient.assessmentState : "unknown";
    return {
      medicalRecordNumber,
      name: clean(patient.name) || "Tanpa nama",
      gender: clean(patient.gender),
      age: clean(patient.age),
      bed: clean(patient.bed),
      status,
      assessmentState,
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
      if (normalized) patients[normalized.medicalRecordNumber] = normalized;
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
    return ["name", "gender", "age", "bed", "tabId", "ermUrl", "assessmentState"]
      .some((field) => existing[field] !== incoming[field]);
  }

  function upsertPatient(state, patient, now = new Date()) {
    const current = normalizeState(state, now.getTime());
    const active = getActiveShift(current);
    const incoming = normalizePatient(patient);
    if (!active || !incoming) return current;
    const existing = active.patients[incoming.medicalRecordNumber];
    if (existing && incoming.assessmentState === "unknown") incoming.assessmentState = existing.assessmentState;
    if (existing && !patientFieldsChanged(existing, incoming)) return current;
    const timestamp = now.toISOString();
    const nextPatient = {
      ...existing,
      ...incoming,
      status: existing?.status || incoming.status,
      arrivedAt: existing?.arrivedAt || timestamp,
      updatedAt: timestamp
    };
    const nextShift = {
      ...active,
      patients: { ...active.patients, [nextPatient.medicalRecordNumber]: nextPatient }
    };
    return {
      ...current,
      shifts: current.shifts.map((shift) => shift.id === nextShift.id ? nextShift : shift)
    };
  }

  function updatePatient(state, medicalRecordNumber, patch, now = new Date()) {
    const current = normalizeState(state, now.getTime());
    const active = getActiveShift(current);
    const key = clean(medicalRecordNumber);
    const existing = active?.patients?.[key];
    if (!active || !existing) return current;
    const candidate = normalizePatient({ ...existing, ...patch, medicalRecordNumber: key });
    if (!candidate || !patientFieldsChanged(existing, candidate) && existing.status === candidate.status) return current;
    const nextPatient = { ...candidate, arrivedAt: existing.arrivedAt, updatedAt: now.toISOString() };
    const nextShift = { ...active, patients: { ...active.patients, [key]: nextPatient } };
    return {
      ...current,
      shifts: current.shifts.map((shift) => shift.id === nextShift.id ? nextShift : shift)
    };
  }

  function patientStatusLabel(status) {
    return STATUS_OPTIONS.find(({ value }) => value === status)?.label || "Baru";
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
    STATUS_OPTIONS,
    FINAL_STATUSES,
    ASSESSMENT_STATES,
    localDateKey,
    normalizeState,
    getActiveShift,
    startShift,
    finishShift,
    deleteShift,
    upsertPatient,
    updatePatient,
    patientStatusLabel,
    sortPatients
  };

  scope.NetmedicShift = api;
  if (typeof module !== "undefined") module.exports = api;

  if (typeof module !== "undefined" && require.main === module) {
    const assert = require("node:assert/strict");
    const started = new Date(2026, 7, 25, 19, 0);
    let state = startShift({}, started);
    assert.equal(getActiveShift(state).dateKey, "2026-08-25");
    state = upsertPatient(state, { medicalRecordNumber: "051462", name: "SALIMUDDIN", bed: "6" }, started);
    assert.equal(sortPatients(getActiveShift(state).patients)[0].name, "SALIMUDDIN");
    const unchanged = upsertPatient(state, { medicalRecordNumber: "051462", name: "SALIMUDDIN", bed: "6" }, started);
    assert.deepEqual(unchanged, state);
    state = updatePatient(state, "051462", { status: "soap_ready" }, new Date(2026, 7, 25, 20, 0));
    assert.equal(getActiveShift(state).patients["051462"].status, "soap_ready");
    state = updatePatient(state, "051462", { assessmentState: "complete" }, new Date(2026, 7, 25, 20, 5));
    assert.equal(getActiveShift(state).patients["051462"].assessmentState, "complete");
    state = upsertPatient(state, { medicalRecordNumber: "051462", name: "SALIMUDDIN", bed: "6" }, started);
    assert.equal(getActiveShift(state).patients["051462"].assessmentState, "complete");
    state = finishShift(state, new Date(2026, 7, 26, 7, 0));
    assert.equal(state.activeShiftId, "");
    assert.equal(state.shifts[0].dateKey, "2026-08-25");
    const completedShiftId = state.shifts[0].id;
    state = deleteShift(state, completedShiftId, new Date(2026, 7, 26, 7, 1));
    assert.equal(state.shifts.length, 0);
    console.log("shift self-check ok");
  }
})(typeof self !== "undefined" ? self : globalThis);
