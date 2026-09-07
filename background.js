importScripts("hospital/rsdkh/ai.js", "shift.js");

const SHIFT = self.NetmedicShift;
const DASHBOARD_TAB_KEY = "netmedicDashboardTabId";
const PATIENT_MEMORIES_KEY = "patientMemories";
let shiftMutationQueue = Promise.resolve();

function enableSidePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(enableSidePanel);
chrome.runtime.onStartup.addListener(enableSidePanel);

async function readShiftState() {
  const saved = await chrome.storage.local.get(SHIFT.STORAGE_KEY);
  return SHIFT.normalizeState(saved[SHIFT.STORAGE_KEY]);
}

function mutateShiftState(mutator) {
  const operation = shiftMutationQueue.then(async () => {
    const current = await readShiftState();
    const next = mutator(current);
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      await chrome.storage.local.set({ [SHIFT.STORAGE_KEY]: next });
    }
    return next;
  });
  shiftMutationQueue = operation.catch(() => {});
  return operation;
}

async function rememberedDashboardTab() {
  try {
    return (await chrome.storage.session.get(DASHBOARD_TAB_KEY))[DASHBOARD_TAB_KEY] || null;
  } catch {
    return null;
  }
}

async function rememberDashboardTab(tabId) {
  try {
    await chrome.storage.session.set({ [DASHBOARD_TAB_KEY]: tabId });
  } catch {
    // The dashboard still works when session storage is unavailable.
  }
}

async function openDashboard() {
  const rememberedTabId = await rememberedDashboardTab();
  if (rememberedTabId) {
    try {
      const tab = await chrome.tabs.get(rememberedTabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true, pinned: true });
      return tab.id;
    } catch {
      // Recreate a dashboard tab when the remembered tab was closed.
    }
  }
  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL("dashboard.html"),
    active: true,
    pinned: true
  });
  await rememberDashboardTab(tab.id);
  return tab.id;
}

async function focusPatientTab(patient) {
  if (Number.isInteger(patient?.tabId)) {
    try {
      const tab = await chrome.tabs.get(patient.tabId);
      const response = await chrome.tabs.sendMessage(tab.id, { type: "rsdkh:get-current-patient-report-identity" });
      if (!response?.ok || SHIFT.patientKey(response.identity) !== SHIFT.patientKey(patient)) {
        throw new Error("Tab lama tidak lagi memuat pasien ini.");
      }
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
      return tab.id;
    } catch {
      // Fall back to the last local eRM URL when the original tab was closed.
    }
  }
  if (!patient?.ermUrl) throw new Error("URL eRM pasien belum tersimpan.");
  const url = new URL(patient.ermUrl);
  if (!(["rsudbalangan.com", "10.10.0.3"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol))) {
    throw new Error("URL eRM pasien tidak valid.");
  }
  const tab = await chrome.tabs.create({ url: url.href, active: true });
  return tab.id;
}

async function updatePatientBed(patient, bed) {
  const patientKey = SHIFT.patientKey(patient);
  const nextBed = String(bed || "").trim();
  if (!patientKey || !nextBed) throw new Error("Pasien atau BED tidak valid.");
  const state = await mutateShiftState((current) => SHIFT.updatePatient(current, patientKey, { bed: nextBed }));
  const saved = await chrome.storage.local.get(PATIENT_MEMORIES_KEY);
  const memories = saved[PATIENT_MEMORIES_KEY]
    && typeof saved[PATIENT_MEMORIES_KEY] === "object"
    && !Array.isArray(saved[PATIENT_MEMORIES_KEY])
    ? saved[PATIENT_MEMORIES_KEY]
    : {};
  memories[patientKey] = { ...memories[patientKey], bed: nextBed };
  await chrome.storage.local.set({ [PATIENT_MEMORIES_KEY]: memories });
  if (Number.isInteger(patient.tabId)) {
    chrome.tabs.sendMessage(patient.tabId, {
      type: "rsdkh:set-patient-tab-title",
      patient,
      title: `${nextBed} ${String(patient.name || "").trim()}`.trim()
    }).catch(() => {});
  }
  return state;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const shiftAction = {
    "rsdkh:shift-get": () => readShiftState(),
    "rsdkh:shift-start": async () => {
      const state = await mutateShiftState((current) => SHIFT.startShift(current));
      await openDashboard();
      return state;
    },
    "rsdkh:shift-finish": () => mutateShiftState((current) => SHIFT.finishShift(current)),
    "rsdkh:shift-delete": () => mutateShiftState((current) => SHIFT.deleteShift(current, message.shiftId)),
    "rsdkh:shift-upsert-patient": () => mutateShiftState((current) => SHIFT.upsertPatient(current, message.patient)),
    "rsdkh:shift-update-patient": () => mutateShiftState((current) => SHIFT.updatePatient(current, message.patientKey || message.medicalRecordNumber, message.patch)),
    "rsdkh:assessment-status-observed": () => mutateShiftState((current) => SHIFT.updatePatient(current, message.patientKey || message.medicalRecordNumber, { assessmentState: message.assessmentState })),
    "rsdkh:patient-bed-update": () => updatePatientBed(message.patient, message.bed),
    "rsdkh:open-dashboard": async () => ({ tabId: await openDashboard() }),
    "rsdkh:focus-patient": async () => ({ tabId: await focusPatientTab(message.patient) }),
    "rsdkh:dashboard-ready": async () => {
      if (!sender.tab?.id) throw new Error("Tab dashboard tidak ditemukan.");
      await rememberDashboardTab(sender.tab.id);
      await chrome.tabs.update(sender.tab.id, { pinned: true });
      return { tabId: sender.tab.id };
    }
  }[message?.type];
  if (shiftAction) {
    shiftAction()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Operasi sesi jaga gagal." }));
    return true;
  }

  const action = {
    "rsdkh:parse-soap": () => self.RSDKHAi.generateSoapParts(message.soapText),
    "rsdkh:generate-prescription": () => self.RSDKHAi.generatePrescription(message.mode, message.prescriptionText, message.includeSupplies),
    "rsdkh:summarize-resume": () => self.RSDKHAi.generateResume(message.sections)
  }[message?.type];
  if (!action) return false;
  action()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "Proses AI gagal." }));
  return true;
});
