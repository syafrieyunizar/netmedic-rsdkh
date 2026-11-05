importScripts("hospital/rsdkh/ai.js", "shift.js", "visite-state.js");

const SHIFT = self.NetmedicShift;
const PATIENT_MEMORIES_KEY = "patientMemories";
const SESSION_GROUPS = {
  "dashboard.html": { title: "🩺 JAGA", color: "orange" },
  "visite.html": { title: "🩺 Visite", color: "cyan" }
};
let shiftMutationQueue = Promise.resolve();
let clipboardCopyRequest;
let visiteQueue = Promise.resolve();
let visiteLinksRunning = 0;
let sessionTabQueue = Promise.resolve();

function manageSessionTabs(action) {
  const operation = sessionTabQueue.then(action);
  sessionTabQueue = operation.catch(() => {});
  return operation;
}

async function ensureDashboardGroup(dashboard, page, moveLeft = false) {
  if (!chrome.tabs.group || !chrome.tabGroups) {
    if (!dashboard.pinned) await chrome.tabs.update(dashboard.id, { pinned: true });
    return null;
  }

  const style = SESSION_GROUPS[page];
  const groups = await chrome.tabGroups.query({ windowId: dashboard.windowId, title: style.title });
  const group = groups.find((item) => item.title === style.title && item.id === dashboard.groupId)
    || groups.find((item) => item.title === style.title);
  const alreadyGrouped = group && group.id === dashboard.groupId;
  if (alreadyGrouped && !moveLeft) return group.id;

  if (dashboard.pinned) await chrome.tabs.update(dashboard.id, { pinned: false });
  const groupId = alreadyGrouped
    ? group.id
    : await chrome.tabs.group({ tabIds: dashboard.id, ...(group ? { groupId: group.id } : {}) });
  if (!group) await chrome.tabGroups.update(groupId, style);

  const members = await chrome.tabs.query({ windowId: dashboard.windowId, groupId });
  const firstIndex = Math.min(...members.map((tab) => tab.index));
  const current = members.find((tab) => tab.id === dashboard.id);
  if (current && current.index > firstIndex) await chrome.tabs.move(dashboard.id, { index: firstIndex });
  const pinned = await chrome.tabs.query({ windowId: dashboard.windowId, pinned: true });
  if (firstIndex > pinned.length) await chrome.tabGroups.move(groupId, { index: pinned.length }).catch(() => {});
  return groupId;
}

async function openSessionDashboard(page, windowId) {
  const url = chrome.runtime.getURL(page);
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => (tab.pendingUrl || tab.url) === url && tab.windowId === windowId)
    || tabs.find((tab) => (tab.pendingUrl || tab.url) === url);
  const dashboard = existing || await chrome.tabs.create({ url, active: true, windowId });
  await ensureDashboardGroup(dashboard, page, true).catch(() => {});
  if (existing) {
    await chrome.windows.update(dashboard.windowId, { focused: true });
    await chrome.tabs.update(dashboard.id, { active: true });
  }
  return dashboard.id;
}

async function dashboardFromSender(sender, page) {
  if (sender.url !== chrome.runtime.getURL(page) || !Number.isInteger(sender.tab?.id)) {
    throw new Error("Buka pasien dari tab dashboard sesi.");
  }
  return chrome.tabs.get(sender.tab.id);
}

function canReusePatientTab(tab, dashboard, groupId) {
  const ungrouped = !(tab.groupId >= 0);
  if (groupId === null) return ungrouped;
  return tab.windowId === dashboard.windowId && !tab.pinned && (tab.groupId === groupId || ungrouped);
}

async function showSessionPatient(dashboard, groupId, url, existing, update = {}) {
  const tab = existing || await chrome.tabs.create({ url, active: false, windowId: dashboard.windowId });
  if (groupId !== null && tab.groupId !== groupId) {
    await chrome.tabs.group({ groupId, tabIds: tab.id }).catch(() => {});
  }
  if (tab.windowId !== dashboard.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { ...update, active: true });
  return tab.id;
}

async function releaseSessionPatientTabs(page) {
  if (!chrome.tabGroups || !chrome.tabs.ungroup) return;
  const { title } = SESSION_GROUPS[page];
  const groups = await chrome.tabGroups.query({ title });
  for (const group of groups.filter((item) => item.title === title)) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    const patientIds = tabs.filter((tab) => patientVisitUrl(tab.pendingUrl || tab.url)).map((tab) => tab.id);
    if (patientIds.length) await chrome.tabs.ungroup(patientIds).catch(() => {});
  }
}

async function resolveVisiteLink(patient, sender) {
  const source = new URL(sender.tab?.url || '');
  if (!['rsudbalangan.com', '10.10.0.3'].includes(source.hostname) || !['http:', 'https:'].includes(source.protocol) || source.hash.split('?')[0] !== '#/daftar-pasien-dirawat') throw new Error('Buka pengambilan visite dari daftar pasien dirawat.');
  if (!/^\d{5,8}$/.test(String(patient?.medicalRecordNumber || '')) || !/^\d{9,11}$/.test(String(patient?.registrationNumber || '')) || !patient?.room) throw new Error('RM, registrasi, atau ruangan pasien belum lengkap.');
  if (visiteLinksRunning >= self.NetmedicVisite.LINK_CONCURRENCY) throw new Error('Tiga tab pengambilan visite masih berjalan. Tunggu lalu coba lagi.');
  visiteLinksRunning++;
  let tabId, timer;
  try {
    const tab = await chrome.tabs.create({ url: source.href, active: false });
    tabId = tab.id;
    const result = await Promise.race([
      (async () => {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          try {
            const result = await chrome.tabs.sendMessage(tabId, { type: 'rsdkh:visite-resolve-patient', patient });
            if (!result?.ok) throw new Error(result?.error || 'Link pasien tidak ditemukan.');
            const current = await chrome.tabs.get(tabId);
            const ermUrl = self.NetmedicVisite.cpptUrl(result.ermUrl);
            if (new URL(ermUrl).origin !== source.origin || self.NetmedicVisite.cpptUrl(current.url) !== ermUrl) throw new Error('Tujuan eRM pasien tidak dapat diverifikasi.');
            return { ermUrl };
          } catch (error) {
            if (!/receiving end does not exist|could not establish connection/i.test(error.message)) throw error;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
        throw new Error('Tab pengambilan belum siap. Coba ulang.');
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Pengambilan link pasien melebihi 60 detik. Coba ulang.')), 60000); })
    ]);
    return result;
  } finally {
    clearTimeout(timer);
    if (tabId) await chrome.tabs.remove(tabId).catch(() => {});
    visiteLinksRunning--;
  }
}

function mutateVisite(groups, windowId) {
  const operation = visiteQueue.then(async () => {
    const V = self.NetmedicVisite;
    if (groups === null) {
      await chrome.storage.local.remove(V.KEY);
      await manageSessionTabs(() => releaseSessionPatientTabs("visite.html").catch(() => {}));
      return;
    }
    const saved = await chrome.storage.local.get(V.KEY);
    const session = V.mergeSession(saved[V.KEY], groups);
    await chrome.storage.local.set({ [V.KEY]: session });
    await manageSessionTabs(() => openSessionDashboard("visite.html", windowId));
  });
  visiteQueue = operation.catch(() => {});
  return operation;
}

async function openVisitePatient(patient, sender) {
  const url = self.NetmedicVisite.cpptUrl(patient?.ermUrl);
  const dashboard = await dashboardFromSender(sender, "visite.html");
  const groupId = await ensureDashboardGroup(dashboard, "visite.html").catch(() => null);
  const tabs = await chrome.tabs.query(groupId === null ? {} : { windowId: dashboard.windowId });
  const matches = tabs.filter((tab) =>
    canReusePatientTab(tab, dashboard, groupId) && patientVisitUrl(tab.pendingUrl || tab.url) === url);
  const existing = matches.find((tab) => tab.groupId === groupId) || matches[0];
  const update = existing && (existing.pendingUrl || existing.url) !== url ? { url } : {};
  return showSessionPatient(dashboard, groupId, url, existing, update);
}

function patientVisitUrl(url) {
  try { return self.NetmedicVisite.cpptUrl(url); }
  catch { return null; }
}

function enableSidePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(enableSidePanel);
chrome.runtime.onStartup.addListener(enableSidePanel);

function finishClipboardCopy(token, ok, error = "") {
  const request = clipboardCopyRequest;
  if (!request || request.token !== token) return false;
  clipboardCopyRequest = null;
  clearTimeout(request.timer);
  if (Number.isInteger(request.windowId)) chrome.windows.remove(request.windowId).catch(() => {});
  if (ok) request.resolve();
  else request.reject(new Error(error || "Gambar gagal disalin ke clipboard."));
  return true;
}

async function copyImageToClipboard(dataUrl) {
  if (!/^data:image\/png;base64,/i.test(String(dataUrl || ""))) throw new Error("Data capture laboratorium tidak valid.");
  if (clipboardCopyRequest) throw new Error("Capture lain masih disalin ke clipboard.");
  const token = crypto.randomUUID();
  const result = new Promise((resolve, reject) => {
    clipboardCopyRequest = {
      token,
      dataUrl,
      windowId: null,
      resolve,
      reject,
      timer: setTimeout(() => finishClipboardCopy(token, false, "Clipboard tidak merespons."), 15000)
    };
  });
  try {
    const popup = await chrome.windows.create({
      url: chrome.runtime.getURL(`clipboard.html?token=${encodeURIComponent(token)}`),
      type: "popup",
      focused: true,
      width: 240,
      height: 140
    });
    if (clipboardCopyRequest?.token === token) clipboardCopyRequest.windowId = popup.id;
  } catch (error) {
    finishClipboardCopy(token, false, error.message);
  }
  return result;
}

function notifyActivePatientTab(tabId) {
  chrome.runtime.sendMessage({ type: "rsdkh:active-patient-tab-changed", tabId }).catch(() => {});
}

chrome.tabs.onActivated.addListener(({ tabId }) => notifyActivePatientTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === "complete")) notifyActivePatientTab(tabId);
});

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

async function focusPatientTab(patient, sender) {
  const dashboard = await dashboardFromSender(sender, "dashboard.html");
  const groupId = await ensureDashboardGroup(dashboard, "dashboard.html").catch(() => null);
  const visitUrl = patientVisitUrl(patient?.ermUrl);
  if (groupId !== null && visitUrl) {
    const members = await chrome.tabs.query({ windowId: dashboard.windowId, groupId });
    const existing = members.find((tab) => patientVisitUrl(tab.pendingUrl || tab.url) === visitUrl);
    if (existing) return showSessionPatient(dashboard, groupId, null, existing);
  }

  let existing;
  if (Number.isInteger(patient?.tabId)) {
    try {
      const tab = await chrome.tabs.get(patient.tabId);
      const response = await chrome.tabs.sendMessage(tab.id, { type: "rsdkh:get-current-patient-report-identity" });
      if (!response?.ok || SHIFT.patientKey(response.identity) !== SHIFT.patientKey(patient)) {
        throw new Error("Tab lama tidak lagi memuat pasien ini.");
      }
      if (canReusePatientTab(tab, dashboard, groupId)) existing = tab;
    } catch {
      // Fall back to the last local eRM URL when the original tab was closed.
    }
  }
  if (existing) return showSessionPatient(dashboard, groupId, null, existing);
  if (!patient?.ermUrl) throw new Error("URL eRM pasien belum tersimpan.");
  const url = new URL(patient.ermUrl);
  if (!(["rsudbalangan.com", "10.10.0.3"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol))) {
    throw new Error("URL eRM pasien tidak valid.");
  }
  return showSessionPatient(dashboard, groupId, url.href);
}

function vitalSignUrlFor(patient) {
  const url = new URL(patient?.ermUrl || "");
  if (!(["rsudbalangan.com", "10.10.0.3"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol))) {
    throw new Error("URL eRM pasien tidak valid.");
  }
  const route = url.hash.replace(/^#\/?/, "").split("/");
  if (route[0] !== "rekam-medis" || !route[1] || !route[2]) throw new Error("Kunjungan pasien tidak ditemukan pada URL eRM.");
  url.hash = `#/rekam-medis/${route[1]}/${route[2]}/vital-sign`;
  return url.href;
}

async function waitForLatestVitalSigns(tabId, patient) {
  const deadline = Date.now() + 15000;
  let lastError = "Tanda vital terbaru tidak ditemukan.";
  while (Date.now() < deadline) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "rsdkh:get-latest-vital-sign", patient });
      if (response?.ok && response.vitalSigns) return response.vitalSigns;
      if (response?.error) lastError = response.error;
    } catch (error) {
      lastError = error.message || lastError;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(lastError);
}

async function getLatestVitalSigns(patient) {
  const vitalUrl = vitalSignUrlFor(patient);
  if (Number.isInteger(patient?.tabId)) {
    try {
      const currentTab = await chrome.tabs.get(patient.tabId);
      if (currentTab.url === vitalUrl) return waitForLatestVitalSigns(currentTab.id, patient);
    } catch {
      // Use an inactive temporary tab when the original patient tab is unavailable.
    }
  }

  const temporaryTab = await chrome.tabs.create({ url: vitalUrl, active: false });
  try {
    return await waitForLatestVitalSigns(temporaryTab.id, patient);
  } finally {
    await chrome.tabs.remove(temporaryTab.id).catch(() => {});
  }
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
  if (message?.type === 'rsdkh:cppt-copy-context') {
    (async () => {
      const url = new URL(sender.tab?.url || '');
      if (!['rsudbalangan.com', '10.10.0.3'].includes(url.hostname) || !/\/cppt(?:$|\?)/.test(url.hash)) throw new Error('Buka halaman CPPT pasien terlebih dahulu.');
      const result = await chrome.tabs.sendMessage(sender.tab.id, { type: 'rsdkh:get-current-patient-report-identity' });
      if (!result?.ok || !result.identity?.medicalRecordNumber || result.identity.visitId !== url.hash.split('/')[3]) throw new Error('Identitas kunjungan CPPT belum tersedia.');
      const V = self.NetmedicVisite, saved = await chrome.storage.local.get(V.KEY);
      return { identity: result.identity, careTeam: V.careTeamFor(saved[V.KEY], result.identity) };
    })().then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'rsdkh:visite-resolve-link') {
    resolveVisiteLink(message.patient, sender).then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message, retryable: /Pasien dengan RM dan registrasi|Daftar pasien (?:belum tersedia|belum stabil)|Tab pengambilan belum siap|melebihi 60 detik/.test(error.message) }));
    return true;
  }
  const visiteAction = {
    "rsdkh:visite-start": () => mutateVisite(message.groups, sender.tab?.windowId),
    "rsdkh:visite-finish": () => mutateVisite(null),
    "rsdkh:visite-open-patient": () => manageSessionTabs(() => openVisitePatient(message.patient, sender))
  }[message?.type];
  if (visiteAction) {
    visiteAction().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "rsdkh:open-admin-login") {
    const windowId = sender.tab?.windowId;
    chrome.storage.local.set({ "magicSoap.openAdminLoginAt": Date.now() })
      .then(() => windowId ? chrome.sidePanel.open({ windowId }) : null)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Side panel gagal dibuka." }));
    return true;
  }
  if (message?.type === "rsdkh:copy-image-to-clipboard") {
    copyImageToClipboard(message.dataUrl)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Capture gagal disalin." }));
    return true;
  }
  if (message?.type === "rsdkh:clipboard-window-result") {
    finishClipboardCopy(message.token, message.ok, message.error);
    return false;
  }
  if (message?.type === "rsdkh:get-pending-clipboard-image") {
    const request = clipboardCopyRequest;
    sendResponse(request?.token === message.token
      ? { ok: true, dataUrl: request.dataUrl }
      : { ok: false, error: "Data capture tidak ditemukan." });
    return false;
  }
  if (message?.type === "rsdkh:get-latest-vital-sign") {
    getLatestVitalSigns(message.patient)
      .then((vitalSigns) => sendResponse({ ok: true, vitalSigns }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Tanda vital terbaru tidak ditemukan." }));
    return true;
  }

  const shiftAction = {
    "rsdkh:shift-get": () => readShiftState(),
    "rsdkh:shift-start": () => manageSessionTabs(async () => {
      const state = await mutateShiftState((current) => SHIFT.startShift(current));
      await openSessionDashboard("dashboard.html", sender.tab?.windowId);
      return state;
    }),
    "rsdkh:shift-finish": () => manageSessionTabs(async () => {
      const state = await mutateShiftState((current) => SHIFT.finishShift(current));
      await releaseSessionPatientTabs("dashboard.html").catch(() => {});
      return state;
    }),
    "rsdkh:shift-delete": () => mutateShiftState((current) => SHIFT.deleteShift(current, message.shiftId)),
    "rsdkh:shift-upsert-patient": () => mutateShiftState((current) => SHIFT.upsertPatient(current, message.patient)),
    "rsdkh:shift-update-patient": () => mutateShiftState((current) => SHIFT.updatePatient(current, message.patientKey || message.medicalRecordNumber, message.patch)),
    "rsdkh:assessment-status-observed": () => mutateShiftState((current) => SHIFT.updatePatient(current, message.patientKey || message.medicalRecordNumber, { assessmentState: message.assessmentState })),
    "rsdkh:patient-bed-update": () => updatePatientBed(message.patient, message.bed),
    "rsdkh:open-dashboard": () => manageSessionTabs(async () => ({ tabId: await openSessionDashboard("dashboard.html", sender.tab?.windowId) })),
    "rsdkh:focus-patient": () => manageSessionTabs(async () => ({ tabId: await focusPatientTab(message.patient, sender) })),
    "rsdkh:dashboard-ready": () => manageSessionTabs(async () => {
      const page = sender.url === chrome.runtime.getURL("visite.html") ? "visite.html" : "dashboard.html";
      const dashboard = await dashboardFromSender(sender, page);
      await ensureDashboardGroup(dashboard, page).catch(() => {});
      return { tabId: dashboard.id };
    })
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
