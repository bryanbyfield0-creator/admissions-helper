/* On-device ICD-10-CM lookup against the bundled CMS code set.
   No referral text is sent anywhere. Works in the browser and in Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AdmissionsICD = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_URL = "data/icd10cm-fy2027.tsv.gz";
  const DEFAULT_FILE = "data/icd10cm-fy2027.tsv.gz";

  const STOP = new Set(["of", "the", "and", "or", "a", "an", "to", "in", "with", "without", "due", "for", "on", "by", "at", "as", "from", "into"]);

  // Expand common clinical abbreviations and synonyms into official-style phrases
  // before ranking against CMS descriptions. More specific patterns first.
  const EXPANSIONS = [
    { re: /\b(niddm|t2dm|dm2|dm\s*ii|diabetes\s*mellitus\s*type\s*(2|ii)|type\s*(2|ii)\s*(dm|diabetes(?:\s*mellitus)?))\b/g, to: "type 2 diabetes mellitus" },
    { re: /\b(iddm|t1dm|dm1|dm\s*i|diabetes\s*mellitus\s*type\s*(1|i)|type\s*(1|i)\s*(dm|diabetes(?:\s*mellitus)?))\b/g, to: "type 1 diabetes mellitus" },
    { re: /\b(htn|high\s+blood\s+pressure)\b/g, to: "essential hypertension" },
    { re: /\b(chf|congestive\s+heart\s+failure)\b/g, to: "heart failure" },
    { re: /\b(copd|c\.?o\.?p\.?d\.?|chronic\s+obstructive\s+(lung|airway)\s+disease|emphysema)\b/g, to: "chronic obstructive pulmonary disease" },
    { re: /\b(esrd|end[- ]stage\s+renal\s+disease)\b/g, to: "end stage renal disease" },
    { re: /\b(ckd|chronic\s+renal\s+(failure|insufficiency)|crf)\b/g, to: "chronic kidney disease" },
    { re: /\b(aki|acute\s+renal\s+failure|acute\s+kidney\s+failure)\b/g, to: "acute kidney failure" },
    { re: /\b(cva|cerebrovascular\s+accident|cva\s+with)\b/g, to: "cerebral infarction" },
    { re: /\b(tia)\b/g, to: "transient ischemic attack" },
    { re: /\b(a-?fib|afib|a\s+fib|atrial\s+fib)\b/g, to: "atrial fibrillation" },
    { re: /\b(uti)\b/g, to: "urinary tract infection" },
    { re: /\b(bph)\b/g, to: "benign prostatic hyperplasia" },
    { re: /\b(gerd|acid\s+reflux)\b/g, to: "gastro-esophageal reflux disease" },
    { re: /\b(oa|djd|degenerative\s+joint\s+disease)\b/g, to: "osteoarthritis" },
    { re: /\b(s\/p\s+fall|status\s+post\s+fall|history\s+of\s+falls?|hx\s+of\s+falls?)\b/g, to: "history of falling" },
    { re: /\b(alzheimer'?s(?:\s+disease)?|ad\s+dementia)\b/g, to: "alzheimer disease" },
    { re: /\b(parkinson'?s(?:\s+disease)?)\b/g, to: "parkinson disease" },
    { re: /\b(pna|cap|hap|community[- ]acquired\s+pneumonia)\b/g, to: "pneumonia" },
    { re: /\b(pvd|pad|peripheral\s+arterial\s+disease)\b/g, to: "peripheral vascular disease" },
    { re: /\b(cad|ashd|coronary\s+artery\s+disease|atherosclerotic\s+heart\s+disease)\b/g, to: "atherosclerotic heart disease" },
    { re: /\b(hld|hyperlipid(?:a)?emia|high\s+cholesterol|dyslipidemia)\b/g, to: "hyperlipidemia" },
    { re: /\b(osa|obstructive\s+sleep\s+apnea)\b/g, to: "obstructive sleep apnea" },
    { re: /\b(dvt)\b/g, to: "deep vein thrombosis" },
    { re: /\b(pe)\b/g, to: "pulmonary embolism" },
    { re: /\b(mrsa\s+colonization|mrsa\s+carrier)\b/g, to: "carrier of methicillin resistant staphylococcus aureus" },
    { re: /\b(mrsa)\b/g, to: "methicillin resistant staphylococcus aureus infection" },
    { re: /\b(hx\s+of|h\/o|history\s+of)\b/g, to: "personal history of" },
    { re: /\b(s\/p|status\s+post)\b/g, to: "status post" },
    { re: /\b(dm)\b/g, to: "diabetes mellitus" },
    { re: /\bfx\b/g, to: "fracture" },
  ];

  // High-confidence preferred billable codes for common, unspecified SNF phrasing.
  // Still verified against the official set at suggest time.
  const PREFERRED = [
    { re: /\bpulmonary\s+hypertension\b/i, code: "I27.20" },
    { re: /\b(essential\s+)?hypertension\b/i, except: /\b(pulmonary|portal|intracranial|gestational|renovascular|secondary)\b/i, code: "I10" },
    { re: /\btype\s*2\s*diabetes(?:\s*mellitus)?\b/i, except: /\b(ketoacidosis|nephropathy|retinopathy|neuropathy|circulatory|foot|hypoglycemia|coma|complication)\b/i, code: "E11.9" },
    { re: /\btype\s*1\s*diabetes(?:\s*mellitus)?\b/i, except: /\b(ketoacidosis|nephropathy|retinopathy|neuropathy|circulatory|foot|hypoglycemia|coma|complication)\b/i, code: "E10.9" },
    { re: /\bheart\s+failure\b/i, except: /\b(systolic|diastolic|combined|preserved|reduced|ejection|left|right|acute\s+on|acute\b|chronic\b)\b/i, code: "I50.9" },
    { re: /\bchronic\s+obstructive\s+pulmonary\s+disease\b/i, except: /\b(with\s+acute|asthma|bronchitis)\b/i, code: "J44.9" },
    { re: /\bunspecified\s+dementia|^dementia\b/i, except: /\b(alzheimer|vascular|lewy|behavioral|psychotic|mood|anxiety|mild|moderate|severe|with)\b/i, code: "F03.90" },
    { re: /\burinary\s+tract\s+infection\b/i, except: /\b(kidney|pyelo|site\s+specified|catheter)\b/i, code: "N39.0" },
    { re: /\batrial\s+fibrillation\b/i, except: /\b(paroxysmal|persistent|chronic|typical|atypical|flutter|permanent|longstanding)\b/i, code: "I48.91" },
    { re: /\bchronic\s+kidney\s+disease,\s*stage\s*3a\b|\bstage\s*3a\b/i, code: "N18.31" },
    { re: /\bchronic\s+kidney\s+disease,\s*stage\s*3b\b|\bstage\s*3b\b/i, code: "N18.32" },
    { re: /\bchronic\s+kidney\s+disease(?:[,\s]+stage\s*3(?:\s|\b|,|$))/i, except: /\b(3a|3b)\b/i, code: "N18.30" },
    { re: /\bend\s*stage\s+renal\s+disease\b|\bchronic\s+kidney\s+disease,\s*stage\s*5\b/i, code: "N18.6" },
    { re: /\bchronic\s+kidney\s+disease,\s*stage\s*4\b/i, code: "N18.4" },
    { re: /\bchronic\s+kidney\s+disease\b/i, except: /\bstage\b/, code: "N18.9" },
    { re: /\bbenign\s+prostatic\s+hyperplasia\b/i, except: /\b(obstruct|urinary|retention|hematuria)\b/i, code: "N40.0" },
    { re: /\bgastro-?esophageal\s+reflux\s+disease\b/i, except: /\b(esophagitis)\b/i, code: "K21.9" },
    { re: /\bhistory\s+of\s+falling\b/i, code: "Z91.81" },
    { re: /\balzheimer\s+disease\b/i, except: /\b(early|late|onset)\b/i, code: "G30.9" },
    { re: /\bparkinson\s+disease\b/i, code: "G20.C" },
    { re: /\bpneumonia\b/i, except: /\b(viral|bacterial|strepto|staph|klebsiella|pseudomonas|covid|aspiration|ventilator|influenza)\b/i, code: "J18.9" },
    { re: /\bsepsis\b/i, except: /\b(severe|shock|strepto|staph|gram|newborn|puerperal)\b/i, code: "A41.9" },
    { re: /\bperipheral\s+vascular\s+disease\b/i, code: "I73.9" },
    { re: /\bhyperlipidemia\b/i, except: /\b(pure|mixed|familial)\b/i, code: "E78.5" },
    { re: /\bobstructive\s+sleep\s+apnea\b/i, except: /\b(pediatric|hypopnea)\b/i, code: "G47.33" },
    { re: /\bhypothyroidism\b/i, except: /\b(congenital|iodine|postprocedural)\b/i, code: "E03.9" },
    { re: /\banemia\b/i, except: /\b(iron|b12|folate|acute|chronic|hemolytic|sickle|aplastic|deficiency)\b/i, code: "D64.9" },
  ];

  let bundle = null;
  let loadPromise = null;

  function compact(code) {
    return String(code || "").toUpperCase().replace(/\./g, "");
  }

  function dotted(code) {
    const raw = compact(code);
    if (!raw) return "";
    return raw.length <= 3 ? raw : `${raw.slice(0, 3)}.${raw.slice(3)}`;
  }

  function normalizeText(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function expandText(s) {
    let out = normalizeText(s);
    for (const rule of EXPANSIONS) {
      out = out.replace(rule.re, rule.to);
    }
    return normalizeText(out);
  }

  function tokens(s) {
    return normalizeText(s).split(" ").filter((t) => t && t.length >= 2 && !STOP.has(t));
  }

  function queryLooksUnspecified(text) {
    const t = normalizeText(text);
    if (/\b(stage\s*3[ab]|left|right|bilateral|acute|chronic|systolic|diastolic|paroxysmal|persistent|with\s+complication|ketoacidosis|aspiration|severe|moderate|mild)\b/.test(t)) {
      // stage 3 without a/b is still unspecified; "chronic kidney disease stage 3" should stay unspecified
      if (/\bstage\s*3\b/.test(t) && !/\bstage\s*3[ab]\b/.test(t) && !/\b(left|right|systolic|diastolic)\b/.test(t)) return true;
      if (/\bstage\s*3\b/.test(t) && /\b(3a|3b)\b/.test(t)) return false;
      if (/\bstage\s*3\b/.test(t) && !/\b3[ab]\b/.test(t)) return true;
      return false;
    }
    return true;
  }

  function isUnspecifiedEntry(entry) {
    const d = entry.norm;
    if (/\b(unspecified|unsp|site not specified|without complications)\b/.test(d)) return true;
    // .9 / .90 / x9 style billable leftovers
    return /\.9[0A-Z]?$/.test(entry.code) || /9$/.test(entry.compact) && entry.compact.length <= 5;
  }

  function hasExtraSpecificity(entry, queryTokens) {
    const extra = ["ketoacidosis", "nephropathy", "retinopathy", "neuropathy", "paroxysmal", "persistent", "systolic", "diastolic", "aspiration", "bacterial", "viral", "behavioral", "psychotic"];
    const q = new Set(queryTokens);
    return extra.some((w) => entry.tokenSet.has(w) && !q.has(w));
  }

  function parseTsv(text) {
    const entries = [];
    const byCompact = new Map();
    const byNormDesc = new Map();
    const tokenIndex = new Map();
    let source = "";
    const lines = String(text).split(/\r?\n/);
    for (const line of lines) {
      if (!line) continue;
      if (line.charAt(0) === "#") {
        if (/Source zip:/i.test(line)) source = line.replace(/^#\s*/, "");
        continue;
      }
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const code = parts[0].trim().toUpperCase();
      const billable = parts[1].trim() === "1";
      const description = parts.slice(2).join("\t").trim();
      if (!code) continue;
      const entry = {
        code,
        compact: compact(code),
        billable,
        description,
        norm: normalizeText(description),
        tokens: tokens(description),
      };
      entry.tokenSet = new Set(entry.tokens);
      const idx = entries.length;
      entries.push(entry);
      if (!byCompact.has(entry.compact)) byCompact.set(entry.compact, entry);
      if (entry.norm) {
        const list = byNormDesc.get(entry.norm) || [];
        list.push(idx);
        byNormDesc.set(entry.norm, list);
      }
      const seen = new Set();
      for (const tok of entry.tokens) {
        if (seen.has(tok)) continue;
        seen.add(tok);
        const bucket = tokenIndex.get(tok);
        if (bucket) bucket.push(idx);
        else tokenIndex.set(tok, [idx]);
      }
    }
    return { source, year: "FY2027", entries, byCompact, byNormDesc, tokenIndex };
  }

  function setBundle(parsed) {
    bundle = parsed;
    return bundle;
  }

  function isGzip(bytes) {
    return bytes && bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  }

  async function gunzipBytes(bytes) {
    if (typeof DecompressionStream === "function") {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new TextDecoder("utf-8").decode(await new Response(stream).arrayBuffer());
    }
    const zlib = require("zlib");
    return zlib.gunzipSync(Buffer.from(bytes)).toString("utf8");
  }

  async function loadFromBytes(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const text = isGzip(bytes) ? await gunzipBytes(bytes) : new TextDecoder("utf-8").decode(bytes);
    return setBundle(parseTsv(text));
  }

  async function loadFromUrl(url) {
    const res = await fetch(url || DEFAULT_URL);
    if (!res.ok) throw new Error("The ICD-10-CM code set could not be loaded from this site.");
    return loadFromBytes(await res.arrayBuffer());
  }

  async function loadFromFile(filePath) {
    const fs = require("fs");
    const path = require("path");
    const target = filePath || path.join(__dirname, DEFAULT_FILE);
    return loadFromBytes(fs.readFileSync(target));
  }

  function ensureLoaded(opts) {
    if (bundle) return Promise.resolve(bundle);
    if (loadPromise) return loadPromise;
    const options = opts || {};
    if (options.tsv) {
      loadPromise = Promise.resolve(setBundle(parseTsv(options.tsv)));
    } else if (typeof options.buffer !== "undefined") {
      loadPromise = loadFromBytes(options.buffer);
    } else if (typeof process !== "undefined" && process.versions && process.versions.node && !options.url) {
      loadPromise = loadFromFile(options.file);
    } else {
      loadPromise = loadFromUrl(options.url || DEFAULT_URL);
    }
    return loadPromise.catch((err) => {
      loadPromise = null;
      throw err;
    });
  }

  function isReady() {
    return !!bundle;
  }

  function getBundle() {
    return bundle;
  }

  function lookup(code) {
    if (!bundle || !code) return null;
    return bundle.byCompact.get(compact(code)) || null;
  }

  function validate(code) {
    const dottedCode = dotted(code);
    if (!dottedCode) return { code: "", status: "invalid", billable: false, description: "" };
    const entry = lookup(dottedCode);
    if (!entry) return { code: dottedCode, status: "invalid", billable: false, description: "" };
    return {
      code: entry.code,
      status: entry.billable ? "valid" : "nonbillable",
      billable: entry.billable,
      description: entry.description,
    };
  }

  function billableChildren(headerCode, limit) {
    if (!bundle) return [];
    const prefix = compact(headerCode);
    if (!prefix) return [];
    const out = [];
    const start = bundle.entries.findIndex((e) => e.compact === prefix);
    const from = start >= 0 ? start + 1 : 0;
    for (let i = from; i < bundle.entries.length; i++) {
      const entry = bundle.entries[i];
      if (!entry.compact.startsWith(prefix)) {
        if (start >= 0) break;
        continue;
      }
      if (entry.compact === prefix) continue;
      if (entry.billable) out.push(entry);
    }
    if (limit && out.length > limit) {
      return out.slice().sort((a, b) => {
        const au = isUnspecifiedEntry(a) ? 1 : 0;
        const bu = isUnspecifiedEntry(b) ? 1 : 0;
        if (au !== bu) return bu - au;
        return a.code.localeCompare(b.code);
      }).slice(0, limit);
    }
    return out;
  }

  function preferredCode(text) {
    const expanded = expandText(text);
    for (const rule of PREFERRED) {
      if (rule.except && rule.except.test(expanded)) continue;
      if (rule.re.test(expanded)) return rule.code;
    }
    return "";
  }

  function scoreEntry(entry, queryNorm, queryTokens, unspecified) {
    const desc = entry.norm;
    let s = 0;
    if (desc === queryNorm) s += 220;
    else if (desc.startsWith(queryNorm) || queryNorm.startsWith(desc)) s += 110;
    else if (desc.includes(queryNorm) && queryNorm.length >= 8) s += 70;

    let overlap = 0;
    for (const tok of queryTokens) {
      if (entry.tokenSet.has(tok)) overlap += 1;
    }
    const union = entry.tokens.length + queryTokens.length - overlap;
    if (queryTokens.length) {
      s += (overlap / queryTokens.length) * 60;
      if (union > 0) s += (overlap / union) * 30;
    }
    if (queryTokens.length && overlap === queryTokens.length) s += 24;
    if (entry.billable) s += 10;
    else s -= 16;
    if (unspecified && isUnspecifiedEntry(entry)) s += 12;
    if (unspecified && hasExtraSpecificity(entry, queryTokens)) s -= 18;
    return s;
  }

  function uniqueByCode(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const key = item.compact || compact(item.code);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function toHit(entry, score, why) {
    return {
      code: entry.code,
      description: entry.description,
      billable: entry.billable,
      score,
      why: why || "",
    };
  }

  function suggest(text, opts) {
    if (!bundle) return [];
    const options = opts || {};
    const limit = options.limit || 5;
    const qRaw = String(text || "").trim();
    if (!qRaw) return [];

    const expanded = expandText(qRaw);
    const queryTokens = tokens(expanded);
    const unspecified = queryLooksUnspecified(qRaw + " " + expanded);
    const hits = [];

    const pref = options.preferred || preferredCode(qRaw) || preferredCode(expanded);
    if (pref) {
      const entry = lookup(pref);
      if (entry) {
        hits.push(toHit(entry, 1000, "preferred"));
        if (!entry.billable) {
          for (const child of billableChildren(entry.code, 8)) {
            hits.push(toHit(child, 800 + scoreEntry(child, expanded, queryTokens, unspecified), "child"));
          }
        }
      }
    }

    const exact = bundle.byNormDesc.get(expanded) || bundle.byNormDesc.get(normalizeText(qRaw)) || [];
    for (const idx of exact) {
      const entry = bundle.entries[idx];
      hits.push(toHit(entry, 900 + (entry.billable ? 20 : 0), "exact"));
      if (!entry.billable) {
        const children = billableChildren(entry.code, 8);
        children.sort((a, b) => scoreEntry(b, expanded, queryTokens, unspecified) - scoreEntry(a, expanded, queryTokens, unspecified));
        for (const child of children.slice(0, 5)) {
          hits.push(toHit(child, 850 + scoreEntry(child, expanded, queryTokens, unspecified), "child"));
        }
      }
    }

    let candidates = new Set();
    const indexTokens = queryTokens.length ? queryTokens : tokens(expanded);
    indexTokens.sort((a, b) => (bundle.tokenIndex.get(a) || []).length - (bundle.tokenIndex.get(b) || []).length);
    for (const tok of indexTokens.slice(0, 6)) {
      const bucket = bundle.tokenIndex.get(tok);
      if (!bucket || bucket.length > 8000) continue;
      if (!candidates.size) {
        for (const idx of bucket) candidates.add(idx);
      } else {
        const next = new Set();
        for (const idx of bucket) if (candidates.has(idx)) next.add(idx);
        // If intersection is too small, keep the union of both
        if (next.size >= 3 || !candidates.size) candidates = next.size ? next : candidates;
        else {
          for (const idx of bucket) candidates.add(idx);
        }
      }
    }
    if (!candidates.size && indexTokens.length) {
      const bucket = bundle.tokenIndex.get(indexTokens[0]) || [];
      for (const idx of bucket.slice(0, 2000)) candidates.add(idx);
    }

    const scored = [];
    for (const idx of candidates) {
      const entry = bundle.entries[idx];
      const sc = scoreEntry(entry, expanded, queryTokens, unspecified);
      if (sc >= 28) scored.push(toHit(entry, sc, "search"));
    }
    scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
    for (const hit of scored.slice(0, Math.max(limit * 4, 20))) hits.push(hit);

    const merged = uniqueByCode(hits);
    merged.sort((a, b) => {
      if (pref && a.code === dotted(pref)) return -1;
      if (pref && b.code === dotted(pref)) return 1;
      if (a.billable !== b.billable) return a.billable ? -1 : 1;
      return b.score - a.score || a.code.localeCompare(b.code);
    });
    return merged.slice(0, limit);
  }

  function search(query, opts) {
    if (!bundle) return [];
    const options = opts || {};
    const limit = options.limit || 8;
    const q = String(query || "").trim();
    if (!q) return [];
    const asCode = dotted(q);
    if (/^[A-Za-z][0-9]/.test(q) && compact(q).length >= 2) {
      const prefix = compact(q);
      const out = [];
      for (const entry of bundle.entries) {
        if (entry.compact.startsWith(prefix)) out.push(toHit(entry, entry.billable ? 2 : 1, "code"));
        if (out.length >= 80) break;
      }
      out.sort((a, b) => {
        if (a.billable !== b.billable) return a.billable ? -1 : 1;
        return a.code.length - b.code.length || a.code.localeCompare(b.code);
      });
      const exact = lookup(asCode);
      const hits = exact ? [toHit(exact, 10, "code"), ...out] : out;
      return uniqueByCode(hits).slice(0, limit);
    }
    return suggest(q, { limit });
  }

  function applyToDiagnoses(diagnoses, opts) {
    const options = opts || {};
    const limit = options.limit || 5;
    return (diagnoses || []).map((d) => {
      const next = Object.assign({}, d);
      // Keep alternatives already chosen for a suggested code (from the curated list).
      const suggestions = next.codeSource === "suggested" && Array.isArray(d.suggestions) ? d.suggestions.slice() : [];
      if (next.code) {
        const v = validate(next.code);
        next.code = v.code || next.code;
        next.codeSource = next.codeSource || "found";
        next.codeStatus = v.status;
        if (v.description && !next.officialDescription) next.officialDescription = v.description;
        if (v.status === "nonbillable" || v.status === "invalid" || next.codeSource === "suggested") {
          const from = suggest(next.description || next.code, { limit });
          for (const hit of from) if (!suggestions.some((x) => x.code === hit.code)) suggestions.push(hit);
        }
      } else if (next.description) {
        const from = suggest(next.description, { limit });
        for (const hit of from) suggestions.push(hit);
        if (options.autofill === false) {
          // Leave the diagnosis uncoded; suggestions are offered in the picker.
        } else if (from[0] && from[0].billable) {
          next.code = from[0].code;
          next.codeSource = "suggested";
          next.codeStatus = "valid";
          next.officialDescription = from[0].description;
        } else if (from[0]) {
          next.code = from[0].code;
          next.codeSource = "suggested";
          next.codeStatus = from[0].billable ? "valid" : "nonbillable";
          next.officialDescription = from[0].description;
        }
      }
      next.suggestions = suggestions;
      return next;
    });
  }

  return {
    DEFAULT_URL,
    DEFAULT_FILE,
    normalizeText,
    expandText,
    dotted,
    compact,
    parseTsv,
    loadFromBytes,
    loadFromUrl,
    loadFromFile,
    ensureLoaded,
    isReady,
    getBundle,
    lookup,
    validate,
    suggest,
    search,
    preferredCode,
    applyToDiagnoses,
    billableChildren,
  };
});
