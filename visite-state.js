((root) => {
  const KEY = "rsdkhVisiteSession";
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
  const api = { KEY, clean, doctorKey, patientKey, cpptUrl, mergeSession };
  root.NetmedicVisite = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
