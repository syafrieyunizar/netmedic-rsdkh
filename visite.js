const V = NetmedicVisite;
let session = null, selectedDoctor = "";
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
  if (!doctors.some((doctor) => V.doctorKey(doctor.name) === selectedDoctor)) selectedDoctor = V.doctorKey(doctors[0]?.name);
  $("#doctorTabs").replaceChildren(); $("#roomList").replaceChildren();
  for (const doctor of doctors) {
    const active = V.doctorKey(doctor.name) === selectedDoctor;
    const button = document.createElement("button"); button.type = "button";
    button.textContent = `${active ? "✓ " : ""}${doctor.name}`;
    button.setAttribute("aria-pressed", String(active));
    button.addEventListener("click", () => { selectedDoctor = V.doctorKey(doctor.name); render(); });
    $("#doctorTabs").append(button);
    if (!active) continue;
    for (const room of doctor.rooms) {
      const section = document.createElement("section"), heading = document.createElement("h2");
      heading.textContent = `${room.name} · ${room.patients.length} pasien`; section.append(heading);
      for (const patient of room.patients) {
        const row = document.createElement("div"); row.className = "visite-patient";
        const name = document.createElement("button"); name.className = "visite-name"; name.type = "button";
        name.textContent = `${patient.name}${patient.raber ? " (Raber)" : ""}`;
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
chrome.storage.local.get(V.KEY).then((saved) => { session = saved[V.KEY] || null; render(); }).catch((error) => notice(error.message));
