/* Referral-field extraction. Pure functions, no network, no DOM.
   Loaded before app.js in the browser and required by the Node test suite.

   Design rule: precision over recall. A field the parser is not sure about is
   left blank so the user fills it in, rather than guessed. Diagnoses and
   allergies are only read from their own sections of the referral. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AdmissionsExtract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Care needs (checkboxes). Kept conservative: each pattern needs a clear,
  // specific phrase so "Isolation: None", "ST. MARY", "Pt is 80", "Stage IV" or
  // "without behavioral disturbance" do not tick boxes.
  const NEED_KEYWORDS = [
    { id: "pt", re: /\bphysical therapy\b|(?:^|[\s,;:(\/])PT(?=[\s,;:)\/]|$)/m },
    { id: "ot", re: /\boccupational therapy\b|(?:^|[\s,;:(\/])OT(?=[\s,;:)\/]|$)/m },
    { id: "st", re: /\bspeech(?:\s*(?:language)?\s*therapy|\s*therapist)\b|\bSLP\b|\bST\s+(?:eval|evaluation|therapy)\b/i },
    { id: "wound", re: /\bwound\s*(?:care|vac|consult|team)\b|\bpressure\s+(?:injury|ulcer)\b|\bwound\b(?=[,;\s]*(?:$|\n))/im },
    { id: "iv", re: /\bIV\s+(?:antibiotics?|abx|fluids?|access|therapy|meds?|medications?|vanc\w*|zosyn|cefazolin|ceftriaxone|ertapenem|daptomycin|[a-z]+(?:mycin|cillin|cef\w*))\b|\bPICC\b|\bintravenous\b/i },
    { id: "dialysis", re: /\b(?:hemo)?dialysis\b|\bHD\s+(?:M\/W\/F|MWF|T\/Th\/S|TTS|schedule|chair|days)\b/i },
    { id: "oxygen", re: /\boxygen\b|\bO2\b|\b\d\s*L\s*(?:NC|nasal cannula)\b/i },
    { id: "isolation", re: /\bcontact\s+(?:precautions|iso(?:lation)?)\b|\bcont(?:act)?\.?\s*iso\b|\bdroplet\b|\bairborne\b|\bMRSA\b|\bVRE\b|\bESBL\b|\bC\.?\s?diff|\bCRE\b|\bisolation\s*[:\-]\s*(?!none\b|no\b|n\/a\b|standard\b|not\b)[a-z]/i },
    { id: "trach", re: /\btrach(?:eostomy)?\b|\bventilator\b|\bvent(?:ilated)?\s+(?:dependent|settings|patient)\b|\bBiPAP\b/i },
    { id: "tube", re: /\btube\s*feed(?:ing|s)?\b|\bPEG\b|\bNG\s*tube\b|\bG-?tube\b|\benteral\b/i },
    { id: "bariatric", re: /\bbariatric\b/i },
    { id: "behavior", re: /\b1:1\b|\bsitter\b|\bwander(?:ing|s)?\b|\belopement\b|\bbehaviou?ral\s+(?:issues|problems|concerns|needs|health)\b|\baggressi(?:ve|on)\b/i },
  ];

  // ICD-10-CM shape: letter, digit, digit-or-letter, then optional "." + 1–4
  // alphanumerics. Undotted long forms (E119) are accepted inside diagnosis
  // sections only. Final say always goes to the bundled CMS code list.
  const ICD_BODY = "([A-Z][0-9][0-9A-Z](?:\\.[0-9A-Z]{1,4}|[0-9A-Z]{1,4})?)";
  const ICD_CODE_RE = new RegExp("\\b" + ICD_BODY + "\\b", "gi");
  const ICD_CODE_EXACT_RE = new RegExp("^" + ICD_BODY + "$", "i");

  const FALSE_POSITIVE_CODES = new Set([
    "A1C", "B12", "B12A", "D5W", "D5NS", "D10W", "D25W", "D50W", "D5LR", "D51W",
    "Q1H", "Q2H", "Q3H", "Q4H", "Q6H", "Q8H", "Q12H", "Q24H", "T10", "L45",
  ]);
  const FREQ_CODE_RE = /^Q\d{1,2}H$/i;
  const LEFT_CONTEXT_RE = /(?:room|rm\.?|apt\.?|suite|unit|bldg\.?|building|wing|bed|phone|tel\.?|fax|zip|postal|npi|dea|mrn|acct\.?|account|lot|batch|box|interstate|highway|hwy|route|vitamin|hba1c|hemoglobin|dose|injection|vaccine|policy|mbi|member\s*(?:id|#)?|group|grp|plan|id|#|subscriber(?:\s*id)?)\s*[:#.\-–]?\s*$/i;

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

  // "MT MEDICAID  Plan: MEDICAID MT  Group: 88120" -> "MT MEDICAID".
  // Cuts a label's value at the next "Label:" on the same line and trims OCR
  // debris like a trailing " :" or " .".
  function cutAtNextLabel(v) {
    let t = String(v || "");
    const m = t.match(/\s+(?:Plan|Group|Grp|Policy|Subscriber|Member|Phone|Fax|Sex|Age|DOB|MRN|Room|Bed|Unit|Isolation|Attending|Relation(?:ship)?|Category|Reaction|Severity|Guarantor|Payer|Secondary|Primary|ID|NPI|Address|Contact|Encounter|Admit|Admission|Physician|Provider)(?:\s+(?:ID|#|No\.?|Number|Name|Payer|Date|Type))?\s*#?\s*:(?:\s|$)/i);
    if (m && m.index > 0) t = t.slice(0, m.index);
    return t.replace(/\s{2,}.*$/, "").replace(/[\s:;.,=|]+$/, "").replace(/^[\s:;.,=|]+/, "").trim();
  }

  function normalizeDob(raw, { minYear = 1900, maxYear = 2100 } = {}) {
    if (!raw) return "";
    const m = String(raw).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (!m) return "";
    let [, mm, dd, yy] = m;
    if (yy.length === 3) return "";
    if (yy.length === 2) yy = Number(yy) > 30 ? `19${yy}` : `20${yy}`;
    const y = Number(yy), mo = Number(mm), d = Number(dd);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < minYear || y > maxYear) return "";
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1) return "";
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  function normalizeIcd10Code(raw) {
    if (!raw) return "";
    let up = String(raw).toUpperCase().replace(/\s+/g, "");
    up = up.replace(/^([A-Z][0-9][0-9A-Z])\.(.+)$/, "$1$2");
    if (!/^[A-Z][0-9][0-9A-Z](?:[0-9A-Z]{1,4})?$/.test(up)) return "";
    if (up.length > 3) return `${up.slice(0, 3)}.${up.slice(3)}`;
    return up;
  }

  function isIcd10Shape(raw) {
    return !!normalizeIcd10Code(raw);
  }

  function compactKey(code) {
    return String(code || "").toUpperCase().replace(/\./g, "");
  }

  function stripListMarker(line) {
    return String(line || "").replace(/^\s*(?:[\u2022•●○▪◦\-–—*#>]+|[0-9]{1,2}[.)]|[A-Za-z][.)])\s*/, "").trim();
  }

  // ---------------------------------------------------------------------------
  // Section detection

  const DX_SECTION_RE = /^(?:(?:hospital|active|current|chronic|master|patient)\s+)?problem\s*list(?:\s*\/\s*diagnos[ie]s)?|^(?:active|principal|current|chronic)\s+problems?|^principal\s+problem|^(?:(primary|principal|admitting|admission|reason\s+for\s+admission)|secondary|other|additional|discharge|final|working|active|hospital|clinical|encounter|referral)\s*(?:dx|diagnos[ie]s)|^(primary|principal|admitting)(?=\s*:)|^(?:secondary|other|additional|comorbid(?:ities)?)(?=\s*:)|^diagnos[ie]s(?:\s*\/\s*problems?)?(?:\s+(?:information|info|list|summary))?|^dx(?:\s*list)?(?=\s*[:\-–]|\s*$)|^assessment(?:\s*(?:and|&|\/)\s*plan)?|^impression(?:\s*(?:and|&|\/)\s*plan)?|^a\s*\/\s*p\b|^icd-?10(?:-?cm)?\s*(?:codes?|diagnos[ie]s)/i;
  const PMH_SECTION_RE = /^(?:past\s+medical\s+history|medical\s+history|past\s+history|pmhx?|comorbidit(?:y|ies)|chronic\s+conditions|resolved\s+problems?)\b/i;
  const ALLERGY_SECTION_RE = /^(?:(drug|medication|food|environmental|latex|known)\s+)?(?:allerg(?:y|ies|ens?)|intolerances?)(?:\s*\/\s*(?:intolerances?|adverse\s+(?:reactions?|drug\s+reactions?)))?(?:\s+(?:list|information|info|reviewed|verified))?(?:\s+as\s+of\s+[0-9\/\-]+(?:\s+[0-9:]+\s*(?:AM|PM)?)?)?(?:\s*\([^)]*\))?(?=\s*[:\-–]|\s*$)|^(environmental|latex)(?=\s*[:\-–])|^adverse\s+(?:drug\s+)?reactions?(?=\s*[:\-–]|\s*$)/i;

  // Everything else that starts a new block. Colon optional (Epic prints
  // most headers alone on a line).
  const OTHER_SECTIONS = [
    ["surgical", /^(?:past\s+)?surgical\s+history|^psh(?:x)?\b|^procedures?(?:\s+history)?|^operations?\b|^surgeries\b/i],
    ["meds", /^(?:current|home|active|discharge|inpatient|scheduled|prn|outpatient)?\s*(?:medications?|meds)(?:\s+(?:prior\s+to\s+admission|list|on\s+admission|at\s+discharge))?|^prior\s+to\s+admission\s+medications|^mar\b|^medication\s+(?:administration|reconciliation)/i],
    ["contacts", /^(?:emergency\s+|patient\s+)?contacts?(?:\s+information)?|^next\s+of\s+kin|^nok\b|^family\s+contacts?|^responsible\s+party|^poa\b|^health\s*care\s+proxy/i],
    ["insurance", /^(?:primary\s+|secondary\s+)?(?:insurance|coverage|payers?|payor)(?:\s+information)?|^subscriber(?:\s+information)?|^guarantor(?:\s+information)?|^financial\s+class|^benefits?\b|^authorization\b/i],
    ["providers", /^care\s+team|^providers?\b|^treatment\s+team|^attending\s+(?:provider|physician)|^consultants?\b|^pcp\b|^primary\s+care/i],
    ["encounter", /^encounter(?:\s+information|\s+details)?|^admission\s+information|^face\s*sheet|^patient\s+(?:face\s*sheet|information|demographics)|^demographics|^visit\s+information|^registration/i],
    ["isolation", /^isolation|^infection\s+(?:status|control|prevention)|^precautions/i],
    ["history", /^family\s+history|^social\s+history|^fhx?\b|^shx?\b|^tobacco|^substance\s+use|^immunizations?|^vaccines?|^functional\s+status|^advance\s+directives?|^code\s+status|^diet\b|^activity\b|^nutrition\b/i],
    ["clinical", /^history\s+of\s+present\s+illness|^hpi\b|^chief\s+complaint|^cc\b|^review\s+of\s+systems|^ros\b|^physical\s+exam(?:ination)?|^exam\b|^vitals?|^vital\s+signs|^labs?\b|^lab(?:oratory)?\s+results|^results\b|^imaging|^radiology|^micro(?:biology)?\b|^cultures?\b|^ekg|^ecg|^hospital\s+course|^brief\s+hospital\s+course|^plan\s+of\s+care|^discharge\s+(?:instructions|plan|summary|condition|disposition)|^disposition|^history\s+and\s+physical|^h\s*&\s*p\b|^progress\s+notes?|^consult(?:ation)?\s+notes?|^nursing\s+(?:notes?|assessment)|^therapy\s+notes?|^pt\s+notes?|^ot\s+notes?|^care\s+needs|^skilled\s+needs|^notes?\b|^weight[- ]bearing|^dme\b|^oxygen\b|^lines?\s*(?:\/\s*drains)?\b/i],
    ["demographic", /^patient(?:\s+name)?\b|^resident(?:\s+name)?\b|^date\s+of\s+birth|^dob\b|^mrn\b|^medical\s+record|^referr(?:ing|al)\s+(?:hospital|facility|source|date|physician)|^hospital\b|^physician\b|^plan(?:\s*name)?\s*[:\-]|^policy|^date\s+received|^date\s+of\s+referral|^proposed\s+discharge|^expected\s+admit|^admit(?:\s*date)?\b|^room\b|^bed\b|^unit\b/i],
  ];

  const HEADER_NOISE_RE = /^[\s*•#>\-–—=_]+|[\s*•#>\-–—=_]+$/g;

  // Words that end a short title-like line (generic header fallback).
  const GENERIC_HEADER_TAIL_RE = /\b(?:history|list|information|info|summary|plan|notes?|medications?|exam|results|orders|contacts?|insurance|coverage|problems?|instructions|status|team|course|assessment|reconciliation|directives?)\s*:?\s*$/i;

  function headerParts(line, re) {
    const t = String(line || "").replace(HEADER_NOISE_RE, "").trim();
    const m = t.match(re);
    if (!m || m.index !== 0) return null;
    const after = t.slice(m[0].length);
    const sep = after.match(/^\s*[:\-–]\s*/);
    if (!sep && after.trim()) return null; // "Allergies were reviewed" is prose, not a header
    return { match: m, remainder: (sep ? after.slice(sep[0].length) : "").trim() };
  }

  function detectHeader(line) {
    const raw = String(line || "").trim();
    if (!raw) return null;
    let hp = headerParts(raw, ALLERGY_SECTION_RE);
    if (hp) {
      const label = hp.match[0];
      let remainder = hp.remainder;
      if (/^as\s+of\b/i.test(remainder)) remainder = "";
      return { section: "allergy", label, remainder, typeHint: allergyTypeFromHeader(label) };
    }
    hp = headerParts(raw, PMH_SECTION_RE);
    if (hp) return { section: "pmh", label: hp.match[0], remainder: hp.remainder, isPrimary: false };
    hp = headerParts(raw, DX_SECTION_RE);
    if (hp) {
      const label = hp.match[0];
      const isPrimary = /^(?:primary|principal|admitting|admission|reason\s+for\s+admission)\b/i.test(label) && !/problems?\s*$/i.test(label) || /^principal\s+problem/i.test(label);
      const section = /^(?:assessment|impression|a\s*\/\s*p)/i.test(label) ? "assessment" : "dx";
      return { section, label, remainder: hp.remainder, isPrimary };
    }
    // Diagnosis table header row, e.g. "Dx   ICD-10" or "Code  Description".
    const flat = raw.replace(/[|+_\/.:;,]/g, " ").replace(/\s+/g, " ").trim();
    if (/^(?:(?:dx|diagnosis|diagnoses|description|icd-?10(?:-?cm)?|code|codes|dx\s+code|rank|classification|date|onset|poa|type|status)\s*)+$/i.test(flat) && flat.split(" ").length >= 2 && /\b(?:dx|diagnos|icd|code)/i.test(flat) && /\b(?:dx|diagnos|icd|description)/i.test(flat)) {
      return { section: "dx", label: flat, remainder: "", isPrimary: false, table: true };
    }
    for (const [section, re] of OTHER_SECTIONS) {
      hp = headerParts(raw, re);
      if (hp) return { section, label: hp.match[0], remainder: hp.remainder };
    }
    // Generic: short title-ish line with no digits ending in a header word,
    // e.g. "SURGICAL HISTORY", "Hospital Course".
    const t = raw.replace(HEADER_NOISE_RE, "").trim();
    if (t.length <= 48 && !/\d/.test(t) && t.split(/\s+/).length <= 5 && GENERIC_HEADER_TAIL_RE.test(t)) {
      return { section: "other", label: t, remainder: "" };
    }
    return null;
  }

  // Lines that are never clinical content regardless of section.
  const NON_CLINICAL_LINE_RE = /\b(?:printed\s+(?:by|on)|page\s+\d+\s+of\s+\d+|attending|provider|physician|pcp|isolation|iso\s*:|subscriber|guarantor|payer|payor|insurance|medicaid|medicare|member\s*(?:id|#)|policy|group\s*(?:#|no|number|:)|relation(?:ship)?|mobile|cell\s*(?:phone|#|:)|home\s+work|phone|encounter\s*(?:date|#|no\.?|number|id|type|information|:)|mrn|dob|date\s+of\s+birth|admit\s+date|fax|npi|address|reviewed\s+(?:on|by)|signed\s+by|electronically\s+signed|e-signed|dictated|transcribed|csn|fin\b|acct|account|sex\s*:|age\s*:)\b/i;
  const TIME_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b/i;
  const PHONE_RE = /\(?\b\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b|\b\d{3}[\s.\-]\d{4}\b/;

  function isNonClinicalLine(line) {
    const t = String(line || "");
    return NON_CLINICAL_LINE_RE.test(t) || TIME_RE.test(t) || PHONE_RE.test(t);
  }

  const BLOCKED_SECTIONS = new Set(["contacts", "insurance", "providers", "encounter", "isolation", "demographic"]);

  function segment(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let section = "none";
    let meta = {};
    for (const rawLine of lines) {
      // Normalize tabs and strip scanner/OCR debris at line ends (" .", " :", " |", "_").
      const line = rawLine.replace(/\t/g, "  ").replace(/(?:\s+[.:;,|<>‘’'"_=~])+\s*$/, "").replace(/^[\s._=~|‘’'"]+(?=\S)/, "").replace(/\s+$/, "");
      const trimmed = line.trim();
      if (!trimmed) {
        out.push({ line: "", section, meta, blank: true });
        continue;
      }
      const header = detectHeader(trimmed);
      if (header) {
        section = header.section;
        meta = header;
        out.push({ line: trimmed, section, meta, header });
        continue;
      }
      out.push({ line: trimmed, section, meta });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Diagnoses

  const DX_TABLE_HEADER_RE = /^(?:diagnosis|problem|description|dx|code|rank|classification|type|icd-?10(?:-?cm)?|date(?:\s+(?:noted|resolved|of\s+onset))?|noted|onset|resolved|poa|priority|class|status|hospital|overview|comments?|laterality|chronic|principal|source|\s|\/|-)+$/i;
  const PLAN_LINE_RE = /^(?:continue|cont\.?|start(?:ed)?|begin|monitor|check|obtain|consult|f\/u|follow(?:\s*-?\s*up)?|order(?:ed)?|give|hold|resume|discontinue|d\/c|dc\b|consider|plan|will\b|recommend|appreciate|pt\b|ot\b|pt\/ot|eval(?:uate)?|wound\s+care|elevate|blood\s+cultures?|cultures?|labs?\b|repeat|trend|titrate|admit|discharge|dispo(?:sition)?|encourage|educate|npo|diet|activity|pain\s+control|dvt\s+ppx|ppx|prophylaxis|code\s+status|full\s+code|dnr|iv\b|po\b|abx|antibiotics?|transfuse|wean|keep|maintain|replete|goal|target|serial|daily|bmp|cbc|cmp|xr|x-ray|ct\b|mri|us\b|ultrasound|echo|tte|ekg|ecg|s\/p\s+\d)/i;
  const MED_LINE_RE = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|ml|meq|units?|iu|%)\b|\b(?:tab(?:let)?s?|caps?(?:ule)?s?|susp(?:ension)?|inhaler|patch|by\s+mouth|daily|nightly|bid|tid|qid|prn|q\s*\d+\s*h)\b/i;
  const NOT_A_DX_RE = /^(?:yes|no|none(?:\s+listed)?|unknown|n\/a|na|date|noted|poa|other|see\s+.*|normal|negative|positive|stable|improving|resolved|active|chronic|hcc|cms\/hcc)$/i;

  function cleanDxText(s) {
    let t = stripListMarker(String(s || ""));
    t = t.replace(/^\(?\s*(?:principal|primary|admitting)\s*(?:problem|dx|diagnosis)?\s*\)?\s*[:\-–]?\s*/i, "");
    t = t.replace(/^(?:active|chronic|resolved)\s+problems?\s*[:\-–]\s*/i, "");
    t = t.replace(/\(\s*(?:cms\s*\/\s*)?hcc\s*\)|\bcms\s*\/\s*hcc\b|\(\s*poa\s*\)/gi, " ");
    t = t.replace(/\[[^\]]*\]/g, " ");
    t = t.replace(/\(\s*\)/g, " ");
    t = t.replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, " ");
    t = t.replace(/\b(?:POA\s*[:\-]?\s*)?(?:Yes|No|Y|N|W|U|Exempt)\s*$/i, " ");
    t = t.replace(/\s+/g, " ").trim();
    // Drop OCR debris ("Anxiety 5 --e NT" -> "Anxiety"): cut at the first
    // token that mixes punctuation runs with 0–2 letters, then drop a stray
    // trailing number unless it belongs to the term ("stage 3", "type 2").
    const words = t.split(" ");
    const debrisAt = words.findIndex((w, i) => i > 0 && /^(?:[^A-Za-z0-9\s]{2,}[A-Za-z]{0,2}|[A-Za-z]{0,2}[^A-Za-z0-9\s(),\/]{2,})$/.test(w));
    if (debrisAt > 0 && /[A-Za-z]{3,}/.test(words.slice(0, debrisAt).join(" "))) t = words.slice(0, debrisAt).join(" ");
    let prev;
    do {
      prev = t;
      const m = t.match(/\s+(\S+)$/);
      if (!m) break;
      const last = m[1];
      const before = t.slice(0, m.index);
      const keepNumber = /\b(?:stage|type|grade|class|level|phase|degree|part|zone|t|l|c|s|cervical|thoracic|lumbar|nyha|gold|ckd)\s*$/i.test(before);
      if (/^[^A-Za-z0-9]+$/.test(last) || (/^\d{1,2}$/.test(last) && !keepNumber)) t = before.trim();
    } while (t !== prev && t.length);
    t = t.replace(/^[\s.,;:\/|*\-–—]+|[\s.,;:\/|*\-–—(]+$/g, "").trim();
    if (t.length > 160) t = t.slice(0, 160).trim();
    return t;
  }

  function looksLikeFreeTextDx(t, section) {
    if (!t || t.length < 3) return false;
    if (SKIP_UNCODED_RE.test(t) || NOT_A_DX_RE.test(t)) return false;
    if (!/[A-Za-z]{3,}/.test(t)) return false;
    if (DX_TABLE_HEADER_RE.test(t.replace(/[.:;,]/g, " ").replace(/(?:^|\s)[A-Za-z0-9](?=\s|$)/g, " ").replace(/\s+/g, " ").trim())) return false;
    if (MED_LINE_RE.test(t)) return false;
    if (PLAN_LINE_RE.test(t)) return false;
    if (isNonClinicalLine(t)) return false;
    if (isNkdaText(t)) return false;
    if (detectHeader(t)) return false;
    if (/\bicd-?10\b|\breviewed\b|\bsee\s+(?:above|below)\b/i.test(t)) return false;
    const words = t.split(/\s+/);
    if (words.length > (section === "assessment" ? 8 : 12) || t.length > 110) return false;
    if (/[.!?]\s+[A-Za-z]/.test(t)) return false; // prose sentence
    if (/\b(?:is|was|were|are|has|had|presents?|presented|reports?|denies|states?|patient|pt)\b/i.test(t) && words.length > 4) return false;
    if (/^[A-Z][a-z]+,\s*[A-Z][a-z]+(?:\s+[A-Z]\.?)?$/.test(t)) return false; // "Lastname, First"
    return true;
  }

  const MODIFIER_START_RE = /^(?:s\/p|status\s+post|w\/o|with|without|due\s+to|secondary\s+to|vs\.?|subsequent|initial|sequela|stage|unspecified|type|left|right|bilateral|acute|chronic|not\s|in\s|of\s|on\s|requiring|complicated|uncomplicated|nos\b|mild|moderate|severe)/i;

  function splitFreeTextList(text, { allowComma }) {
    const semi = text.split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
    if (semi.length > 1) return semi;
    if (!allowComma) return [text];
    const parts = text.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return [text];
    if (parts.slice(1).some((p) => MODIFIER_START_RE.test(p) && p.split(/\s+/).length <= 3)) return [text];
    if (parts.some((p) => p.split(/\s+/).length > 6)) return [text];
    return parts;
  }

  function findCodesInLine(line, { inDx }) {
    const found = [];
    const re = new RegExp(ICD_BODY, "gi");
    let m;
    while ((m = re.exec(line))) {
      const raw = m[1];
      const start = m.index;
      const end = start + raw.length;
      const prevCh = line.charAt(start - 1);
      const nextCh = line.charAt(end);
      // Word boundaries, and not glued to digits, colons, hyphens or slashes
      // (times like 4:40, phone or ID fragments, "ICD-10").
      if (/[A-Za-z0-9]/.test(prevCh) || /[A-Za-z0-9]/.test(nextCh)) continue;
      if (/[:\-\/.]/.test(prevCh) && /\d/.test(line.charAt(start - 2))) continue;
      if (nextCh === ":" || (nextCh === "-" && /\d/.test(line.charAt(end + 1)))) continue;
      if (prevCh === "-" && /ICD$/i.test(line.slice(0, start - 1))) continue;
      const before = line.slice(0, start);
      const after = line.slice(end);
      if (/\d[\s\-]*$/.test(before) && /^\s*\d/.test(after)) continue;
      if (/\d{3}\s*$/.test(before) || /^\s*\d{3,4}\b/.test(after)) continue; // phone neighbours
      if (LEFT_CONTEXT_RE.test(before)) continue;
      const code = normalizeIcd10Code(raw);
      if (!code) continue;
      const compact = compactKey(code);
      if (FALSE_POSITIVE_CODES.has(compact) || FREQ_CODE_RE.test(compact)) continue;
      const dotted = raw.includes(".");
      const bracketed = /[\[(]\s*$/.test(before) && /^\s*[\])]/.test(after);
      if (!dotted && raw.length > 3 && !inDx) continue; // undotted long codes only in dx sections
      found.push({ raw, code, index: start, end, dotted, bracketed });
    }
    return found;
  }

  function lineWithoutCodes(line, matches) {
    let rest = line;
    for (const c of matches.slice().sort((a, b) => b.index - a.index)) {
      rest = rest.slice(0, c.index) + " " + rest.slice(c.end);
    }
    return rest;
  }

  const DX_SYNONYMS = [
    [/\b(?:htn|high\s*blood\s*pressure)\b/gi, "hypertension"],
    [/\b(?:t2dm|dm\s*2|dm\s*ii|niddm)\b/gi, "type 2 diabetes mellitus"],
    [/\bdiabetes\b(?!\s+mellitus)/gi, "diabetes mellitus"],
    [/\bchf\b/gi, "heart failure"],
    [/\bcopd\b/gi, "chronic obstructive pulmonary"],
    [/\bckd\b/gi, "chronic kidney"],
    [/\ba-?fib\b/gi, "atrial fibrillation"],
    [/\blle\b/gi, "left lower limb"],
    [/\brle\b/gi, "right lower limb"],
    [/\blue\b/gi, "left upper limb"],
    [/\brue\b/gi, "right upper limb"],
    [/\bextremity\b/gi, "limb"],
    [/\bhyperlipidemia|hld\b/gi, "hyperlipidemia"],
    [/\buti\b/gi, "urinary tract infection"],
  ];

  function expandDx(s) {
    let t = String(s || "");
    for (const [re, to] of DX_SYNONYMS) t = t.replace(re, to);
    return t;
  }

  function contentTokens(s) {
    s = expandDx(s);
    const STOP = new Set(["of", "the", "and", "or", "a", "an", "to", "in", "with", "without", "due", "for", "on", "by", "at", "as", "unspecified", "other", "type", "disorder", "disease", "nos"]);
    return String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
  }

  function coveredBy(freeText, codedItems) {
    const toks = contentTokens(freeText);
    if (!toks.length) return true;
    for (const c of codedItems) {
      const pool = new Set(contentTokens(`${c.description} ${c.sourceText || ""}`));
      const hit = toks.filter((t) => pool.has(t)).length;
      if (hit / toks.length >= 0.8) return true;
    }
    return false;
  }

  /**
   * opts.lookup(code) -> { code, description, billable } | null
   * When a lookup is supplied (the bundled CMS list), codes not in the list are
   * dropped and the official description replaces the document text.
   */
  function extractDiagnoses(text, opts) {
    if (!text) return [];
    const lookup = opts && typeof opts.lookup === "function" ? opts.lookup : null;
    const rows = segment(text);
    const coded = [];
    const free = [];
    let primaryNext = false;
    let sectionPrimaryPending = false;

    const addCoded = (match, row, desc, primary) => {
      let official = null;
      if (lookup) {
        official = lookup(match.code);
        if (!official) return false;
      }
      coded.push({
        code: official ? official.code : match.code,
        description: official ? official.description : desc,
        sourceText: desc,
        primary: !!primary,
        codeStatus: official ? (official.billable === false ? "nonbillable" : "valid") : "",
        codeSource: "found",
        verified: !!official,
      });
      return true;
    };

    // OCR often reads I→1, Z→2, S→5, B→8, O→0 in the first character and
    // O→0 / I,l→1 later on ("[110]" for I10, "279.01" for Z79.01). Only used
    // with the CMS list, and only when the official description matches the
    // words on the line.
    const ocrRepairs = (content) => {
      if (!lookup) return [];
      const out = [];
      const re = /(^|[\s\[(])([0-9A-Za-z][0-9OoIl][0-9A-Za-z](?:\.[0-9A-Za-z]{1,4})?)(?=$|[\s\]),.;])/g;
      let m;
      while ((m = re.exec(content))) {
        const tok = m[2];
        if (normalizeIcd10Code(tok) && lookup(tok)) continue; // already a real code
        const first = { "1": "I", "2": "Z", "5": "S", "8": "B", "0": "O", "l": "I" }[tok[0]] || tok[0].toUpperCase();
        if (!/[A-Z]/.test(first)) continue;
        const restFixed = tok.slice(1).replace(/[Oo]/g, "0").replace(/[Il]/g, "1");
        const fixed = (first + restFixed).toUpperCase();
        const code = normalizeIcd10Code(fixed);
        if (!code) continue;
        const official = lookup(code);
        if (!official) continue;
        const text = content.replace(tok, " ");
        const lineToks = contentTokens(text);
        const offToks = new Set(contentTokens(official.description));
        if (!lineToks.length) continue;
        const hit = lineToks.filter((t) => offToks.has(t)).length;
        if (hit < 1 || hit / lineToks.length < 0.5) continue;
        const start = m.index + m[1].length;
        out.push({ raw: tok, code, index: start, end: start + tok.length, dotted: tok.includes("."), bracketed: true, repaired: true });
      }
      return out;
    };

    const handleContent = (content, row, opts2) => {
      let isPrimaryLine = !!opts2.isPrimaryLine;
      const section = row.section;
      const inDx = section === "dx" || section === "pmh" || section === "assessment";
      if (BLOCKED_SECTIONS.has(section)) return;
      const lineNonClinical = isNonClinicalLine(content);
      const matches = lineNonClinical ? [] : findCodesInLine(content, { inDx });
      if (inDx && !lineNonClinical) {
        const real = lookup ? matches.filter((mm) => lookup(mm.code)) : matches;
        if (!real.length) {
          const fixedCodes = ocrRepairs(content);
          if (fixedCodes.length) { matches.length = 0; matches.push(...fixedCodes); }
        }
      }
      if (inDx && matches.length === 1 && /\s(?:primary|principal)\b/i.test(" " + lineWithoutCodes(content, matches)) && /^[^A-Za-z0-9]*$/.test(content.slice(0, matches[0].index)) && !/primary\s+(?:care|physician|payer|insurance)/i.test(content)) isPrimaryLine = true;
      const rest = cleanDxText(lineWithoutCodes(content, matches).replace(/\s{2,}(?:primary|principal|\d{1,2})\s{2,}.*$/i, " "));
      let anyCoded = false;
      for (const match of matches) {
        if (!inDx && !(match.dotted || match.bracketed)) continue;
        if (!inDx && !lookup) continue; // outside dx sections, only verified codes
        const primary = (isPrimaryLine || sectionPrimaryPending) && !coded.some((c) => c.primary) && !free.some((f) => f.primary);
        const desc = matches.length === 1 ? rest : "";
        if (addCoded(match, row, desc, primary)) {
          anyCoded = true;
          if (primary) sectionPrimaryPending = false;
        }
      }
      if (anyCoded || !inDx) return;
      if (lineNonClinical) return;
      if (section === "assessment" && /^\s*[-–•*]/.test(content)) return; // plan bullets
      const parts = splitFreeTextList(rest, { allowComma: !isPrimaryLine });
      for (const part of parts) {
        const p = cleanDxText(part);
        if (!looksLikeFreeTextDx(p, section)) continue;
        const primary = (isPrimaryLine || sectionPrimaryPending) && !coded.some((c) => c.primary) && !free.some((f) => f.primary);
        free.push({ code: "", description: p, primary, codeSource: "", codeStatus: "", fromSection: section });
        if (primary) sectionPrimaryPending = false;
      }
    };

    for (const row of rows) {
      if (row.blank) continue;
      if (row.header) {
        const h = row.header;
        sectionPrimaryPending = false;
        if (h.section === "dx" || h.section === "pmh" || h.section === "assessment") {
          if (h.isPrimary) sectionPrimaryPending = true;
          if (h.remainder) handleContent(h.remainder, row, { isPrimaryLine: !!h.isPrimary });
          if (h.isPrimary && h.remainder) sectionPrimaryPending = false;
        }
        continue;
      }
      handleContent(row.line, row, { isPrimaryLine: false });
    }

    // Dedupe coded by code; free text by text and against coded items.
    const out = [];
    const seen = new Map();
    for (const c of coded) {
      const key = compactKey(c.code);
      if (seen.has(key)) {
        const prev = seen.get(key);
        if (c.primary) prev.primary = true;
        if (!prev.description && c.description) prev.description = c.description;
        continue;
      }
      seen.set(key, c);
      out.push(c);
    }
    const freeSeen = new Set();
    for (const f of free) {
      const k = f.description.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!k || freeSeen.has(k)) continue;
      if (coveredBy(f.description, out.filter((d) => d.code))) {
        if (f.primary) {
          const match = out.find((d) => d.code && coveredBy(f.description, [d]));
          if (match && !out.some((d) => d.primary)) match.primary = true;
        }
        continue;
      }
      freeSeen.add(k);
      out.push(f);
    }
    // Primary first, exactly one primary at most.
    let primaryKept = false;
    for (const d of out) {
      if (d.primary && !primaryKept) primaryKept = true;
      else d.primary = false;
    }
    out.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
    return out.map((d) => {
      const item = { code: d.code || "", description: d.description || "", primary: !!d.primary };
      if (d.sourceText && d.sourceText !== d.description) item.sourceText = d.sourceText;
      if (d.codeStatus) item.codeStatus = d.codeStatus;
      if (d.codeSource) item.codeSource = d.codeSource;
      if (d.verified) item.verified = true;
      return item;
    });
  }

  // ---------------------------------------------------------------------------
  // Allergies

  const NKDA_RE = /^(?:nka|nkda|nkfa|nkaa|no\s+known\s+(?:drug\s+|food\s+|environmental\s+|medication\s+)?allerg(?:y|ies)|no\s+known\s+(?:drug\s+)?allerg(?:y|ies)\s+(?:on\s+file|reported|documented)|patient\s+has\s+no\s+known\s+allerg(?:y|ies)|denies\s+(?:any\s+)?(?:known\s+)?allerg(?:y|ies)|no\s+allerg(?:y|ies)(?:\s+(?:reported|listed|identified|noted|on\s+file|documented))?|none\s+known|none(?:\s+reported)?|no\s+active\s+allerg(?:y|ies))$/i;

  function isNkdaText(text) {
    const t = cleanLine(String(text || "")).replace(/[.\s]+$/g, "").replace(/\s+/g, " ");
    if (!t) return false;
    if (NKDA_RE.test(t)) return true;
    if (/^(nka|nkda|nkfa)\b/i.test(t) && !/\bexcept\b|\bbut\b/i.test(t)) return true;
    return /\bno\s+known\s+(?:drug\s+|food\s+|medication\s+)?allerg(?:y|ies)\b/i.test(t) && !/\bexcept\b|\bbut\b/i.test(t);
  }

  const SEVERITY_WORD_RE = /\b(mild|moderate|severe|life[- ]threatening|anaphylaxis|anaphylactic(?:\s+shock)?)\b/i;
  const REACTION_WORDS = "rash(?:es)?|hives|urticaria|itch(?:ing|y)?|pruritus|anaphyla(?:xis|ctic(?:\\s+shock)?)|swelling|angioedema|edema|nausea(?:\\s+(?:and|&)\\s+vomiting)?|vomiting|n\\/v|diarrh(?:ea|oea)|gi\\s+upset|upset\\s+stomach|stomach\\s+upset|abdominal\\s+pain|cramp(?:s|ing)?|shortness\\s+of\\s+breath|sob|dyspnea|wheez(?:ing|e)|difficulty\\s+breathing|trouble\\s+breathing|throat\\s+(?:swelling|closing|tightness)|bronchospasm|hypotension|low\\s+blood\\s+pressure|tachycardia|palpitations|bradycardia|dizz(?:y|iness)|lightheaded(?:ness)?|syncope|headache|confusion|delirium|hallucinations?|agitation|drowsiness|sedation|flushing|redness|red\\s+man(?:\\s+syndrome)?|blisters?|stevens[- ]johnson(?:\\s+syndrome)?|sjs|ten\\b|toxic\\s+epidermal|seizures?|myalgias?|muscle\\s+(?:pain|aches?)|rhabdo(?:myolysis)?|cough|bleeding|kidney\\s+(?:injury|failure)|renal\\s+failure|thrombocytopenia|hit\\b|intolerance|sensitivity|unknown|other|see\\s+comments?|not\\s+specified|unspecified";
  const REACTION_RE = new RegExp("\\b(?:" + REACTION_WORDS + ")\\b", "i");
  const CRITICALITY_RE = /\b(?:high|low|unable\s+to\s+assess|not\s+specified|critical|criticality)\b/gi;

  const DRUG_ALLERGEN_RE = /\b(pcn|penicillins?|amox(?:icillin)?|ampicillin|augmentin|sulfa|sulfonamides?|bactrim|tmp-smx|codeine|morphine|oxycodone|hydrocodone|dilaudid|hydromorphone|aspirin|asa|ibuprofen|nsaids?|naproxen|iodine|contrast|lisinopril|enalapril|ace\s*inhibitors?|vancomycin|cipro(?:floxacin)?|levaquin|levofloxacin|heparin|warfarin|coumadin|statins?|atorvastatin|lidocaine|prednisone|dilantin|phenytoin|keppra|levetiracetam|tramadol|demerol|meperidine|clindamycin|keflex|cephalexin|cefazolin|ancef|cephalosporins?|erythromycin|azithromycin|tetracycline|doxycycline|flagyl|metronidazole|gabapentin|haldol|haloperidol|fluoroquinolones?|macrolides?|opioids?|opiates?|antibiotics?)\b/i;
  const FOOD_ALLERGEN_RE = /\b(peanuts?|tree\s+nuts?|nuts|almonds?|walnuts?|cashews?|pecans?|shellfish|shrimp|crab|lobster|fish|milk|dairy|lactose|eggs?|wheat|gluten|soy|sesame|strawberr(?:y|ies)|chocolate)\b/i;
  const ENV_ALLERGEN_RE = /\b(pollen|dust(?:\s+mites?)?|mold|grass(?:es)?|ragweed|cats?|cat\s+dander|dogs?|dog\s+dander|pet\s+dander|bees?|bee\s+stings?|wasps?|hornets?|insect\s+stings?|tape|adhesive(?:\s+tape)?|nickel)\b/i;

  // Things that are never allergens: conditions, procedures, payers, people.
  const NOT_ALLERGEN_RE = /\b(?:cellulitis|mrsa|vre|esbl|c\.?\s?diff|infection|pneumonia|sepsis|hypertension|blood\s+pressure|high\s*blood|diabet\w*|anxiety|depression|dementia|copd|chf|heart\s+failure|ckd|kidney\s+disease|fracture|hernia|repair|appendectomy|cholecystectomy|surgery|surgical|procedure|history|problem|diagnos\w*|risk|readmission|unplanned|isolation|precautions|bugs|subscriber|medicaid|medicare|insurance|payer|payor|plan|policy|member|group|guarantor|relation|spouse|son|daughter|friend|mother|father|sister|brother|contact|phone|mobile|home|work|attending|provider|physician|nurse|rn|md|do|np|pa-c|reviewed|noted|verified|updated|entered|source|comment|comments|date|printed|page|encounter|admit|discharge|room|bed|unit|mrn|dob|medications?|vitals?|labs?|weight|height|code\s+status|full\s+code|social|family|tobacco|alcohol|smoker|lives)\b/i;

  function allergyTypeFromHeader(header) {
    const h = String(header || "").toLowerCase();
    if (/drug|medication/.test(h)) return "drug";
    if (/food/.test(h)) return "food";
    if (/environmental/.test(h)) return "environmental";
    if (/latex/.test(h)) return "latex";
    return "";
  }

  function inferAllergyType(allergen, hint) {
    const a = String(allergen || "");
    if (/\blatex\b/i.test(a)) return "latex";
    if (hint === "food" || hint === "environmental") return hint;
    if (FOOD_ALLERGEN_RE.test(a)) return "food";
    if (DRUG_ALLERGEN_RE.test(a)) return "drug";
    if (ENV_ALLERGEN_RE.test(a)) return "environmental";
    return hint || "other";
  }

  function normalizeSeverity(word) {
    const w = String(word || "").toLowerCase().replace(/_/g, " ");
    if (/anaphyl/.test(w) || /life/.test(w)) return "life-threatening";
    if (/severe/.test(w)) return "severe";
    if (/moderate/.test(w)) return "moderate";
    if (/mild/.test(w)) return "mild";
    return "";
  }

  function isAllergyTableHeader(line) {
    const t = String(line || "").replace(/[|+_\/.:;,]/g, " ").replace(/\s+/g, " ").trim();
    return /^(?:allergens?|allerg(?:y|ies)|substance|agent|drug|reactions?|reaction\s+type|severity|criticality|type|noted|date(?:\s+noted)?|onset|comments?|status|verified|source|\s)+$/i.test(t) && t.split(" ").length >= 2;
  }

  function splitAllergyItems(text) {
    const t = stripListMarker(String(text || "")).trim();
    if (!t) return [];
    const semi = t.split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
    if (semi.length > 1) return semi;
    const parts = [];
    let buf = "";
    let depth = 0;
    for (const ch of t) {
      if (ch === "(") depth += 1;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      if (ch === "," && depth === 0) {
        if (buf.trim()) parts.push(buf.trim());
        buf = "";
        continue;
      }
      buf += ch;
    }
    if (buf.trim()) parts.push(buf.trim());
    return parts.length ? parts : [t];
  }

  function tidy(s) {
    return String(s || "").replace(/\s+/g, " ").replace(/^[\s,;:.\-–—\/(|]+|[\s,;:.\-–—\/(|]+$/g, "").replace(/\(\s*$/, "").trim();
  }

  function parseAllergyItem(raw, typeHint) {
    let t = stripListMarker(String(raw || "")).replace(/\s+/g, " ").trim();
    if (!t || SKIP_UNCODED_RE.test(t) || isNkdaText(t)) return null;
    if (isAllergyTableHeader(t) || detectHeader(t)) return null;
    // Drop dates and trailing criticality / bookkeeping columns.
    t = t.replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, " ").replace(/\b(?:19|20)\d{2}\b/g, " ");
    t = t.replace(/\s+/g, " ").trim();

    let severity = "";
    const sevMatch = t.match(SEVERITY_WORD_RE);
    if (sevMatch) severity = normalizeSeverity(sevMatch[0]);

    let allergen = t;
    let reaction = "";
    const rm = t.match(REACTION_RE);
    const sm = t.match(SEVERITY_WORD_RE);
    const firstIdx = Math.min(rm ? rm.index : Infinity, sm && /anaphyl/i.test(sm[0]) ? sm.index : Infinity);
    if (firstIdx !== Infinity && firstIdx > 0) {
      allergen = t.slice(0, firstIdx);
      let r = t.slice(firstIdx);
      r = r.replace(/\b(?:mild|moderate|severe|life[- ]threatening)\b/gi, " ").replace(CRITICALITY_RE, " ");
      r = r.replace(/[()]/g, " ");
      reaction = tidy(r).toLowerCase();
      if (/anaphyl/.test(reaction)) reaction = reaction.replace(/anaphylactic(?:\s+shock)?/, "anaphylaxis");
    } else {
      // No reaction words: keep the allergen, strip severity / criticality.
      allergen = t.replace(SEVERITY_WORD_RE, " ").replace(CRITICALITY_RE, " ");
    }
    allergen = tidy(allergen.replace(/\(\s*\)/g, " ").replace(/\s+-\s*$/, ""));
    // Unbalanced paren left by a "(rash)" style split.
    if ((allergen.match(/\(/g) || []).length > (allergen.match(/\)/g) || []).length) allergen = tidy(allergen.replace(/\([^)]*$/, ""));
    if (reaction === "unspecified" || reaction === "not specified") reaction = "";

    if (!isPlausibleAllergen(allergen)) return null;
    if (/anaphyl/.test(reaction) && !severity) severity = "life-threatening";
    return { allergen, reaction, severity, type: inferAllergyType(allergen, typeHint) };
  }

  // PointClickCare / form style: "Allergen: X  Category: Drug  Reaction: Y  Severity: Z".
  // Returns undefined when the text is not in that format.
  function parseAllergyKeyValue(raw, hint) {
    const t = String(raw || "");
    if (!/\b(?:reaction|category|severity|type|allergen|substance)\s*:/i.test(t)) return undefined;
    const fields = {};
    const re = /\b(allergen|substance|agent|category|type|reaction|severity|criticality|noted|onset|status|comments?)\s*:\s*/gi;
    const marks = [];
    let m;
    while ((m = re.exec(t))) marks.push({ key: m[1].toLowerCase(), start: m.index, valStart: m.index + m[0].length });
    if (!marks.length) return undefined;
    const lead = t.slice(0, marks[0].start).trim();
    if (lead) fields.allergen = lead;
    marks.forEach((mk, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].start : t.length;
      fields[mk.key] = t.slice(mk.valStart, end).trim();
    });
    const allergen = tidy(fields.allergen || fields.substance || fields.agent || "");
    if (!isPlausibleAllergen(allergen)) return null;
    let reaction = tidy(fields.reaction || "");
    if (reaction && !REACTION_RE.test(reaction)) reaction = "";
    const severity = normalizeSeverity(fields.severity || fields.criticality || "") || (/anaphyl/i.test(reaction) ? "life-threatening" : "");
    const cat = String(fields.category || fields.type || "").toLowerCase();
    const catType = /drug|medication/.test(cat) ? "drug" : /food/.test(cat) ? "food" : /environment/.test(cat) ? "environmental" : /latex/.test(cat) ? "latex" : "";
    return { allergen, reaction: reaction.toLowerCase(), severity, type: catType || inferAllergyType(allergen, hint) };
  }

  function isPlausibleAllergen(a) {
    if (!a || a.length < 2 || a.length > 60) return false;
    if (!/[A-Za-z]{3,}|^[A-Z]{2,}$/.test(a)) return false;
    if (a.split(/\s+/).length > 6) return false;
    if (/^(?:allergen|allergy|allergies|reaction|severity|type|substance|drug|food|agent|none|yes|no)$/i.test(a)) return false;
    if (NOT_ALLERGEN_RE.test(a) && !DRUG_ALLERGEN_RE.test(a) && !FOOD_ALLERGEN_RE.test(a) && !/latex/i.test(a)) return false;
    if (isNonClinicalLine(a)) return false;
    if (MED_LINE_RE.test(a) && /\b\d/.test(a)) return false;
    if (/\d{3,}/.test(a)) return false;
    if (/^[A-Z][a-z]+,\s*[A-Z][a-z]+/.test(a)) return false; // "Lastname, First"
    if (/[:=]/.test(a)) return false;
    return true;
  }

  function blankAllergies() {
    return { status: "unknown", items: [] };
  }

  function formatAllergyItem(item) {
    if (!item || !item.allergen) return "";
    const extra = [item.reaction, item.severity].filter(Boolean).join(", ");
    return extra ? `${item.allergen} (${extra})` : item.allergen;
  }

  function formatAllergies(allergies) {
    if (!allergies || allergies.status === "unknown") return "";
    if (allergies.status === "nkda") return "NKDA";
    return (allergies.items || []).map(formatAllergyItem).filter(Boolean).join("; ");
  }

  const MAX_ALLERGY_BLOCK_LINES = 25;

  function extractAllergies(text) {
    if (!text) return blankAllergies();
    const rows = segment(text);
    const items = [];
    let sawNkda = false;
    let sawSection = false;
    let blockLines = 0;
    let typeHint = "";
    let blockEnded = false;
    let strayLines = 0;

    const addFrom = (raw, hint) => {
      if (!raw) return;
      const kv = parseAllergyKeyValue(raw, hint);
      if (kv !== undefined) { if (kv) items.push(kv); return; }
      if (isNkdaText(raw)) { sawNkda = true; return; }
      if (/^(?:yes|no|n|y)$/i.test(raw.trim())) return;
      for (const part of splitAllergyItems(raw)) {
        if (isNkdaText(part)) { sawNkda = true; continue; }
        const item = parseAllergyItem(part, hint);
        if (item) items.push(item);
      }
    };

    for (const row of rows) {
      if (row.header) {
        if (row.header.section === "allergy") {
          sawSection = true;
          blockLines = 0;
          blockEnded = false;
          strayLines = 0;
          typeHint = row.header.typeHint || "";
          let rem = row.header.remainder;
          const label = row.header.label || "";
          if (/^latex\b/i.test(label) && rem) {
            if (/^(?:no|none|n|negative|denies)$/i.test(rem)) continue;
            if (/^(?:yes|y|positive)$/i.test(rem)) { items.push({ allergen: "Latex", reaction: "", severity: "", type: "latex" }); continue; }
            if (!/latex/i.test(rem) && (REACTION_RE.test(rem) || SEVERITY_WORD_RE.test(rem))) rem = "Latex " + rem;
          }
          if (/^environmental\b/i.test(label)) typeHint = "environmental";
          addFrom(rem, typeHint);
        }
        continue;
      }
      if (row.section !== "allergy" || row.blank || blockEnded) continue;
      blockLines += 1;
      if (blockLines > MAX_ALLERGY_BLOCK_LINES) { blockEnded = true; continue; }
      const line = row.line;
      if (isAllergyTableHeader(line)) continue;
      if (/^(?:reviewed|last\s+reviewed|verified|updated|marked\s+as\s+reviewed|allergies\s+reviewed)\b/i.test(line)) continue;
      // A line that clearly belongs to something else (insurance, contacts,
      // a diagnosis, a procedure) means the allergy list has ended even if the
      // next header was missed by OCR. Stop reading rather than guess.
      if (!isNkdaText(line) && (isNonClinicalLine(line) || (NOT_ALLERGEN_RE.test(line) && !REACTION_RE.test(line) && !DRUG_ALLERGEN_RE.test(line) && !FOOD_ALLERGEN_RE.test(line) && !/latex/i.test(line)))) {
        if (/^(?:reviewed|noted|entered|source)\b/i.test(line)) continue;
        strayLines += 1;
        if (strayLines >= 2) blockEnded = true;
        continue;
      }
      strayLines = 0;
      addFrom(line, typeHint);
    }

    const unique = [];
    const seen = new Set();
    for (const item of items) {
      const key = item.allergen.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    if (unique.length) return { status: "listed", items: unique };
    if (sawNkda) return { status: "nkda", items: [] };
    return { status: "unknown", items: [], sectionFound: sawSection };
  }

  // ---------------------------------------------------------------------------
  // Other fields

  function titleCaseName(s) {
    return String(s || "").toLowerCase().replace(/(^|[\s'\-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }

  const NAME_STOP_RE = /\b(?:hospital|medical|center|health|regional|clinic|facility|referral|insurance|medicare|medicaid|printed|page|face|sheet|history|physical|discharge|summary|unknown|patient|report)\b/i;

  function plausibleName(n) {
    if (!n) return false;
    const t = n.trim();
    if (t.length < 3 || t.length > 60) return false;
    if (NAME_STOP_RE.test(t)) return false;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 5) return false;
    return /^[A-Za-z][A-Za-z' .\-]+$/.test(t);
  }

  function flipName(lastFirst) {
    const m = String(lastFirst || "").match(/^\s*([A-Za-z'\-]+(?:\s+[A-Za-z'\-]+)?)\s*,\s*([A-Za-z'\-]+(?:\s+[A-Za-z'\-.]+){0,2})\s*$/);
    if (!m) return lastFirst;
    return `${m[2]} ${m[1]}`.replace(/\s+/g, " ").trim();
  }

  function extractName(text) {
    const labeled = pick(text, [
      /(?:^|\n)[ \t]*(?:Patient|Resident)\s*Name\s*[:\-]\s*([A-Za-z][A-Za-z' .,\-]{1,80})/i,
      /(?:^|\n)[ \t]*(?:Patient|Resident)\s*[:\-]\s*([A-Za-z][A-Za-z' .,\-]{1,80}?)(?:\s*\(|\s{2,}|\s+(?:MRN|DOB|ID)\b|$)/im,
      /(?:^|\n)[ \t]*Name\s*[:\-]\s*([A-Za-z][A-Za-z' .,\-]{1,80})/i,
    ]);
    if (labeled) {
      let n = labeled.replace(/\s+(?:MRN|DOB|Sex|Age|ID)\b.*$/i, "").trim();
      if (n.includes(",")) n = flipName(n);
      if (/^[A-Z' .\-]+$/.test(n)) n = titleCaseName(n);
      if (plausibleName(n)) return n;
    }
    // Epic banner: "LASTNAME, FIRST MIDDLE  MRN: 123  DOB: ..."
    const banner = String(text).match(/(?:^|\n)[ \t]*([A-Z][A-Za-z'\-]+(?:\s[A-Z][A-Za-z'\-]+)?,\s*[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-.]*){0,2})\s+(?:MRN|DOB|Sex|Age|CSN)\b/);
    if (banner) {
      let n = flipName(banner[1]);
      if (/^[A-Z' .\-]+$/.test(n)) n = titleCaseName(n);
      if (plausibleName(n)) return n;
    }
    return "";
  }

  const DATE_PAT = "(\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4})";

  function pickDate(text, labels, opts) {
    for (const label of labels) {
      const re = new RegExp("(?:^|[\\s|])" + label + "\\s*[:\\-#]?\\s*" + DATE_PAT, "im");
      const m = String(text).match(re);
      if (m) {
        const d = normalizeDob(m[1], opts);
        if (d) return d;
      }
    }
    return "";
  }

  function extractHospital(text) {
    const labeled = pick(text, [
      /Referring\s*(?:Hospital|Facility|Source)\s*[:\-]\s*([^\n]+)/i,
      /Discharg(?:e|ing)\s*(?:From|Hospital|Facility)\s*[:\-]\s*([^\n]+)/i,
      /(?:^|\n)[ \t]*(?:Hospital|Sending\s+Facility|Transferring\s+Facility|Admitting\s+(?:Hospital|Facility))(?:\s*Name)?\s*[:\-]\s*([^\n]+)/i,
    ]);
    if (labeled) return cutAtNextLabel(labeled);
    const lines = String(text).split(/\r?\n/).slice(0, 12);
    for (const raw of lines) {
      let l = raw.trim();
      if (!l || l.length > 80 || /[:@]/.test(l) || /\d{3,}/.test(l)) continue;
      if (/printed|page\s+\d/i.test(l)) continue;
      if (detectHeader(l)) continue; // "Hospital Problems", "Hospital Course"
      if (/\b(?:hospital|medical\s+center|medical\s+centre|health\s+(?:system|center)|regional\s+medical|memorial|infirmary)\b/i.test(l)) {
        l = l.split(/\s{2,}/)[0].replace(/\s+(?:inpatient|outpatient|face\s*sheet|patient\s+face\s*sheet).*$/i, "").trim();
        return /^[A-Z0-9 .,'&\-]+$/.test(l) ? titleCaseName(l).replace(/\bSt\b/g, "St") : l;
      }
    }
    return "";
  }

  // Payer is read from insurance lines only, never from the whole document.
  function payerLines(text) {
    const rows = segment(text);
    const out = [];
    for (const r of rows) {
      if (r.blank) continue;
      const labeled = /^(?:(?:primary|secondary)\s+)?(?:insurance|payer|payor|plan|coverage|financial\s+class)\b/i.test(r.line);
      if (r.section === "insurance" || labeled) out.push(r.header ? r.header.remainder || r.line : r.line);
    }
    return out.join("\n");
  }

  function pickPlan(text) {
    return pick(text, [
      /(?:^|\n)[ \t]*(?:Primary\s+)?Insurance\s*[:\-]\s*([^\n]+)/i,
      /(?:^|\n)[ \t]*(?:Primary\s+)?Payer\s*[:\-]\s*([^\n]+?)(?:\s{2,}|$)/im,
      /(?:^|\n)[ \t]*Plan\s*[:\-]\s*([^\n]+)/i,
    ]);
  }

  function guessPayer(text) {
    const src = payerLines(text);
    const notes = cutAtNextLabel(pickPlan(text) || pickPlan(src));
    if (!src.trim()) return { payer: "", notes: "" };
    const t = src.toLowerCase();
    const hasMed = /medicare/.test(t);
    const hasCaid = /medicaid|medi-cal|medi cal/.test(t);
    const ma = /medicare\s+advantage|\b(?:hmo|ppo|snp|d-snp|mapd)\b|gold\s+plus|humana|aetna\s+medicare|united\s*healthcare\s+medicare|aarp\s+medicare\s+advantage|wellcare|scan\s+health|kaiser/.test(t) && !/supplement|medigap/.test(t);
    if (hasMed && hasCaid) return { payer: "medicare-medicaid", notes };
    if (ma && (hasMed || /humana|wellcare|scan/.test(t))) return { payer: "mco", notes };
    if (hasMed) return { payer: "medicare", notes };
    if (hasCaid) return { payer: "medicaid", notes };
    if (/private\s+pay|self[- ]pay/.test(t)) return { payer: "private-pay", notes };
    if (/aetna|blue\s*cross|bcbs|anthem|united\s*healthcare|uhc|cigna|humana|tricare|commercial|private\s+insurance|employer|ppo|hmo|epo/.test(t)) return { payer: "private", notes };
    return { payer: "", notes };
  }

  // True when the pattern appears at least once without a nearby negation
  // ("no oxygen", "tube feeding not required", "Isolation: none").
  function needMentioned(text, re) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = g.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 24), m.index);
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 28);
      if (m[0].length === 0) { g.lastIndex += 1; continue; }
      if (/\b(?:no|not|denies|without|w\/o|non)\s*[-:]?\s*$/i.test(before)) continue;
      if (/^\s*[:\-]?\s*(?:not\s+(?:required|needed|indicated)|none|no\b|n\/a|discontinued|d\/c)/i.test(after)) continue;
      return true;
    }
    return false;
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

  function extractFields(text, opts) {
    const src = String(text || "");
    const name = extractName(src);
    const thisYear = new Date().getFullYear();
    const dob = pickDate(src, ["Date\\s*of\\s*Birth", "Birth\\s*Date", "DOB", "D\\.O\\.B\\.?"], { minYear: 1900, maxYear: thisYear });
    const hospital = extractHospital(src);
    const diagnoses = extractDiagnoses(src, opts);
    const primary = diagnoses.find((d) => d.primary) || diagnoses[0];
    const diagnosis = formatDiagnosis(primary);
    const dateReceived = pickDate(src, ["Referral\\s*Date", "Date\\s*Received", "Date\\s*of\\s*Referral", "Referral\\s*Received", "Received"], { minYear: 2000, maxYear: thisYear + 1 });
    const expected = pickDate(src, [
      "Proposed\\s*Discharge\\s*Date", "Anticipated\\s*Discharge(?:\\s*Date)?", "Expected\\s*Discharge(?:\\s*Date)?", "Estimated\\s*Discharge(?:\\s*Date)?", "Planned\\s*Discharge(?:\\s*Date)?",
      "Expected\\s*Admit(?:\\s*Date)?", "Anticipated\\s*Admit(?:\\s*Date)?", "Planned\\s*Admit(?:\\s*Date)?", "Projected\\s*Admit(?:\\s*Date)?", "SNF\\s*Admit(?:\\s*Date)?",
    ], { minYear: 2000, maxYear: thisYear + 1 });
    const payerGuess = guessPayer(src);
    const needs = NEED_KEYWORDS.filter((n) => needMentioned(src, n.re)).map((n) => n.id);
    const notes = pick(src, [/(?:^|\n)[ \t]*Notes?\s*[:\-]\s*([^\n]{10,400})/i]);
    const allergies = extractAllergies(src);
    return {
      name,
      dob,
      hospital,
      diagnosis,
      diagnoses,
      allergies,
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
    ICD_CODE_EXACT_RE,
    extractFields,
    extractDiagnoses,
    normalizeIcd10Code,
    isIcd10Shape,
    formatDiagnosis,
    formatDiagnosesList,
    extractAllergies,
    formatAllergies,
    formatAllergyItem,
    blankAllergies,
    isNkdaText,
    pick,
    cleanLine,
    normalizeDob,
    guessPayer,
    segment,
    detectHeader,
  };
});
