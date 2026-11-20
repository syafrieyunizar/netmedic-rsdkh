const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const V = require('./visite-state.js');
const event = { addListener() {} };
let fail = false, removed = [], created = [];
const target = 'https://rsudbalangan.com:91/#/rekam-medis/p/v/cppt';
const context = vm.createContext({
  URL, console, setTimeout, clearTimeout, importScripts() {}, self: { NetmedicVisite: V },
  chrome: {
    runtime: { onInstalled: event, onStartup: event, onMessage: event },
    tabs: {
      onActivated: event, onUpdated: event,
      async create(options) { created.push(options); return { id: 9 + created.length }; },
      async sendMessage(id, message) { if (message.type === "rsdkh:visite-ready") return { ok: true }; assert.ok(id >= 10); assert.equal(message.patient.registrationNumber, '2611000854'); return fail ? { ok: false, error: 'Patient not found' } : { ok: true, ermUrl: target }; },
      async get() { return { url: target }; },
      async remove(id) { removed.push(id); }
    }
  }
});
vm.runInContext(fs.readFileSync('background.js', 'utf8'), context);
(async () => {
  const sender = { tab: { url: 'https://rsudbalangan.com:91/#/daftar-pasien-dirawat' } };
  const patient = { medicalRecordNumber: '001234', registrationNumber: '2611000854', room: 'ANGGREK' };
  const result = await context.resolveVisiteLink(patient, sender);
  assert.equal(result.ermUrl, target);
  assert.equal(created[0].active, false);
  assert.deepEqual(removed, [10]);
  fail = true;
  await assert.rejects(context.resolveVisiteLink(patient, sender), /Patient not found/);
  assert.deepEqual(removed, [10, 11]);
  await assert.rejects(context.resolveVisiteLink(patient, { tab: { url: 'https://example.com/' } }), /daftar pasien/);
  await assert.rejects(context.resolveVisiteLink({ ...patient, registrationNumber: '' }, sender), /registrasi/);
  assert.equal(created.length, 2);
  let markReady, finishLookup, firstProbe;
  const readiness = new Promise((resolve) => { markReady = resolve; });
  const lookup = new Promise((resolve) => { finishLookup = resolve; });
  const probed = new Promise((resolve) => { firstProbe = resolve; });
  context.chrome.tabs.sendMessage = async (id, message) => {
    if (message.type === "rsdkh:visite-ready") {
      if (id === 12) { firstProbe(); await readiness; }
      return { ok: true };
    }
    await lookup;
    return { ok: true, ermUrl: target };
  };
  const parallel = Array.from({ length: 2 }, () => context.resolveVisiteLink(patient, sender));
  await probed;
  await assert.rejects(context.resolveVisiteLink(patient, sender), /Dua tab/);
  assert.equal(created.length, 3, "the second tab waits for the first to be ready");
  markReady();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created.length, 4, "the second tab opens while the first lookup is still running");
  finishLookup();
  await Promise.all(parallel);
  assert.deepEqual(removed.slice(2).sort(), [12, 13]);
  await context.resolveVisiteLink(patient, sender);
  assert.equal(created.length, 5, "capacity available again after cleanup");
  context.dashboardFromSender = async () => ({ id: 1, windowId: 1 });
  context.ensureDashboardGroup = async () => 7;
  const resumeUrl = "https://rsudbalangan.com:91/#/rekam-medis/p/v/resume-new";
  const cpptTab = { id: 20, windowId: 1, groupId: 7, url: target };
  const resumeTab = { id: 21, windowId: 1, groupId: 7, url: resumeUrl };
  context.chrome.tabs.query = async () => [cpptTab];
  context.showSessionTab = async (page, dashboard, group, url, existing) => ({ url, existing });
  const visit = { ermUrl: target };
  const opened = await context.openVisitePatient(visit, sender, true);
  assert.equal(opened.url, resumeUrl);
  assert.equal(opened.existing, undefined, "resume opens separately from CPPT");
  context.chrome.tabs.query = async () => [resumeTab, cpptTab];
  assert.equal((await context.openVisitePatient(visit, sender, true)).existing, resumeTab);
  assert.equal((await context.openVisitePatient(visit, sender)).existing, cpptTab);
  context.chrome.tabs.query = async () => [resumeTab];
  assert.equal((await context.openVisitePatient(visit, sender)).existing, undefined);
  await assert.rejects(context.openVisitePatient({ ermUrl: "https://example.org/#/rekam-medis/p/v/cppt" }, sender, true), /Alamat pasien tidak valid/);
  console.log('PASS inactive tabs, URL verification, cleanup on success/error, two staggered tabs');
})().catch((error) => { console.error(error); process.exit(1); });
