const assert = require("node:assert/strict");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.VISITE_TEST_BROWSER ? { executablePath: process.env.VISITE_TEST_BROWSER } : {}) });
  try {
    for (const layout of ["split-hidden-header", "split-body-only", "normal"]) {
      const split = layout !== "normal";
      const page = await browser.newPage();
      try {
        let groups;
        const labels = ["Aksi", "No", "Tgl Registrasi", "No RM", "Noregistrasi", "Nama Pasien", "Resume", "Dokter", "Dokter Bersama", "Kelas", "Ruangan", "Kamar"];
        const head = `<thead><tr>${labels.map((label) => `<th>${label}</th>`).join("")}</tr></thead>`;
        const data = ['<a href="#/rekam-medis/p/visit-a"><i class="fa-stethoscope"></i></a>', "1", "2026-11-04", "001234", "2611000854", "ABDULLAH", "-", "dr. Akhmad, Sp.PD", "dr. Rahmat, Sp.JP", "Kelas 1", "ANGGREK", "ANGGREK 8"];
        const body = `<tbody><tr>${data.map((value, index) => `<td><span class="p-column-title">${labels[index]}</span>${value}</td>`).join("")}</tr></tbody>`;
        // PrimeNG keeps the visible header and patient rows in different tables.
        const tables = split
          ? `<div class="p-datatable-scrollable-wrapper ng-star-inserted"><div class="p-datatable-scrollable-view"><div class="p-datatable-scrollable-header"><table>${head}</table></div><div class="p-datatable-scrollable-body ng-star-inserted"><table>${layout === "split-hidden-header" ? head : ""}${body}</table></div></div></div>`
          : `<table>${head}${body}</table>`;
        const html = `<style>.p-column-title{display:none}.p-datatable-scrollable-body thead{visibility:hidden;height:0}</style><a>Pasien Pulang</a><label><input type="checkbox" checked>Hanya Pasien Dokter Saya</label><button>Cari</button><section id="p-tabpanel-4"><div class="p-col-12 p-p-0"><p-table><div class="p-datatable">${tables}<div class="p-paginator"><select><option>10</option><option>100</option></select><button class="p-paginator-next" disabled>Next</button></div></div></p-table></div></section>`;
        await page.route("https://rsudbalangan.com:91/**", (route) => route.fulfill({ contentType: "text/html", body: html }));
        await page.goto("https://rsudbalangan.com:91/#/daftar-pasien-dirawat");
        await page.exposeFunction("saveGroups", (value) => { groups = value; });
        await page.evaluate(() => { window.chrome = { runtime: { sendMessage: async (message) => { await window.saveGroups(message.groups); return { ok: true }; } } }; });
        await page.addScriptTag({ path: "visite-state.js" });
        await page.addScriptTag({ path: "hospital/rsdkh/visite.js" });
        await page.click("#rsdkh-visite-button");
        await page.waitForFunction(() => document.querySelector('.rsdkh-visite-modal input') || document.querySelector('.rsdkh-visite-error'), null, { timeout: 12000 });
        const error = await page.locator('.rsdkh-visite-error').count() ? await page.locator('.rsdkh-visite-error').textContent() : "";
        assert.equal(error, "", `Layout ${split ? "split" : "normal"}: ${error}`);
        assert.equal(await page.locator('.rsdkh-visite-modal input').count(), 2);
        assert.equal(await page.locator('select').inputValue(), "100");
        assert.equal(await page.locator('body > label input').isChecked(), false);
        for (const checkbox of await page.locator('.rsdkh-visite-modal input').all()) await checkbox.check();
        await page.click('.rsdkh-visite-modal button[type=submit]');
        assert.equal(groups.length, 2);
        assert.equal(groups[0].patients[0].name, "ABDULLAH");
        assert.equal(groups[0].patients[0].medicalRecordNumber, "001234");
        assert.equal(groups[0].patients[0].raber, false);
        assert.equal(groups[1].patients[0].raber, true);
        console.log(`PASS ${layout}: patient, RM, doctors, Raber, 100 rows`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
