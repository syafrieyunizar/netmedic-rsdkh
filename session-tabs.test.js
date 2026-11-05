const assert = require("node:assert/strict");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    executablePath: process.env.VISITE_TEST_BROWSER,
    args: [`--disable-extensions-except=${__dirname}`, `--load-extension=${__dirname}`]
  });
  try {
    await browser.route("https://rsudbalangan.com:91/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Test patient</title>" }));
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    const dashboardId = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true });
      await chrome.tabs.update(tab.id, { pinned: true });
      await chrome.tabs.create({ url: "about:blank", active: false });
      const old = await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html"), pinned: true });
      const dashboardId = await manageSessionTabs(() => openSessionDashboard("dashboard.html"));
      if (dashboardId !== old.id) throw new Error("Existing dashboard was duplicated.");
      return dashboardId;
    });

    const url = "https://rsudbalangan.com:91/#/rekam-medis/test-patient/test-visit";
    const visit = await worker.evaluate(async ({ dashboardId, url }) => {
      const [pinned] = await chrome.tabs.query({ pinned: true });
      const shift = await chrome.tabs.get(dashboardId);
      const shiftSender = { url: chrome.runtime.getURL("dashboard.html"), tab: shift };
      const patient = { ermUrl: url, medicalRecordNumber: "001234", visitId: "test-visit" };
      const first = await focusPatientTab(patient, shiftSender);
      const repeat = await focusPatientTab(patient, shiftSender);
      const visiteId = await openSessionDashboard("visite.html");
      const visite = await chrome.tabs.get(visiteId);
      const visiteSender = { url: chrome.runtime.getURL("visite.html"), tab: visite };
      const cpptId = await openVisitePatient(patient, visiteSender);
      const repeatCpptId = await openVisitePatient(patient, visiteSender);
      const reopenedVisiteId = await openSessionDashboard("visite.html");
      return {
        pinned,
        shift: await chrome.tabs.get(dashboardId),
        shiftGroup: await chrome.tabGroups.get(shift.groupId),
        shiftPatient: await chrome.tabs.get(first),
        repeat,
        visite: await chrome.tabs.get(visiteId),
        visiteGroup: await chrome.tabGroups.get(visite.groupId),
        cppt: await chrome.tabs.get(cpptId),
        repeatCpptId,
        reopenedVisiteId
      };
    }, { dashboardId, url });
    assert.equal(visit.pinned.index, 0);
    assert.equal(visit.visite.index, 1);
    assert.equal(visit.visiteGroup.title, "🩺 Visite");
    assert.equal(visit.cppt.groupId, visit.visiteGroup.id);
    assert.equal(visit.cppt.index, 2);
    assert.equal(visit.cppt.pendingUrl || visit.cppt.url, `${url}/cppt`);
    assert.equal(visit.cppt.id, visit.repeatCpptId);
    assert.equal(visit.visite.id, visit.reopenedVisiteId);
    assert.equal(visit.shift.index, 3);
    assert.equal(visit.shiftGroup.title, "🩺 JAGA");
    assert.equal(visit.shiftPatient.groupId, visit.shiftGroup.id);
    assert.equal(visit.shiftPatient.index, 4);
    assert.equal(visit.shiftPatient.id, visit.repeat);
    assert.notEqual(visit.shiftPatient.id, visit.cppt.id);
    assert.equal(visit.shiftPatient.pendingUrl || visit.shiftPatient.url, url);

    const restored = await worker.evaluate(async (visiteId) => {
      await chrome.tabs.remove(visiteId);
      const id = await manageSessionTabs(() => openSessionDashboard("visite.html"));
      const tab = await chrome.tabs.get(id);
      const members = await chrome.tabs.query({ groupId: tab.groupId });
      return { tab, memberIds: members.map((member) => member.id) };
    }, visit.visite.id);
    assert.equal(restored.tab.index, 1);
    assert.deepEqual(restored.memberIds, [restored.tab.id, visit.cppt.id]);

    const dashboardPage = browser.pages().find((page) => page.url().endsWith("/visite.html"));
    assert.ok(dashboardPage);
    const response = await dashboardPage.evaluate(() => chrome.runtime.sendMessage({ type: "rsdkh:visite-finish" }));
    assert.equal(response.ok, true);
    const afterFinish = await worker.evaluate(async ({ cpptId, shiftPatientId }) => ({
      cppt: await chrome.tabs.get(cpptId),
      shiftPatient: await chrome.tabs.get(shiftPatientId)
    }), { cpptId: visit.cppt.id, shiftPatientId: visit.shiftPatient.id });
    assert.equal(afterFinish.cppt.groupId, -1);
    assert.equal(afterFinish.shiftPatient.groupId, visit.shiftGroup.id);
    console.log("PASS native tab groups, pinned-tab migration, ordering, reuse, isolation, dashboard recovery and session finish");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
