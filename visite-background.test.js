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
      async sendMessage(id, message) { assert.ok(id >= 10); assert.equal(message.patient.registrationNumber, '2611000854'); return fail ? { ok: false, error: 'Patient not found' } : { ok: true, ermUrl: target }; },
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
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  context.chrome.tabs.sendMessage = async () => { await barrier; return { ok: true, ermUrl: target }; };
  const parallel = Array.from({ length: 3 }, () => context.resolveVisiteLink(patient, sender));
  await assert.rejects(context.resolveVisiteLink(patient, sender), /Tiga tab/);
  assert.equal(created.length, 5);
  release();
  await Promise.all(parallel);
  assert.deepEqual(removed.slice(2).sort(), [12, 13, 14]);
  await context.resolveVisiteLink(patient, sender);
  assert.equal(created.length, 6, 'capacity available again after cleanup');
  console.log('PASS inactive tabs, URL verification, cleanup on success/error, maximum three parallel tabs');
})().catch((error) => { console.error(error); process.exit(1); });
