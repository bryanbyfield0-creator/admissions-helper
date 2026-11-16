(() => {
  "use strict";

  // Keep the original key so referrals already saved in this browser still load after the rename.
  const STORAGE_KEY = "weeshee-admissions-v1";
  const STATUSES = [
    { id: "new", label: "New referral" },
    { id: "reviewing", label: "Reviewing" },
    { id: "pending-auth", label: "Pending insurance auth" },
    { id: "accepted", label: "Accepted" },
    { id: "admitted", label: "Admitted" },
    { id: "declined", label: "Declined" },
  ];
  const PAYERS = [
    { id: "medicare", label: "Medicare" },
    { id: "medicaid", label: "Medicaid / Medi-Cal" },
    { id: "medicare-medicaid", label: "Medicare + Medicaid" },
    { id: "mco", label: "Medicare Advantage / MCO" },
    { id: "private", label: "Private insurance" },
    { id: "private-pay", label: "Private pay" },
    { id: "other", label: "Other / pending" },
  ];
  const NEEDS = [
    { id: "pt", label: "PT" },
    { id: "ot", label: "OT" },
    { id: "st", label: "Speech therapy" },
    { id: "wound", label: "Wound care" },
    { id: "iv", label: "IV therapy" },
    { id: "dialysis", label: "Dialysis" },
    { id: "oxygen", label: "Oxygen" },
    { id: "isolation", label: "Isolation / infection precautions" },
    { id: "trach", label: "Trach / vent" },
    { id: "tube", label: "Tube feeding" },
    { id: "bariatric", label: "Bariatric" },
    { id: "behavior", label: "Behavioral / 1:1" },
  ];
  const CHECKLIST = [
    { id: "insurance-verified", label: "Insurance eligibility verified" },
    { id: "auth-obtained", label: "Prior authorization obtained (or not required)" },
    { id: "hp-received", label: "History & Physical (H&P) received" },
    { id: "med-list", label: "Medication list received" },
    { id: "face-sheet", label: "Face sheet / demographics received" },
    { id: "discharge-summary", label: "Discharge summary received" },
    { id: "bed-assigned", label: "Bed assigned" },
    { id: "family-contacted", label: "Family / responsible party contacted" },
    { id: "consent-signed", label: "Admission consent signed" },
    { id: "orders-received", label: "Admission orders received" },
    { id: "transport-arranged", label: "Transportation arranged" },
    { id: "special-needs", label: "Isolation / special needs reviewed" },
  ];
  let state = emptyState();
  let cryptoKey = null;
  let currentView = "dashboard";
  let selectedId = null;
  let searchQuery = "";
  let filterStatus = "";
  let filterPayer = "";
  let filledFromPdf = new Set();
  let extractRaw = "";
  let extractName = "";
  let toastTimer = 0;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function emptyState() {
    return { facilityName: "", referrals: [] };
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "r-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const part = String(iso).slice(0, 10);
    const [y, m, d] = part.split("-");
    if (!y || !m || !d) return part;
    return `${Number(m)}/${Number(d)}/${y}`;
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return formatDate(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function statusLabel(id) {
    return STATUSES.find((s) => s.id === id)?.label || id;
  }

  function payerLabel(id) {
    return PAYERS.find((p) => p.id === id)?.label || id || "Payer pending";
  }

  function needLabel(id) {
    return NEEDS.find((n) => n.id === id)?.label || id;
  }

  function highAcuity(needs) {
    return (needs || []).filter((id) => ["wound", "iv", "dialysis", "isolation", "trach", "tube", "bariatric", "behavior"].includes(id));
  }

  function blankChecklist() {
    const out = {};
    for (const item of CHECKLIST) out[item.id] = { done: false, at: null };
    return out;
  }

  function checklistProgress(referral) {
    const items = CHECKLIST.length;
    const done = CHECKLIST.filter((c) => referral.checklist?.[c.id]?.done).length;
    return { done, items, pct: items ? Math.round((done / items) * 100) : 0 };
  }

  function newReferralDefaults() {
    return {
      id: uid(),
      name: "",
      dob: "",
      hospital: "",
      diagnosis: "",
      diagnoses: [],
      allergies: { status: "unknown", items: [] },
      payer: "",
      payerNotes: "",
      dateReceived: todayISO(),
      expectedAdmitDate: "",
      needs: [],
      notes: "",
      status: "new",
      statusHistory: [{ status: "new", at: new Date().toISOString() }],
      checklist: blankChecklist(),
      extractedText: "",
      extractedSourceName: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }

  function b64ToBuf(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  async function deriveKey(passcode, salt) {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passcode), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptState(data, passcode, existingSalt) {
    const salt = existingSalt || crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passcode, salt);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(data)));
    cryptoKey = key;
    return { v: 1, enc: true, salt: bufToB64(salt), iv: bufToB64(iv), ct: bufToB64(ct) };
  }

  async function decryptState(record, passcode) {
    const salt = b64ToBuf(record.salt);
    const iv = b64ToBuf(record.iv);
    const key = await deriveKey(passcode, salt);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, b64ToBuf(record.ct));
    cryptoKey = key;
    return JSON.parse(new TextDecoder().decode(pt));
  }

  function readRecord() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function persist() {
    const record = readRecord();
    try {
      if (record?.enc) {
        if (!window.__weesheePass) throw new Error("locked");
        const next = await encryptState(state, window.__weesheePass, b64ToBuf(record.salt));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, enc: false, data: state }));
      }
    } catch (err) {
      console.error(err);
      toast("Could not save on this device. Export a backup, or free some browser storage.");
    }
  }

  function findReferral(id) {
    return state.referrals.find((r) => r.id === id);
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
      return true;
    } catch {
      toast("Could not copy automatically. Select the text and copy it.");
      return false;
    }
  }

  function downloadFile(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function populateSelects() {
    const statusFilter = $("#filter-status");
    if (statusFilter.options.length <= 1) {
      for (const s of STATUSES) {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.label;
        statusFilter.appendChild(o);
      }
    }
    const payerFilter = $("#filter-payer");
    if (payerFilter.options.length <= 1) {
      for (const p of PAYERS) {
        const o = document.createElement("option");
        o.value = p.id;
        o.textContent = p.label;
        payerFilter.appendChild(o);
      }
    }
    const payer = $("#referral-payer");
    if (payer.options.length <= 1) {
      for (const p of PAYERS) {
        const o = document.createElement("option");
        o.value = p.id;
        o.textContent = p.label;
        payer.appendChild(o);
      }
    }
    const needs = $("#needs-fields");
    if (!needs.childElementCount) {
      needs.innerHTML = NEEDS.map((n) =>
        `<label><input type="checkbox" data-need="${escapeHtml(n.id)}" data-testid="need-${escapeHtml(n.id)}" /> ${escapeHtml(n.label)}</label>`
      ).join("");
    }
  }

  function showView(name) {
    currentView = name;
    $$(".view").forEach((v) => { v.hidden = v.id !== `view-${name}`; });
    $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    if (name !== "detail") selectedId = null;
  }

  function filteredReferrals() {
    const q = searchQuery.trim().toLowerCase();
    return state.referrals.filter((r) => {
      if (filterStatus && r.status !== filterStatus) return false;
      if (filterPayer && r.payer !== filterPayer) return false;
      if (!q) return true;
      const dxText = (r.diagnoses || []).map((d) => [d.code, d.description].filter(Boolean).join(" ")).join(" ");
      const alrg = r.allergies && r.allergies.status === "nkda" ? "nkda no known allergies" : ((r.allergies && r.allergies.items) || []).map((a) => [a.allergen, a.reaction].filter(Boolean).join(" ")).join(" ");
      const hay = [r.name, r.hospital, r.diagnosis, dxText, alrg, payerLabel(r.payer), r.payerNotes, r.notes, (r.needs || []).map(needLabel).join(" ")].join(" ").toLowerCase();
      return hay.includes(q);
    }).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  function counts() {
    const c = Object.fromEntries(STATUSES.map((s) => [s.id, 0]));
    for (const r of state.referrals) if (c[r.status] != null) c[r.status] += 1;
    return c;
  }

  function renderDashboard() {
    const c = counts();
    $("#stat-grid").innerHTML = STATUSES.map((s) =>
      `<button type="button" class="stat" data-status="${s.id}" data-testid="stat-${s.id}">
        <span class="n">${c[s.id]}</span><span class="l">${escapeHtml(s.label)}</span>
      </button>`
    ).join("");
    $$("#stat-grid .stat").forEach((btn) => {
      btn.addEventListener("click", () => {
        filterStatus = btn.dataset.status;
        $("#filter-status").value = filterStatus;
        showView("referrals");
        renderReferrals();
      });
    });

    const today = todayISO();
    const expected = state.referrals.filter((r) => r.expectedAdmitDate === today && r.status !== "declined" && r.status !== "admitted");
    const admittedToday = state.referrals.filter((r) => r.status === "admitted" && statusDate(r, "admitted") === today);
    const todayBox = $("#today-admits");
    if (!expected.length && !admittedToday.length) {
      todayBox.innerHTML = `<p class="empty" data-testid="today-admits-empty">No admits expected or completed today.</p>`;
    } else {
      todayBox.innerHTML = `<div class="mini-list">${[...expected, ...admittedToday].map(miniRow).join("")}</div>`;
      bindOpenLinks(todayBox);
    }

    const awaiting = state.referrals.filter((r) => ["new", "reviewing", "pending-auth"].includes(r.status))
      .sort((a, b) => (a.dateReceived || "").localeCompare(b.dateReceived || ""));
    $("#awaiting-count").textContent = String(awaiting.length);
    const awaitingList = $("#awaiting-list");
    awaitingList.innerHTML = awaiting.length
      ? `<div class="mini-list">${awaiting.slice(0, 8).map(miniRow).join("")}</div>`
      : `<p class="empty">Nothing waiting on a decision.</p>`;
    bindOpenLinks(awaitingList);

    const admitted = c.admitted;
    const declined = c.declined;
    const decided = admitted + declined;
    const rateEl = $("#conversion-rate");
    if (!decided) {
      rateEl.textContent = "—";
      $("#conversion-detail").textContent = "Admission rate appears after you mark referrals admitted or declined.";
    } else {
      rateEl.textContent = `${Math.round((admitted / decided) * 100)}%`;
      $("#conversion-detail").textContent = `${admitted} admitted and ${declined} declined (${decided} decided). Pending referrals are not counted yet.`;
    }

    if (!state.referrals.length) {
      todayBox.innerHTML = `<div class="empty-hero">No referrals yet. Add one, or upload a referral PDF and review the suggested fields.</div>`;
    }
  }

  function statusDate(referral, statusId) {
    const hits = (referral.statusHistory || []).filter((h) => h.status === statusId);
    return hits.length ? String(hits[hits.length - 1].at).slice(0, 10) : "";
  }

  function miniRow(r) {
    return `<button type="button" class="mini-item" data-open="${escapeHtml(r.id)}">
      <div class="t">${escapeHtml(r.name || "Untitled")}</div>
      <div class="meta">${escapeHtml(r.hospital || "Source not listed")} · ${escapeHtml(payerLabel(r.payer))} · ${escapeHtml(r.diagnosis || "Diagnosis not listed")} · <span class="badge ${escapeHtml(r.status)}">${escapeHtml(statusLabel(r.status))}</span></div>
    </button>`;
  }

  function cardHtml(r) {
    const prog = checklistProgress(r);
    const flags = highAcuity(r.needs);
    return `<article class="ref-card" draggable="true" data-id="${escapeHtml(r.id)}" data-testid="card-${escapeHtml(r.id)}">
      <div class="t">${escapeHtml(r.name || "Untitled")}</div>
      <div class="meta">${escapeHtml(r.hospital || "Source not listed")}</div>
      <div class="meta">${escapeHtml(r.diagnosis || "Diagnosis not listed")}</div>
      <div class="meta">${escapeHtml(payerLabel(r.payer))} · received ${escapeHtml(formatDate(r.dateReceived))}</div>
      <div class="tags">
        ${r.expectedAdmitDate ? `<span class="pill">Admit ${escapeHtml(formatDate(r.expectedAdmitDate))}</span>` : ""}
        ${flags.map((id) => `<span class="tag need">${escapeHtml(needLabel(id))}</span>`).join("")}
      </div>
      <div class="progress" aria-hidden="true"><span style="width:${prog.pct}%"></span></div>
      <div class="progress-label">${prog.done}/${prog.items} checklist</div>
      <label class="sr-only" for="status-${escapeHtml(r.id)}">Change status</label>
      <select class="status-select" id="status-${escapeHtml(r.id)}" data-status-for="${escapeHtml(r.id)}" data-testid="status-${escapeHtml(r.id)}">
        ${STATUSES.map((s) => `<option value="${s.id}" ${s.id === r.status ? "selected" : ""}>${escapeHtml(s.label)}</option>`).join("")}
      </select>
    </article>`;
  }

  function renderPipeline() {
    const board = $("#pipeline-board");
    board.innerHTML = STATUSES.map((s) => {
      const items = state.referrals.filter((r) => r.status === s.id)
        .sort((a, b) => (a.dateReceived || "").localeCompare(b.dateReceived || ""));
      return `<section class="column" data-status="${s.id}" data-testid="column-${s.id}">
        <div class="column-head"><span>${escapeHtml(s.label)}</span><span class="count">${items.length}</span></div>
        <div class="stack">${items.length ? items.map(cardHtml).join("") : `<p class="empty">None</p>`}</div>
      </section>`;
    }).join("");
    bindBoard(board);
  }

  function bindBoard(root) {
    $$(".ref-card", root).forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest("select")) return;
        openDetail(card.dataset.id);
      });
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", card.dataset.id);
        e.dataTransfer.effectAllowed = "move";
      });
    });
    $$("[data-status-for]", root).forEach((sel) => {
      sel.addEventListener("change", () => setStatus(sel.dataset.statusFor, sel.value));
    });
    $$(".column", root).forEach((col) => {
      col.addEventListener("dragover", (e) => { e.preventDefault(); });
      col.addEventListener("drop", (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        if (id) setStatus(id, col.dataset.status);
      });
    });
  }

  function renderReferrals() {
    const list = filteredReferrals();
    const box = $("#referral-list");
    if (!state.referrals.length) {
      box.innerHTML = `<div class="empty-hero">No referrals yet. Use New referral to add one.</div>`;
      return;
    }
    if (!list.length) {
      box.innerHTML = `<div class="empty-hero">No referrals match this search.</div>`;
      return;
    }
    box.innerHTML = `<div class="list-stack">${list.map((r) =>
      `<button type="button" class="list-card" data-open="${escapeHtml(r.id)}" data-testid="list-${escapeHtml(r.id)}">
        <div><div class="t">${escapeHtml(r.name || "Untitled")}</div><div class="meta">${escapeHtml(r.diagnosis || "Diagnosis not listed")}</div></div>
        <div class="meta">${escapeHtml(r.hospital || "Source not listed")}<br>${escapeHtml(payerLabel(r.payer))}</div>
        <div class="meta">Received ${escapeHtml(formatDate(r.dateReceived))}${r.expectedAdmitDate ? `<br>Expected ${escapeHtml(formatDate(r.expectedAdmitDate))}` : ""}</div>
        <span class="badge ${escapeHtml(r.status)}">${escapeHtml(statusLabel(r.status))}</span>
      </button>`
    ).join("")}</div>`;
    bindOpenLinks(box);
  }

  function bindOpenLinks(root) {
    $$("[data-open]", root).forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.open)));
  }

  function openDetail(id) {
    const r = findReferral(id);
    if (!r) return;
    selectedId = id;
    showView("detail");
    renderDetail();
  }

  function referralDiagnoses(r) {
    if (!r) return [];
    if (Array.isArray(r.diagnoses) && r.diagnoses.length) {
      return r.diagnoses.map((d) => ({
        code: (d && d.code) || "",
        description: (d && d.description) || "",
        primary: !!(d && d.primary),
        codeSource: (d && d.codeSource) || "",
        codeStatus: (d && d.codeStatus) || "",
        officialDescription: (d && d.officialDescription) || "",
        suggestions: Array.isArray(d && d.suggestions) ? d.suggestions : [],
      }));
    }
    if (r.diagnosis) return [{ code: "", description: r.diagnosis, primary: true }];
    return [];
  }

  function formatDiagnosisText(item) {
    return (typeof AdmissionsExtract !== "undefined" && AdmissionsExtract.formatDiagnosis)
      ? AdmissionsExtract.formatDiagnosis(item)
      : ((item && ((item.code && item.description) ? `${item.code} ${item.description}` : (item.code || item.description || ""))) || "");
  }

  function formatDiagnosesPlain(items) {
    return (items || []).map(formatDiagnosisText).filter(Boolean).join("; ");
  }

  function formatDiagnosesWithSource(items) {
    return (items || []).map((d) => {
      const text = formatDiagnosisText(d);
      if (!text) return "";
      const bits = [];
      if (d.codeSource === "suggested") bits.push("suggested");
      else if (d.codeSource === "found") bits.push("found");
      else if (d.codeSource === "manual") bits.push("entered");
      if (d.codeStatus === "invalid") bits.push("invalid");
      else if (d.codeStatus === "nonbillable") bits.push("not billable");
      return bits.length ? `${text} (${bits.join(", ")})` : text;
    }).filter(Boolean).join("; ");
  }

  function codeBadgeHtml(d, testId) {
    if (!d || !d.code) return "";
    let cls = "";
    let label = "";
    if (d.codeStatus === "invalid") { cls = "dx-badge-invalid"; label = "not in ICD-10-CM – verify"; }
    else if (d.codeStatus === "nonbillable") { cls = "dx-badge-nonbillable"; label = "not billable – verify"; }
    else if (d.codeSource === "suggested") { cls = "dx-badge-suggested"; label = "suggested – verify"; }
    else if (d.codeSource === "found") { cls = "dx-badge-found"; label = "from referral"; }
    if (!label) return "";
    const idAttr = testId ? ` data-testid="${testId}"` : "";
    return `<span class="dx-badge ${cls}"${idAttr}>${escapeHtml(label)}</span>`;
  }

  function diagnosesListHtml(items) {
    if (!items || !items.length) return "";
    const rows = items.map((d) => {
      const code = d.code
        ? `<span class="dx-code-pill">${escapeHtml(d.code)}</span>`
        : `<span class="dx-missing">no code found</span>`;
      const desc = escapeHtml(d.description || (d.code ? "" : "—"));
      const pri = d.primary ? ` <span class="pill">Primary</span>` : "";
      return `<li>${code}<span>${desc}</span>${pri}${codeBadgeHtml(d)}</li>`;
    }).join("");
    return `<div class="dx-detail" data-testid="diagnoses-detail"><strong>Diagnoses</strong><ul>${rows}</ul></div>`;
  }

  function referralAllergies(r) {
    if (r && r.allergies && (r.allergies.status || (r.allergies.items && r.allergies.items.length))) {
      return {
        status: r.allergies.status || (r.allergies.items && r.allergies.items.length ? "listed" : "unknown"),
        items: Array.isArray(r.allergies.items) ? r.allergies.items.map((a) => ({
          allergen: (a && a.allergen) || "",
          reaction: (a && a.reaction) || "",
          severity: (a && a.severity) || "",
          type: (a && a.type) || "",
        })).filter((a) => a.allergen) : [],
      };
    }
    return { status: "unknown", items: [] };
  }

  function formatAllergiesText(allergies) {
    if (typeof AdmissionsExtract !== "undefined" && AdmissionsExtract.formatAllergies) {
      return AdmissionsExtract.formatAllergies(allergies);
    }
    if (!allergies || allergies.status === "unknown") return "";
    if (allergies.status === "nkda") return "NKDA";
    return ((allergies.items) || []).map((a) => {
      const extra = [a.reaction, a.severity].filter(Boolean).join(", ");
      return extra ? `${a.allergen} (${extra})` : a.allergen;
    }).filter(Boolean).join("; ");
  }

  function allergiesSummaryLine(r, { missing = "not listed" } = {}) {
    const a = referralAllergies(r);
    if (a.status === "nkda") return "NKDA";
    const text = formatAllergiesText(a);
    return text || missing;
  }

  function allergiesDetailHtml(r) {
    const a = referralAllergies(r);
    if (a.status === "nkda") {
      return `<div class="allergy-detail allergy-detail-nkda" data-testid="allergies-detail"><strong>Allergies:</strong> No known allergies (NKDA)</div>`;
    }
    if (a.status === "listed" && a.items.length) {
      const rows = a.items.map((item) => {
        const bits = [item.allergen];
        const extra = [item.reaction, item.severity, item.type].filter(Boolean).join(" · ");
        return `<li>${escapeHtml(item.allergen)}${extra ? ` — ${escapeHtml(extra)}` : ""}</li>`;
      }).join("");
      return `<div class="allergy-detail allergy-detail-listed" data-testid="allergies-detail"><strong>Allergies — review before admission</strong><ul>${rows}</ul></div>`;
    }
    return `<div class="allergy-detail allergy-detail-unknown" data-testid="allergies-detail"><strong>Allergies:</strong> not listed in the referral — please confirm</div>`;
  }

  function renderDetail() {
    const r = findReferral(selectedId);
    const view = $("#view-detail");
    if (!r) {
      view.innerHTML = `<p class="empty">That referral is no longer here.</p>`;
      return;
    }
    const prog = checklistProgress(r);
    const statusIdx = STATUSES.findIndex((s) => s.id === r.status);
    const acceptMsg = buildAcceptMessage(r);
    const declineMsg = buildDeclineMessage(r);
    view.innerHTML = `
      <div class="detail-head">
        <div>
          <button type="button" class="btn small" data-testid="back-btn" id="back-btn">Back</button>
          <h2 style="margin-top:10px">${escapeHtml(r.name || "Untitled")}</h2>
          <div class="meta">${escapeHtml(r.hospital || "Source not listed")} · ${escapeHtml(payerLabel(r.payer))} · received ${escapeHtml(formatDate(r.dateReceived))}</div>
        </div>
        <span class="badge ${escapeHtml(r.status)}" data-testid="detail-status">${escapeHtml(statusLabel(r.status))}</span>
      </div>
      <div class="stepper" data-testid="status-stepper">
        ${STATUSES.map((s, i) => `<button type="button" class="step ${s.id === r.status ? "current" : i < statusIdx && r.status !== "declined" ? "done" : ""}" data-set-status="${s.id}">${escapeHtml(s.label)}</button>`).join("")}
      </div>
      <div class="detail-grid">
        <div class="card">
          <h2>Referral</h2>
          <p><strong>Name / initials:</strong> ${escapeHtml(r.name)}</p>
          <p><strong>Date of birth:</strong> ${escapeHtml(formatDate(r.dob))}</p>
          <p><strong>Hospital / source:</strong> ${escapeHtml(r.hospital || "—")}</p>
          ${allergiesDetailHtml(r)}
          <p><strong>Diagnosis:</strong> ${escapeHtml(r.diagnosis || "—")}</p>
          ${diagnosesListHtml(referralDiagnoses(r))}
          <p><strong>Payer:</strong> ${escapeHtml(payerLabel(r.payer))}${r.payerNotes ? ` — ${escapeHtml(r.payerNotes)}` : ""}</p>
          <p><strong>Expected admit:</strong> ${escapeHtml(formatDate(r.expectedAdmitDate))}</p>
          <p><strong>Care needs:</strong> ${r.needs?.length ? r.needs.map((id) => escapeHtml(needLabel(id))).join(", ") : "None listed"}</p>
          <p><strong>Notes:</strong> ${escapeHtml(r.notes || "—")}</p>
          <div class="btn-row">
            <button type="button" class="btn" data-testid="edit-referral-btn" id="edit-referral-btn">Edit details</button>
          </div>
        </div>
        <div class="card">
          <h2>Admission checklist</h2>
          <div class="progress" aria-hidden="true"><span style="width:${prog.pct}%"></span></div>
          <div class="progress-label" data-testid="checklist-progress">${prog.done} of ${prog.items} complete (${prog.pct}%)</div>
          <div class="check-list" data-testid="checklist">
            ${CHECKLIST.map((item) => {
              const done = !!r.checklist?.[item.id]?.done;
              return `<label class="check-item ${done ? "done" : ""}">
                <input type="checkbox" data-check="${item.id}" data-testid="check-${item.id}" ${done ? "checked" : ""} />
                <span>${escapeHtml(item.label)}${done && r.checklist[item.id].at ? `<div class="meta">${escapeHtml(formatDateTime(r.checklist[item.id].at))}</div>` : ""}</span>
              </label>`;
            }).join("")}
          </div>
        </div>
        <div class="card">
          <h2>Messages</h2>
          <p class="hint">Copy and paste into an email or text. Edit as needed before you send. These are templates only.</p>
          <h3>Acceptance</h3>
          <pre class="template-box" data-testid="accept-template">${escapeHtml(acceptMsg)}</pre>
          <div class="btn-row"><button type="button" class="btn primary" data-testid="copy-accept" id="copy-accept">Copy acceptance</button></div>
          <h3 style="margin-top:16px">Decline</h3>
          <pre class="template-box" data-testid="decline-template">${escapeHtml(declineMsg)}</pre>
          <div class="btn-row"><button type="button" class="btn" data-testid="copy-decline" id="copy-decline">Copy decline</button></div>
        </div>
        <div class="card">
          <h2>Status history</h2>
          <ul class="history" data-testid="status-history">
            ${(r.statusHistory || []).map((h) => `<li><strong>${escapeHtml(statusLabel(h.status))}</strong> · ${escapeHtml(formatDateTime(h.at))}</li>`).join("")}
          </ul>
          ${r.extractedText ? `<h2 style="margin-top:16px">Text saved from the file</h2><p class="hint">${escapeHtml(r.extractedSourceName || "Referral file")} · review before use</p><pre class="extract-text">${highlightExtract(r.extractedText)}</pre>` : ""}
          <div class="btn-row" style="margin-top:16px">
            <button type="button" class="btn danger" data-testid="delete-referral-btn" id="delete-referral-btn">Delete this referral</button>
          </div>
        </div>
      </div>
    `;
    $("#back-btn").addEventListener("click", () => { showView("pipeline"); renderAll(); });
    $("#edit-referral-btn").addEventListener("click", () => openReferralForm(r.id));
    $("#copy-accept").addEventListener("click", () => copyText(acceptMsg));
    $("#copy-decline").addEventListener("click", () => copyText(declineMsg));
    $("#delete-referral-btn").addEventListener("click", () => deleteReferral(r.id));
    $$("[data-set-status]", view).forEach((b) => b.addEventListener("click", () => setStatus(r.id, b.dataset.setStatus)));
    $$("[data-check]", view).forEach((box) => {
      box.addEventListener("change", () => toggleCheck(r.id, box.dataset.check, box.checked));
    });
  }

  function facilityName() {
    return (state.facilityName || "").trim() || "Admissions";
  }

  function buildAcceptMessage(r) {
    const when = r.expectedAdmitDate ? ` on ${formatDate(r.expectedAdmitDate)}` : " (date to be confirmed)";
    const dx = formatDiagnosesWithSource(referralDiagnoses(r)) || formatDiagnosesPlain(referralDiagnoses(r));
    const dxBlock = dx ? `\n\nDiagnoses: ${dx}` : "";
    const alrg = allergiesSummaryLine(r, { missing: "not listed in the referral — please confirm" });
    const alrgBlock = `\nAllergies: ${alrg}\n`;
    return `Hello,\n\nWe are pleased to accept the referral for ${r.name || "this patient"} from ${r.hospital || "your hospital"}. We can admit${when}.${dxBlock}${alrgBlock}Please send any remaining records (H&P, medication list, and discharge summary) and confirm transportation.\n\nThank you,\n${facilityName()}`;
  }

  function buildDeclineMessage(r) {
    const reason = (r.notes || "").trim();
    const why = reason ? ` After review, we are unable to accept this referral at this time. ${reason}` : " After review, we are unable to accept this referral at this time.";
    return `Hello,\n\nThank you for the referral for ${r.name || "this patient"} from ${r.hospital || "your hospital"}.${why} Please feel free to send future referrals.\n\nThank you,\n${facilityName()}`;
  }

  function buildDailySummary() {
    const today = todayISO();
    const c = counts();
    const expected = state.referrals.filter((r) => r.expectedAdmitDate === today && r.status !== "declined");
    const awaiting = state.referrals.filter((r) => ["new", "reviewing", "pending-auth"].includes(r.status));
    const accepted = state.referrals.filter((r) => r.status === "accepted");
    const line = (r) => {
      const dx = formatDiagnosesWithSource(referralDiagnoses(r)) || r.diagnosis || "dx n/a";
      const alrg = allergiesSummaryLine(r, { missing: "allergies n/a" });
      return `- ${r.name || "Untitled"} | ${r.hospital || "source n/a"} | ${payerLabel(r.payer)} | ${dx} | Allergies: ${alrg}${r.expectedAdmitDate ? ` | expected ${formatDate(r.expectedAdmitDate)}` : ""}`;
    };
    return `Daily admissions summary — ${formatDate(today)}\n${facilityName()}\n\nExpected admits today (${expected.length}):\n${expected.length ? expected.map(line).join("\n") : "- None"}\n\nAccepted, awaiting arrival (${accepted.length}):\n${accepted.length ? accepted.map(line).join("\n") : "- None"}\n\nStill in review or pending insurance auth (${awaiting.length}):\n${awaiting.length ? awaiting.map(line).join("\n") : "- None"}\n\nPipeline counts: New ${c.new}, Reviewing ${c.reviewing}, Pending auth ${c["pending-auth"]}, Accepted ${c.accepted}, Admitted ${c.admitted}, Declined ${c.declined}\n`;
  }

  async function setStatus(id, status) {
    const r = findReferral(id);
    if (!r || r.status === status) return;
    r.status = status;
    r.statusHistory = r.statusHistory || [];
    r.statusHistory.push({ status, at: new Date().toISOString() });
    r.updatedAt = new Date().toISOString();
    await persist();
    renderAll();
  }

  async function toggleCheck(id, key, done) {
    const r = findReferral(id);
    if (!r) return;
    r.checklist = r.checklist || blankChecklist();
    r.checklist[key] = { done: !!done, at: done ? new Date().toISOString() : null };
    r.updatedAt = new Date().toISOString();
    await persist();
    if (currentView === "detail" && selectedId === id) renderDetail();
    else renderAll();
  }

  async function deleteReferral(id) {
    if (!confirm("Delete this referral from this device? This cannot be undone.")) return;
    state.referrals = state.referrals.filter((r) => r.id !== id);
    await persist();
    selectedId = null;
    showView("pipeline");
    renderAll();
    toast("Referral deleted from this device");
  }

  function diagnosisRowEl(item) {
    const d = item || { code: "", description: "", primary: false, codeSource: "", codeStatus: "", suggestions: [] };
    const row = document.createElement("div");
    row.className = "dx-row";
    row.setAttribute("data-testid", "diagnosis-row");
    row.dataset.codeSource = d.codeSource || "";
    row.dataset.codeStatus = d.codeStatus || "";
    const suggestions = Array.isArray(d.suggestions) ? d.suggestions : [];
    row.dataset.suggestions = JSON.stringify(suggestions);
    const badge = codeBadgeHtml(d, "diagnosis-code-badge");
    const altOptions = suggestions.map((s) => {
      const tag = s.billable === false ? " (not billable)" : "";
      const selected = s.code === d.code ? " selected" : "";
      return `<option value="${escapeHtml(s.code)}"${selected}>${escapeHtml(s.code)} — ${escapeHtml(s.description || "")}${tag}</option>`;
    }).join("");
    const hasAlts = suggestions.length > 0;
    row.innerHTML = `
      <label class="dx-primary">
        <input type="radio" name="dx-primary" class="dx-primary-input" data-testid="diagnosis-primary" ${d.primary ? "checked" : ""} />
        Primary
      </label>
      <div class="dx-code-wrap">
        <input type="text" class="dx-code" data-testid="diagnosis-code" maxlength="16" placeholder="ICD-10" value="${escapeHtml(d.code || "")}" autocomplete="off" spellcheck="false" />
        ${badge}
      </div>
      <input type="text" class="dx-desc" data-testid="diagnosis-description" maxlength="400" placeholder="Description" value="${escapeHtml(d.description || "")}" />
      <button type="button" class="btn small" data-remove-dx="1" data-testid="remove-diagnosis">Remove</button>
      <select class="dx-alts" data-testid="diagnosis-code-alternatives" ${hasAlts ? "" : "disabled hidden"}>
        <option value="">Search or pick another code…</option>
        ${altOptions}
      </select>
    `;
    return row;
  }

  function renderDiagnosisRows(items) {
    const box = $("#diagnoses-list");
    if (!box) return;
    box.innerHTML = "";
    const rows = items && items.length ? items : [{ code: "", description: "", primary: true }];
    rows.forEach((d) => box.appendChild(diagnosisRowEl(d)));
  }

  function readDiagnosesList() {
    return $$("#diagnoses-list [data-testid='diagnosis-row']").map((row) => {
      const raw = (row.querySelector(".dx-code")?.value || "").trim();
      const normalized = (typeof AdmissionsExtract !== "undefined" && AdmissionsExtract.normalizeIcd10Code)
        ? AdmissionsExtract.normalizeIcd10Code(raw)
        : raw.toUpperCase();
      let suggestions = [];
      try { suggestions = JSON.parse(row.dataset.suggestions || "[]"); } catch { suggestions = []; }
      return {
        code: normalized || raw.toUpperCase(),
        description: (row.querySelector(".dx-desc")?.value || "").trim(),
        primary: !!row.querySelector(".dx-primary-input")?.checked,
        codeSource: row.dataset.codeSource || "",
        codeStatus: row.dataset.codeStatus || "",
        suggestions,
      };
    }).filter((d) => d.code || d.description);
  }

  function updateRowCodeMeta(row, { source, status, suggestions, officialDescription } = {}) {
    if (source != null) row.dataset.codeSource = source;
    if (status != null) row.dataset.codeStatus = status;
    if (suggestions) row.dataset.suggestions = JSON.stringify(suggestions);
    const input = row.querySelector(".dx-code");
    const wrap = row.querySelector(".dx-code-wrap");
    if (wrap && input) {
      const item = {
        code: input.value.trim(),
        codeSource: row.dataset.codeSource,
        codeStatus: row.dataset.codeStatus,
      };
      wrap.querySelectorAll(".dx-badge").forEach((el) => el.remove());
      const html = codeBadgeHtml(item, "diagnosis-code-badge");
      if (html) {
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        wrap.appendChild(tmp.firstElementChild);
      }
    }
    const sel = row.querySelector(".dx-alts");
    if (sel && suggestions) {
      const current = (row.querySelector(".dx-code")?.value || "").trim();
      sel.innerHTML = `<option value="">Search or pick another code…</option>` + suggestions.map((s) => {
        const tag = s.billable === false ? " (not billable)" : "";
        const selected = s.code === current ? " selected" : "";
        return `<option value="${escapeHtml(s.code)}"${selected}>${escapeHtml(s.code)} — ${escapeHtml(s.description || "")}${tag}</option>`;
      }).join("");
      sel.disabled = !suggestions.length;
      sel.hidden = !suggestions.length;
    }
    if (officialDescription) row.dataset.officialDescription = officialDescription;
  }

  async function enhanceDiagnosesWithCodes() {
    if (typeof AdmissionsICD === "undefined") return;
    try {
      await AdmissionsICD.ensureLoaded();
    } catch (err) {
      console.warn(err);
      return;
    }
    const current = readDiagnosesList();
    if (!current.length) return;
    const next = AdmissionsICD.applyToDiagnoses(current);
    const primaryValue = $("#referral-diagnosis")?.value;
    renderDiagnosisRows(next);
    if (primaryValue && $("#referral-diagnosis")) $("#referral-diagnosis").value = primaryValue;
  }

  async function searchCodesForRow(row, query) {
    if (typeof AdmissionsICD === "undefined") return;
    try {
      await AdmissionsICD.ensureLoaded();
    } catch {
      return;
    }
    const hits = AdmissionsICD.search(query, { limit: 8 });
    updateRowCodeMeta(row, { suggestions: hits });
    const exact = AdmissionsICD.validate(query);
    if (query && exact && exact.status !== "invalid" && exact.code) {
      updateRowCodeMeta(row, { source: "manual", status: exact.status, officialDescription: exact.description });
    }
  }

  function syncPrimaryDiagnosisField() {
    const field = $("#referral-diagnosis");
    if (!field) return;
    const rows = $$("#diagnoses-list [data-testid='diagnosis-row']");
    const primary = rows.find((row) => row.querySelector(".dx-primary-input")?.checked) || rows[0];
    if (!primary) return;
    const item = {
      code: (primary.querySelector(".dx-code")?.value || "").trim().toUpperCase(),
      description: (primary.querySelector(".dx-desc")?.value || "").trim(),
    };
    if (typeof AdmissionsExtract !== "undefined" && AdmissionsExtract.normalizeIcd10Code) {
      item.code = AdmissionsExtract.normalizeIcd10Code(item.code) || item.code;
    }
    const text = formatDiagnosisText(item);
    if (text) field.value = text;
  }

  function bindDiagnosesEditor() {
    const list = $("#diagnoses-list");
    const addBtn = $("#add-diagnosis-btn");
    if (addBtn) addBtn.addEventListener("click", () => {
      if (list) list.appendChild(diagnosisRowEl({ code: "", description: "", primary: false }));
    });
    if (!list) return;
    list.addEventListener("click", (e) => {
      const remove = e.target.closest("[data-remove-dx]");
      if (!remove) return;
      const row = remove.closest(".dx-row");
      const rows = $$(".dx-row", list);
      if (rows.length <= 1) {
        const code = row.querySelector(".dx-code");
        const desc = row.querySelector(".dx-desc");
        const pri = row.querySelector(".dx-primary-input");
        if (code) code.value = "";
        if (desc) desc.value = "";
        if (pri) pri.checked = true;
        updateRowCodeMeta(row, { source: "", status: "", suggestions: [] });
      } else {
        const wasPrimary = !!row.querySelector(".dx-primary-input")?.checked;
        row.remove();
        if (wasPrimary) {
          const first = list.querySelector(".dx-primary-input");
          if (first) first.checked = true;
        }
      }
      syncPrimaryDiagnosisField();
    });
    list.addEventListener("change", (e) => {
      if (e.target.classList.contains("dx-primary-input")) syncPrimaryDiagnosisField();
      if (e.target.classList.contains("dx-alts")) {
        const row = e.target.closest(".dx-row");
        const code = e.target.value;
        if (!row || !code) return;
        const input = row.querySelector(".dx-code");
        if (input) input.value = code;
        let status = "valid";
        if (typeof AdmissionsICD !== "undefined" && AdmissionsICD.isReady()) {
          status = AdmissionsICD.validate(code).status;
        }
        updateRowCodeMeta(row, { source: "manual", status });
        if (row.querySelector(".dx-primary-input")?.checked) syncPrimaryDiagnosisField();
      }
    });
    let searchTimer = 0;
    list.addEventListener("input", (e) => {
      if (e.target.classList.contains("dx-code") || e.target.classList.contains("dx-desc")) {
        const row = e.target.closest(".dx-row");
        if (row?.querySelector(".dx-primary-input")?.checked) syncPrimaryDiagnosisField();
        if (e.target.classList.contains("dx-code")) {
          row.dataset.codeSource = "manual";
          clearTimeout(searchTimer);
          const q = e.target.value.trim();
          searchTimer = setTimeout(() => searchCodesForRow(row, q), 200);
        }
        if (e.target.classList.contains("dx-desc") && !(row.querySelector(".dx-code")?.value || "").trim()) {
          clearTimeout(searchTimer);
          const q = e.target.value.trim();
          searchTimer = setTimeout(async () => {
            if (typeof AdmissionsICD === "undefined" || q.length < 3) return;
            try { await AdmissionsICD.ensureLoaded(); } catch { return; }
            const hits = AdmissionsICD.suggest(q, { limit: 5 });
            updateRowCodeMeta(row, { suggestions: hits });
          }, 250);
        }
      }
    });
  }

  const ALLERGY_TYPES = [
    { id: "", label: "Type" },
    { id: "drug", label: "Drug" },
    { id: "food", label: "Food" },
    { id: "environmental", label: "Environmental" },
    { id: "latex", label: "Latex" },
    { id: "other", label: "Other" },
  ];
  const ALLERGY_SEVERITIES = ["", "mild", "moderate", "severe", "life-threatening"];

  function allergyRowEl(item) {
    const a = item || { allergen: "", reaction: "", severity: "", type: "" };
    const row = document.createElement("div");
    row.className = "allergy-row";
    row.setAttribute("data-testid", "allergy-row");
    const sevOpts = ALLERGY_SEVERITIES.map((s) => `<option value="${escapeHtml(s)}"${a.severity === s ? " selected" : ""}>${s ? escapeHtml(s) : "Severity"}</option>`).join("");
    const typeOpts = ALLERGY_TYPES.map((s) => `<option value="${escapeHtml(s.id)}"${a.type === s.id ? " selected" : ""}>${escapeHtml(s.label)}</option>`).join("");
    row.innerHTML = `
      <input type="text" class="allergy-allergen" data-testid="allergy-allergen" maxlength="160" placeholder="Allergen" value="${escapeHtml(a.allergen || "")}" />
      <input type="text" class="allergy-reaction" data-testid="allergy-reaction" maxlength="160" placeholder="Reaction" value="${escapeHtml(a.reaction || "")}" />
      <select class="allergy-severity" data-testid="allergy-severity">${sevOpts}</select>
      <select class="allergy-type" data-testid="allergy-type">${typeOpts}</select>
      <button type="button" class="btn small" data-remove-allergy="1" data-testid="remove-allergy">Remove</button>
    `;
    return row;
  }

  function updateAllergiesBanner(status) {
    const banner = $("#allergies-banner");
    if (!banner) return;
    banner.className = "allergy-banner";
    if (status === "nkda") {
      banner.hidden = false;
      banner.classList.add("allergy-banner-nkda");
      banner.textContent = "No known allergies (NKDA). This was recorded explicitly — it is not the same as a missing allergy section.";
    } else if (status === "listed") {
      banner.hidden = false;
      banner.classList.add("allergy-banner-listed");
      banner.textContent = "Allergies are listed. This is safety-critical — review every item before you save or admit.";
    } else {
      banner.hidden = false;
      banner.classList.add("allergy-banner-unknown");
      banner.textContent = "No allergy section was found in the referral. Confirm allergies before admission.";
    }
  }

  function renderAllergyEditor(allergies) {
    const box = $("#allergies-list");
    const nkda = $("#allergies-nkda");
    if (!box) return;
    const data = allergies || { status: "unknown", items: [] };
    box.innerHTML = "";
    if (nkda) nkda.checked = data.status === "nkda";
    if (data.status === "listed" && data.items && data.items.length) {
      data.items.forEach((item) => box.appendChild(allergyRowEl(item)));
    } else if (data.status !== "nkda") {
      box.appendChild(allergyRowEl({}));
    }
    box.hidden = data.status === "nkda";
    const addBtn = $("#add-allergy-btn");
    if (addBtn) addBtn.hidden = data.status === "nkda";
    updateAllergiesBanner(data.status || "unknown");
  }

  function readAllergies() {
    const nkda = $("#allergies-nkda");
    if (nkda && nkda.checked) return { status: "nkda", items: [] };
    const items = $$("#allergies-list [data-testid='allergy-row']").map((row) => ({
      allergen: (row.querySelector(".allergy-allergen")?.value || "").trim(),
      reaction: (row.querySelector(".allergy-reaction")?.value || "").trim(),
      severity: (row.querySelector(".allergy-severity")?.value || "").trim(),
      type: (row.querySelector(".allergy-type")?.value || "").trim(),
    })).filter((a) => a.allergen);
    if (items.length) return { status: "listed", items };
    const banner = $("#allergies-banner");
    const status = banner && banner.classList.contains("allergy-banner-unknown") ? "unknown" : (items.length ? "listed" : "unknown");
    return { status, items };
  }

  function bindAllergiesEditor() {
    const list = $("#allergies-list");
    const addBtn = $("#add-allergy-btn");
    const nkda = $("#allergies-nkda");
    if (addBtn) addBtn.addEventListener("click", () => {
      if (nkda) nkda.checked = false;
      if (list) {
        list.hidden = false;
        addBtn.hidden = false;
        list.appendChild(allergyRowEl({}));
      }
      updateAllergiesBanner("listed");
    });
    if (nkda) nkda.addEventListener("change", () => {
      if (nkda.checked) {
        if (list) list.hidden = true;
        if (addBtn) addBtn.hidden = true;
        updateAllergiesBanner("nkda");
      } else {
        if (list) {
          list.hidden = false;
          if (!list.querySelector("[data-testid='allergy-row']")) list.appendChild(allergyRowEl({}));
        }
        if (addBtn) addBtn.hidden = false;
        const hasItems = $$("#allergies-list [data-testid='allergy-row']").some((row) => (row.querySelector(".allergy-allergen")?.value || "").trim());
        updateAllergiesBanner(hasItems ? "listed" : "unknown");
      }
    });
    if (list) list.addEventListener("click", (e) => {
      const remove = e.target.closest("[data-remove-allergy]");
      if (!remove) return;
      const row = remove.closest(".allergy-row");
      const rows = $$(".allergy-row", list);
      if (rows.length <= 1) {
        row.querySelectorAll("input").forEach((el) => { el.value = ""; });
        row.querySelectorAll("select").forEach((el) => { el.selectedIndex = 0; });
      } else {
        row.remove();
      }
    });
    if (list) list.addEventListener("input", () => {
      if (nkda && nkda.checked) return;
      const hasItems = $$("#allergies-list [data-testid='allergy-row']").some((row) => (row.querySelector(".allergy-allergen")?.value || "").trim());
      if (hasItems) updateAllergiesBanner("listed");
    });
  }

  function resetForm() {
    filledFromPdf = new Set();
    extractRaw = "";
    extractName = "";
    $("#referral-form").dataset.editId = "";
    $("#referral-dialog-title").textContent = "New referral";
    $("#referral-name").value = "";
    $("#referral-dob").value = "";
    $("#referral-hospital").value = "";
    $("#referral-diagnosis").value = "";
    renderDiagnosisRows([]);
    renderAllergyEditor({ status: "unknown", items: [] });
    $("#referral-payer").value = "";
    $("#referral-payer-notes").value = "";
    $("#referral-date-received").value = todayISO();
    $("#referral-expected-admit").value = "";
    $("#referral-notes").value = "";
    $$("[data-need]").forEach((c) => { c.checked = false; });
    $("#review-banner").hidden = true;
    $("#pdf-error").hidden = true;
    $("#extract-panel").hidden = true;
    $("#extract-text").textContent = "";
    $("#extract-source").textContent = "";
    $("#pdf-upload").value = "";
    const dashInput = $("#dash-file-input");
    if (dashInput) dashInput.value = "";
    hidePastePanels();
    markPdfFields();
  }

  function fillForm(r) {
    resetForm();
    $("#referral-form").dataset.editId = r.id;
    $("#referral-dialog-title").textContent = "Edit referral";
    $("#referral-name").value = r.name || "";
    $("#referral-dob").value = r.dob || "";
    $("#referral-hospital").value = r.hospital || "";
    $("#referral-diagnosis").value = r.diagnosis || "";
    renderDiagnosisRows(referralDiagnoses(r));
    renderAllergyEditor(referralAllergies(r));
    $("#referral-payer").value = r.payer || "";
    $("#referral-payer-notes").value = r.payerNotes || "";
    $("#referral-date-received").value = r.dateReceived || todayISO();
    $("#referral-expected-admit").value = r.expectedAdmitDate || "";
    $("#referral-notes").value = r.notes || "";
    $$("[data-need]").forEach((c) => { c.checked = (r.needs || []).includes(c.dataset.need); });
    if (r.extractedText) {
      extractRaw = r.extractedText;
      extractName = r.extractedSourceName || "";
      showExtract();
    }
  }

  function markPdfFields() {
    const map = {
      "referral-name": "name",
      "referral-dob": "dob",
      "referral-hospital": "hospital",
      "referral-diagnosis": "diagnosis",
      "referral-payer": "payer",
      "referral-payer-notes": "payerNotes",
    };
    for (const [id, key] of Object.entries(map)) {
      const label = $(`label.field:has(#${id}) span`) || $(`#${id}`)?.closest("label")?.querySelector("span");
      if (label) label.classList.toggle("from-pdf", filledFromPdf.has(key));
    }
    const dxLegend = $("#diagnoses-fieldset legend");
    if (dxLegend) dxLegend.classList.toggle("from-pdf", filledFromPdf.has("diagnoses"));
    const alrgLegend = $("#allergies-fieldset legend");
    if (alrgLegend) alrgLegend.classList.toggle("from-pdf", filledFromPdf.has("allergies"));
  }

  function openReferralForm(editId) {
    populateSelects();
    if (editId) {
      const r = findReferral(editId);
      if (r) fillForm(r);
    } else {
      resetForm();
    }
    const dlg = $("#referral-dialog");
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
    $("#referral-name").focus();
  }

  function closeReferralForm() {
    const dlg = $("#referral-dialog");
    if (dlg.open) dlg.close();
  }

  function readForm() {
    const needs = $$("[data-need]").filter((c) => c.checked).map((c) => c.dataset.need);
    return {
      name: $("#referral-name").value.trim(),
      dob: $("#referral-dob").value,
      hospital: $("#referral-hospital").value.trim(),
      diagnosis: $("#referral-diagnosis").value.trim(),
      diagnoses: readDiagnosesList(),
      allergies: readAllergies(),
      payer: $("#referral-payer").value,
      payerNotes: $("#referral-payer-notes").value.trim(),
      dateReceived: $("#referral-date-received").value || todayISO(),
      expectedAdmitDate: $("#referral-expected-admit").value,
      needs,
      notes: $("#referral-notes").value.trim(),
      extractedText: extractRaw,
      extractedSourceName: extractName,
    };
  }

  async function saveReferral(ev) {
    ev.preventDefault();
    const data = readForm();
    if (!data.name) {
      toast("Add a name or initials");
      $("#referral-name").focus();
      return;
    }
    const editId = $("#referral-form").dataset.editId;
    if (editId) {
      const r = findReferral(editId);
      if (!r) return;
      Object.assign(r, data, { updatedAt: new Date().toISOString() });
      await persist();
      closeReferralForm();
      openDetail(editId);
      toast("Referral updated");
      return;
    }
    const r = Object.assign(newReferralDefaults(), data);
    state.referrals.unshift(r);
    await persist();
    closeReferralForm();
    renderAll();
    openDetail(r.id);
    toast("Referral saved on this device");
  }

  function highlightExtract(text) {
    const ranges = [];
    const add = (re) => {
      const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
      const r = new RegExp(re.source, flags);
      let m;
      while ((m = r.exec(text))) {
        ranges.push([m.index, m.index + m[0].length]);
        if (!r.global) break;
      }
    };
    add(/Patient\s*Name\s*[:\-]?[^\n]+/i);
    add(/Date\s*of\s*Birth\s*[:\-]?[^\n]+/i);
    add(/DOB\s*[:\-]?[^\n]+/i);
    add(/Primary\s*Diagnosis\s*[:\-]?[^\n]+/i);
    add(/Secondary\s*(?:Diagnos(?:is|es)|Dx)?\s*[:\-]?[^\n]*/i);
    add(/Admitting\s*Diagnosis\s*[:\-]?[^\n]+/i);
    add(/Problem\s*List\s*[:\-]?[^\n]*/i);
    add(/Active\s*Diagnoses\s*[:\-]?[^\n]*/i);
    add(/Diagnosis\s*[:\-]?[^\n]+/i);
    add(/Allerg(?:y|ies)(?:\s*\/\s*Intolerances?)?\s*[:\-]?[^\n]*/i);
    add(/\b(NKDA|NKA|No\s+known\s+(?:drug\s+)?allerg(?:y|ies))\b/gi);
    add(/(?:Drug|Food|Environmental|Latex)\s+Allerg(?:y|ies)\s*[:\-]?[^\n]*/i);
    if (typeof AdmissionsExtract !== "undefined" && AdmissionsExtract.ICD_CODE_RE) {
      add(AdmissionsExtract.ICD_CODE_RE);
    }
    add(/Insurance\s*[:\-]?[^\n]+/i);
    add(/Payer\s*[:\-]?[^\n]+/i);
    add(/Referring\s*(?:Hospital|Facility|Source)\s*[:\-]?[^\n]+/i);
    add(/Hospital\s*[:\-]?[^\n]+/i);
    add(/\b(Medicare(?:\s+(?:Part\s+[A-D]|Advantage))?|Medicaid|Medi-Cal|PT|OT|wound care|IV antibiotics|dialysis|isolation|trach|ventilator)\b/gi);
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    for (const rng of ranges) {
      const last = merged[merged.length - 1];
      if (last && rng[0] <= last[1]) last[1] = Math.max(last[1], rng[1]);
      else merged.push(rng.slice());
    }
    let html = "";
    let i = 0;
    for (const [a, b] of merged) {
      if (a > i) html += escapeHtml(text.slice(i, a));
      html += `<mark>${escapeHtml(text.slice(a, b))}</mark>`;
      i = b;
    }
    html += escapeHtml(text.slice(i));
    return html;
  }

  function showExtract() {
    $("#extract-panel").hidden = !extractRaw;
    $("#extract-source").textContent = extractName ? extractName : "";
    $("#extract-text").innerHTML = highlightExtract(extractRaw);
  }

  function hidePastePanels() {
    const dash = $("#dash-paste-panel");
    const dlg = $("#dialog-paste-panel");
    if (dash) dash.hidden = true;
    if (dlg) dlg.hidden = true;
  }

  function setImportError(message, where) {
    const dashErr = $("#dash-import-error");
    const dlgErr = $("#pdf-error");
    if (dashErr) {
      dashErr.hidden = !(where === "dash" && message);
      dashErr.textContent = where === "dash" ? (message || "") : "";
    }
    if (dlgErr) {
      dlgErr.hidden = !(where === "dialog" && message);
      dlgErr.textContent = where === "dialog" ? (message || "") : "";
    }
  }

  function fileKind(file) {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    if (name.endsWith(".pdf") || type === "application/pdf") return "pdf";
    if (name.endsWith(".docx") || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
    if (name.endsWith(".doc") || type === "application/msword") return "doc";
    if (
      name.endsWith(".txt") || name.endsWith(".csv") || name.endsWith(".md") || name.endsWith(".eml") ||
      type.startsWith("text/") || type === "message/rfc822" || type === "text/csv"
    ) return "text";
    return "other";
  }

  function hasDragFiles(e) {
    const types = e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    return [...types].includes("Files") || [...types].includes("application/x-moz-file");
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot unpack Word files");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function unzipEntries(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    let eocd = -1;
    const min = Math.max(0, bytes.length - 22 - 65535);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("That Word file could not be opened.");
    const count = view.getUint16(eocd + 10, true);
    let cd = view.getUint32(eocd + 16, true);
    const files = {};
    const decoder = new TextDecoder("utf-8");
    for (let n = 0; n < count; n++) {
      if (view.getUint32(cd, true) !== 0x02014b50) throw new Error("That Word file could not be opened.");
      const method = view.getUint16(cd + 10, true);
      const compSize = view.getUint32(cd + 20, true);
      const nameLen = view.getUint16(cd + 28, true);
      const extraLen = view.getUint16(cd + 30, true);
      const commentLen = view.getUint16(cd + 32, true);
      const localOff = view.getUint32(cd + 42, true);
      const name = decoder.decode(bytes.subarray(cd + 46, cd + 46 + nameLen));
      const locNameLen = view.getUint16(localOff + 26, true);
      const locExtra = view.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + locNameLen + locExtra;
      const comp = bytes.subarray(dataStart, dataStart + compSize);
      let data;
      if (method === 0) data = comp;
      else if (method === 8) data = await inflateRaw(comp);
      else throw new Error("That Word file uses a format this tracker cannot read.");
      files[name] = data;
      cd += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  function docxXmlToText(xmlStr) {
    const xml = new DOMParser().parseFromString(xmlStr, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("The Word document could not be read.");
    const lines = [];

    function paraText(p) {
      let out = "";
      (function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) return;
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const ln = node.localName;
        if (ln === "t") out += node.textContent || "";
        else if (ln === "tab") out += " ";
        else if (ln === "br" || ln === "cr") out += " ";
        else {
          for (const child of node.childNodes) walk(child);
        }
      })(p);
      return out.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    }

    function collectParas(el, into) {
      for (const child of el.children) {
        if (child.localName === "tbl") continue;
        if (child.localName === "p") into.push(child);
        else collectParas(child, into);
      }
    }

    function collectRows(tbl, into) {
      for (const child of tbl.children) {
        if (child.localName === "tr") into.push(child);
        else if (child.localName === "tbl") continue;
        else if (child.localName === "tc") continue;
        else collectRows(child, into);
      }
    }

    function rowText(tr) {
      const cells = [];
      for (const child of tr.children) {
        if (child.localName !== "tc") continue;
        const paras = [];
        collectParas(child, paras);
        cells.push(paras.map(paraText).filter(Boolean).join(" "));
      }
      return cells.join(" ").replace(/\s+/g, " ").trim();
    }

    function walkBlock(el) {
      for (const child of el.children) {
        const n = child.localName;
        if (n === "p") {
          const text = paraText(child);
          if (text) lines.push(text);
        } else if (n === "tbl") {
          const rows = [];
          collectRows(child, rows);
          for (const tr of rows) {
            const text = rowText(tr);
            if (text) lines.push(text);
          }
        } else if (n === "sdt") {
          const content = [...child.children].find((c) => c.localName === "sdtContent");
          walkBlock(content || child);
        } else if (n === "body" || n === "document" || n === "hdr" || n === "ftr") {
          walkBlock(child);
        }
      }
    }

    const body = [...xml.getElementsByTagName("*")].find((n) => n.localName === "body") || xml.documentElement;
    walkBlock(body);
    return lines.join("\n").trim();
  }

  async function readDocxText(arrayBuffer) {
    const files = await unzipEntries(arrayBuffer);
    const entry = files["word/document.xml"];
    if (!entry) throw new Error("That Word file did not contain a readable document.");
    const xml = new TextDecoder("utf-8").decode(entry);
    const text = docxXmlToText(xml);
    if (!text) throw new Error("No readable text was found in that Word file. Enter the details by hand.");
    return text;
  }

  async function readPdfText(arrayBuffer) {
    if (typeof pdfjsLib === "undefined") throw new Error("PDF reader is missing");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer, disableRange: true, disableStream: true }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      let lastY = null;
      const bits = [];
      for (const item of content.items) {
        const y = item.transform ? item.transform[5] : 0;
        if (lastY != null && Math.abs(lastY - y) > 6) {
          bits.push(line.trim());
          line = "";
        } else if (line && item.hasEOL) {
          bits.push(line.trim());
          line = "";
        } else if (line && !line.endsWith(" ") && item.str && !item.str.startsWith(" ")) {
          line += " ";
        }
        line += item.str || "";
        lastY = y;
        if (item.hasEOL) {
          bits.push(line.trim());
          line = "";
        }
      }
      if (line.trim()) bits.push(line.trim());
      pages.push(bits.filter(Boolean).join("\n"));
    }
    return pages.join("\n\n").trim();
  }

  function cleanupPlainText(text, filename) {
    let t = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const isEmail = /\.eml$/i.test(filename || "") || (/^From:/m.test(t) && /^Subject:/m.test(t));
    if (isEmail) {
      const parts = t.split(/\n\n/);
      if (parts.length > 1 && /^[\w-]+:/m.test(parts[0])) t = parts.slice(1).join("\n\n");
      t = t.replace(/=\n/g, "");
      t = t.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => {
        try { return decodeURIComponent("%" + hex); } catch { return _; }
      });
    }
    return t.trim();
  }

  async function readReferralFile(file) {
    const kind = fileKind(file);
    if (kind === "doc") {
      throw new Error("Older Word .doc files cannot be read here. Please save the file as .docx, PDF, or plain text, or enter the details by hand.");
    }
    if (kind === "other") {
      throw new Error("This file type is not supported. Drop a PDF, a Word file (.docx), or a text file (.txt, .csv, .md, or .eml).");
    }
    if (kind === "pdf") {
      const text = await readPdfText(await file.arrayBuffer());
      if (!text) throw new Error("No readable text was found. Scanned image-only PDFs cannot be read here. Enter the details by hand.");
      return text;
    }
    if (kind === "docx") {
      try {
        return await readDocxText(await file.arrayBuffer());
      } catch (err) {
        if (err && /cannot be read|could not be opened|could not be read|did not contain|No readable text|cannot unpack/i.test(err.message || "")) throw err;
        throw new Error("This Word file could not be read. Try saving it as .docx or PDF, or enter the details by hand.");
      }
    }
    const text = cleanupPlainText(await file.text(), file.name);
    if (!text) throw new Error("That text file was empty. Paste the referral text or enter the details by hand.");
    return text;
  }

  function applyExtractedText(text, sourceName, toastMessage) {
    extractRaw = text;
    extractName = sourceName || "";
    showExtract();
    const guessed = AdmissionsExtract.extractFields(text);
    filledFromPdf = new Set();
    const apply = (id, key, value) => {
      if (!value) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.value = value;
      filledFromPdf.add(key);
    };
    apply("referral-name", "name", guessed.name);
    apply("referral-dob", "dob", guessed.dob);
    apply("referral-hospital", "hospital", guessed.hospital);
    apply("referral-diagnosis", "diagnosis", guessed.diagnosis);
    renderDiagnosisRows(guessed.diagnoses || []);
    if (guessed.diagnoses && guessed.diagnoses.length) filledFromPdf.add("diagnoses");
    renderAllergyEditor(guessed.allergies || { status: "unknown", items: [] });
    if (guessed.allergies && guessed.allergies.status && guessed.allergies.status !== "unknown") filledFromPdf.add("allergies");
    enhanceDiagnosesWithCodes();
    apply("referral-payer", "payer", guessed.payer);
    apply("referral-payer-notes", "payerNotes", guessed.payerNotes);
    if (guessed.dateReceived) apply("referral-date-received", "dateReceived", guessed.dateReceived);
    if (guessed.expectedAdmitDate) apply("referral-expected-admit", "expectedAdmitDate", guessed.expectedAdmitDate);
    if (guessed.notes && !$("#referral-notes").value) {
      $("#referral-notes").value = guessed.notes;
      filledFromPdf.add("notes");
    }
    for (const id of guessed.needs) {
      const box = $(`[data-need="${id}"]`);
      if (box) box.checked = true;
    }
    $("#review-banner").hidden = filledFromPdf.size === 0 && !guessed.needs.length;
    markPdfFields();
    toast(toastMessage || "The file was read on this device. Review before you save.");
    const banner = $("#review-banner");
    if (banner && !banner.hidden) banner.scrollIntoView({ block: "nearest" });
  }

  function dialogIsOpen() {
    const dlg = $("#referral-dialog");
    return !!(dlg && (dlg.open || dlg.hasAttribute("open")));
  }

  async function importReferralFile(file, source) {
    if (!file) return;
    const where = source === "dash" && !dialogIsOpen() ? "dash" : "dialog";
    setImportError("", "dash");
    setImportError("", "dialog");
    try {
      const text = await readReferralFile(file);
      if (where === "dash") openReferralForm();
      applyExtractedText(text, file.name, "The file was read on this device. Review before you save.");
    } catch (err) {
      console.error(err);
      let message = err && err.message ? err.message : "This file could not be read. Enter the details by hand.";
      if (fileKind(file) === "pdf" && !/readable text|password|image-only|not supported/i.test(message)) {
        message = "This PDF could not be read. It may be password-protected or image-only. Enter the details by hand.";
      }
      setImportError(message, where);
    }
  }

  async function importPastedText(text, source) {
    const cleaned = cleanupPlainText(text, "pasted.txt");
    const where = source === "dash" && !dialogIsOpen() ? "dash" : "dialog";
    setImportError("", "dash");
    setImportError("", "dialog");
    if (!cleaned) {
      setImportError("Paste the referral text first.", where === "dash" ? "dash" : "dialog");
      return;
    }
    if (where === "dash") openReferralForm();
    hidePastePanels();
    applyExtractedText(cleaned, "Pasted text", "The pasted text was read on this device. Review before you save.");
  }

  function bindDropzone(el, onFile) {
    if (!el) return;
    let enter = 0;
    el.addEventListener("dragenter", (e) => {
      if (!hasDragFiles(e)) return;
      e.preventDefault();
      enter += 1;
      el.classList.add("is-dragover");
    });
    el.addEventListener("dragover", (e) => {
      if (!hasDragFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      el.classList.add("is-dragover");
    });
    el.addEventListener("dragleave", (e) => {
      if (!hasDragFiles(e) && enter === 0) return;
      enter = Math.max(0, enter - 1);
      if (enter === 0) el.classList.remove("is-dragover");
    });
    el.addEventListener("drop", (e) => {
      if (!hasDragFiles(e) && !(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length)) return;
      e.preventDefault();
      e.stopPropagation();
      enter = 0;
      el.classList.remove("is-dragover");
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) onFile(file);
    });
  }

  function onPdfUpload(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    importReferralFile(file, "dialog");
  }

  function onDashFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    importReferralFile(file, "dash");
  }

  function renderSettings() {
    $("#facility-name").value = state.facilityName || "";
    const hasPass = !!readRecord()?.enc;
    $("#remove-passcode-btn").hidden = !hasPass;
    $("#lock-now-btn").hidden = !hasPass;
  }

  function renderAll() {
    renderDashboard();
    renderPipeline();
    renderReferrals();
    renderSettings();
    if (currentView === "detail" && selectedId) renderDetail();
  }

  function exportJson() {
    const payload = {
      app: "Admissions Tracker",
      exportedAt: new Date().toISOString(),
      data: state,
    };
    downloadFile(`admissions-tracker-backup-${todayISO()}.json`, JSON.stringify(payload, null, 2), "application/json");
    toast("JSON backup downloaded");
  }

  function csvEscape(value) {
    const s = String(value ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function exportCsv() {
    const headers = [
      "Name", "DOB", "Hospital", "Diagnosis", "Diagnoses", "Allergy status", "Allergies", "Payer", "Payer notes", "Date received",
      "Expected admit", "Status", "Needs", "Notes", "Checklist complete", "Updated",
    ];
    const rows = state.referrals.map((r) => {
      const prog = checklistProgress(r);
      const dxList = formatDiagnosesWithSource(referralDiagnoses(r)) || formatDiagnosesPlain(referralDiagnoses(r));
      const alrg = referralAllergies(r);
      const alrgStatus = alrg.status === "nkda" ? "NKDA" : (alrg.status === "listed" ? "listed" : "not listed");
      return [
        r.name, r.dob, r.hospital, r.diagnosis, dxList, alrgStatus, formatAllergiesText(alrg) || (alrg.status === "nkda" ? "NKDA" : ""),
        payerLabel(r.payer), r.payerNotes,
        r.dateReceived, r.expectedAdmitDate, statusLabel(r.status),
        (r.needs || []).map(needLabel).join("; "), r.notes,
        `${prog.done}/${prog.items}`, r.updatedAt,
      ].map(csvEscape).join(",");
    });
    downloadFile(`admissions-tracker-${todayISO()}.csv`, `${headers.join(",")}\n${rows.join("\n")}\n`, "text/csv");
    toast("CSV downloaded");
  }

  async function importJson(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = parsed.data || parsed;
      if (!incoming || !Array.isArray(incoming.referrals)) throw new Error("format");
      if (!confirm("Restore this backup into this browser? Existing referrals with the same id will be replaced. Others will be kept.")) return;
      const byId = new Map(state.referrals.map((r) => [r.id, r]));
      for (const r of incoming.referrals) {
        if (r && r.id) byId.set(r.id, r);
      }
      if (incoming.facilityName && !state.facilityName) state.facilityName = incoming.facilityName;
      if (incoming.facilityName && confirm("Also replace the facility name from the backup?")) {
        state.facilityName = incoming.facilityName;
      }
      state.referrals = [...byId.values()];
      await persist();
      renderAll();
      toast("Backup restored on this device");
    } catch (e) {
      toast("That file does not look like an Admissions Tracker backup.");
    }
  }

  async function clearAll() {
    if ($("#clear-confirm").value.trim() !== "DELETE") {
      toast('Type DELETE to confirm.');
      $("#clear-confirm").focus();
      return;
    }
    if (!confirm("Clear every referral stored in this browser?")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = emptyState();
    cryptoKey = null;
    window.__weesheePass = "";
    $("#clear-confirm").value = "";
    selectedId = null;
    searchQuery = "";
    filterStatus = "";
    filterPayer = "";
    const search = $("#search-input");
    const status = $("#filter-status");
    const payer = $("#filter-payer");
    if (search) search.value = "";
    if (status) status.value = "";
    if (payer) payer.value = "";
    showView("dashboard");
    renderAll();
    toast("All data on this device was cleared");
  }

  async function setPasscode(ev) {
    ev.preventDefault();
    const a = $("#new-passcode").value;
    const b = $("#confirm-passcode").value;
    const status = $("#passcode-status");
    status.hidden = true;
    if (a.length < 4) { toast("Use at least 4 characters"); return; }
    if (a !== b) { toast("Passcodes do not match"); return; }
    const packed = await encryptState(state, a);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(packed));
    window.__weesheePass = a;
    $("#new-passcode").value = "";
    $("#confirm-passcode").value = "";
    $("#remove-passcode-btn").hidden = false;
    $("#lock-now-btn").hidden = false;
    status.textContent = "Passcode saved. Referral data on this device is now encrypted.";
    status.hidden = false;
    toast("Passcode set");
  }

  async function removePasscode() {
    const current = prompt("Enter the current passcode to remove it.");
    if (current == null) return;
    try {
      const record = readRecord();
      if (record?.enc) await decryptState(record, current);
      window.__weesheePass = "";
      cryptoKey = null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, enc: false, data: state }));
      $("#remove-passcode-btn").hidden = true;
      $("#lock-now-btn").hidden = true;
      toast("Passcode removed. Data stays on this device, unencrypted.");
    } catch {
      toast("That passcode did not work.");
    }
  }

  function lockNow() {
    if (!readRecord()?.enc) return;
    window.__weesheePass = "";
    cryptoKey = null;
    state = emptyState();
    $("#app").hidden = true;
    $("#lock-screen").hidden = false;
    $("#unlock-passcode").value = "";
    $("#unlock-error").hidden = true;
    $("#unlock-passcode").focus();
  }

  async function unlock(ev) {
    ev.preventDefault();
    const pass = $("#unlock-passcode").value;
    const err = $("#unlock-error");
    err.hidden = true;
    try {
      const record = readRecord();
      state = await decryptState(record, pass);
      if (!state.referrals) state = Object.assign(emptyState(), state);
      window.__weesheePass = pass;
      $("#lock-screen").hidden = true;
      $("#app").hidden = false;
      $("#unlock-passcode").value = "";
      renderAll();
    } catch {
      err.textContent = "That passcode did not work.";
      err.hidden = false;
    }
  }

  function bindEvents() {
    $$(".nav-btn").forEach((btn) => btn.addEventListener("click", () => {
      showView(btn.dataset.view);
      renderAll();
    }));
    $("#new-referral-btn").addEventListener("click", () => openReferralForm());
    $("#close-referral-dialog").addEventListener("click", closeReferralForm);
    $("#cancel-referral-btn").addEventListener("click", closeReferralForm);
    $("#referral-form").addEventListener("submit", saveReferral);
    bindDiagnosesEditor();
    bindAllergiesEditor();
    $("#pdf-upload").addEventListener("change", onPdfUpload);
    $("#dash-file-input").addEventListener("change", onDashFile);
    bindDropzone($("#dash-dropzone"), (file) => importReferralFile(file, "dash"));
    bindDropzone($("#dialog-dropzone"), (file) => importReferralFile(file, "dialog"));
    document.addEventListener("dragover", (e) => { if (hasDragFiles(e)) e.preventDefault(); });
    document.addEventListener("drop", (e) => { if (hasDragFiles(e)) e.preventDefault(); });
    $("#dash-paste-toggle").addEventListener("click", () => {
      const panel = $("#dash-paste-panel");
      panel.hidden = !panel.hidden;
      if (!panel.hidden) $("#dash-paste-text").focus();
    });
    $("#dialog-paste-toggle").addEventListener("click", () => {
      const panel = $("#dialog-paste-panel");
      panel.hidden = !panel.hidden;
      if (!panel.hidden) $("#dialog-paste-text").focus();
    });
    $("#dash-paste-apply").addEventListener("click", () => importPastedText($("#dash-paste-text").value, "dash"));
    $("#dialog-paste-apply").addEventListener("click", () => importPastedText($("#dialog-paste-text").value, "dialog"));
    $("#search-input").addEventListener("input", () => { searchQuery = $("#search-input").value; renderReferrals(); });
    $("#filter-status").addEventListener("change", () => { filterStatus = $("#filter-status").value; renderReferrals(); });
    $("#filter-payer").addEventListener("change", () => { filterPayer = $("#filter-payer").value; renderReferrals(); });
    $("#copy-summary-btn").addEventListener("click", () => copyText(buildDailySummary()));
    document.addEventListener("click", (e) => {
      const jump = e.target.closest("[data-view-jump]");
      if (jump) { showView(jump.dataset.viewJump); renderAll(); }
    });
    $("#save-facility-btn").addEventListener("click", async () => {
      state.facilityName = $("#facility-name").value.trim();
      await persist();
      toast("Facility name saved on this device");
    });
    $("#export-json-btn").addEventListener("click", exportJson);
    $("#export-csv-btn").addEventListener("click", exportCsv);
    $("#import-json").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) importJson(file);
    });
    $("#clear-all-btn").addEventListener("click", clearAll);
    $("#passcode-form").addEventListener("submit", setPasscode);
    $("#remove-passcode-btn").addEventListener("click", removePasscode);
    $("#lock-now-btn").addEventListener("click", lockNow);
    $("#unlock-form").addEventListener("submit", unlock);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("#referral-dialog").open) closeReferralForm();
    });
  }

  async function boot() {
    populateSelects();
    bindEvents();
    const record = readRecord();
    if (!record) {
      state = emptyState();
      renderAll();
      return;
    }
    if (record.enc) {
      $("#app").hidden = true;
      $("#lock-screen").hidden = false;
      return;
    }
    state = Object.assign(emptyState(), record.data || record);
    if (!Array.isArray(state.referrals)) state.referrals = [];
    renderAll();
  }

  window.__weesheePass = "";
  if (typeof AdmissionsICD !== "undefined" && AdmissionsICD.ensureLoaded) {
    AdmissionsICD.ensureLoaded().catch((err) => console.warn(err));
  }
  boot();
})();
