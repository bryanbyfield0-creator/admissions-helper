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
  const NEED_KEYWORDS = [
    { id: "pt", re: /\b(physical therapy|\bPT\b)\b/i },
    { id: "ot", re: /\b(occupational therapy|\bOT\b)\b/i },
    { id: "st", re: /\b(speech therapy|\bST\b|SLP)\b/i },
    { id: "wound", re: /\bwound(?:\s*care|\s*vac)?\b/i },
    { id: "iv", re: /\b(IV|intravenous)\b/i },
    { id: "dialysis", re: /\bdialysis\b|\bhemodialysis\b|\bHD\b/i },
    { id: "oxygen", re: /\boxygen\b|\bO2\b/i },
    { id: "isolation", re: /\bisolation\b|\bcontact precautions\b|\bMRSA\b|\bC\.\s?diff/i },
    { id: "trach", re: /\btrach(?:eostomy)?\b|\bventilator\b|\bvent\b/i },
    { id: "tube", re: /\btube feeding\b|\bPEG\b|\bNG tube\b/i },
    { id: "bariatric", re: /\bbariatric\b/i },
    { id: "behavior", re: /\b1:1\b|\bbehavioral\b|\bwandering\b/i },
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
      const hay = [r.name, r.hospital, r.diagnosis, payerLabel(r.payer), r.payerNotes, r.notes, (r.needs || []).map(needLabel).join(" ")].join(" ").toLowerCase();
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
          <p><strong>Diagnosis:</strong> ${escapeHtml(r.diagnosis || "—")}</p>
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
          ${r.extractedText ? `<h2 style="margin-top:16px">Text saved from PDF</h2><p class="hint">${escapeHtml(r.extractedSourceName || "Referral PDF")} · review before use</p><pre class="extract-text">${highlightExtract(r.extractedText)}</pre>` : ""}
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
    return `Hello,\n\nWe are pleased to accept the referral for ${r.name || "this patient"} from ${r.hospital || "your hospital"}. We can admit${when}. Please send any remaining records (H&P, medication list, and discharge summary) and confirm transportation.\n\nThank you,\n${facilityName()}`;
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
    const line = (r) => `- ${r.name || "Untitled"} | ${r.hospital || "source n/a"} | ${payerLabel(r.payer)} | ${r.diagnosis || "dx n/a"}${r.expectedAdmitDate ? ` | expected ${formatDate(r.expectedAdmitDate)}` : ""}`;
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

  function normalizeDob(raw) {
    if (!raw) return "";
    const m = String(raw).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (!m) return "";
    let [, mm, dd, yy] = m;
    if (yy.length === 2) yy = Number(yy) > 30 ? `19${yy}` : `20${yy}`;
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  function pick(text, patterns) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m && m[1]) return cleanLine(m[1]);
    }
    return "";
  }

  function cleanLine(s) {
    return s.replace(/\s+/g, " ").replace(/[•|]+/g, " ").trim().replace(/[,;.\s]+$/, "");
  }

  function guessPayer(text) {
    const t = text.toLowerCase();
    const hasMed = /medicare/.test(t);
    const hasCaid = /medicaid|medi-cal|medi cal/.test(t);
    if (hasMed && hasCaid) return { payer: "medicare-medicaid", notes: pickPlan(text) };
    if (/medicare\s+advantage|\b(mco|hmo|ppo)\b/.test(t) && hasMed) return { payer: "mco", notes: pickPlan(text) };
    if (hasMed) return { payer: "medicare", notes: pickPlan(text) };
    if (hasCaid) return { payer: "medicaid", notes: pickPlan(text) };
    if (/private pay|self[- ]pay/.test(t)) return { payer: "private-pay", notes: pickPlan(text) };
    if (/insurance|payer|aetna|blue cross|united|cigna|humana/.test(t)) return { payer: "private", notes: pickPlan(text) };
    return { payer: "", notes: pickPlan(text) };
  }

  function pickPlan(text) {
    return pick(text, [
      /Insurance\s*[:\-]\s*([^\n]+)/i,
      /Payer\s*[:\-]\s*([^\n]+)/i,
      /Plan\s*[:\-]\s*([^\n]+)/i,
    ]);
  }

  function extractFields(text) {
    const name = pick(text, [
      /Patient\s*Name\s*[:\-]\s*([A-Za-z][A-Za-z' .\-]{1,80})/i,
      /Resident\s*Name\s*[:\-]\s*([A-Za-z][A-Za-z' .\-]{1,80})/i,
      /(?:^|\n)\s*Name\s*[:\-]\s*([A-Za-z][A-Za-z' .\-]{1,80})/i,
    ]);
    const dobRaw = pick(text, [
      /Date\s*of\s*Birth\s*[:\-]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /DOB\s*[:\-]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    ]);
    const hospital = pick(text, [
      /Referring\s*(?:Hospital|Facility|Source)\s*[:\-]\s*([^\n]+)/i,
      /Discharge\s*(?:From|Hospital)\s*[:\-]\s*([^\n]+)/i,
      /Hospital\s*[:\-]\s*([^\n]+)/i,
    ]);
    const diagnosis = pick(text, [
      /Primary\s*Diagnosis\s*[:\-]\s*([^\n]+)/i,
      /Admitting\s*Diagnosis\s*[:\-]\s*([^\n]+)/i,
      /Diagnosis\s*[:\-]\s*([^\n]+)/i,
    ]);
    const dateReceived = normalizeDob(pick(text, [
      /Referral\s*Date\s*[:\-]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /Date\s*Received\s*[:\-]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /Date\s*of\s*Referral\s*[:\-]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    ]));
    const expected = normalizeDob(pick(text, [
      /Proposed\s*Discharge\s*Date\s*[:\-]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /Expected\s*Admit(?:\s*Date)?\s*[:\-]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /Admit(?:\s*Date)?\s*[:\-]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    ]));
    const payerGuess = guessPayer(text);
    const needs = NEED_KEYWORDS.filter((n) => n.re.test(text)).map((n) => n.id);
    const notes = pick(text, [/Notes?\s*[:\-]\s*([^\n]{10,400})/i]);
    return { name, dob: normalizeDob(dobRaw), hospital, diagnosis, dateReceived, expectedAdmitDate: expected, payer: payerGuess.payer, payerNotes: payerGuess.notes, needs, notes };
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
    add(/Diagnosis\s*[:\-]?[^\n]+/i);
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

  async function onPdfUpload(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    const err = $("#pdf-error");
    err.hidden = true;
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      err.textContent = "Please choose a PDF file.";
      err.hidden = false;
      return;
    }
    try {
      if (typeof pdfjsLib === "undefined") throw new Error("PDF reader is missing");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
      const data = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data, disableRange: true, disableStream: true }).promise;
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
      const text = pages.join("\n\n").trim();
      if (!text) {
        err.textContent = "No readable text was found. Scanned image-only PDFs cannot be read here. Enter the details by hand.";
        err.hidden = false;
        return;
      }
      extractRaw = text;
      extractName = file.name;
      showExtract();
      const guessed = extractFields(text);
      filledFromPdf = new Set();
      const apply = (id, key, value) => {
        if (!value) return;
        const el = document.getElementById(id);
        if (!el) return;
        if (!el.value) {
          el.value = value;
          filledFromPdf.add(key);
        } else if (el.value !== value) {
          el.value = value;
          filledFromPdf.add(key);
        } else {
          filledFromPdf.add(key);
        }
      };
      apply("referral-name", "name", guessed.name);
      apply("referral-dob", "dob", guessed.dob);
      apply("referral-hospital", "hospital", guessed.hospital);
      apply("referral-diagnosis", "diagnosis", guessed.diagnosis);
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
      toast("PDF text was read on this device. Review before you save.");
    } catch (e) {
      console.error(e);
      err.textContent = "This PDF could not be read. It may be password-protected or image-only. Enter the details by hand.";
      err.hidden = false;
    }
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
      "Name", "DOB", "Hospital", "Diagnosis", "Payer", "Payer notes", "Date received",
      "Expected admit", "Status", "Needs", "Notes", "Checklist complete", "Updated",
    ];
    const rows = state.referrals.map((r) => {
      const prog = checklistProgress(r);
      return [
        r.name, r.dob, r.hospital, r.diagnosis, payerLabel(r.payer), r.payerNotes,
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
    $("#pdf-upload").addEventListener("change", onPdfUpload);
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
  boot();
})();
