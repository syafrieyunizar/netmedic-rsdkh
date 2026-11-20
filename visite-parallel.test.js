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
  assert.equal(peak, 2);
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
  assert.equal(started, 2, 'failure stops new jobs');
  assert.equal(running, 0, 'all in-flight jobs finish before retry is allowed');
  const attempts = new Map(), recoveryProgress = [];
  let serial = false, recovering = false, recoveryActive = 0;
  const recovered = await V.resolveSelectedLinks(groups, async (item) => {
    const count = (attempts.get(item.registrationNumber) || 0) + 1;
    attempts.set(item.registrationNumber, count);
    recoveryActive++;
    if (serial) assert.equal(recoveryActive, 1, 'retry is sequential after draining the parallel jobs');
    await new Promise((resolve) => setTimeout(resolve, 5));
    recoveryActive--;
    if (patients.indexOf(item) < 2 && count === 1) throw Object.assign(new Error("temporary lookup failure"), { stage: "lookup" });
    return `https://rsudbalangan.com:91/#/rekam-medis/p/${item.registrationNumber}`;
  }, (done, total, phase) => { recovering ||= phase === "retry"; serial ||= phase === "serial"; recoveryProgress.push(done); });
  assert.equal(attempts.get(patients[0].registrationNumber), 2);
  assert.equal(attempts.get(patients[1].registrationNumber), 2);
  assert.ok(recovering && serial, "first failure queues a retry and the repeated stage switches to one tab");
  for (const item of patients.slice(2)) assert.equal(attempts.get(item.registrationNumber), 1, 'successful links are not fetched again');
  assert.equal(recoveryProgress.at(-1), 20);
  assert.equal(recoveryActive, 0);
  assert.equal(recovered[0].patients.length, 20);
  assert.equal(recovered[0].patients[0].ermUrl, recovered[1].patients[0].ermUrl);
  let isolatedAttempts = 0, isolatedSerial = false;
  await V.resolveSelectedLinks(groups, async (item) => {
    if (item === patients[0] && ++isolatedAttempts === 1) throw Object.assign(new Error("temporary startup failure"), { stage: "load" });
    return "https://rsudbalangan.com:91/#/rekam-medis/p/v";
  }, (done, total, phase) => { isolatedSerial ||= phase === "serial"; });
  assert.equal(isolatedAttempts, 2);
  assert.equal(isolatedSerial, false, "an isolated failure does not trigger serial mode");
  console.log('PASS parallel pool, bounded concurrency, cleanup, serial recovery, successful links retained');
})().catch((error) => { console.error(error); process.exit(1); });
