const assert = require('node:assert/strict');
const F = require('./hospital/rsdkh/cppt-copy.js');
const V = require('./visite-state.js');
const now = Date.parse('2026-11-05T03:00:00Z');
assert.equal(F.careDay('03 Nov 2026 07:10', now), 3);
assert.equal(F.careDay('05 Nov 2026 07:10', now), 1);
assert.equal(F.careDay('05 Nov 2026 07:10', Date.parse('2026-11-05T16:00:00Z')), 2);
assert.throws(() => F.careDay('31 Nov 2026 07:10', now), /valid/);
assert.throws(() => F.careDay('06 Nov 2026 07:10', now), /setelah/);
assert.throws(() => F.careDay('', now));
const patient = { name: 'Akhmad Yamani', medicalRecordNumber: '156082', ermUrl: 'https://rsudbalangan.com:91/#/rekam-medis/p/v', doctors: ['dr. Rahmat'], sharedDoctors: ['dr. Akhmad', 'dr. Widya'] };
for (const chosen of ['dr. Rahmat', 'dr. Akhmad', 'dr. Widya']) {
  const session = V.mergeSession(null, [{ doctor: chosen, room: 'ROSE', patients: [patient] }]);
  assert.equal(session.doctors.length, 3);
  for (const doctor of session.doctors) {
    assert.equal(doctor.rooms[0].patients.length, 1);
    assert.equal(doctor.rooms[0].patients[0].raber, doctor.name !== 'dr. Rahmat');
  }
  assert.deepEqual(V.careTeamFor(session, { medicalRecordNumber: '156082', visitId: 'v' }), { primaryDoctors: ['dr. Rahmat'], sharedDoctors: ['dr. Akhmad', 'dr. Widya'] });
  assert.deepEqual(V.careTeamFor(session, { medicalRecordNumber: '156082', visitId: 'other' }), { primaryDoctors: [], sharedDoctors: [] });
}
const report = { identity: { name: 'Akhmad Yamani', age: '51 tahun 7 bln 24 hari', gender: 'Laki-laki' }, room: 'ROSE', firstDate: '03 Nov 2026 07:10', soap: { S: 'Keluhan', O: 'TD 100/63', A: 'Diagnosis', P: 'Terapi 1\nTerapi 2' }, now };
assert.match(F.formatReport(report), /\*Tn\. Akhmad Yamani \/ 51 thn 7 bln \/ Perawatan Hari ke-3\*/);
assert.doesNotMatch(F.formatReport(report), /DPJP|Raber/);
assert.match(F.formatReport(report), /P\)\nTerapi 1\nTerapi 2$/);
assert.match(F.formatReport({ ...report, careTeam: { primaryDoctors: ['dr. Rahmat'], sharedDoctors: ['dr. Akhmad', 'dr. Widya'] } }), /DPJP Utama : dr\. Rahmat \/ Raber : dr\. Akhmad, dr\. Widya\*/);
console.log('PASS CPPT date, WITA, WhatsApp format, care teams, no cross-encounter lookup');
