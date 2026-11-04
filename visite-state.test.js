const assert = require("node:assert/strict");
const V = require("./visite-state.js");
const patient = (id, raber = false) => ({ name: id, medicalRecordNumber: "001234", ermUrl: `https://rsudbalangan.com:91/#/rekam-medis/p/${id}`, raber });
let state = V.mergeSession(null, [{ doctor: "dr. A", room: "ANGGREK", patients: [patient("a", true), patient("a")] }]);
assert.equal(state.doctors[0].rooms[0].patients.length, 1);
assert.equal(state.doctors[0].rooms[0].patients[0].raber, false);
state = V.mergeSession(state, [
  { doctor: "dr A", room: "ROSE", patients: [patient("b")] },
  { doctor: "dr. B", room: "ANGGREK", patients: [patient("a", true)] }
]);
assert.equal(state.doctors.length, 2);
assert.deepEqual(state.doctors[0].rooms.map((room) => room.name), ["ROSE", "ANGGREK"]);
assert.equal(state.doctors[1].rooms[0].patients[0].raber, true);
const previous = JSON.stringify(state);
state = V.mergeSession(state, [{ doctor: "dr. A", room: "ANGGREK", patients: [patient("a"), patient("a")] }]);
assert.equal(state.doctors[0].rooms.length, 2);
assert.equal(state.doctors[0].rooms[0].patients.length, 1);
assert.notEqual(JSON.stringify(state), previous);
state = V.mergeSession(state, [{ doctor: "dr. A", room: "ROSE", patients: [patient("a"), patient("new-visit")] }]);
assert.equal(state.doctors[0].rooms[1].patients.length, 0);
assert.equal(state.doctors[0].rooms[0].patients.length, 2);
assert.match(state.doctors[0].rooms[0].patients[0].ermUrl, /\/a\/cppt$/);
assert.throws(() => V.cpptUrl("https://example.com/#/rekam-medis/a/b"));
assert.throws(() => V.mergeSession(state, []));
assert.match(V.cpptUrl("http://10.10.0.3/#/rekam-medis/a/b/diagnosis"), /\/a\/b\/cppt$/);
console.log("Visite merge, encounter, Raber and URL checks passed");
