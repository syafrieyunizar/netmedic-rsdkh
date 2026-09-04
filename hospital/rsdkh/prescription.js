(() => {
  "use strict";

  const BUTTON_ID = "netmedic-rsdkh-erx-button";
  const SLOT_ID = `${BUTTON_ID}-slot`;
  const OPNAME_BUTTON_ID = "netmedic-rsdkh-opname-prescription";
  const UI_ID = "netmedic-rsdkh-erx-ui";
  const PRODUCT_ALIASES_KEY = "rsdkhProductAliases";
  const NETMEDIC_LOGIN_KEY = "RUdJRVJBTURBTg==";
  const NETMEDIC_CACHE_NAME = "cacheEMR_qwertyuiop";
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
  const DEPOT_NAMES = ["DEPO GAWAT DARURAT", "DEPO OK", "DEPO RAJAL", "DEPO RAWAT INAP"];

  let ui;
  let running = false;
  let pendingAutoGenerate = false;
  let injectQueued = false;
  let productCatalog = [];
  let productCatalogByName = new Map();
  let productCatalogPromise;
  let productAliases = [];
  let productAliasesPromise;

  const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ");
  const searchable = (value) => normalize(value).toLowerCase().replace(/[^a-z0-9%.,]+/g, " ");
  const isVisible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function isPrescriptionPage() {
    return location.hash.includes("/order-resep-v2");
  }

  function isNewOpnamePage() {
    return location.hash.includes("/pengantar-opname-new");
  }

  function extractIgdInstructions(records = []) {
    const values = records.flatMap((record) => {
      const json = record?.json || {};
      const rows = Array.isArray(json.datasource) ? json.datasource : [];
      return [json.planning, json.instruksidokter, ...rows.map((row) => row?.instruksidokter)];
    }).map((value) => String(value || "").trim()).filter(Boolean);
    return [...new Set(values)].join("\n");
  }

  function extractOpnameTherapies(records = []) {
    return records.map((record) => String(record?.json?.rencanaterapi || record?.json?.rencanaTerapi || "").trim())
      .filter(Boolean)
      .join("\n");
  }

  function storedJson(storage, key) {
    try {
      return JSON.parse(storage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function currentRegistration() {
    const cache = storedJson(localStorage, "cacheHelper");
    const value = Array.isArray(cache) ? cache.find((entry) => entry?.name === NETMEDIC_CACHE_NAME)?.value : null;
    if (!value) return null;
    try {
      return typeof value === "string" ? JSON.parse(value) : value;
    } catch {
      return null;
    }
  }

  async function loadMedicalRecords(kind) {
    const login = storedJson(localStorage, NETMEDIC_LOGIN_KEY) || storedJson(sessionStorage, NETMEDIC_LOGIN_KEY);
    const registration = currentRegistration()?.noregistrasi;
    const token = login?.["X-AUTH-TOKEN"] || login?.["x-auth-token"];
    if (!registration) throw new Error("Nomor registrasi pasien tidak ditemukan. Buka ulang rekam medis pasien.");
    if (!token) throw new Error("Sesi Netmedic tidak ditemukan. Silakan login ulang.");

    const query = new URLSearchParams({ jenis: kind, noregistrasi: registration });
    const response = await fetch(`/service/emr/get-rekam-medis?${query}`, {
      credentials: "same-origin",
      headers: {
        "X-AUTH-TOKEN": token,
        kdProfile: login.kdProfile || "",
        KdUser: login.id || "",
        Accept: "application/json"
      }
    });
    if (!response.ok) throw new Error(`Data rekam medis gagal diambil (${response.status}).`);
    const payload = await response.json();
    return Array.isArray(payload?.data) ? payload.data : [];
  }

  function catalogKey(name) {
    return normalize(name).toLocaleUpperCase("id-ID");
  }

  function upsertCatalogRecord(catalog, record) {
    const key = catalogKey(record?.namaproduk);
    if (key) catalog.set(key, record);
  }

  function normalizeProductAlias(alias = {}) {
    return {
      term: normalize(alias.term),
      query: normalize(alias.query),
      selection: alias.selection === "confirm" ? "confirm" : "unique"
    };
  }

  function findProductAlias(item, aliases = []) {
    const source = ` ${normalizeProductMatchText(`${item.display_name || ""} ${item.search_term || ""}`)} `;
    return aliases.map(normalizeProductAlias).find((alias) => {
      const term = normalizeProductMatchText(alias.term);
      return term && source.includes(` ${term} `);
    }) || null;
  }


  function normalizeProductMatchText(value) {
    return searchable(value)
      .replace(/,/g, ".")
      .replace(/(\d)(mcg|mg|gr|g|ml|cc)\b/g, "$1 $2")
      .replace(/\b(?:normal saline|sodium chloride|natrium klorida|ns)\b/g, "nacl")
      .replace(/\b(?:difenhidramin|diphenhydramine|diphenhydramin)\b/g, "diphenhydramin")
      .replace(/\bondansetron\b/g, "ondancetron")
      .replace(/\b(?:adrenalin|adrenaline)\b/g, "epinephrine")
      .replace(/\s+/g, " ")
      .trim();
  }

  function detectProductForm(value) {
    const text = searchable(value);
    if (/\b(?:injeksi|injection|inj|ampul|amp|vial)\b/.test(text)) return "injeksi";
    if (/\b(?:infus|infusion|ivfd)\b/.test(text)) return "infus";
    if (/\b(?:sirup|syrup|syr|suspensi|susp)\b/.test(text)) return "sirup";
    if (/\b(?:tablet|tab|kaplet|kapsul|capsule|caps)\b/.test(text)) return "tablet";
    if (/\b(?:salep|cream|krim|ointment)\b/.test(text)) return "salep";
    if (/\b(?:tetes|drop)\b/.test(text)) return "tetes";
    return "";
  }

  function requestedProductForm(item) {
    return detectProductForm(item.display_name)
      || detectProductForm(item.form)
      || detectProductForm(item.search_term);
  }

  function doseTokens(value) {
    return [...new Set(normalizeProductMatchText(value)
      .match(/\d+(?:\.\d+)?\s*(?:mcg|mg|gr|g|ml|cc|%)/g) || [])]
      .map((token) => token.replace(/\s+/g, ""));
  }

  function productMatchScore(item, productName) {
    const product = normalizeProductMatchText(productName);
    const context = normalizeProductMatchText(`${item.search_term || ""} ${item.display_name || ""}`);
    const names = [...new Set([item.search_term, item.display_name].map(normalizeProductMatchText).filter(Boolean))];
    if (!names.length || !product) return -Infinity;

    const requestedForm = requestedProductForm(item);
    const productForm = detectProductForm(productName);
    if (requestedForm && productForm && requestedForm !== productForm) return -Infinity;
    const requestedDoses = doseTokens(item.strength || context);
    const compactProduct = product.replace(/\s+/g, "");
    return Math.max(...names.map((primary) => {
      let score = product === primary ? 240 : product.includes(primary) ? 120 : 0;
      const primaryTokens = [...new Set(primary.split(" ").filter((token) => token.length > 1))];
      const productTokens = new Set(product.split(" "));
      const matchedTokens = primaryTokens.filter((token) => productTokens.has(token)).length;
      score += matchedTokens * 24;
      score -= (primaryTokens.length - matchedTokens) * 18;
      if (requestedForm && productForm === requestedForm) score += 48;
      if (requestedDoses.length) {
        const matchingDoses = requestedDoses.filter((dose) => compactProduct.includes(dose)).length;
        score += matchingDoses ? matchingDoses * 32 : -32;
      }
      return score;
    }));
  }

  function firstCatalogSuggestion(value, catalog) {
    const query = normalizeProductMatchText(value);
    if (!query) return "";
    const options = catalog.map((record) => ({ name: record.namaproduk, text: normalizeProductMatchText(record.namaproduk) }));
    return (options.find((option) => option.text === query)
      || options.find((option) => option.text.startsWith(query))
      || options.find((option) => option.text.includes(query)))?.name || "";
  }

  function matchCatalogItem(item, catalog, aliases = []) {
    const alias = findProductAlias(item, aliases);
    const aliasQuery = normalizeProductMatchText(alias?.query);
    const aliasCandidates = aliasQuery
      ? catalog.filter((product) => normalizeProductMatchText(product.namaproduk).includes(aliasQuery))
      : [];
    const pool = aliasCandidates.length ? aliasCandidates : catalog;
    const scoredItem = alias ? { ...item, search_term: alias.query } : item;
    const ranked = pool
      .map((product) => ({ name: product.namaproduk, score: productMatchScore(scoredItem, product.namaproduk) }))
      .filter((candidate) => Number.isFinite(candidate.score))
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "id"));
    const best = ranked[0];
    const second = ranked[1];
    const aliasAllowsAutomatic = !alias || (alias.selection === "unique" && aliasCandidates.length === 1);
    const confident = Boolean(aliasAllowsAutomatic && best && best.score >= 54 && (!second || best.score - second.score >= 12));
    const matchedName = confident ? best.name : "";
    const reviewNote = confident
      ? item.review_note || ""
      : alias?.selection === "confirm"
        ? `Istilah '${alias.term}' diatur agar selalu dikonfirmasi. Pilih produk yang sesuai.`
        : `Produk katalog belum dapat dipastikan untuk '${item.display_name || item.search_term || "item"}'. Pilih produk yang sesuai.`;
    return {
      ...item,
      search_term: matchedName,
      catalog_candidates: ranked.slice(0, 8).map((candidate) => candidate.name),
      needs_review: Boolean(item.needs_review || !confident),
      review_note: reviewNote
    };
  }

  function matchPrescriptionToCatalog(result, catalog, aliases = []) {
    return { ...result, items: result.items.map((item) => matchCatalogItem(item, catalog, aliases)) };
  }

  async function loadProductAliases() {
    if (!productAliasesPromise) {
      productAliasesPromise = Promise.all([
        fetch(chrome.runtime.getURL("hospital/rsdkh/product-aliases.json")).then((response) => {
          if (!response.ok) throw new Error(`Kamus produk gagal dimuat (${response.status}).`);
          return response.json();
        }),
        chrome.storage.local.get(PRODUCT_ALIASES_KEY)
      ]).then(([defaults, stored]) => {
        const aliases = Array.isArray(stored[PRODUCT_ALIASES_KEY]) ? stored[PRODUCT_ALIASES_KEY] : defaults.aliases;
        productAliases = aliases.map(normalizeProductAlias).filter((alias) => alias.term && alias.query);
        return productAliases;
      });
    }
    return productAliasesPromise;
  }

  async function loadProductCatalog() {
    if (!productCatalogPromise) {
      productCatalogPromise = fetch(chrome.runtime.getURL("hospital/rsdkh/product-catalog.json"))
        .then((response) => {
          if (!response.ok) throw new Error(`Katalog produk gagal dimuat (${response.status}).`);
          return response.json();
        })
        .then((payload) => {
          const records = Array.isArray(payload?.products) ? payload.products : [];
          const unique = new Map();
          records.forEach((record) => upsertCatalogRecord(unique, { namaproduk: normalize(record?.namaproduk) }));
          if (!unique.size || payload.count !== unique.size || payload.complete !== true) throw new Error("Katalog produk tidak valid, belum lengkap, atau jumlahnya tidak sesuai.");
          productCatalog = [...unique.values()];
          productCatalogByName = new Map(productCatalog.map((record) => [catalogKey(record.namaproduk), record.namaproduk]));
          return productCatalog;
        });
    }
    return productCatalogPromise;
  }

  function getPatientAgeContext() {
    const ageElement = [...document.querySelectorAll("small.tag.is-danger.is-rounded")]
      .find((element) => isVisible(element) && /^\d+\s*thn(?:\s+\d+\s*bln)?(?:\s+\d+\s*hari)?$/i.test(normalize(element.textContent)));
    const text = normalize(ageElement?.textContent);
    const years = Number(text.match(/^(\d+)\s*thn/i)?.[1]);
    if (!Number.isFinite(years)) return { text: "", years: null, category: "unknown" };
    return { text, years, category: years < 18 ? "child" : "adult" };
  }

  function ensureSurfloForContext(result, mode, age = {}, includeSupplies = true) {
    if (!includeSupplies || mode !== "emergency_inpatient" || !Array.isArray(result?.items)) return result;
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

  function parseDoseSchedule(value) {
    const text = searchable(value).replace(/,/g, ".");
    const compact = text.match(/\b(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(mcg|mg|gr|g|ml|cc|tablet|tab|kaplet|kapsul|caps)?\b/i);
    if (compact) {
      return {
        frequency: Number(compact[1]),
        amount: Number(compact[2]),
        unit: String(compact[3] || "").toLowerCase()
      };
    }
    const verbal = text.match(/\b(\d+(?:\.\d+)?)\s*(tablet|tab|kaplet|kapsul|caps|ml|cc)\b.*?\b(\d+(?:\.\d+)?)\s*kali\b/i);
    if (verbal) {
      return { frequency: Number(verbal[3]), amount: Number(verbal[1]), unit: verbal[2].toLowerCase() };
    }
    return { frequency: 0, amount: 0, unit: "" };
  }

  function massInMg(value) {
    const match = searchable(value).replace(/,/g, ".").match(/\b(\d+(?:\.\d+)?)\s*(mcg|mg|gr|g)\b/i);
    if (!match) return 0;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === "mcg") return amount / 1000;
    if (unit === "g" || unit === "gr") return amount * 1000;
    return amount;
  }

  function durationDays(value) {
    return Number(searchable(value).match(/\b(?:selama\s*)?(\d+)\s*(?:hari|hr)\b/i)?.[1]) || 0;
  }

  function infusionRateTpm(value) {
    return Number(searchable(value).replace(/,/g, ".").match(/\b(\d+(?:\.\d+)?)\s*(?:tpm|tetes\s*per\s*menit)\b/i)?.[1]) || 0;
  }

  function calculatePrescriptionQty(item, mode, outpatientDays = 0) {
    const product = item.search_term || item.display_name || "";
    const form = detectProductForm(product) || requestedProductForm(item);
    const context = `${item.directions || ""} ${item.display_name || ""} ${item.strength || ""}`;
    const explicitDays = durationDays(context);
    const days = mode === "outpatient" ? (Number(outpatientDays) || explicitDays) : 0;
    if (item.is_supply) return Math.max(1, Math.ceil(Number(item.qty) || 1));
    if (form === "sirup") return 1;

    if (form === "infus") {
      const rate = infusionRateTpm(context);
      if (!rate) return Math.max(1, Math.ceil(Number(item.qty) || 1));
      return Math.max(1, Math.ceil(rate / 7) * (days || 1));
    }

    const schedule = parseDoseSchedule(context);
    if (form === "injeksi") {
      const productStrength = massInMg(product);
      const prescribedStrength = schedule.unit && /^(?:mcg|mg|gr|g)$/.test(schedule.unit)
        ? massInMg(`${schedule.amount}${schedule.unit}`)
        : massInMg(item.strength || item.display_name);
      const perDose = productStrength && prescribedStrength
        ? Math.max(1, Math.ceil(prescribedStrength / productStrength))
        : 1;
      return Math.max(1, perDose * (schedule.frequency || 1) * (days || 1));
    }

    if (form === "tablet") {
      if (mode === "outpatient" && !days) return 10;
      let unitsPerDose = schedule.amount || 1;
      if (/^(?:mcg|mg|gr|g)$/.test(schedule.unit)) {
        const productStrength = massInMg(product);
        const prescribedStrength = massInMg(`${schedule.amount}${schedule.unit}`);
        if (productStrength && prescribedStrength) unitsPerDose = Math.max(1, Math.ceil(prescribedStrength / productStrength));
      }
      return Math.max(1, Math.ceil(unitsPerDose * (schedule.frequency || 1) * (days || 1)));
    }

    if (mode === "outpatient" && !days) return 10;
    return Math.max(1, Math.ceil(Number(item.qty) || 1));
  }

  function applyCalculatedQuantities(result, mode, outpatientDays = 0) {
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        qty: calculatePrescriptionQty(item, mode, outpatientDays)
      }))
    };
  }

  function exactText(label, selector = "a,button,span,div,label,li") {
    return [...document.querySelectorAll(selector)]
      .filter(isVisible)
      .sort((left, right) => left.children.length - right.children.length)
      .find((element) => normalize(element.textContent) === label) || null;
  }

  function exactTextIn(scope, label, selector = "a,button,span,div,label,li") {
    if (!scope) return null;
    return [...scope.querySelectorAll(selector)]
      .filter(isVisible)
      .sort((left, right) => left.children.length - right.children.length)
      .find((element) => normalize(element.textContent) === label) || null;
  }

  function findButton(label, scope = document) {
    return [...scope.querySelectorAll("button")].find((button) => isVisible(button) && normalize(button.textContent) === label) || null;
  }

  function roomDropdown() {
    const label = exactText("Ruangan", "label,span,div");
    return label?.parentElement?.querySelector(".p-dropdown")
      || label?.closest(".p-field,.p-col-12,[class*='p-col']")?.querySelector(".p-dropdown")
      || null;
  }

  async function selectErmDepot(depot) {
    if (!DEPOT_NAMES.includes(depot)) throw new Error("Pilih depo pengambilan obat terlebih dahulu.");
    const dropdown = await waitFor(roomDropdown, "Dropdown Ruangan untuk depo tidak ditemukan.");
    const selected = () => normalize(dropdown.querySelector(".p-dropdown-label")?.textContent);
    if (selected() === depot) return;
    const trigger = dropdown.querySelector(".p-dropdown-trigger") || dropdown;
    clickButtonLikeUser(trigger);
    const option = await waitFor(
      () => [...document.querySelectorAll(".p-dropdown-item,[role='option']")]
        .find((item) => isVisible(item) && normalize(item.textContent) === depot),
      `Pilihan ${depot} tidak ditemukan pada dropdown Ruangan.`
    );
    clickButtonLikeUser(option);
    await waitFor(() => selected() === depot, `Depo belum berhasil diubah menjadi ${depot}.`);
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

  function linkedQtyInput(panel, qty) {
    return [...panel.querySelectorAll('input[placeholder="Jumlah"]')]
      .find((control) => control !== qty && isVisible(control)) || null;
  }

  async function syncQtyInput(panel, qty, value) {
    const expected = Math.max(1, Math.ceil(Number(value) || 1));
    await typeControlValue(qty, expected, { blur: false, delay: 18 });
    await waitFor(() => Number(qty.value) === expected, "Qty Obat belum berhasil diisi.", 3000);

    const inputNumber = qty.closest(".p-inputnumber");
    const up = inputNumber?.querySelector(".p-inputnumber-button-up");
    const down = inputNumber?.querySelector(".p-inputnumber-button-down");
    if (up && down) {
      const first = expected > 1 ? down : up;
      const second = expected > 1 ? up : down;
      clickButtonLikeUser(first);
      await sleep(80);
      clickButtonLikeUser(second);
      await sleep(80);

      for (let attempt = 0; Number(qty.value) !== expected && attempt < 500; attempt += 1) {
        const current = Number(qty.value);
        const step = current < expected ? up : down;
        clickButtonLikeUser(step);
        await sleep(25);
        if (Number(qty.value) === current) throw new Error("Spinner Qty Obat tidak merespons.");
      }
    }

    await waitFor(() => Number(qty.value) === expected, "Qty Obat belum tersinkron ke eRM.", 3000);
    const linked = linkedQtyInput(panel, qty);
    if (linked) {
      await waitFor(
        () => Number(linked.value) === expected,
        `Jumlah e-Resep belum mengikuti Qty ${expected}.`,
        3000
      );
    }
    qty.blur();
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

    if (item.catalog_product) {
      await typeControlValue(search, term, { blur: false, delay: 18 });
      options = await settledOptions(search);
      const exact = options.find((option) => catalogKey(option.textContent) === catalogKey(term));
      if (exact) return chooseOption(exact, search);
      throw new Error(`Produk katalog '${term}' tidak muncul pada dropdown eRM.`);
    }

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

  function isReadyButton(button) {
    return Boolean(button
      && isVisible(button)
      && !button.disabled
      && button.getAttribute("aria-disabled") !== "true"
      && !button.classList.contains("p-disabled"));
  }

  function clickButtonLikeUser(button) {
    button.scrollIntoView({ block: "center", behavior: "auto" });
    button.focus();
    if (typeof PointerEvent === "function") {
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse", isPrimary: true }));
    }
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    if (typeof PointerEvent === "function") {
      button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse", isPrimary: true }));
    }
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    button.click();
  }

  async function clickAddWithRetry(panel, added, product) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (added()) return;
      const add = await waitFor(
        () => {
          const button = findButton("Tambah", prescriptionPanel() || panel);
          return isReadyButton(button) ? button : null;
        },
        "Tombol Tambah belum siap. Periksa produk dan Qty.",
        6000
      );
      await sleep(attempt === 1 ? 220 : 420);
      if (added()) return;
      clickButtonLikeUser(add);
      try {
        await waitFor(added, `Produk '${product}' belum berhasil ditambahkan.`, 5000);
        return;
      } catch (error) {
        if (attempt === 2 || added()) {
          if (added()) return;
          throw error;
        }
      }
    }
  }

  async function insertItem(item) {
    const panel = await ensureNonCompoundPanel();
    const selectedProduct = await selectProduct(panel, item);
    const qty = await waitFor(() => qtyInput(panel), "Kolom Qty Obat tidak ditemukan.");
    await syncQtyInput(panel, qty, item.qty);
    const directions = directionsField(panel);
    if (directions) setControlValue(directions, item.directions || "");
    await sleep(180);

    const beforeRows = document.querySelectorAll("tbody tr").length;
    const beforeProductRows = productRowCount(selectedProduct);
    const added = () => {
      const currentPanel = prescriptionPanel();
      if (!currentPanel) return false;
      const productAdded = productRowCount(selectedProduct) > beforeProductRows;
      const rowsAdded = document.querySelectorAll("tbody tr").length > beforeRows;
      const reset = !normalize(productInput(currentPanel)?.value) && !normalize(qtyInput(currentPanel)?.value);
      return productAdded || rowsAdded || reset;
    };
    await clickAddWithRetry(panel, added, selectedProduct);
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
    card.dataset.form = item.form || "";
    card.dataset.strength = item.strength || "";
    const index = document.createElement("strong");
    index.className = "erx-item-index";
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

    const grid = document.createElement("div");
    grid.className = "erx-item-grid";
    grid.append(
      index,
      createField("Nama produk", "erx-search", item.search_term || ""),
      createField("Qty (pcs)", "erx-qty", item.qty || 1, "number"),
      createField("Aturan pakai", "erx-directions", item.directions || ""),
      remove
    );
    grid.querySelector(".erx-qty").min = "1";
    grid.querySelector(".erx-qty").step = "1";
    const product = grid.querySelector(".erx-search");
    product.setAttribute("list", "erx-product-catalog");
    product.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      const suggestion = firstCatalogSuggestion(product.value, productCatalog);
      if (!suggestion) return;
      event.preventDefault();
      product.value = suggestion;
      product.dispatchEvent(new Event("input", { bubbles: true }));
      product.dispatchEvent(new Event("change", { bubbles: true }));
    });
    product.addEventListener("change", () => {
      const canonical = productCatalogByName.get(catalogKey(product.value));
      if (canonical) {
        product.value = canonical;
        const review = card.querySelector(".erx-review-note");
        if (/^Produk katalog belum dapat dipastikan/i.test(review?.textContent || "")) review.hidden = true;
        if (card.dataset.state === "error") setItemStatus(card, "pending", "");
      } else if (product.value.trim()) {
        setItemStatus(card, "error", "Nama produk tidak tersedia pada katalog eRM.");
      }
      syncInsertButton();
    });
    grid.addEventListener("input", () => {
      if (card.dataset.state === "error") setItemStatus(card, "pending", "");
      syncInsertButton();
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
    card.append(grid, review, status);
    return card;
  }

  function renumberItems() {
    [...ui.items.children].forEach((card, index) => {
      card.querySelector(".erx-item-index").textContent = `${index + 1}.`;
      card.querySelector(".erx-remove").setAttribute("aria-label", `Hapus item resep ${index + 1}`);
    });
  }

  function renderPrescription(result) {
    ui.summary.value = result.summary || "";
    ui.warning.hidden = !result.warning;
    ui.warning.textContent = result.warning || "";
    ui.catalogList.replaceChildren(...productCatalog.map((record) => {
      const option = document.createElement("option");
      option.value = record.namaproduk;
      return option;
    }));
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
        form: card.dataset.form || "",
        strength: card.dataset.strength || "",
        qty: Math.max(1, Math.ceil(Number(card.querySelector(".erx-qty").value) || 1)),
        directions: card.querySelector(".erx-directions").value.trim(),
        catalog_product: true
      }
    }));
  }

  function syncInsertButton() {
    const hasItems = Boolean(ui?.items.children.length);
    const catalogValid = hasItems && [...ui.items.querySelectorAll(".erx-search")]
      .every((input) => productCatalogByName.has(catalogKey(input.value)));
    ui.insert.disabled = running || !catalogValid || !ui.confirm.checked;
  }

  function setRunning(active) {
    running = active;
    ui.generate.disabled = active;
    ui.depot.disabled = active;
    ui.addItem.disabled = active;
    ui.close.disabled = active;
    ui.closeIcon.disabled = active;
    ui.confirm.disabled = active;
    ui.items.querySelectorAll("input,textarea,button").forEach((control) => {
      if (control.closest(".erx-item")?.dataset.state !== "done") control.disabled = active;
    });
    syncInsertButton();
  }

  function chooseSupplyPreference() {
    return new Promise((resolve) => {
      const dialog = ui.supplyDialog;
      const finish = (value) => {
        dialog.close();
        resolve(value);
      };
      ui.suppliesYes.onclick = () => finish(true);
      ui.suppliesNo.onclick = () => finish(false);
      dialog.oncancel = (event) => {
        event.preventDefault();
        finish(null);
      };
      dialog.showModal();
      ui.suppliesYes.focus();
    });
  }

  function chooseOutpatientDuration() {
    return new Promise((resolve) => {
      const dialog = ui.durationDialog;
      const finish = (cancelled) => {
        const days = Math.max(0, Math.floor(Number(ui.durationDays.value) || 0));
        dialog.close();
        resolve({ cancelled, days });
      };
      ui.durationContinue.onclick = () => finish(false);
      ui.durationCancel.onclick = () => finish(true);
      dialog.oncancel = (event) => {
        event.preventDefault();
        finish(true);
      };
      ui.durationDays.value = "";
      dialog.showModal();
      ui.durationDays.focus();
    });
  }

  async function generatePrescription() {
    const prescriptionText = ui.source.value.trim();
    if (!prescriptionText) {
      setStatus("error", "Tuliskan obat terlebih dahulu.");
      ui.source.focus();
      return;
    }
    const depot = ui.depot.value;
    if (!depot) {
      setStatus("error", "Pilih depo pengambilan obat terlebih dahulu.");
      ui.depot.focus();
      return;
    }
    setStatus("loading", `Memilih ${depot} pada eRM.`);
    try {
      await selectErmDepot(depot);
    } catch (error) {
      setStatus("error", error.message || "Depo pengambilan gagal dipilih.");
      return;
    }
    const mode = ui.shadow.querySelector('input[name="erx-mode"]:checked').value;
    let outpatientDays = 0;
    if (mode === "outpatient") {
      const duration = await chooseOutpatientDuration();
      if (duration.cancelled) return;
      outpatientDays = duration.days;
    }
    const includeSupplies = await chooseSupplyPreference();
    if (includeSupplies === null) return;
    setRunning(true);
    ui.generate.querySelector("span").textContent = "Sedang generate...";
    setStatus("loading", "AI sedang merapikan resep.");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "rsdkh:generate-prescription",
        mode: ui.shadow.querySelector('input[name="erx-mode"]:checked').value,
        prescriptionText,
        includeSupplies
      });
      if (!response?.ok) throw new Error(response?.error || "AI gagal merapikan resep.");
      const [catalog, aliases] = await Promise.all([loadProductCatalog(), loadProductAliases()]);
      const matched = matchPrescriptionToCatalog(ensureSurfloForContext(response.result, mode, getPatientAgeContext(), includeSupplies), catalog, aliases);
      const calculated = applyCalculatedQuantities(matched, mode, outpatientDays);
      renderPrescription(calculated);
      const unresolved = calculated.items.filter((item) => !item.search_term).length;
      const state = unresolved ? "error" : "success";
      const message = unresolved
        ? `${unresolved} item belum memiliki produk katalog. Pilih produk sebelum memasukkan e-Resep.`
        : "Semua item sudah dicocokkan dengan katalog dan Qty telah dihitung. Periksa kembali sebelum memasukkan e-Resep.";
      setStatus(state, message);
    } catch (error) {
      setStatus("error", error.message || "AI gagal merapikan resep.");
    } finally {
      setRunning(false);
      ui.generate.querySelector("span").textContent = "Generate";
    }
  }

  function sourceConfig() {
    const mode = ui.shadow.querySelector('input[name="erx-mode"]:checked')?.value;
    if (mode === "emergency_inpatient") return {
      kinds: ["PENGKAJIAN DOKTER IGD", "PENGKAJIAN DOKTER"],
      label: "Ambil Resep dari Tatalaksana IGD",
      sourceName: "Planning Pengkajian Dokter IGD",
      empty: "Planning pada Pengkajian Dokter IGD belum tersedia.",
      extract: extractIgdInstructions
    };
    if (mode === "inpatient") return {
      kinds: ["PENGANTAR OPNAME NEW", "PENGANTAR OPNAME"],
      label: "Ambil resep dari pengantar opname",
      sourceName: "Pengantar Opname",
      empty: "Rencana Terapi pada Pengantar Opname belum tersedia.",
      extract: extractOpnameTherapies
    };
    return null;
  }

  function syncSourceButton() {
    const config = sourceConfig();
    ui.importSource.hidden = !config;
    if (config) ui.importSource.querySelector("span").textContent = config.label;
  }

  async function loadPrescriptionSource(config) {
    let lastError;
    let loaded = false;
    for (const kind of config.kinds) {
      try {
        const records = await loadMedicalRecords(kind);
        loaded = true;
        const source = config.extract(records);
        if (source) return source;
      } catch (error) {
        lastError = error;
      }
    }
    if (!loaded && lastError) throw lastError;
    return "";
  }

  async function autoGenerateAfterDepotChoice(message) {
    if (ui.depot.value) {
      pendingAutoGenerate = false;
      await generatePrescription();
      return;
    }
    pendingAutoGenerate = true;
    setStatus("success", message);
    ui.depot.focus();
  }

  async function importPrescriptionSource() {
    const config = sourceConfig();
    if (!config || running) return;
    ui.importSource.disabled = true;
    ui.modeInputs.forEach((input) => { input.disabled = true; });
    ui.importSource.querySelector("span").textContent = "Mengambil data...";
    setStatus("loading", `Mengambil ${config.sourceName}.`);
    try {
      const source = await loadPrescriptionSource(config);
      if (!source) throw new Error(config.empty);
      setNativeValue(ui.source, source);
      ui.source.dispatchEvent(new Event("input", { bubbles: true }));
      await autoGenerateAfterDepotChoice("Data resep berhasil diambil. Pilih depo untuk melanjutkan Generate.");
    } catch (error) {
      setStatus("error", error.message || "Data resep gagal diambil.");
    } finally {
      ui.importSource.disabled = false;
      ui.modeInputs.forEach((input) => { input.disabled = false; });
      syncSourceButton();
    }
  }

  function formatInsertionReport(completed, failures) {
    const summary = `${completed} item berhasil, ${failures.length} item gagal.`;
    if (!failures.length) return summary;
    const details = failures.map(({ index, name, message }) => `${index}. ${name}: ${message}`).join("\n");
    return `${summary}\n${details}\nItem hijau tidak akan diulang saat mencoba kembali.`;
  }

  async function insertPrescription() {
    if (!ui.confirm.checked || running) return;
    const entries = collectItems().filter(({ card }) => card.dataset.state !== "done");
    if (!entries.length) return;
    if (!ui.depot.value) {
      setStatus("error", "Pilih depo pengambilan obat terlebih dahulu.");
      ui.depot.focus();
      return;
    }
    try {
      await selectErmDepot(ui.depot.value);
    } catch (error) {
      setStatus("error", error.message || "Depo pengambilan gagal dipilih.");
      return;
    }
    setRunning(true);
    setStatus("loading", `Memasukkan 0 dari ${entries.length} item.`);
    if (ui.dialog.open) ui.dialog.close();
    showToast(`Mulai memasukkan ${entries.length} item. Jangan berpindah halaman.`);
    let completed = 0;
    const failures = [];
    try {
      for (const [position, { card, item }] of entries.entries()) {
        const itemIndex = Number.parseInt(card.querySelector(".erx-item-index")?.textContent, 10) || position + 1;
        setItemStatus(card, "loading", `Mencari '${item.search_term}'...`);
        try {
          if (!item.search_term) throw new Error("Nama produk/pencarian tidak boleh kosong.");
          if (!productCatalogByName.has(catalogKey(item.search_term))) throw new Error(`Produk '${item.search_term}' tidak tersedia pada katalog eRM.`);
          const selected = await insertItem(item);
          completed += 1;
          setItemStatus(card, "done", `Berhasil ditambahkan: ${selected}`);
        } catch (error) {
          const message = error.message || "Gagal memasukkan produk ke e-Resep.";
          failures.push({
            index: itemIndex,
            name: item.search_term || `Item ${itemIndex}`,
            message,
            card
          });
          setItemStatus(card, "error", message);
        }
        setStatus("loading", `Memproses ${position + 1} dari ${entries.length} item · ${completed} berhasil · ${failures.length} gagal.`);
      }
      if (failures.length) {
        setStatus("error", formatInsertionReport(completed, failures));
        if (!ui.dialog.open) ui.dialog.showModal();
        requestAnimationFrame(() => failures[0].card.scrollIntoView({
          block: "center",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
        }));
        showToast(`Proses selesai: ${completed} berhasil, ${failures.length} gagal. Periksa laporan pada modal.`);
      } else {
        setStatus("success", formatInsertionReport(completed, failures));
        showToast(`${completed} item e-Resep berhasil dimasukkan. Periksa kembali sebelum melanjutkan.`);
      }
    } catch (error) {
      setStatus("error", `Proses batch terganggu: ${error.message || "Terjadi kesalahan tak terduga."}`);
      if (!ui.dialog.open) ui.dialog.showModal();
      showToast("Proses batch terganggu. Periksa laporan pada modal.");
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
              <label><input type="radio" name="erx-mode" value="emergency_inpatient" checked><span>Resep Pergantian IGD</span></label>
            </div></fieldset>
            <label class="erx-depot-label" for="erx-depot"><span>Depo pengambilan *</span><select id="erx-depot" required>
              <option value="">Pilih depo</option>
              ${DEPOT_NAMES.map((name) => `<option value="${name}">${name}</option>`).join("")}
            </select></label>
            <label class="erx-source-label" for="erx-source"><span>Tulis obat-obatan di sini</span><textarea id="erx-source" rows="6" placeholder="panto 1&#10;ns 1&#10;ondan 1"></textarea></label>
            <button class="erx-import-source" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/></svg><span></span></button>
          </section>
          <section class="erx-preview" hidden>
            <label for="erx-summary"><span>Terapi yang dirapikan</span><textarea id="erx-summary" rows="4"></textarea></label>
            <p class="erx-warning" hidden role="alert"></p>
            <div class="erx-preview-heading"><h3>Resep</h3><button class="erx-add-item" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Tambah item</button></div>
            <datalist id="erx-product-catalog"></datalist>
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
      </dialog>
      <dialog class="erx-supply-dialog" aria-labelledby="erx-supply-title">
        <section>
          <p>ALAT MEDIS</p>
          <h2 id="erx-supply-title">Resepkan juga spuit dan alat medis lain?</h2>
          <div>
            <button class="secondary erx-supplies-no" type="button">Tidak, hanya resepkan obat-obatan</button>
            <button class="primary erx-supplies-yes" type="button">Ya, resepkan alat medis</button>
          </div>
        </section>
      </dialog>
      <dialog class="erx-duration-dialog" aria-labelledby="erx-duration-title">
        <section>
          <p>RAWAT JALAN</p>
          <h2 id="erx-duration-title">Obat digunakan untuk berapa hari?</h2>
          <label>Jumlah hari
            <input class="erx-duration-days" type="number" min="1" step="1" inputmode="numeric" placeholder="Contoh: 5">
            <small>Default jika kosong: 10 pcs per masing-masing obat.</small>
          </label>
          <div>
            <button class="secondary erx-duration-cancel" type="button">Batal</button>
            <button class="primary erx-duration-continue" type="button">Lanjutkan</button>
          </div>
        </section>
      </dialog>`;
    document.documentElement.append(host);
    ui = {
      shadow,
      dialog: shadow.querySelector("dialog"),
      depot: shadow.querySelector("#erx-depot"),
      source: shadow.querySelector("#erx-source"),
      importSource: shadow.querySelector(".erx-import-source"),
      modeInputs: [...shadow.querySelectorAll('input[name="erx-mode"]')],
      preview: shadow.querySelector(".erx-preview"),
      summary: shadow.querySelector("#erx-summary"),
      warning: shadow.querySelector(".erx-warning"),
      catalogList: shadow.querySelector("#erx-product-catalog"),
      items: shadow.querySelector(".erx-items"),
      confirm: shadow.querySelector(".erx-confirm input"),
      status: shadow.querySelector(".erx-status"),
      addItem: shadow.querySelector(".erx-add-item"),
      generate: shadow.querySelector(".erx-generate"),
      insert: shadow.querySelector(".erx-insert"),
      close: shadow.querySelector(".erx-close"),
      closeIcon: shadow.querySelector(".erx-close-icon"),
      supplyDialog: shadow.querySelector(".erx-supply-dialog"),
      suppliesYes: shadow.querySelector(".erx-supplies-yes"),
      suppliesNo: shadow.querySelector(".erx-supplies-no"),
      durationDialog: shadow.querySelector(".erx-duration-dialog"),
      durationDays: shadow.querySelector(".erx-duration-days"),
      durationContinue: shadow.querySelector(".erx-duration-continue"),
      durationCancel: shadow.querySelector(".erx-duration-cancel")
    };
    const close = () => {
      if (running) return;
      pendingAutoGenerate = false;
      ui.dialog.close();
    };
    ui.generate.addEventListener("click", generatePrescription);
    ui.importSource.addEventListener("click", importPrescriptionSource);
    ui.modeInputs.forEach((input) => input.addEventListener("change", syncSourceButton));
    ui.depot.addEventListener("change", () => {
      if (!pendingAutoGenerate || !ui.depot.value) return;
      pendingAutoGenerate = false;
      generatePrescription();
    });
    ui.insert.addEventListener("click", insertPrescription);
    ui.addItem.addEventListener("click", () => {
      ui.items.append(createItemCard({ qty: 1 }));
      renumberItems();
      syncInsertButton();
      ui.items.lastElementChild.querySelector("input").focus();
    });
    ui.confirm.addEventListener("change", syncInsertButton);
    ui.durationDays.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      ui.durationContinue.click();
    });
    ui.close.addEventListener("click", close);
    ui.closeIcon.addEventListener("click", close);
    ui.dialog.addEventListener("cancel", (event) => { if (running) event.preventDefault(); });
    syncSourceButton();
    return ui;
  }

  function openModal() {
    createUi();
    pendingAutoGenerate = false;
    ui.depot.value = "";
    setStatus("", "");
    ui.dialog.showModal();
    ui.source.focus();
  }

  function opnameDetailDialog() {
    const title = exactText("Detail Pengantar Opname", ".p-dialog-title,h1,h2,h3,h4,span");
    return title?.closest(".p-dialog,[role='dialog']") || null;
  }

  function opnameEditor() {
    return opnameDetailDialog()
      || (isNewOpnamePage() ? document.querySelector("app-pengantar-opname-new") : null);
  }

  function opnameTherapyLabel(root) {
    return [...(root?.querySelectorAll("label,span,div") || [])]
      .filter(isVisible)
      .sort((left, right) => left.children.length - right.children.length)
      .find((element) => /^rencana terapi\s*:?$/i.test(normalize(element.textContent)));
  }

  function opnameTherapy(root) {
    const label = opnameTherapyLabel(root);
    const container = label?.closest(".p-field,.p-col-12,[class*='p-col']") || label?.parentElement;
    return String(container?.querySelector("textarea")?.value || "").trim();
  }

  async function startOpnamePrescription(button) {
    if (running || button.disabled) return;
    const source = opnameTherapy(opnameEditor());
    if (!source) {
      showToast("Rencana Terapi pada Pengantar Opname masih kosong.");
      return;
    }
    button.disabled = true;
    button.textContent = "Menyiapkan...";
    try {
      const menuText = exactText("Resep Elektronik V2", "a,button,span,li");
      const menu = menuText?.closest("a,button,[role='menuitem']") || menuText;
      if (!menu) throw new Error("Menu Resep Elektronik V2 tidak ditemukan.");
      menu.click();
      await waitFor(isPrescriptionPage, "Halaman Resep Elektronik V2 gagal dibuka.", 20000);
      queueInject();
      const prescriptionButton = await waitFor(
        () => document.getElementById(BUTTON_ID),
        "Tombol e-Resep otomatis tidak ditemukan."
      );
      if (!ui?.dialog?.open) prescriptionButton.click();
      await waitFor(() => ui?.dialog?.open && ui, "Modal e-Resep otomatis gagal dibuka.");
      const inpatient = ui.modeInputs.find((input) => input.value === "inpatient");
      if (!inpatient) throw new Error("Pilihan Rawat inap tidak ditemukan.");
      inpatient.click();
      setNativeValue(ui.source, source);
      ui.source.dispatchEvent(new Event("input", { bubbles: true }));
      await autoGenerateAfterDepotChoice("Rencana Terapi berhasil dimuat. Pilih depo untuk melanjutkan Generate.");
    } catch (error) {
      showToast(error.message || "Buat Resep gagal dijalankan.");
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = "Buat Resep";
      }
    }
  }

  function injectPrescriptionButton() {
    if (!isPrescriptionPage()) {
      document.getElementById(SLOT_ID)?.remove();
      return;
    }
    if (!document.getElementById(BUTTON_ID)) {
      const text = exactText("Racikan", "a,button,span,li");
      const tab = text?.closest("a,button,[role='tab']") || text;
      const tabItem = tab?.closest("li") || tab;
      if (tabItem?.parentElement) {
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
    }
  }

  function injectOpnameButton() {
    const existing = document.getElementById(OPNAME_BUTTON_ID);
    const editor = opnameEditor();
    const isNewPage = editor?.matches?.("app-pengantar-opname-new");
    const title = isNewPage
      ? exactTextIn(editor, "Pengantar Opname New", "h1,h2,h3,h4,h5")
      : editor && exactTextIn(editor, "Detail Pengantar Opname", ".p-dialog-title,h1,h2,h3,h4,span");
    const target = title && (!isNewPage || opnameTherapyLabel(editor)) ? title : null;
    if (!target) {
      existing?.remove();
      document.querySelector(".netmedic-rsdkh-opname-heading")?.classList.remove("netmedic-rsdkh-opname-heading");
      return;
    }
    if (existing) return;
    const button = document.createElement("button");
    button.id = OPNAME_BUTTON_ID;
    button.type = "button";
    button.textContent = "Buat Resep";
    button.addEventListener("click", () => startOpnamePrescription(button));
    if (isNewPage) target.classList.add("netmedic-rsdkh-opname-heading");
    target.insertAdjacentElement("afterend", button);
  }

  function injectButtons() {
    injectQueued = false;
    injectPrescriptionButton();
    injectOpnameButton();
  }

  function queueInject() {
    if (injectQueued) return;
    injectQueued = true;
    requestAnimationFrame(injectButtons);
  }

  if (typeof module !== "undefined") module.exports = {
    narrowOptions,
    ensureSurfloForContext,
    catalogKey,
    upsertCatalogRecord,
    normalizeProductAlias,
    findProductAlias,
    normalizeProductMatchText,
    detectProductForm,
    requestedProductForm,
    doseTokens,
    productMatchScore,
    firstCatalogSuggestion,
    matchCatalogItem,
    matchPrescriptionToCatalog,
    parseDoseSchedule,
    massInMg,
    durationDays,
    infusionRateTpm,
    calculatePrescriptionQty,
    applyCalculatedQuantities,
    extractIgdInstructions,
    extractOpnameTherapies,
    formatInsertionReport
  };
  if (typeof document !== "undefined") {
    new MutationObserver(queueInject).observe(document.documentElement, { childList: true, subtree: true });
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes[PRODUCT_ALIASES_KEY]) productAliasesPromise = null;
    });
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
  const catalog = new Map();
  module.exports.upsertCatalogRecord(catalog, { namaproduk: "SURFLO NO 24\r\n", marker: "old" });
  module.exports.upsertCatalogRecord(catalog, { namaproduk: "  surflo   no 24  ", marker: "new" });
  assert.equal(catalog.size, 1);
  assert.equal(catalog.values().next().value.marker, "new");
  const products = [
    { namaproduk: "DIPHENHYDRAMIN 10MG INJ" },
    { namaproduk: "EPINEPHRINE 0.1% INJ" },
    { namaproduk: "NOREPINEPHRINE 4MG INJ" },
    { namaproduk: "DEXAMETHASONE 0,5MG TAB" },
    { namaproduk: "DEXAMETHASONE 5MG/ML INJ" },
    { namaproduk: "NACL 0,9% 500ML INFUS" },
    { namaproduk: "ONDANCETRON 4 MG TAB" },
    { namaproduk: "ONDANCETRON 4MG/2ML INJ" },
    { namaproduk: "ONDANCETRON 8MG INJ" }
  ];
  assert.equal(module.exports.matchCatalogItem({ search_term: "Difenhidramin", form: "injeksi" }, products).search_term, "DIPHENHYDRAMIN 10MG INJ");
  assert.equal(module.exports.matchCatalogItem({ search_term: "Epinephrine", form: "injeksi" }, products).search_term, "EPINEPHRINE 0.1% INJ");
  assert.equal(module.exports.matchCatalogItem({ search_term: "Dexamethasone", form: "injeksi" }, products).search_term, "DEXAMETHASONE 5MG/ML INJ");
  assert.equal(module.exports.matchCatalogItem({ display_name: "Inj. Ondansetron 4mg", search_term: "Ondansetron", form: "", strength: "4 mg" }, products).search_term, "ONDANCETRON 4MG/2ML INJ");
  assert.equal(module.exports.matchCatalogItem({ display_name: "Inj. Ondansetron 4mg", search_term: "ONDANCETRON 4 MG TAB", form: "injeksi", strength: "4 mg" }, products).search_term, "ONDANCETRON 4MG/2ML INJ");
  assert.equal(module.exports.matchCatalogItem({ display_name: "Spuit 10 cc", search_term: "syringe 10 ml", form: "alat", strength: "10 cc" }, [{ namaproduk: "SPUIT 1 CC" }, { namaproduk: "SPUIT 10 CC" }]).search_term, "SPUIT 10 CC");
  assert.equal(module.exports.firstCatalogSuggestion("nacl", [{ namaproduk: "NACL 0,9% 500ML INFUS" }, { namaproduk: "NACL 0,9% 100ML INFUS" }]), "NACL 0,9% 500ML INFUS");
  assert.equal(module.exports.matchCatalogItem({ display_name: "Antrain", search_term: "Antrain", form: "injeksi", strength: "1 gr" }, [{ namaproduk: "METAMIZOLE 1GR INJ" }], [{ term: "antrain", query: "METAMIZOLE", selection: "unique" }]).search_term, "METAMIZOLE 1GR INJ");
  assert.equal(module.exports.matchCatalogItem({ display_name: "Attapulgite", search_term: "Attapulgite", form: "tablet" }, [{ namaproduk: "AKITA (ATTAPULGITE 600, PECTIN 50)" }], [{ term: "attapulgite", query: "ATTAPULGITE", selection: "confirm" }]).search_term, "");
  assert.equal(module.exports.calculatePrescriptionQty({ search_term: "NACL 0,9% 500ML INFUS", directions: "20 tpm" }, "inpatient"), 3);
  assert.equal(module.exports.calculatePrescriptionQty({ search_term: "CEFOTAXIME 1GR INJ", form: "injeksi", strength: "1 gr", directions: "3x1gr" }, "inpatient"), 3);
  assert.equal(module.exports.calculatePrescriptionQty({ search_term: "AKITA (ATTAPULGITE 600, PECTIN 50)", form: "tablet", directions: "3x2 tab" }, "inpatient"), 6);
  assert.equal(module.exports.calculatePrescriptionQty({ search_term: "AKITA (ATTAPULGITE 600, PECTIN 50)", form: "tablet", directions: "3x2 tab" }, "outpatient"), 10);
  assert.equal(module.exports.calculatePrescriptionQty({ search_term: "AKITA (ATTAPULGITE 600, PECTIN 50)", form: "tablet", directions: "3x2 tab" }, "outpatient", 5), 30);
  assert.equal(module.exports.calculatePrescriptionQty({ search_term: "AKITA (ATTAPULGITE 600, PECTIN 50)", form: "tablet", directions: "3x2 tab selama 5 hari" }, "outpatient"), 30);
  assert.equal(module.exports.calculatePrescriptionQty({ search_term: "PARACETAMOL SYRUP", form: "sirup", directions: "3x1" }, "outpatient", 5), 1);
  assert.equal(module.exports.matchCatalogItem({ search_term: "Pantoprazole", form: "injeksi" }, products).search_term, "");
  assert.equal(
    module.exports.formatInsertionReport(2, [{ index: 3, name: "SPASMINAL", message: "Produk tidak ditemukan." }]),
    "2 item berhasil, 1 item gagal.\n3. SPASMINAL: Produk tidak ditemukan.\nItem hijau tidak akan diulang saat mencoba kembali."
  );
  assert.equal(module.exports.extractIgdInstructions([
    { json: { planning: "NS 20 tpm", datasource: [{ instruksidokter: "NS 20 tpm" }, { instruksidokter: "  Inj. Antrain 1 gr  " }] } },
    { json: { datasource: [{ instruksidokter: "Pantoprazole 40 mg" }, { instruksidokter: "" }] } }
  ]), "NS 20 tpm\nInj. Antrain 1 gr\nPantoprazole 40 mg");
  assert.equal(module.exports.extractOpnameTherapies([
    { json: { rencanaterapi: "Futrolit 20 tpm", rencanatindakan: "Observasi" } },
    { json: { diagnosis: "Tidak boleh ikut", rencanaTerapi: "Ondansetron 3x4 mg" } }
  ]), "Futrolit 20 tpm\nOndansetron 3x4 mg");
  console.log("RSDKH prescription self-check ok");
}
