(() => {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6, agu: 7, ags: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11 };
  function careDay(firstDate, now = Date.now()) {
    const match = clean(firstDate).match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
    if (!match || months[match[2].toLowerCase()] === undefined) throw new Error('Tanggal CPPT paling bawah belum dapat dibaca.');
    const day = Number(match[1]), month = months[match[2].toLowerCase()], year = Number(match[3]);
    const start = Date.UTC(year, month, day), valid = new Date(start);
    if (valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month || valid.getUTCDate() !== day) throw new Error('Tanggal CPPT tidak valid.');
    const today = new Date(Number(now) + 8 * 3600000).toISOString().slice(0, 10);
    const count = Math.floor((Date.parse(`${today}T00:00:00Z`) - start) / 86400000) + 1;
    if (count < 1) throw new Error('Tanggal CPPT paling bawah berada setelah hari ini.');
    return count;
  }
  function patientLabel(identity) {
    let name = clean(identity.name);
    const age = clean(identity.age).replace(/\btahun\b/gi, 'thn');
    const years = Number(age.match(/^(\d+)\s*thn/i)?.[1] || 0);
    if (!/^(?:Tn|Ny|Nn|An|By|Bayi)\.?\s/i.test(name) && !/\b(?:Tn|Ny|Nn|An|By)\.?$/i.test(name)) {
      const prefix = years >= 18 ? (/^laki/i.test(identity.gender) ? 'Tn.' : /^perempuan$/i.test(identity.gender) ? 'Ny.' : '') : years >= 1 ? 'An.' : 'By.';
      name = `${prefix} ${name}`.trim();
    }
    const shortAge = age.match(/\d+\s*thn\s+\d+\s*bln/i)?.[0] || age;
    return `${name} / ${shortAge}`;
  }
  function formatReport({ identity, room, firstDate, soap, careTeam = {}, visiteNumber, now }) {
    if (!identity?.name || !identity.age || !room) throw new Error('Nama, umur, atau ruangan pasien belum lengkap.');
    const fields = [patientLabel(identity), `Perawatan Hari ke-${careDay(firstDate, now)}`];
    if (careTeam.primaryDoctors?.length) fields.push(`DPJP Utama : ${careTeam.primaryDoctors.join(', ')}`);
    if (careTeam.sharedDoctors?.length) fields.push(`Raber : ${careTeam.sharedDoctors.join(', ')}`);
    const heading = Number.isInteger(visiteNumber) && visiteNumber > 0 ? `${room} #${visiteNumber}` : room;
    return `${heading}\n*${fields.join(' / ')}*\n\n${['S', 'O', 'A', 'P'].map((key) => `${key})\n${String(soap[key] || '').trim()}`).join('\n\n')}`;
  }
  function badgeText(badge) {
    const clone = badge.cloneNode(true);
    clone.querySelectorAll('button').forEach((button) => button.remove());
    clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    return clone.textContent.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[\t ]+/g, ' ').trim()).join('\n').trim();
  }
  function readEntry(table) {
    const soap = {};
    for (const key of ['S', 'O', 'A', 'P']) {
      const button = table.querySelector(`button[label="${key}"]`);
      if (!button) throw new Error(`Bagian ${key} CPPT tidak ditemukan.`);
      soap[key] = badgeText(button.closest('.order-badge') || button.parentElement);
    }
    const pBadge = table.querySelector('button[label="P"]').closest('.order-badge');
    for (const badge of pBadge?.parentElement.querySelectorAll('.order-badge') || []) {
      const button = badge.querySelector('button');
      if (!button || ['S', 'O', 'A', 'P'].includes(clean(button.getAttribute('label') || button.textContent))) continue;
      soap.P += `\n\n${clean(button.textContent)}\n${badgeText(badge)}`;
    }
    return { soap, room: clean(table.querySelector('.title-ruangan')?.textContent), registration: clean(table.querySelector('.title-kelas')?.textContent), date: clean(table.querySelector('.koneng')?.textContent) };
  }
  const api = { careDay, patientLabel, formatReport, readEntry };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof document === 'undefined') return;
  let toastTimer, injectTimer;
  const onPage = () => /^#\/rekam-medis\/[^/]+\/[^/]+\/cppt(?:$|\?)/.test(location.hash);
  function notify(message, error = false) {
    let toast = document.getElementById('rsdkh-cppt-copy-toast');
    if (!toast) { toast = document.createElement('div'); toast.id = 'rsdkh-cppt-copy-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); document.body.append(toast); }
    toast.textContent = message; toast.dataset.error = String(error); toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 8000 : 3500);
  }
  async function copy(table, button) {
    button.disabled = true;
    try {
      const hash = location.hash;
      const response = await chrome.runtime.sendMessage({ type: 'rsdkh:cppt-copy-context' });
      if (!response?.ok) throw new Error(response?.error || 'Identitas pasien belum dapat dibaca.');
      if (location.hash !== hash || !table.isConnected) throw new Error('Halaman CPPT berubah. Coba kembali pada pasien yang sesuai.');
      const entry = readEntry(table);
      const info = [...document.querySelectorAll('h3, h4')].find((heading) => clean(heading.textContent) === 'INFO REGISTRASI')?.parentElement;
      const headerNumber = clean(info?.querySelector('.pi-book')?.parentElement.textContent);
      const headerRegistration = /^\d{9,11}$/.test(headerNumber) ? headerNumber : '';
      if (headerRegistration && response.identity.registrationNumber && headerRegistration !== String(response.identity.registrationNumber)) throw new Error('Identitas registrasi pada header belum sinkron.');
      const registration = headerRegistration || String(response.identity.registrationNumber || '');
      if (!registration || entry.registration !== registration) throw new Error('CPPT yang dipilih bukan kunjungan aktif pasien.');
      const entries = [...document.querySelectorAll('table.tb-custom')].filter((item) => item.querySelector('button[label="S"]') && clean(item.querySelector('.title-kelas')?.textContent) === registration);
      const firstDate = clean(entries.at(-1)?.querySelector('.koneng')?.textContent);
      const text = formatReport({ identity: response.identity, room: entry.room, firstDate, soap: entry.soap, careTeam: response.careTeam, visiteNumber: response.visiteNumber });
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const textarea = document.createElement('textarea'); textarea.value = text; textarea.style.cssText = 'position:fixed;left:-9999px'; document.body.append(textarea); textarea.select();
        try { if (!document.execCommand('copy')) throw new Error('Clipboard tidak tersedia.'); } finally { textarea.remove(); button.focus(); }
      }
      notify('CPPT berhasil disalin');
    } catch (error) { notify(error.message || 'CPPT gagal disalin', true); }
    finally { button.disabled = false; }
  }
  function inject() {
    if (!onPage()) return;
    for (const edit of document.querySelectorAll('table.tb-custom button[icon="pi pi-check-square"]')) {
      const table = edit.closest('table.tb-custom'), actions = edit.closest('td');
      if (!actions || !table.querySelector('button[label="S"]') || actions.querySelector('.rsdkh-cppt-konsul')) continue;
      const slot = document.createElement('div'); slot.className = 'rsdkh-cppt-konsul-slot';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'p-button-rounded p-button p-component p-button-icon-only rsdkh-cppt-konsul'; button.title = 'Konsul'; button.setAttribute('aria-label', 'Konsul'); button.innerHTML = '<span aria-hidden="true">👨‍⚕️</span>';
      button.dataset.cpptCopyBuild = '2.3-header';
      button.addEventListener('click', () => copy(table, button)); slot.append(button); actions.append(slot);
    }
  }
  new MutationObserver(() => { clearTimeout(injectTimer); injectTimer = setTimeout(inject, 80); }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', inject); inject();
})();
