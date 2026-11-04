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
      async create(options) { created.push(options); return { id: 10 }; },
      async sendMessage(id, message) { assert.equal(id, 10); assert.equal(message.patient.registrationNumber, '2611000854'); return fail ? { ok: false, error: 'Patient not found' } : { ok: true, ermUrl: target }; },
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
  assert.deepEqual(removed, [10, 10]);
  await assert.rejects(context.resolveVisiteLink(patient, { tab: { url: 'https://example.com/' } }), /daftar pasien/);
  await assert.rejects(context.resolveVisiteLink({ ...patient, registrationNumber: '' }, sender), /registrasi/);
  assert.equal(created.length, 2);
  console.log('PASS background tab stays inactive, URL verified, cleanup on success/error, invalid requests rejected');
})().catch((error) => { console.error(error); process.exit(1); });
