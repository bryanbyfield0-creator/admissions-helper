// Diagnosis names to suggested ICD-10-CM codes: Epic names-only discharge
// summary with (HCC) tags, negation, family history, rule-out, laterality,
// whole-document code fallback (no dot, OCR lookalikes), and zero junk.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const X = require("../extract.js");
const D = require("../dxnames.js");
const I = require("../icd10.js");
const F = (n) => fs.readFileSync(path.join(__dirname, "fixtures", "names", n), "utf8");
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("ok  - " + name); } catch (e) { fail++; console.error("FAIL - " + name + "\n" + e.message); } };

(async () => {
  await I.ensureLoaded();
  const lookup = (c) => { const e = I.lookup(c); return e ? { code: e.code, description: e.description, billable: e.billable } : null; };
  const opts = { lookup, suggest: I.suggest };
  const codesOf = (r) => r.diagnoses.map((d) => d.code);

  t("every curated code is in the CMS ICD-10-CM list", () => {
    const bad = D.codesInRules().filter((c) => !I.lookup(c));
    assert.deepStrictEqual(bad, []);
    assert.ok(D.RULES.length >= 300, `only ${D.RULES.length} rules`);
  });

  t("Epic names-only discharge summary gets suggested codes, ranked, with no junk", () => {
    const trace = {};
    const r = X.extractFields(F("epic-ds-names-only.txt"), Object.assign({ trace }, opts));
    const codes = codesOf(r);
    assert.deepStrictEqual(codes.slice(0, 5), ["I50.33", "L03.116", "J44.1", "E11.65", "N17.9"], codes.join(","));
    assert.strictEqual(r.diagnoses[0].primary, true, "principal problem is primary");
    for (const c of ["I10", "E78.5", "I48.0", "M17.11"]) assert.ok(codes.includes(c), `PMH ${c} missing: ${codes}`);
    // Family history, ROS negations and rule-out never become diagnoses.
    for (const c of ["C50.919", "I63.9", "R56.9", "G40.909", "I82.409", "J18.9"]) assert.ok(!codes.includes(c), `junk ${c}: ${codes}`);
    for (const d of r.diagnoses) {
      assert.strictEqual(d.codeSource, "suggested");
      assert.ok(!/hcc|cms/i.test(d.description), d.description);
      assert.ok(d.suggestions && d.suggestions.length >= 1, `alternatives for ${d.code}`);
    }
    assert.ok(trace.sections.some((s) => s.section === "dx"), "sections traced");
    assert.strictEqual(r.allergies.items[0].allergen.toLowerCase().startsWith("penicillin"), true);
  });

  t("laterality picks the most specific code", () => {
    const m = (s) => D.match(s, { lookup }).map((x) => x.code);
    assert.deepStrictEqual(m("RLE cellulitis"), ["L03.115"]);
    assert.deepStrictEqual(m("Cellulitis of left lower leg"), ["L03.116"]);
    assert.deepStrictEqual(m("Left hip fracture"), ["S72.002A"]);
    assert.deepStrictEqual(m("s/p right TKA"), ["Z96.651"]);
  });

  t("negation, family history and rule-out are skipped", () => {
    const neg = (s) => D.match(s, { lookup }).every((x) => x.negated);
    for (const s of ["no history of stroke", "denies chest pain or CHF", "r/o pneumonia", "Mother had dementia", "pneumonia was ruled out", "negative for DVT"]) assert.ok(neg(s), s);
    assert.ok(!D.match("history of CVA", { lookup })[0].negated);
  });

  t("whole-document pass reads undotted and bracketed codes, ignores rooms, labs and IDs", () => {
    const r = X.extractFields(F("no-sections-codes.txt"), opts);
    assert.deepStrictEqual(codesOf(r).sort(), ["E11.9", "I10", "L03.116"]);
  });

  t("OCR lookalikes (1IO, L03.l16) are repaired only when words match", () => {
    const r = X.extractFields(F("ocr-variants.txt"), opts);
    assert.deepStrictEqual(codesOf(r).sort(), ["I10", "L03.116"]);
  });

  console.log(`\n${pass} name-to-code tests passed, ${fail} failed.`);
  if (fail) process.exit(1);
})();
