/* Diagnosis and referral-field extraction. Pure functions, no network, no DOM.
   Loaded before app.js in the browser and required by the Node test suite. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AdmissionsExtract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

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

  // ICD-10-CM: letter A–Z (U included so COVID codes like U07.1 are kept),
  // then a digit, then an alnum category character, optional dot + 1–4 chars.
  // The same shape without a dot (E119 → E11.9) is also accepted.
  const ICD_BODY = "([A-Z][0-9][0-9A-Z](?:\\.[0-9A-Z]{1,4}|[0-9A-Z]{1,4})?)";
  const ICD_CODE_RE = new RegExp("\\b" + ICD_BODY + "\\b", "gi");
  const ICD_CODE_EXACT_RE = new RegExp("^" + ICD_BODY + "$", "i");

  const FALSE_POSITIVE_CODES = new Set([
    "A1C", "B12", "B12A",
    "D5W", "D5NS", "D10W", "D25W", "D50W", "D5LR", "D51W",
    "Q1H", "Q2H", "Q3H", "Q4H", "Q6H", "Q8H", "Q12H", "Q24H",
  ]);

  const LEFT_CONTEXT_RE = /(?:room|rm\.?|apt\.?|apartment|suite|unit|bldg\.?|building|wing|bed|phone|tel\.?|fax|zip|postal|npi|dea|mrn|acct\.?|account|lot|batch|po\s*box|p\.?\s*o\.?\s*box|interstate|highway|hwy|route|vitamin|hba1c|hemoglobin|dose|injection|vaccine|lot\s*#|policy|mbi|member\s*id)\s*[:#.\-–]?\s*$/i;
  const FREQ_CODE_RE = /^Q\d{1,2}H$/i;

  const DX_HEADER_RE = /^(?:((?:primary|principal|admitting)\s*(?:dx|diagnosis|diagnoses)?)|((?:secondary|other|additional)(?:\s*(?:dx|diagnosis|diagnoses))?|(?:active|discharge|working)\s*(?:dx|diagnosis|diagnoses))|(problem\s*list|active\s*problems?|past\s*medical\s*history|pmhx?|assessment\s*(?:and|&)\s*plan|diagnos(?:is|es)|dx(?:\s*list)?|icd-?10(?:-?cm)?(?:\s*codes?)?))\s*[:\-–]?\s*(.*)$/i;

  const END_SECTION_RE = /^(?:patient(?:\s*name)?|resident\s*name|date\s*of\s*birth|dob|mrn|medical\s*record(?:\s*number)?|referr(?:ing|al)\s*(?:hospital|facility|source|date|physician)|hospital|attending(?:\s*physician)?|physician|insurance|payer|plan(?:\s*name)?|policy(?:\s*(?:number|\/\s*mbi)?)?|medications?|current\s*meds|meds(?:\s*list)?|allergies|labs?|lab\s*results|vitals?|vital\s*signs|care\s*needs|weight-?bearing|isolation|notes?|proposed\s*discharge(?:\s*date)?|expected\s*admit(?:\s*date)?|admit(?:\s*date)?|date\s*received|date\s*of\s*referral|code\s*status|diet|activity|social\s*history|family(?:\s*contact)?|advance\s*directive|dme|procedures?|imaging|consults?|weight|height|bmi|oxygen\s*sat|precautions|code\s*status|nursing\s*orders)\s*[:\-–]/i;

  const TABLE_HEADER_RE = /^(?=.*\b(?:icd-?10(?:-?cm)?|code|dx\s*code|diag(?:nosis)?\s*code)\b)(?=.*\b(?:description|diagnosis|diagnoses|dx|title)\b).{0,80}$/i;

  const MODIFIER_START_RE = /^(s\/p|status\s+post|w\/o|without|due\s+to|secondary\s+to|vs\.?|subsequent\s+encounter|initial\s+encounter|sequela)\b/i;

  const SKIP_UNCODED_RE = /^(none|n\/?a|nil|see\s+(?:below|above|note|notes|list)|not\s+listed|unknown|—|-|\.|\*+)$/i;

  function cleanLine(s) {
    return String(s || "").replace(/\s+/g, " ").replace(/[•|]+/g, " ").trim().replace(/[,;.\s]+$/, "");
  }

  function pick(text, patterns) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m && m[1]) return cleanLine(m[1]);
    }
    return "";
  }

  function normalizeDob(raw) {
    if (!raw) return "";
    const m = String(raw).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (!m) return "";
    let [, mm, dd, yy] = m;
    if (yy.length === 2) yy = Number(yy) > 30 ? `19${yy}` : `20${yy}`;
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  function pickPlan(text) {
    return pick(text, [
      /Insurance\s*[:\-]\s*([^\n]+)/i,
      /Payer\s*[:\-]\s*([^\n]+)/i,
      /Plan\s*[:\-]\s*([^\n]+)/i,
    ]);
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

  function normalizeIcd10Code(raw) {
    if (!raw) return "";
    let up = String(raw).toUpperCase().replace(/\s+/g, "");
    up = up.replace(/^([A-Z][0-9][0-9A-Z])\.(.+)$/, "$1$2");
    if (!ICD_CODE_EXACT_RE.test(up) && !/^[A-Z][0-9][0-9A-Z][0-9A-Z]{1,4}$/.test(up)) {
      if (!/^[A-Z][0-9][0-9A-Z]$/.test(up)) return "";
    }
    if (up.length > 3) return `${up.slice(0, 3)}.${up.slice(3)}`;
    return up;
  }

  function isIcd10Shape(raw) {
    return !!normalizeIcd10Code(raw);
  }

  function compactKey(code) {
    return String(code || "").toUpperCase().replace(/\./g, "");
  }

  function cleanDescription(s) {
    let t = String(s || "");
    t = t.replace(/[([{\]‘’]/g, " ").replace(/[)\]}']/g, " ");
    t = t.replace(ICD_CODE_RE, " ");
    t = t.replace(/^(?:primary|principal|admitting|secondary|other|additional|active|discharge)\s*(?:dx|diagnosis|diagnoses)?\s*[:\-–]\s*/i, "");
    t = t.replace(/^(?:icd-?10(?:-?cm)?|code|dx)\s*[:\-–#]?\s*/i, "");
    t = t.replace(/^[\s.,;:\/|*\-–—]+|[\s.,;:\/|*\-–—]+$/g, "");
    t = t.replace(/\s+/g, " ").trim();
    t = t.replace(/[,;.\s]+$/, "");
    if (t.length > 400) t = t.slice(0, 400).trim();
    return t;
  }

  function stripListMarker(line) {
    return String(line || "").replace(/^\s*(?:[\u2022•●○▪\-–—*]|[0-9]+[.)]|[A-Za-z][.)])\s+/, "").trim();
  }

  function looksLikeMedication(line) {
    const t = stripListMarker(line);
    if (ICD_CODE_RE.test(t)) {
      ICD_CODE_RE.lastIndex = 0;
      return false;
    }
    return /\b\d+(?:\.\d+)?\s*(mg|mcg|µg|mcg|g|ml|meq|units?|iu)\b|\b(?:tab(?:let)?s?|caps?|susp(?:ension)?)\b|\b(?:BID|TID|QID|PRN|q\d+\s*h)\b/i.test(t);
  }

  function looksLikeUncodedDiagnosis(line) {
    const t = stripListMarker(line);
    if (!t || SKIP_UNCODED_RE.test(t)) return false;
    if (looksLikeMedication(t)) return false;
    if (isTableHeader(t) || matchDxHeader(t) || isEndSection(t)) return false;
    if (t.length < 3) return false;
    if (!/[A-Za-z]{3,}/.test(t)) return false;
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(t)) return false;
    if (/^(yes|no|unknown|none listed)$/i.test(t)) return false;
    return true;
  }

  function matchDxHeader(line) {
    const t = String(line || "").trim();
    const m = t.match(DX_HEADER_RE);
    if (!m) return null;
    // Avoid treating a bare capitalized word mid-sentence as a header unless it is
    // a label (has a colon/dash or is a known phrase). "Diagnosis" as a table cell
    // with no colon still counts because of the regex.
    const isPrimary = !!(m[1] && /^(?:primary|principal|admitting)\b/i.test(m[1]));
    const remainder = (m[4] || "").trim();
    return { isPrimary, remainder, raw: m[0] };
  }

  function isEndSection(line) {
    const t = String(line || "").trim();
    if (matchDxHeader(t) || isTableHeader(t)) return false;
    return END_SECTION_RE.test(t);
  }

  function isTableHeader(line) {
    const t = String(line || "").replace(/[|+\-_/]/g, " ").replace(/\s+/g, " ").trim();
    if (!TABLE_HEADER_RE.test(t)) return false;
    return t.split(" ").length <= 12;
  }

  function shouldRejectCode(raw, line, indexInLine) {
    const normalized = normalizeIcd10Code(raw);
    const compact = compactKey(normalized);
    if (!normalized) return true;
    if (FALSE_POSITIVE_CODES.has(compact) || FALSE_POSITIVE_CODES.has(normalized)) return true;
    if (FREQ_CODE_RE.test(compact)) return true;
    const before = String(line || "").slice(0, indexInLine);
    if (LEFT_CONTEXT_RE.test(before)) return true;
    const around = String(line || "");
    if (/\b(vitamin|hba1c|hemoglobin\s*a1c|a1c)\b/i.test(around) && (compact === "B12" || compact === "A1C")) return true;
    if (/\b(q\s*\d+\s*h|every\s+\d+\s+hours?)\b/i.test(around) && FREQ_CODE_RE.test(compact)) return true;
    return false;
  }

  function hasDxKeyword(text) {
    return /\b(diagnos(?:is|es)|dx|icd-?10|problem\s*list|active\s*problems?|pmhx?|comorbid|medical\s*history|principal|admitting)\b/i.test(text || "");
  }

  function findCodesInLine(line) {
    const found = [];
    const re = new RegExp(ICD_CODE_RE.source, "gi");
    let m;
    while ((m = re.exec(line))) {
      const raw = m[1];
      if (shouldRejectCode(raw, line, m.index)) continue;
      const code = normalizeIcd10Code(raw);
      if (!code) continue;
      found.push({ raw, code, index: m.index, end: m.index + m[0].length, dotted: /\./.test(raw) || raw.length > 3 });
    }
    return found;
  }

  function descriptionForCode(line, match, allMatches) {
    // Prefer text on the same line with this code removed (and other codes too).
    let rest = line;
    // Remove from the end so earlier indices stay valid if we sliced, but here we
    // just wipe all code tokens and leftover punctuation.
    const sorted = allMatches.slice().sort((a, b) => b.index - a.index);
    for (const c of sorted) {
      rest = rest.slice(0, c.index) + " " + rest.slice(c.end);
    }
    return cleanDescription(rest);
  }

  function splitUncodedList(text, { allowComma }) {
    const t = stripListMarker(text);
    if (!t) return [];
    const semi = t.split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
    if (semi.length > 1) return semi.map(cleanDescription).filter(Boolean);
    if (!allowComma) return [cleanDescription(t)].filter(Boolean);
    const parts = t.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return [cleanDescription(t)].filter(Boolean);
    if (parts.slice(1).some((p) => MODIFIER_START_RE.test(p))) {
      return [cleanDescription(t)].filter(Boolean);
    }
    return parts.map(cleanDescription).filter((p) => p && p.length >= 3);
  }

  function pushItem(items, { code, description, primary }) {
    const desc = cleanDescription(description || "");
    const normalized = code ? normalizeIcd10Code(code) : "";
    if (!normalized && !desc) return;
    items.push({
      code: normalized,
      description: desc,
      primary: !!primary,
    });
  }

  function addCodedLine(items, line, { primary, inSection, nextLine, consumeNext }) {
    const matches = findCodesInLine(line);
    if (!matches.length) return 0;
    let usedNext = 0;
    const lineHasKeyword = hasDxKeyword(line);
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      let description = descriptionForCode(line, match, matches);
      if (!description && matches.length === 1 && nextLine) {
        const next = stripListMarker(nextLine);
        if (next && !findCodesInLine(next).length && looksLikeUncodedDiagnosis(next) && !isEndSection(next) && !matchDxHeader(next)) {
          description = cleanDescription(next);
          usedNext = 1;
        }
      }
      const accept = inSection || lineHasKeyword || !!description || match.dotted;
      if (!accept) continue;
      pushItem(items, { code: match.code, description, primary: primary && i === 0 && items.every((d) => !d.primary) });
    }
    if (consumeNext) return usedNext;
    return 0;
  }

  function extractDiagnoses(text) {
    if (!text) return [];
    const lines = String(text).replace(/\r\n/g, "\n").split("\n");
    const items = [];
    let inDxSection = false;
    let sectionPrimary = false;
    let primaryAssigned = false;

    const markPrimary = (force) => {
      if (force && !primaryAssigned) {
        primaryAssigned = true;
        return true;
      }
      return false;
    };

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;

      if (isTableHeader(trimmed)) {
        inDxSection = true;
        sectionPrimary = false;
        continue;
      }

      const header = matchDxHeader(trimmed);
      if (header) {
        inDxSection = true;
        sectionPrimary = header.isPrimary;
        if (header.remainder) {
          const remainder = header.remainder;
          const codes = findCodesInLine(remainder);
          if (codes.length) {
            const skip = addCodedLine(items, remainder, {
              primary: markPrimary(header.isPrimary),
              inSection: true,
              nextLine: lines[i + 1],
            });
            if (skip) i += skip;
          } else if (looksLikeUncodedDiagnosis(remainder) || remainder.length >= 3) {
            const parts = splitUncodedList(remainder, { allowComma: !header.isPrimary });
            for (const part of parts) {
              const isPri = markPrimary(header.isPrimary && parts.indexOf(part) === 0);
              pushItem(items, { code: "", description: part, primary: isPri });
            }
          }
        }
        continue;
      }

      if (inDxSection && isEndSection(trimmed)) {
        inDxSection = false;
        sectionPrimary = false;
        continue;
      }

      const codes = findCodesInLine(trimmed);
      if (codes.length) {
        const wantPrimary = sectionPrimary && inDxSection && !primaryAssigned;
        const skip = addCodedLine(items, trimmed, {
          primary: markPrimary(wantPrimary),
          inSection: inDxSection,
          nextLine: lines[i + 1],
        });
        if (skip) i += skip;
        continue;
      }

      if (inDxSection && looksLikeUncodedDiagnosis(trimmed)) {
        // If the previous added item was a code with no description and this
        // line is a lone description, prefer attaching it (already handled by
        // look-ahead). Reaching here means it is its own uncoded diagnosis.
        const parts = splitUncodedList(trimmed, { allowComma: !sectionPrimary });
        for (const part of parts) {
          const isPri = markPrimary(sectionPrimary && !primaryAssigned);
          pushItem(items, { code: "", description: part, primary: isPri });
        }
      }
    }

    return dedupeDiagnoses(items);
  }

  function dedupeDiagnoses(items) {
    const out = [];
    const codeSeen = new Set();
    const descSeen = new Set();
    for (const item of items) {
      if (item.code) {
        const key = compactKey(item.code);
        if (codeSeen.has(key)) {
          const prev = out.find((d) => compactKey(d.code) === key);
          if (prev && !prev.description && item.description) prev.description = item.description;
          if (prev && item.primary) prev.primary = true;
          continue;
        }
        codeSeen.add(key);
        out.push({ code: item.code, description: item.description || "", primary: !!item.primary });
        if (item.description) descSeen.add(item.description.toLowerCase());
        continue;
      }
      const dk = (item.description || "").toLowerCase();
      if (!dk || descSeen.has(dk)) continue;
      descSeen.add(dk);
      out.push({ code: "", description: item.description, primary: !!item.primary });
    }
    const primaryCount = out.filter((d) => d.primary).length;
    if (primaryCount > 1) {
      let kept = false;
      for (const d of out) {
        if (d.primary && kept) d.primary = false;
        else if (d.primary) kept = true;
      }
    }
    return out;
  }

  function formatDiagnosis(item) {
    if (!item) return "";
    const code = item.code || "";
    const description = item.description || "";
    if (code && description) return `${code} ${description}`;
    return code || description;
  }

  function formatDiagnosesList(items, { missingCode = "no code found" } = {}) {
    return (items || []).map((d) => {
      const text = formatDiagnosis(d);
      if (!d.code && d.description) return `${d.description} (${missingCode})`;
      return text;
    }).filter(Boolean).join("; ");
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
    const diagnoses = extractDiagnoses(text);
    const primary = diagnoses.find((d) => d.primary) || diagnoses[0];
    let diagnosis = formatDiagnosis(primary);
    if (!diagnosis) {
      diagnosis = pick(text, [
        /Primary\s*Diagnosis\s*[:\-]\s*([^\n]+)/i,
        /Admitting\s*Diagnosis\s*[:\-]\s*([^\n]+)/i,
        /Diagnosis\s*[:\-]\s*([^\n]+)/i,
      ]);
    }
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
    return {
      name,
      dob: normalizeDob(dobRaw),
      hospital,
      diagnosis,
      diagnoses,
      dateReceived,
      expectedAdmitDate: expected,
      payer: payerGuess.payer,
      payerNotes: payerGuess.notes,
      needs,
      notes,
    };
  }

  return {
    NEED_KEYWORDS,
    ICD_CODE_RE,
    extractFields,
    extractDiagnoses,
    normalizeIcd10Code,
    isIcd10Shape,
    formatDiagnosis,
    formatDiagnosesList,
    pick,
    cleanLine,
    normalizeDob,
    guessPayer,
  };
});
