importScripts("hospital/rsdkh/ai.js", "shift.js", "visite-state.js");

const SHIFT = self.NetmedicShift;
const PATIENT_MEMORIES_KEY = "patientMemories";
const PUBLIC_ERM_ORIGIN = "https://rsudbalangan.com:91";
const INTERNAL_ERM_ORIGIN = "http://10.10.0.3";
const SESSION_PATIENT_LISTS = {
  "dashboard.html": { contextKey: "jagaErmContext", route: "#/daftar-pasien-igd" },
  "visite.html": { contextKey: "visiteErmContext", route: "#/daftar-pasien-dirawat" }
};
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

async function createSessionGroup(tabId, page) {
  const groupId = await chrome.tabs.group({ tabIds: tabId });
  await chrome.tabGroups.update(groupId, SESSION_GROUPS[page]);
  return groupId;
}

async function moveSessionGroupLeft(windowId, groupId, firstIndex) {
  const pinned = await chrome.tabs.query({ windowId, pinned: true });
  if (firstIndex > pinned.length) await chrome.tabGroups.move(groupId, { index: pinned.length }).catch(() => {});
}

async function ensureDashboardGroup(dashboard, page, moveLeft = false) {
  if (!chrome.tabs.group || !chrome.tabGroups) return null;

  const style = SESSION_GROUPS[page];
  const groups = await chrome.tabGroups.query({ windowId: dashboard.windowId, title: style.title });
  const group = groups.find((item) => item.title === style.title && item.id === dashboard.groupId)
    || groups.find((item) => item.title === style.title);
  if (dashboard.pinned) return group?.id ?? null;
  const alreadyGrouped = group && group.id === dashboard.groupId;
  if (alreadyGrouped && !moveLeft) return group.id;

  let groupId = group?.id;
  if (!group) groupId = await createSessionGroup(dashboard.id, page);
  else if (!alreadyGrouped) await chrome.tabs.group({ tabIds: dashboard.id, groupId });

  const members = await chrome.tabs.query({ windowId: dashboard.windowId, groupId });
  const firstIndex = Math.min(...members.map((tab) => tab.index));
  const current = members.find((tab) => tab.id === dashboard.id);
  if (current && current.index > firstIndex) await chrome.tabs.move(dashboard.id, { index: firstIndex });
  await moveSessionGroupLeft(dashboard.windowId, groupId, firstIndex);
  return groupId;
}

function supportedErmOrigin(value) {
  try {
    const { origin } = new URL(value);
    return [PUBLIC_ERM_ORIGIN, INTERNAL_ERM_ORIGIN].includes(origin) ? origin : "";
  } catch {
    return "";
  }
}

async function openSessionDashboard(page, windowId) {
  const url = chrome.runtime.getURL(page);
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => (tab.pendingUrl || tab.url) === url && tab.windowId === windowId)
    || tabs.find((tab) => (tab.pendingUrl || tab.url) === url);
  const [source] = await chrome.tabs.query({ active: true, ...(windowId === undefined ? { lastFocusedWindow: true } : { windowId }) });
  const origin = supportedErmOrigin(source?.pendingUrl || source?.url);
  const accessedAt = Date.now();
  const dashboard = existing || await chrome.tabs.create({ url, active: true, windowId });
  if (origin) {
    const { contextKey } = SESSION_PATIENT_LISTS[page];
    await chrome.storage.session?.set({ [contextKey]: { origin, accessedAt, tabId: dashboard.id } }).catch(() => {});
  }
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
  if (groupId === null && (!dashboard.pinned || !chrome.tabGroups)) return ungrouped;
  return tab.windowId === dashboard.windowId && !tab.pinned && (tab.groupId === groupId || ungrouped);
}

async function showSessionTab(page, dashboard, groupId, url, existing, update = {}) {
  const tab = existing || await chrome.tabs.create({ url, active: false, windowId: dashboard.windowId });
  if (groupId !== null && tab.groupId !== groupId) {
    await chrome.tabs.group({ groupId, tabIds: tab.id }).catch(() => {});
  } else if (groupId === null && dashboard.pinned && chrome.tabs.group && chrome.tabGroups) {
    const newGroupId = await createSessionGroup(tab.id, page).catch(() => null);
    if (newGroupId !== null) await moveSessionGroupLeft(tab.windowId, newGroupId, tab.index);
  }
  if (tab.windowId !== dashboard.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { ...update, active: true });
  return tab.id;
}

async function openSessionPatientList(page, sender) {
  const { contextKey, route } = SESSION_PATIENT_LISTS[page];
  const dashboard = await dashboardFromSender(sender, page);
  const tabs = await chrome.tabs.query({ windowId: dashboard.windowId });
  const ermTabs = tabs.map((tab) => ({
    origin: supportedErmOrigin(tab.pendingUrl || tab.url),
    lastAccessed: tab.lastAccessed || 0
  })).filter((tab) => tab.origin).sort((left, right) => right.lastAccessed - left.lastAccessed);
  const context = (await chrome.storage.session?.get(contextKey).catch(() => null))?.[contextKey];
  const rememberedOrigin = context?.tabId === dashboard.id && supportedErmOrigin(context.origin);
  const recent = ermTabs[0];
  let origin = rememberedOrigin && context.accessedAt >= (recent?.lastAccessed || 0)
    ? rememberedOrigin
    : recent?.origin;
  if (!origin && page === "dashboard.html") {
    const shift = SHIFT.getActiveShift(await readShiftState());
    origin = Object.values(shift?.patients || {})
      .sort((left, right) => right.arrivedAt.localeCompare(left.arrivedAt))
      .map((patient) => supportedErmOrigin(patient.ermUrl)).find(Boolean);
  } else if (!origin) {
    const key = self.NetmedicVisite.KEY;
    const saved = await chrome.storage.local.get(key);
    const patients = (saved[key]?.doctors || []).flatMap((doctor) => doctor.rooms.flatMap((room) => room.patients));
    origin = patients.map((patient) => supportedErmOrigin(patient.ermUrl)).find(Boolean);
  }
  const groupId = await ensureDashboardGroup(dashboard, page).catch(() => null);
  return showSessionTab(page, dashboard, groupId, `${origin || PUBLIC_ERM_ORIGIN}/${route}`);
}

async function toggleDashboardPin(page, sender) {
  const dashboard = await dashboardFromSender(sender, page);
  const tab = await chrome.tabs.update(dashboard.id, { pinned: !dashboard.pinned });
  if (!tab.pinned) await ensureDashboardGroup(tab, page, true).catch(() => {});
  return { pinned: tab.pinned };
}

async function openIgdPatientInJaga(patient, sender) {
  if (sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || !chrome.tabGroups) return { handled: false };
  const source = await chrome.tabs.get(sender.tab.id);
  if (!Number.isInteger(source.groupId) || source.groupId < 0 || !supportedErmOrigin(source.url)) return { handled: false };
  const url = new URL(source.url);
  if (url.hash.split("?")[0] !== "#/daftar-pasien-igd") return { handled: false };
  const group = await chrome.tabGroups.get(source.groupId).catch(() => null);
  if (group?.title !== SESSION_GROUPS["dashboard.html"].title) return { handled: false };
  if (!/^\d{5,8}$/.test(patient?.medicalRecordNumber) || !/^\d{9,11}$/.test(patient?.registrationNumber)) {
    throw new Error("RM atau nomor registrasi pasien IGD belum terbaca.");
  }
  const lookup = {
    medicalRecordNumber: patient.medicalRecordNumber,
    registrationNumber: patient.registrationNumber,
    discharged: patient.discharged === true,
    period: Array.isArray(patient.period) ? patient.period.slice(0, 2) : []
  };
  const tab = await chrome.tabs.create({ url: url.href, windowId: source.windowId, active: false, openerTabId: source.id });
  let opened = false;
  try {
    let result;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        result = await chrome.tabs.sendMessage(tab.id, { type: "rsdkh:jaga-resolve-igd-patient", patient: lookup });
        break;
      } catch (error) {
        if (!/receiving end does not exist|could not establish connection/i.test(error.message)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    if (!result?.ok) throw new Error(result?.error || "Tab latar belakang belum siap. Coba buka pasien lagi.");
    const current = await chrome.tabs.get(tab.id);
    const destination = new URL(result.ermUrl);
    if (destination.origin !== url.origin || !patientVisitUrl(destination.href) || current.url !== destination.href) {
      throw new Error("Tujuan eRM pasien IGD tidak dapat diverifikasi.");
    }
    if (current.groupId !== group.id) await chrome.tabs.group({ groupId: group.id, tabIds: tab.id });
    opened = true;
    return { handled: true };
  } finally {
    if (!opened) await chrome.tabs.remove(tab.id).catch(() => {});
  }
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

function manageVisite(action) {
  const operation = visiteQueue.then(action);
  visiteQueue = operation.catch(() => {});
  return operation;
}

function mutateVisite(groups, windowId) {
  return manageVisite(async () => {
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
}

function selectVisiteDoctor(doctorKey, sender) {
  return manageVisite(async () => {
    await dashboardFromSender(sender, "visite.html");
    const V = self.NetmedicVisite;
    const saved = await chrome.storage.local.get(V.KEY);
    const session = saved[V.KEY];
    if (session?.doctors?.some((doctor) => V.doctorKey(doctor.name) === doctorKey) && session.selectedDoctor !== doctorKey) {
      await chrome.storage.local.set({ [V.KEY]: { ...session, selectedDoctor: doctorKey } });
    }
  });
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
  return showSessionTab("visite.html", dashboard, groupId, url, existing, update);
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
  const page = "dashboard.html";
  const dashboard = await dashboardFromSender(sender, page);
  const groupId = await ensureDashboardGroup(dashboard, page).catch(() => null);
  const visitUrl = patientVisitUrl(patient?.ermUrl);
  if (groupId !== null && visitUrl) {
    const members = await chrome.tabs.query({ windowId: dashboard.windowId, groupId });
    const existing = members.find((tab) => patientVisitUrl(tab.pendingUrl || tab.url) === visitUrl);
    if (existing) return showSessionTab(page, dashboard, groupId, null, existing);
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
  if (existing) return showSessionTab(page, dashboard, groupId, null, existing);
  if (!patient?.ermUrl) throw new Error("URL eRM pasien belum tersimpan.");
  const url = new URL(patient.ermUrl);
  if (!(["rsudbalangan.com", "10.10.0.3"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol))) {
    throw new Error("URL eRM pasien tidak valid.");
  }
  return showSessionTab(page, dashboard, groupId, url.href);
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
  if (message?.type === "rsdkh:jaga-open-igd-patient") {
    openIgdPatientInJaga(message.patient, sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'rsdkh:cppt-copy-context') {
    (async () => {
      const url = new URL(sender.tab?.url || '');
      if (!['rsudbalangan.com', '10.10.0.3'].includes(url.hostname) || !/\/cppt(?:$|\?)/.test(url.hash)) throw new Error('Buka halaman CPPT pasien terlebih dahulu.');
      const result = await chrome.tabs.sendMessage(sender.tab.id, { type: 'rsdkh:get-current-patient-report-identity' });
      if (!result?.ok || !result.identity?.medicalRecordNumber || result.identity.visitId !== url.hash.split('/')[3]) throw new Error('Identitas kunjungan CPPT belum tersedia.');
      const V = self.NetmedicVisite, saved = await chrome.storage.local.get(V.KEY);
      const session = saved[V.KEY];
      return {
        identity: result.identity,
        careTeam: V.careTeamFor(session, result.identity),
        visiteNumber: V.patientNumberFor(session, result.identity)
      };
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
    "rsdkh:visite-select-doctor": () => selectVisiteDoctor(message.doctor, sender),
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
    "rsdkh:jaga-open-patient-list": () => manageSessionTabs(() => openSessionPatientList("dashboard.html", sender)),
    "rsdkh:visite-open-patient-list": () => manageSessionTabs(() => openSessionPatientList("visite.html", sender)),
    "rsdkh:jaga-toggle-dashboard-pin": () => manageSessionTabs(() => toggleDashboardPin("dashboard.html", sender)),
    "rsdkh:visite-toggle-dashboard-pin": () => manageSessionTabs(() => toggleDashboardPin("visite.html", sender)),
    "rsdkh:focus-patient": () => manageSessionTabs(async () => ({ tabId: await focusPatientTab(message.patient, sender) })),
    "rsdkh:dashboard-ready": () => manageSessionTabs(async () => {
      const page = sender.url === chrome.runtime.getURL("visite.html") ? "visite.html" : "dashboard.html";
      const dashboard = await dashboardFromSender(sender, page);
      await ensureDashboardGroup(dashboard, page).catch(() => {});
      return { tabId: dashboard.id, pinned: (await chrome.tabs.get(dashboard.id)).pinned };
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
