((root) => {
  const KEY = "rsdkhVisiteSession";
  const LINK_CONCURRENCY = 3;
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const doctorKey = (value) => clean(value).toLocaleLowerCase("id-ID").replace(/[.,\s]+/g, "");
  const patientKey = (patient) => `${clean(patient.medicalRecordNumber)}:${clean(patient.visitId)}`;
  function cpptUrl(value) {
    const url = new URL(value);
    if (!["rsudbalangan.com", "10.10.0.3"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol)) throw new Error("Alamat pasien tidak valid.");
    const match = url.hash.match(/^#\/rekam-medis\/([^/]+)\/([^/]+)/);
    if (!match) throw new Error("Link kunjungan pasien belum ditemukan.");
    url.hash = `#/rekam-medis/${match[1]}/${match[2]}/cppt`;
    return url.href;
  }
  function mergeSession(current, groups) {
    const now = new Date().toISOString();
    const next = current ? structuredClone(current) : { startedAt: now, doctors: [] };
    if (!Array.isArray(groups) || !groups.length) throw new Error("Pilih setidaknya satu dokter.");
    for (const group of groups) {
      const name = clean(group.doctor), room = clean(group.room);
      if (!name || !room || !Array.isArray(group.patients)) throw new Error("Data visite belum lengkap.");
      const patients = new Map();
      for (const source of group.patients) {
        const url = cpptUrl(source.ermUrl);
        const visitId = new URL(url).hash.split("/")[3];
        const patient = { name: clean(source.name), medicalRecordNumber: clean(source.medicalRecordNumber), visitId, ermUrl: url, raber: Boolean(source.raber) };
        if (!patient.name || !patient.medicalRecordNumber) throw new Error("Identitas pasien visite belum lengkap.");
        const key = patientKey(patient);
        if (patients.has(key)) patient.raber = patient.raber && patients.get(key).raber;
        patients.set(key, patient);
      }
      let doctor = next.doctors.find((item) => doctorKey(item.name) === doctorKey(name));
      if (!doctor) { doctor = { name, rooms: [] }; next.doctors.push(doctor); }
      const keys = new Set(patients.keys());
      doctor.rooms = doctor.rooms.filter((item) => item.name !== room).map((item) => ({ ...item, patients: item.patients.filter((patient) => !keys.has(patientKey(patient))) }));
      doctor.rooms.unshift({ name: room, patients: [...patients.values()] });
    }
    next.updatedAt = now;
    return next;
  }
  async function resolveSelectedLinks(groups, resolveLink, onProgress = () => {}) {
    const keyFor = (patient) => `${patient.medicalRecordNumber}:${patient.registrationNumber}`;
    const selected = new Map();
    for (const group of groups) for (const patient of group.patients) selected.set(keyFor(patient), patient);
    const patients = [...selected.values()], links = new Map();
    let cursor = 0, completed = 0, failure;
    onProgress(completed, patients.length);
    const workers = Array.from({ length: Math.min(LINK_CONCURRENCY, patients.length) }, async () => {
      while (!failure && cursor < patients.length) {
        const patient = patients[cursor++];
        try {
          const url = cpptUrl(await resolveLink(patient));
          links.set(keyFor(patient), url);
          onProgress(++completed, patients.length);
        } catch (error) { if (!failure || !error.retryable) failure = error; }
      }
    });
    await Promise.all(workers);
    if (failure) {
      if (!failure.retryable) throw failure;
      onProgress(completed, patients.length, 'serial-retry');
      for (const patient of patients) {
        if (links.has(keyFor(patient))) continue;
        const url = cpptUrl(await resolveLink(patient));
        links.set(keyFor(patient), url);
        onProgress(++completed, patients.length, 'serial-retry');
      }
    }
    return groups.map((group) => ({ ...group, patients: group.patients.map((patient) => ({ ...patient, ermUrl: links.get(keyFor(patient)) })) }));
  }
  const api = { KEY, LINK_CONCURRENCY, clean, doctorKey, patientKey, cpptUrl, mergeSession, resolveSelectedLinks };
  root.NetmedicVisite = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
