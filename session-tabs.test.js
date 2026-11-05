const assert = require("node:assert/strict");
const http = require("node:http");
const { chromium } = require("playwright");

const igdFixture = `
  <div class="filter-box">
    <p-calendar><input value="2026-11-05 00:00"></p-calendar>
    <p-calendar><input value="2026-11-05 23:59"></p-calendar>
    <input placeholder="No. RM"><input placeholder="No. Reg"><button id="search">Cari</button>
  </div>
  <div class="p-datatable-scrollable-view">
    <div class="p-datatable-scrollable-header"><table><thead><tr>
      <th>Aksi</th><th>No Registrasi</th><th>No RM</th>
    </tr></thead></table></div>
    <div class="p-datatable-scrollable-body"><table><tbody id="patients"></tbody></table></div>
  </div>
  <script>
    const body = document.querySelector("#patients");
    function renderPatient(registration, visitId) {
      body.innerHTML = '<tr><td><button ptooltip="Pengkajian Medis/EMR" icon="fa fa-stethoscope"><span>EMR</span></button></td>'
        + '<td>' + registration + '</td><td>001234</td></tr>';
      body.querySelector("button").onclick = () => history.pushState({}, "", "#/rekam-medis/test-igd/" + visitId);
    }
    renderPatient("2611000001", "older-visit");
    document.querySelector("#search").onclick = () => {
      const registration = document.querySelector('input[placeholder="No. Reg"]').value;
      const start = document.querySelector("p-calendar input").value;
      if (registration === "2611000002" && start === "2026-11-01 00:00") renderPatient(registration, "selected-visit");
    };
  </script>`;

(async () => {
  const proxy = http.createServer((request, response) => {
    response.writeHead(request.headers.host === "10.10.0.3" ? 200 : 404, { "Content-Type": "text/html" });
    response.end(igdFixture);
  });
  await new Promise((resolve, reject) => proxy.once("error", reject).listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      executablePath: process.env.VISITE_TEST_BROWSER,
      proxy: { server: `http://127.0.0.1:${proxy.address().port}` },
      args: [`--disable-extensions-except=${__dirname}`, `--load-extension=${__dirname}`]
    });
    await browser.route("https://rsudbalangan.com:91/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Test patient</title>" }));
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    const dashboardUrl = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true });
      await chrome.tabs.update(tab.id, { pinned: true });
      await chrome.tabs.create({ url: "about:blank", active: false });
      await mutateShiftState((state) => SHIFT.startShift(state));
      return chrome.runtime.getURL("dashboard.html");
    });
    const shiftPage = await browser.newPage();
    await shiftPage.goto(dashboardUrl);
    const pin = shiftPage.getByRole("button", { name: "PIN Dashboard Jaga", exact: true });
    const unpin = shiftPage.getByRole("button", { name: "Unpin", exact: true });
    const openList = shiftPage.getByRole("button", { name: "Daftar Pasien IGD", exact: true });
    await pin.waitFor();
    const dashboardId = await worker.evaluate(() => manageSessionTabs(() => openSessionDashboard("dashboard.html")));
    assert.equal(browser.pages().filter((page) => page.url() === dashboardUrl).length, 1);

    await pin.click();
    await unpin.waitFor();
    await shiftPage.reload();
    await unpin.waitFor();
    const pinnedDashboard = await worker.evaluate((id) => chrome.tabs.get(id), dashboardId);
    assert.equal(pinnedDashboard.pinned, true);
    assert.equal(pinnedDashboard.groupId, -1);
    const publicList = "https://rsudbalangan.com:91/#/daftar-pasien-igd";
    const firstList = browser.waitForEvent("page");
    await openList.click();
    await (await firstList).waitForURL(publicList);
    const secondList = browser.waitForEvent("page");
    await openList.click();
    await (await secondList).waitForURL(publicList);
    const publicTabs = await worker.evaluate(async (url) =>
      (await chrome.tabs.query({})).filter((tab) => (tab.pendingUrl || tab.url) === url), publicList);
    assert.equal(publicTabs.length, 2);
    assert.ok(publicTabs[0].groupId >= 0);
    assert.equal(publicTabs[0].groupId, publicTabs[1].groupId);

    await unpin.click();
    await pin.waitFor();
    const unpinned = await worker.evaluate(async (id) => {
      const tab = await chrome.tabs.get(id);
      const members = await chrome.tabs.query({ groupId: tab.groupId });
      return { tab, firstId: members[0]?.id };
    }, dashboardId);
    assert.equal(unpinned.tab.pinned, false);
    assert.equal(unpinned.tab.groupId, publicTabs[0].groupId);
    assert.equal(unpinned.firstId, dashboardId);
    await worker.evaluate(async (ids) => {
      await chrome.tabs.remove(ids);
      const source = await chrome.tabs.create({ url: "http://10.10.0.3/#/daftar-registrasi-pasien" });
      await manageSessionTabs(() => openSessionDashboard("dashboard.html", source.windowId));
      await chrome.tabs.remove(source.id);
    }, publicTabs.map((tab) => tab.id));

    const internalList = "http://10.10.0.3/#/daftar-pasien-igd";
    const internalPage = browser.waitForEvent("page");
    await openList.click();
    await (await internalPage).waitForURL(internalList);
    const internalTab = await worker.evaluate(async (url) =>
      (await chrome.tabs.query({})).find((tab) => (tab.pendingUrl || tab.url) === url), internalList);
    assert.equal(internalTab.groupId, unpinned.tab.groupId);

    const listPage = await internalPage;
    await listPage.locator("p-calendar input").first().fill("2026-11-01 00:00");
    await listPage.getByPlaceholder("No. Reg", { exact: true }).fill("2611000002");
    await listPage.getByRole("button", { name: "Cari", exact: true }).click();
    await listPage.getByText("2611000002", { exact: true }).waitFor();
    const opening = browser.waitForEvent("page");
    await listPage.getByRole("button", { name: "EMR", exact: true }).click();
    const opened = await opening;
    const openedUrl = "http://10.10.0.3/#/rekam-medis/test-igd/selected-visit";
    await opened.waitForURL(openedUrl);
    const openedTab = await worker.evaluate(async ({ url, groupId }) => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const tab = (await chrome.tabs.query({ groupId })).find((tab) => tab.url === url);
        if (tab) return tab;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }, { url: openedUrl, groupId: internalTab.groupId });
    assert.ok(openedTab, "the patient tab joined the Jaga group");
    assert.equal(openedTab.active, false);
    const [activeList] = await worker.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }));
    assert.equal(activeList.id, internalTab.id);
    assert.equal(listPage.url(), internalList);
    assert.equal(await listPage.getByPlaceholder("No. Reg", { exact: true }).inputValue(), "2611000002");
    await opened.close();

    const outsideGroup = await browser.newPage();
    await outsideGroup.goto(internalList);
    const countBefore = browser.pages().length;
    await outsideGroup.getByRole("button", { name: "EMR", exact: true }).click();
    await outsideGroup.waitForURL("http://10.10.0.3/#/rekam-medis/test-igd/older-visit");
    assert.equal(browser.pages().length, countBefore);
    await outsideGroup.close();
    await worker.evaluate((id) => chrome.tabs.remove(id), internalTab.id);

    const url = "http://10.10.0.3/#/rekam-medis/test-patient/test-visit";
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

    const visitePage = browser.pages().find((page) => page.url().endsWith("/visite.html"));
    assert.ok(visitePage);
    const visitePin = visitePage.getByRole("button", { name: "PIN Dashboard Visite", exact: true });
    const visiteUnpin = visitePage.getByRole("button", { name: "Unpin", exact: true });
    await visitePin.click();
    await visiteUnpin.waitFor();
    await visitePage.reload();
    await visiteUnpin.waitFor();
    const pinnedVisite = await worker.evaluate((id) => chrome.tabs.get(id), visit.visite.id);
    assert.equal(pinnedVisite.pinned, true);
    assert.equal(pinnedVisite.groupId, -1);
    const inpatientPagePromise = browser.waitForEvent("page");
    await visitePage.getByRole("button", { name: "Daftar Pasien Rawat Inap", exact: true }).click();
    const inpatientPage = await inpatientPagePromise;
    const inpatientUrl = "http://10.10.0.3/#/daftar-pasien-dirawat";
    await inpatientPage.waitForURL(inpatientUrl);
    await visiteUnpin.click();
    await visitePin.waitFor();
    const visiteMembers = await worker.evaluate(async (id) => {
      await sessionTabQueue;
      const dashboard = await chrome.tabs.get(id);
      return chrome.tabs.query({ groupId: dashboard.groupId });
    }, visit.visite.id);
    assert.equal(visiteMembers[0].id, visit.visite.id);
    assert.equal(visiteMembers[0].pinned, false);
    assert.ok(visiteMembers.some((tab) => tab.id === visit.cppt.id));
    assert.ok(visiteMembers.some((tab) => (tab.pendingUrl || tab.url) === inpatientUrl));
    await inpatientPage.close();

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
    console.log("PASS Jaga and Visite pin/unpin, public/internal lists, exact encounter in a background tab, native navigation outside Jaga, group ordering and session finish");
  } finally {
    await browser?.close();
    proxy.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
