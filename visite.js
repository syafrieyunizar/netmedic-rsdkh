const V = NetmedicVisite;
let session = null;
let dashboardTabId;
const $ = (selector) => document.querySelector(selector);
function notice(message) { $("#visiteNotice").textContent = message; $("#visiteNotice").hidden = false; }
async function openPatient(patient, button) {
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "rsdkh:visite-open-patient", patient });
    if (!response?.ok) throw new Error(response?.error || "CPPT gagal dibuka.");
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; }
}
function render() {
  const doctors = session?.doctors || [];
  $("#emptyVisite").hidden = doctors.length > 0;
  $("#finishVisite").hidden = !doctors.length;
  $("#sessionMeta").textContent = session ? `Mulai ${new Date(session.startedAt).toLocaleString("id-ID")} · ${doctors.length} dokter` : "";
  const selectedDoctor = V.selectedDoctorFor(session);
  $("#doctorTabs").replaceChildren(); $("#roomList").replaceChildren();
  for (const doctor of doctors) {
    const active = doctor === selectedDoctor;
    const button = document.createElement("button"); button.type = "button";
    button.textContent = `${active ? "✓ " : ""}${doctor.name}`;
    button.setAttribute("aria-pressed", String(active));
    button.addEventListener("click", async () => {
      if (active) return;
      try {
        const response = await chrome.runtime.sendMessage({ type: "rsdkh:visite-select-doctor", doctor: V.doctorKey(doctor.name) });
        if (!response?.ok) throw new Error(response?.error || "Pilihan dokter gagal disimpan.");
      } catch (error) { notice(error.message); }
    });
    $("#doctorTabs").append(button);
    if (!active) continue;
    for (const room of V.numberedRooms(doctor)) {
      const section = document.createElement("section"), heading = document.createElement("h2");
      heading.textContent = `${room.name} · ${room.patients.length} pasien`; section.append(heading);
      for (const { patient, number } of room.patients) {
        const row = document.createElement("div"); row.className = "visite-patient";
        const name = document.createElement("button"); name.className = "visite-name"; name.type = "button";
        name.textContent = `${number}. ${patient.name}${patient.raber ? " (Raber)" : ""}`;
        const rm = document.createElement("small"); rm.textContent = `RM ${patient.medicalRecordNumber}`;
        const cppt = document.createElement("button"); cppt.className = "visite-cppt"; cppt.type = "button"; cppt.textContent = "CPPT"; cppt.setAttribute("aria-label", `Buka CPPT ${patient.name}`);
        for (const button of [name, cppt]) button.addEventListener("click", () => openPatient(patient, button));
        row.append(name, rm, cppt); section.append(row);
      }
      $("#roomList").append(section);
    }
  }
}
$("#finishVisite").addEventListener("click", async () => {
  if (!confirm("Selesaikan visite? Seluruh daftar pasien dalam sesi ini akan dihapus tanpa riwayat.")) return;
  try { const response = await chrome.runtime.sendMessage({ type: "rsdkh:visite-finish" }); if (!response?.ok) throw new Error(response?.error); }
  catch (error) { notice(error.message); }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[V.KEY]) { session = changes[V.KEY].newValue || null; render(); } });

$("#openInpatientList").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "rsdkh:visite-open-patient-list" });
    if (!response?.ok) throw new Error(response?.error || "Daftar Pasien Rawat Inap gagal dibuka.");
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; }
});

const pinButton = $("#toggleDashboardPin");
function renderDashboardPin(pinned) {
  pinButton.dataset.pinned = String(Boolean(pinned));
  pinButton.querySelector("span").textContent = pinned ? "Unpin" : "PIN Dashboard Visite";
}
pinButton.addEventListener("click", async () => {
  pinButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "rsdkh:visite-toggle-dashboard-pin" });
    if (!response?.ok) throw new Error(response?.error || "Pin Dashboard Visite gagal diubah.");
    renderDashboardPin(response.result.pinned);
  } catch (error) { notice(error.message); }
  finally { pinButton.disabled = false; }
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId === dashboardTabId && typeof change.pinned === "boolean") renderDashboardPin(change.pinned);
});
chrome.runtime.sendMessage({ type: "rsdkh:dashboard-ready" }).then((response) => {
  if (!response?.ok) throw new Error(response?.error || "Status pin Dashboard Visite belum tersedia.");
  dashboardTabId = response.result.tabId;
  renderDashboardPin(response.result.pinned);
  pinButton.disabled = false;
}).catch((error) => notice(error.message));
chrome.storage.local.get(V.KEY).then((saved) => { session = saved[V.KEY] || null; render(); }).catch((error) => notice(error.message));
