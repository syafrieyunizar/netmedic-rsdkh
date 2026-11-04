(() => {
  const V = globalThis.NetmedicVisite;
  const clean = V.clean;
  let running = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => Boolean(element?.getClientRects().length);
  const onList = () => location.hash.split("?")[0] === "#/daftar-pasien-dirawat";
  async function until(read, message, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const value = read(); if (value) return value; await sleep(150); }
    throw new Error(message);
  }
  function sourceTable() {
    const hasPatientHeaders = (element) => /Dokter Bersama/i.test(element?.textContent || "") && /Nama Pasien/i.test(element?.textContent || "");
    const scrollBody = [...document.querySelectorAll('.p-datatable-scrollable-body > table')].find((table) => {
      const view = table.closest('.p-datatable-scrollable-view') || table.closest('.p-datatable');
      return visible(table) && hasPatientHeaders(view?.querySelector('.p-datatable-scrollable-header'));
    });
    if (scrollBody) return scrollBody;
    return [...document.querySelectorAll("table")].find((table) => visible(table) && table.querySelector('tbody') && hasPatientHeaders(table));
  }
  function cellText(cell) {
    if (!cell) return "";
    const copy = cell.cloneNode(true);
    copy.querySelectorAll('.p-column-title, .p-sr-only, .sr-only, [aria-hidden="true"]').forEach((node) => node.remove());
    return clean(copy.textContent);
  }
  function rows() {
    const table = sourceTable();
    if (!table) throw new Error("Tabel pasien rawat inap belum tersedia.");
    const view = table.closest('.p-datatable-scrollable-view') || table.closest('.p-datatable');
    const headerTable = table.closest('.p-datatable-scrollable-body')
      ? view?.querySelector('.p-datatable-scrollable-header table') || table
      : table;
    const headerRow = [...headerTable.querySelectorAll("thead tr")].find((row) => row.closest("table") === headerTable && /Nama Pasien/i.test(row.textContent) && /Dokter Bersama/i.test(row.textContent));
    const headers = [...(headerRow?.children || [])].map((node) => cellText(node).toLowerCase().replace(/[^a-z0-9]/g, ""));
    const index = (...names) => headers.findIndex((header) => names.includes(header));
    const columns = { name: index("namapasien"), rm: index("norm", "norekammedis"), room: index("ruangan"), doctor: index("dokter"), shared: index("dokterbersama") };
    if (Object.values(columns).some((value) => value < 0)) throw new Error("Kolom nama, RM, ruangan, atau dokter tidak dikenali.");
    return [...table.querySelectorAll("tbody tr")].filter((row) => row.closest("table") === table).flatMap((row) => {
      const cells = [...row.children].filter((cell) => cell.tagName === "TD");
      if (cells.length <= Math.max(...Object.values(columns))) return [];
      const read = (key) => cellText(cells[columns[key]]);
      const name = read("name"), medicalRecordNumber = read("rm"), room = read("room");
      if (!name || !/^\d{5,8}$/.test(medicalRecordNumber) || !room) return [];
      const doctorCell = cells[columns.doctor], sharedCell = cells[columns.shared];
      const doctors = (cell) => {
        const text = cellText(cell);
        return text.split(/(?=\bdr\.?\s)/i).map(clean).filter((name) => /^dr\.?\s/i.test(name));
      };
      const icon = row.querySelector('[class*="stethoscope"]');
      const action = icon?.closest("a,button") || row.querySelector('a[href*="/rekam-medis/"]');
      const anchor = action?.closest("a[href]") || action?.querySelector("a[href]");
      const href = anchor?.getAttribute("href");
      let ermUrl = "";
      if (href) { try { ermUrl = V.cpptUrl(new URL(href, location.href).href); } catch {} }
      const registrationIndex = index('noregistrasi', 'nomorregistrasi');
      const registrationNumber = registrationIndex >= 0 ? cellText(cells[registrationIndex]) : '';
      return [{ name, medicalRecordNumber, registrationNumber, room, doctors: doctors(doctorCell), sharedDoctors: doctors(sharedCell), ermUrl, action }];
    });
  }
  function paginator() {
    const scope = sourceTable()?.closest('p-table, .p-datatable') || document;
    return [...scope.querySelectorAll(".p-paginator")].find(visible);
  }
  async function settle() {
    await sleep(500);
    let last = null, stableSince = Date.now();
    await until(() => {
      if (!sourceTable() || [...document.querySelectorAll('.p-datatable-loading-overlay, .p-progress-spinner')].some(visible)) {
        last = null; stableSince = Date.now(); return false;
      }
      const signature = rows().map((row) => `${row.medicalRecordNumber}:${row.room}`).join("|");
      if (signature !== last) { last = signature; stableSince = Date.now(); }
      return Date.now() - stableSince >= (signature ? 1000 : 4000);
    }, "Daftar pasien belum stabil.");
  }
  async function setPageSize() {
    const pager = paginator(); if (!pager) throw new Error("Pengaturan jumlah baris bawah tidak ditemukan.");
    const native = pager.querySelector("select");
    if (native) {
      if (native.value !== "100") { native.value = "100"; native.dispatchEvent(new Event("change", { bubbles: true })); await settle(); }
      return;
    }
    const dropdown = pager.querySelector(".p-dropdown, [role=combobox]");
    if (!dropdown) throw new Error("Dropdown jumlah baris tidak ditemukan.");
    if (clean(dropdown.textContent) === "100") return;
    dropdown.click();
    const option = await until(() => [...document.querySelectorAll('[role=option], .p-dropdown-item')].find((node) => visible(node) && clean(node.textContent) === "100"), "Pilihan 100 baris tidak ditemukan.");
    option.click(); await settle();
  }
  async function prepare() {
    const label = [...document.querySelectorAll('label')].find((node) => visible(node) && /^Hanya Pasien Dokter Saya$/i.test(clean(node.textContent)));
    const input = label?.parentElement.querySelector('input[type=checkbox]') || label?.control;
    if (input?.checked) {
      const control = input.closest('p-checkbox, .p-checkbox');
      (control?.querySelector('.p-checkbox-box') || input).click();
      await until(() => !input.checked, "Filter dokter belum berhasil dinonaktifkan.");
    }
    const search = [...document.querySelectorAll("button")].find((button) => visible(button) && clean(button.textContent) === "Cari");
    if (!search) throw new Error("Tombol Cari tidak ditemukan.");
    search.click(); await settle(); await setPageSize();
    const first = paginator()?.querySelector(".p-paginator-first");
    if (first && !first.disabled && first.getAttribute("aria-disabled") !== "true") { first.click(); await settle(); }
  }
  async function resolveBackgroundPatient(patient) {
    if (!onList() || !patient.registrationNumber) throw new Error('Nomor registrasi pasien belum tersedia untuk pengambilan link.');
    await until(() => sourceTable(), 'Daftar pasien belum tersedia di tab pengambilan.');
    const registration = document.querySelector('input[placeholder="No Registrasi"]');
    if (!registration) throw new Error('Kolom pencarian registrasi tidak ditemukan.');
    for (const [placeholder, value] of [['No Rekam Medis', patient.medicalRecordNumber], ['Nama Pasien', ''], ['No Registrasi', patient.registrationNumber]]) {
      const field = document.querySelector(`input[placeholder="${placeholder}"]`);
      if (field) { field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    await prepare();
    const row = await until(() => sourceTable() && rows().find((item) => item.medicalRecordNumber === patient.medicalRecordNumber && item.registrationNumber === patient.registrationNumber && item.room === patient.room), 'Pasien dengan RM dan registrasi yang dipilih tidak ditemukan di tab pengambilan.');
    if (!row.action) throw new Error('Tombol stetoskop pasien tidak ditemukan.');
    row.action.click();
    await until(() => /^#\/rekam-medis\/[^/]+\/[^/]+/.test(location.hash), 'Link eRM pasien tidak terbaca.');
    return V.cpptUrl(location.href);
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'rsdkh:visite-resolve-patient') return false;
    resolveBackgroundPatient(message.patient).then((ermUrl) => sendResponse({ ok: true, ermUrl })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
  async function collect(status) {
    await prepare();
    const patients = new Map(), seenPages = new Set();
    while (true) {
      const pageRows = rows();
      const pageKey = pageRows.map((row) => `${row.medicalRecordNumber}:${row.room}`).join("|");
      if (seenPages.has(pageKey)) throw new Error("Halaman tabel berulang. Pengambilan dihentikan agar tidak ada data terlewat.");
      seenPages.add(pageKey);
      for (const source of pageRows) {
        status.textContent = 'Membaca daftar pasien dan dokter…';
        patients.set(`${source.medicalRecordNumber}:${source.registrationNumber}`, { ...source, action: undefined });
      }
      const next = paginator()?.querySelector(".p-paginator-next");
      if (!next || next.disabled || next.getAttribute("aria-disabled") === "true" || next.classList.contains("p-disabled")) break;
      next.click(); await settle();
    }
    if (!patients.size) {
      const sourceRows = [...(sourceTable()?.querySelectorAll('tbody tr') || [])].filter((row) => row.children.length > 1);
      throw new Error(sourceRows.length
        ? `Tabel berisi ${sourceRows.length} baris, tetapi kolom identitas pasien belum dapat dibaca. Muat ulang halaman setelah memperbarui extension.`
        : "Tidak ada pasien. Pilih ruangan yang memiliki pasien terlebih dahulu.");
    }
    return [...patients.values()];
  }
  async function start() {
    if (running) return;
    if (document.querySelector('.rsdkh-visite-modal[open]')) { document.querySelector('.rsdkh-visite-modal button')?.focus(); return; }
    running = true;
    const button = document.getElementById("rsdkh-visite-button"); button.disabled = true;
    const dialog = document.createElement("dialog"); dialog.className = "rsdkh-visite-modal";
    const form = document.createElement("form"), title = document.createElement("h2"), status = document.createElement("p"), fields = document.createElement("div"), footer = document.createElement("footer");
    title.textContent = "Mulai Visite"; status.textContent = "Menyiapkan daftar pasien…"; status.setAttribute("role", "status");
    const cancel = document.createElement("button"), submit = document.createElement("button");
    cancel.type = "button"; cancel.textContent = "Tutup"; cancel.disabled = true;
    submit.type = "submit"; submit.textContent = "Mulai Visite"; submit.hidden = true;
    footer.append(cancel, submit); form.append(title, status, fields, footer); dialog.append(form); document.body.append(dialog); dialog.showModal();
    dialog.addEventListener("cancel", (event) => { if (running) event.preventDefault(); });
    cancel.addEventListener("click", () => { dialog.close(); dialog.remove(); });
    try {
      const patients = await collect(status), selections = [];
      const rooms = [...new Set(patients.map((patient) => patient.room))];
      for (const room of rooms) {
        const roomPatients = patients.filter((patient) => patient.room === room);
        const doctors = new Map();
        for (const patient of roomPatients) for (const name of [...patient.doctors, ...patient.sharedDoctors]) doctors.set(V.doctorKey(name), name);
        const fieldset = document.createElement("fieldset"), legend = document.createElement("legend"); legend.textContent = room; fieldset.append(legend);
        for (const [key, name] of doctors) {
          const label = document.createElement("label"), checkbox = document.createElement("input"); checkbox.type = "checkbox";
          const matching = roomPatients.filter((patient) => [...patient.doctors, ...patient.sharedDoctors].some((doctor) => V.doctorKey(doctor) === key));
          label.append(checkbox, document.createTextNode(`${name} · ${matching.length} pasien`)); fieldset.append(label);
          selections.push({ checkbox, room, doctor: name, patients: matching.map((patient) => ({ ...patient, raber: !patient.doctors.some((doctor) => V.doctorKey(doctor) === key) })) });
        }
        if (!doctors.size) throw new Error(`Nama dokter di ${room} belum dapat dibaca.`);
        fields.append(fieldset);
      }
      status.textContent = "Pilih dokter untuk setiap ruangan yang ingin ditambahkan."; submit.hidden = false;
      form.addEventListener("submit", async (event) => {
        event.preventDefault(); submit.disabled = true; cancel.disabled = true; running = true;
        fields.querySelectorAll('fieldset').forEach((fieldset) => { fieldset.disabled = true; });
        try {
          const groups = selections.filter((item) => item.checkbox.checked).map(({ room, doctor, patients }) => ({ room, doctor, patients }));
          if (!groups.length) throw new Error("Pilih setidaknya satu dokter.");
          const selectedPatients = new Map();
          for (const group of groups) for (const patient of group.patients) selectedPatients.set(`${patient.medicalRecordNumber}:${patient.registrationNumber}`, patient);
          let completed = 0;
          for (const patient of selectedPatients.values()) {
            status.textContent = `Mengambil link pasien terpilih ${++completed}/${selectedPatients.size}…`;
            status.className = '';
            const response = await chrome.runtime.sendMessage({ type: 'rsdkh:visite-resolve-link', patient, sourceUrl: location.href });
            if (!response?.ok) throw new Error(response?.error || 'Link pasien belum berhasil diambil.');
            for (const group of groups) for (const item of group.patients) {
              if (item.medicalRecordNumber === patient.medicalRecordNumber && item.registrationNumber === patient.registrationNumber) item.ermUrl = response.ermUrl;
            }
          }
          const response = await chrome.runtime.sendMessage({ type: "rsdkh:visite-start", groups });
          if (!response?.ok) throw new Error(response?.error || "Sesi visite gagal dibuat.");
          dialog.close(); dialog.remove();
        } catch (error) { status.textContent = error.message; status.className = "rsdkh-visite-error"; }
        finally { submit.disabled = false; cancel.disabled = false; running = false; fields.querySelectorAll('fieldset').forEach((fieldset) => { fieldset.disabled = false; }); }
      });
    } catch (error) { status.textContent = error.message; status.className = "rsdkh-visite-error"; }
    finally { running = false; cancel.disabled = false; button.disabled = false; }
  }
  function inject() {
    if (!onList() || document.getElementById("rsdkh-visite-button")) return;
    const target = [...document.querySelectorAll("a,button,span")].find((node) => visible(node) && clean(node.textContent) === "Pasien Pulang");
    if (!target) return;
    const anchor = target.closest("li") || target.closest("a,button") || target;
    const button = document.createElement("button"); button.id = "rsdkh-visite-button"; button.type = "button";
    button.dataset.visiteBuild = "2.2.1-selected-background";
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6m3 11v-3a7 7 0 0 0-3-6"/></svg><span>VISITE</span>';
    button.addEventListener("click", start); anchor.after(button);
  }
  new MutationObserver(inject).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", inject); inject();
})();
