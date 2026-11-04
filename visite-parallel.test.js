const assert = require('node:assert/strict');
const V = require('./visite-state.js');
const patient = (id) => ({ medicalRecordNumber: '001234', registrationNumber: String(2611000000 + id) });
const patients = Array.from({ length: 20 }, (_, index) => patient(index));
const groups = [{ doctor: 'dr. A', patients }, { doctor: 'dr. B', patients: [patients[0]] }];
(async () => {
  let active = 0, peak = 0, calls = 0;
  const progress = [];
  const result = await V.resolveSelectedLinks(groups, async (item) => {
    active++; peak = Math.max(peak, active); calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return `https://rsudbalangan.com:91/#/rekam-medis/p/${item.registrationNumber}`;
  }, (done, total) => progress.push([done, total]));
  assert.equal(peak, 3);
  assert.equal(calls, 20, 'shared patient resolved once');
  assert.equal(active, 0);
  assert.deepEqual(progress.map(([done]) => done), Array.from({ length: 21 }, (_, index) => index));
  assert.ok(progress.every(([, total]) => total === 20));
  assert.equal(result[0].patients[0].ermUrl, result[1].patients[0].ermUrl);
  assert.equal(groups[0].patients[0].ermUrl, undefined, 'input stays unchanged');
  let started = 0, running = 0;
  await assert.rejects(V.resolveSelectedLinks(groups, async () => {
    const index = started++; running++;
    if (!index) { running--; throw new Error('test failure'); }
    await new Promise((resolve) => setTimeout(resolve, 10));
    running--;
    return 'https://rsudbalangan.com:91/#/rekam-medis/p/v';
  }), /test failure/);
  assert.equal(started, 3, 'failure stops new jobs');
  assert.equal(running, 0, 'all in-flight jobs finish before retry is allowed');
  console.log('PASS 20-patient pool: concurrency 3, deduplication, completion progress, failure drains active jobs');
})().catch((error) => { console.error(error); process.exit(1); });
