const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.VISITE_TEST_BROWSER ? { executablePath: process.env.VISITE_TEST_BROWSER } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
    const badge = (key, text) => `<span class="order-badge">${text}<button label="${key}">${key}</button></span>`;
    const card = (date, reg, s, p) => `<table class="tb-custom"><tr><td class="koneng" colspan="3">${date}</td></tr><tr><td><button icon="pi pi-check-square" title="Edit">Edit</button></td><td><div class="title-ruangan">ROSE</div><div class="title-layan">dr. Ratna</div><div class="title-kelas">${reg}</div></td><td>${badge('S', s)}${badge('O', 'TD 100/63 mmHg')}${badge('A', 'Melena + anemia')}${badge('P', p)}</td></tr></table>`;
    const html = `<style>body{font:14px Arial}table{width:100%;border:1px solid #c4c6d0;border-radius:8px;margin-bottom:16px}td{padding:8px}.koneng{background:#fff18a}.order-badge{display:block;border:1px solid #25c891;border-radius:8px;padding:8px;margin:4px}td:first-child{width:100px}</style><div><h4>INFO REGISTRASI</h4><p><i class="pi-book"></i>2611000329</p></div>${card('05 Nov 2026 09:45', '2611000329', 'Keluhan entri Ratna', 'Terapi 1\nTerapi 2<br>Terapi 3')}${card('03 Nov 2026 07:10', '2611000329', 'Keluhan entri awal', 'Terapi awal')}${card('01 Oct 2026 07:10', '2610000001', 'Kunjungan lama', 'Terapi lama')}`;
    await page.route('https://rsudbalangan.com:91/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://rsudbalangan.com:91/#/rekam-medis/p/v/cppt');
    await page.evaluate(() => {
      Date.now = () => Date.parse('2026-11-05T03:00:00Z');
      window.copied = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copied = text; } } });
      window.chrome = { runtime: { sendMessage: async () => ({ ok: true, identity: { name: 'Akhmad Yamani', gender: 'Laki-laki', age: '51 tahun 7 bln 24 hari', medicalRecordNumber: '156082', registrationNumber: '', visitId: 'v' }, careTeam: { primaryDoctors: ['dr. Rahmat'], sharedDoctors: ['dr. Akhmad', 'dr. Widya'] }, visiteNumber: 1 }) } };
    });
    await page.addScriptTag({ path: 'hospital/rsdkh/cppt-copy.js' });
    await page.addStyleTag({ path: 'hospital/rsdkh/cppt-copy.css' });
    assert.equal(await page.locator('.rsdkh-cppt-konsul').count(), 3);
    assert.equal(await page.locator('.rsdkh-cppt-konsul').first().getAttribute('title'), 'Konsul');
    await page.locator('.rsdkh-cppt-konsul').first().click();
    await page.waitForFunction(() => window.copied.length > 0);
    const text = await page.evaluate(() => window.copied);
    assert.match(text, /^ROSE #1\n/);
    assert.match(text, /Perawatan Hari ke-3/);
    assert.match(text, /DPJP Utama : dr\. Rahmat \/ Raber : dr\. Akhmad, dr\. Widya/);
    assert.match(text, /S\)\nKeluhan entri Ratna/);
    assert.match(text, /P\)\nTerapi 1\nTerapi 2\nTerapi 3$/);
    assert.doesNotMatch(text, /Keluhan entri awal|Kunjungan lama|Terapi lama|156082/);
    await page.locator('.rsdkh-cppt-konsul').last().click();
    assert.match(await page.locator('#rsdkh-cppt-copy-toast').innerText(), /bukan kunjungan aktif/);
    assert.equal(await page.evaluate(() => window.copied), text);
    assert.equal(await page.locator('.rsdkh-cppt-konsul').count(), 3, 'injection stays idempotent');
    await page.locator('.rsdkh-cppt-konsul').first().click();
    await page.screenshot({ path: 'output/playwright/cppt-konsul-v2.3.0.png', fullPage: true });
    console.log('PASS CPPT DOM: round buttons, exact entry, original line breaks, earliest current-visit CPPT, clipboard, wrong visit rejected');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
