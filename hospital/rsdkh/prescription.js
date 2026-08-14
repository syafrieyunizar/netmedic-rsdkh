(() => {
  "use strict";

  const BUTTON_ID = "netmedic-rsdkh-erx-button";
  const SLOT_ID = `${BUTTON_ID}-slot`;
  const UI_ID = "netmedic-rsdkh-erx-ui";
  const OPTION_SELECTOR = ".p-autocomplete-item:not(.p-disabled), .p-dropdown-item:not(.p-disabled), [role='option']:not([aria-disabled='true'])";
  const FORM_ALIASES = {
    tablet: ["tablet", "tab", "kaplet", "kapsul", "capsule"],
    oral: ["tablet", "tab", "kaplet", "kapsul", "sirup", "syrup", "suspensi"],
    sirup: ["sirup", "syrup", "syr", "suspensi", "susp"],
    injeksi: ["injeksi", "inj", "ampul", "amp", "vial"],
    infus: ["infus", "infusion", "ivfd", "fls", "botol"],
    salep: ["salep", "cream", "krim", "ointment"],
    tetes: ["tetes", "drop"]
  };

  let ui;
  let running = false;
  let injectQueued = false;

  const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ");
  const searchable = (value) => normalize(value).toLowerCase().replace(/[^a-z0-9%.,]+/g, " ");
  const isVisible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function isPrescriptionPage() {
    return location.hash.includes("/order-resep-v2");
  }

  function getPatientAgeContext() {
    const ageElement = [...document.querySelectorAll("small.tag.is-danger.is-rounded")]
      .find((element) => isVisible(element) && /^\d+\s*thn(?:\s+\d+\s*bln)?(?:\s+\d+\s*hari)?$/i.test(normalize(element.textContent)));
    const text = normalize(ageElement?.textContent);
    const years = Number(text.match(/^(\d+)\s*thn/i)?.[1]);
    if (!Number.isFinite(years)) return { text: "", years: null, category: "unknown" };
    return { text, years, category: years < 18 ? "child" : "adult" };
  }

  function ensureSurfloForContext(result, mode, age = {}) {
    if (mode !== "emergency_inpatient" || !Array.isArray(result?.items)) return result;
    const parenteral = result.items.some((item) => {
      const text = `${item.form || ""} ${item.display_name || ""} ${item.search_term || ""}`.toLowerCase();
      return /\b(?:injeksi|injection|inj|infus|infusion|ivfd)\b/.test(text) && !/\bsurflo\b/.test(text);
    });
    if (!parenteral) return result;

    const years = Number(age?.years);
    const size = Number.isFinite(years) ? (years < 18 ? "24" : "22") : "";
    const surflo = {
      display_name: size ? `Surflo ${size}` : "Surflo - ukuran perlu ditinjau",
      search_term: size ? `Surflo no ${size}` : "Surflo",
      form: "alat",
      strength: size,
      qty: 1,
      unit: "pcs",
      directions: "",
      is_supply: true,
      needs_review: !size,
      review_note: size ? "" : "Umur pasien tidak ditemukan pada eRM; tentukan ukuran Surflo secara manual."
    };
    const items = [...result.items];
    const surfloIndex = items.findIndex((item) => /\bsurflo\b/i.test(`${item.display_name || ""} ${item.search_term || ""}`));
    if (surfloIndex >= 0) items[surfloIndex] = { ...items[surfloIndex], ...surflo };
    else items.push(surflo);
    const warning = size ? "" : "Umur pasien tidak ditemukan; ukuran Surflo wajib ditinjau.";
    return { ...result, warning: [result.warning, warning].filter(Boolean).join(" "), items };
  }

  function exactText(label, selector = "a,button,span,div,label,li") {
    return [...document.querySelectorAll(selector)]
      .filter(isVisible)
      .sort((left, right) => left.children.length - right.children.length)
      .find((element) => normalize(element.textContent) === label) || null;
  }

  function findButton(label, scope = document) {
    return [...scope.querySelectorAll("button")].find((button) => isVisible(button) && normalize(button.textContent) === label) || null;
  }

  async function waitFor(getter, errorMessage, timeout = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const result = getter();
      if (result) return result;
      await sleep(80);
    }
    throw new Error(errorMessage);
  }

  function setNativeValue(control, value) {
    if (!control) throw new Error("Kolom e-Resep tidak ditemukan.");
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter.call(control, String(value ?? ""));
  }

  function dispatchKey(control, type, key) {
    control.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key }));
  }

  function clearControlLikeHuman(control) {
    control.focus();
    control.click();
    control.select?.();
    dispatchKey(control, "keydown", "Backspace");
    let cleared = false;
    try {
      cleared = Boolean(document.execCommand?.("delete", false)) && !control.value;
    } catch {
      cleared = false;
    }
    if (!cleared) {
      setNativeValue(control, "");
      control.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
    }
    dispatchKey(control, "keyup", "Backspace");
  }

  function typeCharacterLikeHuman(control, character) {
    dispatchKey(control, "keydown", character);
    const previousValue = control.value;
    if (typeof control.setSelectionRange === "function") {
      const end = control.value.length;
      control.setSelectionRange(end, end);
    }
    let inserted = false;
    try {
      inserted = Boolean(document.execCommand?.("insertText", false, character)) && control.value !== previousValue;
    } catch {
      inserted = false;
    }
    if (!inserted) {
      setNativeValue(control, `${control.value}${character}`);
      control.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: character }));
    }
    dispatchKey(control, "keyup", character);
  }

  function setControlValue(control, value, blur = true) {
    if (!control) throw new Error("Kolom e-Resep tidak ditemukan.");
    control.focus();
    setNativeValue(control, value);
    control.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value ?? "") }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    if (blur) control.blur();
  }

  async function typeControlValue(control, value, { blur = true, delay = 35 } = {}) {
    if (!control) throw new Error("Kolom e-Resep tidak ditemukan.");
    clearControlLikeHuman(control);

    for (const character of String(value ?? "")) {
      typeCharacterLikeHuman(control, character);
      await sleep(delay);
    }

    control.dispatchEvent(new Event("change", { bubbles: true }));
    if (blur) control.blur();
  }

  function prescriptionPanel() {
    const productLabel = exactText("Produk", "label,span,div");
    return productLabel?.closest(".p-panel-content")
      || productLabel?.closest(".p-panel")
      || exactText("Resep Non Racikan")?.closest(".p-panel")
      || null;
  }

  function nonCompoundTab() {
    const text = exactText("Non Racikan", "a,button,span,li");
    return text?.closest("a,button,[role='tab']") || text;
  }

  function productInput(panel) {
    const label = [...panel.querySelectorAll("label,span,div")]
      .filter(isVisible)
      .sort((left, right) => left.children.length - right.children.length)
      .find((element) => normalize(element.textContent) === "Produk");
    const selector = 'input.p-autocomplete-input[role="searchbox"], input[role="searchbox"][placeholder="Pilih Produk"], input[placeholder="Pilih Produk"]';
    const field = label?.parentElement?.querySelector(selector) || null;
    return field || [...panel.querySelectorAll(selector)].find(isVisible) || null;
  }

  function qtyInput(panel) {
    return [...panel.querySelectorAll('input[placeholder="Qty"], input.p-inputnumber-input')].find(isVisible) || null;
  }

  function directionsField(panel) {
    return [...panel.querySelectorAll('textarea[placeholder="Aturan Pakai"], input[placeholder="Aturan Pakai"]')].find(isVisible) || null;
  }

  function productOptionScope(search) {
    const controlledId = search?.getAttribute("aria-controls");
    const controlled = controlledId ? document.getElementById(controlledId) : null;
    return controlled?.closest(".p-autocomplete-panel, .p-overlay, .p-connected-overlay") || controlled || document;
  }

  function visibleOptions(search) {
    return [...productOptionScope(search).querySelectorAll(OPTION_SELECTOR)]
      .filter((option) => isVisible(option) && normalize(option.textContent) && !/no records|tidak ada data/i.test(normalize(option.textContent)));
  }

  async function settledOptions(search) {
    await sleep(120);
    let previous = "";
    let stable = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(80);
      const scope = productOptionScope(search);
      const options = visibleOptions(search);
      const signature = options.map((option) => normalize(option.textContent)).join("|");
      const loading = scope.querySelector(".p-autocomplete-loader, .p-autocomplete-loading-icon, .p-dropdown-loading-icon, .p-progress-spinner");
      const emptyMessage = scope.querySelector(".p-autocomplete-empty-message, .p-empty-message");
      if (signature === previous && !loading) stable += 1;
      else stable = 0;
      previous = signature;
      if (stable >= 2 && (options.length || isVisible(emptyMessage))) return options;
    }
    return visibleOptions(search);
  }

  async function chooseOption(option, search) {
    const selected = normalize(option.textContent);
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    option.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    await sleep(100);
    await waitFor(
      () => search.getAttribute("aria-expanded") !== "true" || !isVisible(option),
      `Produk '${selected}' belum berhasil dipilih.`,
      4000
    );
    return selected;
  }

  function narrowOptions(options, item) {
    let candidates = options;
    const form = searchable(item.form);
    const aliases = Object.entries(FORM_ALIASES).find(([key]) => form.includes(key))?.[1] || [];
    if (aliases.length) {
      const byForm = candidates.filter((option) => aliases.some((alias) => searchable(option.textContent).includes(alias)));
      if (byForm.length) candidates = byForm;
    }
    const strengths = searchable(item.strength).match(/\d+(?:[.,]\d+)?\s*(?:mcg|mg|g|ml|cc|%)/g) || [];
    if (!strengths.length && /\balat\b/.test(form)) {
      strengths.push(...(searchable(item.strength).match(/\b\d{1,3}\b/g) || []));
    }
    if (strengths.length) {
      const compactStrengths = strengths.map((value) => value.replace(/\s+/g, ""));
      const byStrength = candidates.filter((option) => {
        const text = searchable(option.textContent).replace(/\s+/g, "");
        return compactStrengths.every((strength) => text.includes(strength));
      });
      if (byStrength.length) candidates = byStrength;
    }
    return candidates;
  }

  async function selectProduct(panel, item) {
    const search = await waitFor(() => productInput(panel), "Kolom AutoComplete Pilih Produk tidak ditemukan.");
    const term = normalize(item.search_term);
    if (!term) throw new Error("Nama produk/pencarian tidak boleh kosong.");
    let options = [];

    clearControlLikeHuman(search);

    for (const character of term) {
      typeCharacterLikeHuman(search, character);
      options = await settledOptions(search);
      if (options.length === 1) {
        return chooseOption(options[0], search);
      }
    }

    const candidates = narrowOptions(options, item);
    if (candidates.length === 1) {
      return chooseOption(candidates[0], search);
    }
    if (!options.length) throw new Error(`Produk '${item.search_term}' tidak ditemukan.`);
    throw new Error(`Produk '${item.search_term}' masih memiliki ${candidates.length || options.length} pilihan. Perjelas nama, sediaan, atau kekuatannya lalu coba lagi.`);
  }

  async function ensureNonCompoundPanel() {
    const tab = await waitFor(nonCompoundTab, "Tab Non Racikan tidak ditemukan.");
    tab.click();
    return waitFor(prescriptionPanel, "Form Resep Non Racikan tidak ditemukan.");
  }

  function productRowCount(product) {
    const signature = searchable(product).replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
    if (!signature) return 0;
    return [...document.querySelectorAll("tbody tr")]
      .filter(isVisible)
      .filter((row) => searchable(row.textContent).replace(/[.,]/g, " ").replace(/\s+/g, " ").includes(signature))
      .length;
  }

  async function insertItem(item) {
    const panel = await ensureNonCompoundPanel();
    const selectedProduct = await selectProduct(panel, item);
    const qty = await waitFor(() => qtyInput(panel), "Kolom Qty Obat tidak ditemukan.");
    await typeControlValue(qty, item.qty);
    await waitFor(() => Number(qty.value) === Number(item.qty), "Qty Obat belum berhasil diisi.", 3000);
    const directions = directionsField(panel);
    if (directions) setControlValue(directions, item.directions || "");

    const beforeRows = document.querySelectorAll("tbody tr").length;
    const beforeProductRows = productRowCount(selectedProduct);
    const add = findButton("Tambah", panel);
    if (!add) throw new Error("Tombol Tambah e-Resep tidak ditemukan.");
    add.click();
    await sleep(120);
    await waitFor(() => {
      const currentPanel = prescriptionPanel();
      if (!currentPanel) return false;
      const productAdded = productRowCount(selectedProduct) > beforeProductRows;
      const rowsAdded = document.querySelectorAll("tbody tr").length > beforeRows;
      const reset = !normalize(productInput(currentPanel)?.value) && !normalize(qtyInput(currentPanel)?.value);
      return productAdded || rowsAdded || reset;
    }, `Produk '${selectedProduct}' belum berhasil ditambahkan.`);
    return selectedProduct;
  }

  function setStatus(state, message) {
    ui.status.hidden = !message;
    ui.status.dataset.state = state;
    ui.status.textContent = message;
  }

  function createField(labelText, className, value, type = "text") {
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = labelText;
    const input = document.createElement(type === "textarea" ? "textarea" : "input");
    input.className = className;
    if (type !== "textarea") input.type = type;
    input.value = value ?? "";
    label.append(text, input);
    return label;
  }

  function setItemStatus(card, state, message) {
    card.dataset.state = state;
    const status = card.querySelector(".erx-item-status");
    status.hidden = !message;
    status.dataset.state = state;
    status.textContent = message;
    const done = state === "done";
    card.querySelectorAll("input,textarea,button.erx-remove").forEach((control) => { control.disabled = done || running; });
  }

  function createItemCard(item = {}) {
    const card = document.createElement("article");
    card.className = "erx-item";
    card.dataset.state = "pending";
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.className = "erx-item-title";
    title.textContent = item.display_name || item.search_term || "Item baru";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "erx-remove";
    remove.setAttribute("aria-label", "Hapus item resep");
    remove.title = "Hapus item resep";
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>';
    remove.addEventListener("click", () => {
      card.remove();
      renumberItems();
      syncInsertButton();
    });
    header.append(title, remove);

    const grid = document.createElement("div");
    grid.className = "erx-item-grid";
    grid.append(
      createField("Nama produk / pencarian", "erx-search", item.search_term || item.display_name || ""),
      createField("Sediaan", "erx-form", item.form || ""),
      createField("Kekuatan / ukuran", "erx-strength", item.strength || ""),
      createField("Qty (pcs)", "erx-qty", item.qty || 1, "number"),
      createField("Aturan pakai", "erx-directions", item.directions || "", "textarea")
    );
    grid.querySelector(".erx-qty").min = "1";
    grid.querySelector(".erx-qty").step = "1";
    grid.querySelector(".erx-search").addEventListener("input", (event) => { title.textContent = event.target.value || "Item baru"; });
    grid.addEventListener("input", () => {
      if (card.dataset.state === "error") setItemStatus(card, "pending", "");
    });

    const review = document.createElement("p");
    review.className = "erx-review-note";
    review.hidden = !item.needs_review && !item.review_note;
    review.textContent = item.review_note || (item.needs_review ? "Item ini perlu diperiksa dokter." : "");
    const status = document.createElement("p");
    status.className = "erx-item-status";
    status.hidden = true;
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    card.append(header, grid, review, status);
    return card;
  }

  function renumberItems() {
    [...ui.items.children].forEach((card, index) => {
      card.querySelector(".erx-item-title").dataset.index = String(index + 1);
      card.querySelector(".erx-remove").setAttribute("aria-label", `Hapus item resep ${index + 1}`);
    });
  }

  function renderPrescription(result) {
    ui.summary.value = result.summary || "";
    ui.warning.hidden = !result.warning;
    ui.warning.textContent = result.warning || "";
    ui.items.replaceChildren(...result.items.map(createItemCard));
    renumberItems();
    ui.preview.hidden = false;
    ui.confirm.checked = false;
    ui.insert.hidden = false;
    syncInsertButton();
  }

  function collectItems() {
    return [...ui.items.children].map((card) => ({
      card,
      item: {
        search_term: card.querySelector(".erx-search").value.trim(),
        form: card.querySelector(".erx-form").value.trim(),
        strength: card.querySelector(".erx-strength").value.trim(),
        qty: Math.max(1, Math.ceil(Number(card.querySelector(".erx-qty").value) || 1)),
        directions: card.querySelector(".erx-directions").value.trim()
      }
    }));
  }

  function syncInsertButton() {
    const hasItems = Boolean(ui?.items.children.length);
    ui.insert.disabled = running || !hasItems || !ui.confirm.checked;
  }

  function setRunning(active) {
    running = active;
    ui.generate.disabled = active;
    ui.addItem.disabled = active;
    ui.close.disabled = active;
    ui.closeIcon.disabled = active;
    ui.confirm.disabled = active;
    ui.items.querySelectorAll("input,textarea,button").forEach((control) => {
      if (control.closest(".erx-item")?.dataset.state !== "done") control.disabled = active;
    });
    syncInsertButton();
  }

  async function generatePrescription() {
    const prescriptionText = ui.source.value.trim();
    if (!prescriptionText) {
      setStatus("error", "Tuliskan obat terlebih dahulu.");
      ui.source.focus();
      return;
    }
    setRunning(true);
    ui.generate.querySelector("span").textContent = "Sedang generate...";
    setStatus("loading", "AI sedang merapikan resep.");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "rsdkh:generate-prescription",
        mode: ui.shadow.querySelector('input[name="erx-mode"]:checked').value,
        prescriptionText
      });
      if (!response?.ok) throw new Error(response?.error || "AI gagal merapikan resep.");
      const mode = ui.shadow.querySelector('input[name="erx-mode"]:checked').value;
      renderPrescription(ensureSurfloForContext(response.result, mode, getPatientAgeContext()));
      setStatus("success", "Resep selesai dirapikan. Periksa setiap item sebelum dimasukkan.");
    } catch (error) {
      setStatus("error", error.message || "AI gagal merapikan resep.");
    } finally {
      setRunning(false);
      ui.generate.querySelector("span").textContent = "Generate";
    }
  }

  async function insertPrescription() {
    if (!ui.confirm.checked || running) return;
    const entries = collectItems().filter(({ card }) => card.dataset.state !== "done");
    if (!entries.length) return;
    setRunning(true);
    setStatus("loading", `Memasukkan 0 dari ${entries.length} item.`);
    if (ui.dialog.open) ui.dialog.close();
    showToast(`Mulai memasukkan ${entries.length} item. Jangan berpindah halaman.`);
    let completed = 0;
    try {
      for (const { card, item } of entries) {
        if (!item.search_term) throw new Error("Nama produk/pencarian tidak boleh kosong.");
        setItemStatus(card, "loading", `Mencari '${item.search_term}'...`);
        try {
          const selected = await insertItem(item);
          completed += 1;
          setItemStatus(card, "done", `Berhasil ditambahkan: ${selected}`);
          setStatus("loading", `Memasukkan ${completed} dari ${entries.length} item.`);
        } catch (error) {
          setItemStatus(card, "error", error.message);
          throw error;
        }
      }
      setStatus("success", `${completed} item berhasil dimasukkan ke e-Resep.`);
      showToast(`${completed} item e-Resep berhasil dimasukkan. Periksa kembali sebelum melanjutkan.`);
    } catch (error) {
      setStatus("error", `${error.message} Item yang sudah hijau tidak akan diulang saat mencoba kembali.`);
      if (!ui.dialog.open) ui.dialog.showModal();
      showToast("Input e-Resep berhenti. Periksa item yang ditandai merah.");
    } finally {
      setRunning(false);
    }
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "netmedic-rsdkh-erx-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.append(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 220);
    }, 6000);
  }

  function createUi() {
    if (ui) return ui;
    const host = document.createElement("div");
    host.id = UI_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <link rel="stylesheet" href="${chrome.runtime.getURL("hospital/rsdkh/prescription.css")}">
      <dialog class="erx-dialog" aria-labelledby="erx-title">
        <div class="erx-shell">
          <header class="erx-header">
            <div><p>NETMEDIC RSDKH</p><h2 id="erx-title">e-Resep otomatis</h2></div>
            <button class="erx-close-icon" type="button" aria-label="Tutup" title="Tutup"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </header>
          <section class="erx-compose">
            <fieldset class="erx-mode"><legend>Jenis resep</legend><div role="radiogroup" aria-label="Jenis resep">
              <label><input type="radio" name="erx-mode" value="inpatient"><span>Rawat inap</span></label>
              <label><input type="radio" name="erx-mode" value="outpatient"><span>Rawat jalan</span></label>
              <label><input type="radio" name="erx-mode" value="emergency_inpatient" checked><span>Resep IGD (Ranap)</span></label>
            </div></fieldset>
            <label class="erx-source-label" for="erx-source"><span>Tulis obat-obatan di sini</span><textarea id="erx-source" rows="6" placeholder="panto 1&#10;ns 1&#10;ondan 1"></textarea></label>
          </section>
          <section class="erx-preview" hidden>
            <label for="erx-summary"><span>Terapi yang dirapikan</span><textarea id="erx-summary" rows="4"></textarea></label>
            <p class="erx-warning" hidden role="alert"></p>
            <div class="erx-preview-heading"><h3>Resep</h3><button class="erx-add-item" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Tambah item</button></div>
            <div class="erx-items"></div>
            <label class="erx-confirm"><input type="checkbox"><span>Konfirmasi kesesuaian terapi. Saya sudah menyesuaikan bila ada yang salah atau kurang.</span></label>
          </section>
          <p class="erx-status" hidden role="status" aria-live="polite"></p>
          <footer class="erx-actions">
            <button class="secondary erx-close" type="button">Batal</button>
            <button class="secondary erx-generate" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-1 7h7l-8 13 1-8H5l8-12Z"/></svg><span>Generate</span></button>
            <button class="primary erx-insert" type="button" hidden disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg><span>Masukkan e-Resep</span></button>
          </footer>
        </div>
      </dialog>`;
    document.documentElement.append(host);
    ui = {
      shadow,
      dialog: shadow.querySelector("dialog"),
      source: shadow.querySelector("#erx-source"),
      preview: shadow.querySelector(".erx-preview"),
      summary: shadow.querySelector("#erx-summary"),
      warning: shadow.querySelector(".erx-warning"),
      items: shadow.querySelector(".erx-items"),
      confirm: shadow.querySelector(".erx-confirm input"),
      status: shadow.querySelector(".erx-status"),
      addItem: shadow.querySelector(".erx-add-item"),
      generate: shadow.querySelector(".erx-generate"),
      insert: shadow.querySelector(".erx-insert"),
      close: shadow.querySelector(".erx-close"),
      closeIcon: shadow.querySelector(".erx-close-icon")
    };
    const close = () => { if (!running) ui.dialog.close(); };
    ui.generate.addEventListener("click", generatePrescription);
    ui.insert.addEventListener("click", insertPrescription);
    ui.addItem.addEventListener("click", () => {
      ui.items.append(createItemCard({ qty: 1 }));
      renumberItems();
      syncInsertButton();
      ui.items.lastElementChild.querySelector("input").focus();
    });
    ui.confirm.addEventListener("change", syncInsertButton);
    ui.close.addEventListener("click", close);
    ui.closeIcon.addEventListener("click", close);
    ui.dialog.addEventListener("cancel", (event) => { if (running) event.preventDefault(); });
    return ui;
  }

  function openModal() {
    createUi();
    setStatus("", "");
    ui.dialog.showModal();
    ui.source.focus();
  }

  function injectButton() {
    injectQueued = false;
    if (!isPrescriptionPage()) {
      document.getElementById(SLOT_ID)?.remove();
      return;
    }
    if (document.getElementById(BUTTON_ID)) return;
    const text = exactText("Racikan", "a,button,span,li");
    const tab = text?.closest("a,button,[role='tab']") || text;
    const tabItem = tab?.closest("li") || tab;
    if (!tabItem?.parentElement) return;

    const slot = document.createElement(tabItem.tagName === "LI" ? "li" : "span");
    slot.id = SLOT_ID;
    slot.className = "netmedic-rsdkh-erx-slot";
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "e-Resep otomatis";
    button.addEventListener("click", openModal);
    slot.append(button);
    tabItem.insertAdjacentElement("afterend", slot);
  }

  function queueInject() {
    if (injectQueued) return;
    injectQueued = true;
    requestAnimationFrame(injectButton);
  }

  if (typeof module !== "undefined") module.exports = { narrowOptions, ensureSurfloForContext };
  if (typeof document !== "undefined") {
    new MutationObserver(queueInject).observe(document.documentElement, { childList: true, subtree: true });
    addEventListener("hashchange", queueInject);
    queueInject();
  }
})();

if (typeof module !== "undefined" && require.main === module) {
  const assert = require("node:assert/strict");
  const options = [
    { textContent: "Paracetamol Tablet 500 mg" },
    { textContent: "Paracetamol Sirup 120 mg/5 ml" }
  ];
  assert.deepEqual(
    module.exports.narrowOptions(options, { form: "tablet", strength: "500 mg" }).map((option) => option.textContent),
    ["Paracetamol Tablet 500 mg"]
  );
  const injection = { summary: "Inj. Pantoprazole", warning: "", items: [{ display_name: "Pantoprazole", search_term: "Pantoprazole", form: "injeksi" }] };
  assert.equal(module.exports.ensureSurfloForContext(injection, "emergency_inpatient", { years: 45 }).items.at(-1).search_term, "Surflo no 22");
  assert.equal(module.exports.ensureSurfloForContext(injection, "emergency_inpatient", { years: 7 }).items.at(-1).search_term, "Surflo no 24");
  console.log("RSDKH prescription self-check ok");
}
