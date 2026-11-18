#!/usr/bin/env node
"use strict";
/* Precision tests on synthetic hospital referrals (Epic face sheet + H&P,
   PointClickCare admission record, case-manager email, and the OCR text the
   app's own on-device reader produced from noisy scanned PDFs of them).
   All names and numbers are fictional. */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const extract = require("../extract.js");
const icd = require("../icd10.js");

const DIR = path.join(__dirname, "fixtures", "epic");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("ok  - " + name);
  } catch (err) {
    failed += 1;
    console.error("FAIL - " + name);
    console.error(err && err.stack ? err.stack : err);
  }
}

// Junk seen in Bryan's real referral (and look-alikes in these fixtures).
const JUNK_CODES = ["U40", "G76", "Y92.029", "B06", "J45", "N18", "C25", "W19", "S72", "F32", "E10", "Z87.891234"];
const JUNK_DX_TEXT = /printed|sullivan|holloway|contacts?\b|relation|home work|mobile|friend|spouse|attending|provider|isolation|cont iso|subscriber|guarantor|medicaid|medicare|payer|group|policy|\b\d{3}[-\s]\d{4}\b|\d{1,2}:\d{2}|page \d|surgical history|hernia|appendectomy|cholecystectomy|cataract|metformin|amlodipine|vancomycin|continue|wound care|pt\/ot|diagnosis date|procedure|laterality|^date$|code\.?\s*:?\s*description/i;
const JUNK_ALLERGY = /mrsa|cellulitis|\bbugs\b|medicaid|medicare|subscriber|groubs|risk|unplann|anxiety|blood\s*press|pressur|surgical|hernia|history|problem|repair|reviewed|holloway|allergen reactions|diagnosis|hypertension|diabetes|metformin|amlodipine|payer|tedpatric/i;

function assertNoJunk(fields, label) {
  for (const d of fields.diagnoses) {
    assert.ok(d.code !== "ICD-10", `${label}: literal ICD-10 as a code`);
    assert.ok(!JUNK_CODES.includes(d.code), `${label}: junk code ${d.code} (${d.description})`);
    if (d.code) assert.ok(extract.isIcd10Shape(d.code), `${label}: bad code shape ${d.code}`);
    assert.ok(!JUNK_DX_TEXT.test(d.description), `${label}: junk diagnosis text "${d.description}"`);
  }
  for (const a of fields.allergies.items) {
    assert.ok(!JUNK_ALLERGY.test(a.allergen), `${label}: junk allergen "${a.allergen}"`);
    assert.ok(!/\d{1,2}\/\d{1,2}\/\d{2,4}|medicaid|medicare|\bmt\b/i.test(a.reaction), `${label}: junk reaction "${a.reaction}" on ${a.allergen}`);
  }
}

const EXPECT = {
  "epic-cellulitis": {
    name: "Mateo Andres Delacruz", dob: "1959-06-02", hospital: "Northvale Regional Medical Center",
    payer: "medicaid", dateReceived: "", expectedAdmitDate: "",
    codes: ["L03.116", "I10", "E11.9", "F41.9"], primary: "L03.116",
    free: ["Concern for MRSA"],
    allergyStatus: "listed",
    allergies: [["Penicillins", "hives"], ["Sulfa (Sulfonamide Antibiotics)", "rash"], ["Lisinopril", "swelling"]],
    needs: ["pt", "ot", "wound", "iv", "isolation"],
  },
  "epic-nkda": {
    name: "Evelyn Joan Pruitt", dob: "1940-02-19", hospital: "Lakeshore Community Hospital",
    payer: "medicare", dateReceived: "", expectedAdmitDate: "",
    codes: ["I50.33", "N18.31"], primary: null,
    free: ["Atrial fibrillation", "Hypothyroidism", "Generalized weakness"],
    allergyStatus: "nkda", allergies: [],
    needs: [],
  },
  "epic-table": {
    name: "Samuel Okonkwo", dob: "1948-09-30", hospital: "St. Odile Hospital",
    payer: "mco", dateReceived: "", expectedAdmitDate: "",
    codes: ["S72.001A", "F03.90", "J44.9"], primary: null,
    free: ["History of falling"],
    allergyStatus: "listed",
    allergies: [["Codeine", "nausea and vomiting", "moderate"], ["Morphine", "itching", "mild"], ["Aspirin", ""], ["Latex", "anaphylaxis", "life-threatening"]],
    needs: ["isolation"],
  },
  "pcc-facesheet": {
    name: "Margaret L Hartley", dob: "1937-04-07", hospital: "Cedar Ridge Medical Center",
    payer: "medicare", dateReceived: "2026-11-17", expectedAdmitDate: "2026-11-20",
    codes: ["I63.9", "R13.12", "I48.91", "Z79.01", "E78.5"], primary: "I63.9",
    free: [],
    allergyStatus: "listed",
    allergies: [["Penicillin", "hives", "moderate"], ["Shellfish", "throat swelling", "severe"], ["Adhesive tape", "skin redness"]],
    needs: ["pt", "ot", "st"],
  },
  "referral-email": {
    name: "Robert T. Nguyen", dob: "1945-12-01", hospital: "Harbor View Hospital",
    payer: "medicare-medicaid", dateReceived: "2026-11-18", expectedAdmitDate: "2026-11-19",
    codes: [], primary: null,
    free: ["Sepsis due to UTI", "acute kidney injury", "Type 2 diabetes mellitus"],
    allergyStatus: "nkda", allergies: [],
    needs: ["pt", "ot", "iv"],
  },
  "epic-allergy-first": {
    name: "Tomas Elias Ramos", dob: "1956-01-22", hospital: "Quail Creek Medical Center",
    payer: "", dateReceived: "", expectedAdmitDate: "",
    codes: ["L03.116", "A49.02", "I10"], primary: null,
    free: [],
    allergyStatus: "listed",
    allergies: [["Codeine", "nausea"], ["Vancomycin", "red man syndrome"]],
    needs: ["isolation"],
  },
  "no-allergy-section": {
    name: "Harold B. Finch", dob: "1950-05-05", hospital: "Mount Pleasant Hospital",
    payer: "private", dateReceived: "", expectedAdmitDate: "",
    codes: ["Z47.1"], primary: "Z47.1",
    free: [],
    allergyStatus: "unknown", allergies: [],
    needs: ["pt"],
  },
};

// OCR output from the app's real reader. OCR is allowed to garble the
// hospital's accent ("Médical"), nothing else.
const OCR_FILES = {
  "epic-cellulitis-scan.ocr.txt": "epic-cellulitis",
  "pcc-facesheet-scan.ocr.txt": "pcc-facesheet",
  "epic-nkda-scan.ocr.txt": "epic-nkda",
};

function checkExpected(fields, exp, label, { ocr = false } = {}) {
  assert.strictEqual(fields.name, exp.name, `${label}: name`);
  assert.strictEqual(fields.dob, exp.dob, `${label}: dob`);
  if (ocr) assert.strictEqual(fields.hospital.normalize("NFD").replace(/[\u0300-\u036f]/g, ""), exp.hospital, `${label}: hospital`);
  else assert.strictEqual(fields.hospital, exp.hospital, `${label}: hospital`);
  assert.strictEqual(fields.payer, exp.payer, `${label}: payer`);
  assert.strictEqual(fields.dateReceived, exp.dateReceived, `${label}: date received`);
  assert.strictEqual(fields.expectedAdmitDate, exp.expectedAdmitDate, `${label}: expected admit`);
  const codes = fields.diagnoses.filter((d) => d.code).map((d) => d.code);
  assert.deepStrictEqual(codes.slice().sort(), exp.codes.slice().sort(), `${label}: codes ${codes.join(", ")}`);
  const free = fields.diagnoses.filter((d) => !d.code).map((d) => d.description);
  assert.deepStrictEqual(free.slice().sort(), exp.free.slice().sort(), `${label}: free-text dx ${JSON.stringify(free)}`);
  const primary = fields.diagnoses.find((d) => d.primary);
  if (exp.primary) assert.strictEqual(primary && primary.code, exp.primary, `${label}: primary`);
  // Coded items show the official CMS description, not surrounding text.
  for (const d of fields.diagnoses.filter((x) => x.code)) {
    const official = icd.lookup(d.code);
    assert.ok(official, `${label}: ${d.code} not in CMS list`);
    assert.strictEqual(d.description, official.description, `${label}: ${d.code} description`);
  }
  assert.strictEqual(fields.allergies.status, exp.allergyStatus, `${label}: allergy status`);
  const got = fields.allergies.items.map((a) => [a.allergen, a.reaction, a.severity]);
  assert.strictEqual(got.length, exp.allergies.length, `${label}: allergy count ${JSON.stringify(got)}`);
  exp.allergies.forEach(([allergen, reaction, severity], i) => {
    assert.strictEqual(got[i][0], allergen, `${label}: allergen ${i}`);
    assert.strictEqual(got[i][1], reaction, `${label}: reaction for ${allergen}`);
    if (severity !== undefined) assert.strictEqual(got[i][2], severity, `${label}: severity for ${allergen}`);
  });
  assert.deepStrictEqual(fields.needs.slice().sort(), exp.needs.slice().sort(), `${label}: needs ${fields.needs.join(",")}`);
  assertNoJunk(fields, label);
}

(async () => {
  await icd.ensureLoaded();
  const lookup = (c) => {
    const e = icd.lookup(c);
    return e ? { code: e.code, description: e.description, billable: e.billable } : null;
  };

  for (const [base, exp] of Object.entries(EXPECT)) {
    await test(`${base}.txt extracts every field correctly with zero junk`, () => {
      checkExpected(extract.extractFields(read(base + ".txt"), { lookup }), exp, base);
    });
  }
  for (const [file, base] of Object.entries(OCR_FILES)) {
    await test(`${file} (noisy scan read by on-device OCR) extracts correctly with zero junk`, () => {
      checkExpected(extract.extractFields(read(file), { lookup }), EXPECT[base], file, { ocr: true });
    });
  }

  await test("never returns the junk items from Bryan's screen recording", () => {
    const all = Object.keys(EXPECT).map((b) => read(b + ".txt")).concat(Object.keys(OCR_FILES).map(read));
    for (const text of all) assertNoJunk(extract.extractFields(text, { lookup }), "combined");
  });

  await test("without the code list, unverifiable codes outside diagnosis sections are dropped", () => {
    const fields = extract.extractFields(read("epic-cellulitis.txt"));
    assertNoJunk(fields, "no-lookup");
    const codes = fields.diagnoses.filter((d) => d.code).map((d) => d.code);
    assert.deepStrictEqual(codes.sort(), ["E11.9", "F41.9", "I10", "L03.116"]);
  });

  await test("codes not in the CMS list are rejected even inside a diagnosis section", () => {
    const dx = extract.extractDiagnoses("Diagnoses:\nZ99.99 Made-up code\nI10 Hypertension\n", { lookup });
    assert.deepStrictEqual(dx.filter((d) => d.code).map((d) => d.code), ["I10"]);
  });

  await test("times, phone fragments and 'ICD-10' are never codes", () => {
    const text = "Problem List\nSeen at 4:40 PM, call 555 9492 B06\nICD-10 codes reviewed\nI10 Essential hypertension\n";
    const dx = extract.extractDiagnoses(text, { lookup });
    assert.deepStrictEqual(dx.filter((d) => d.code).map((d) => d.code), ["I10"]);
    assert.ok(!dx.some((d) => /4:40|9492|ICD-10/i.test(d.code + d.description)));
  });

  await test("NKDA variants show as NKDA, and a missing section is 'unknown' (not guessed)", () => {
    for (const t of ["Allergies\nNo Known Allergies\n", "Allergies: NKDA", "Drug Allergies: NKA", "Allergies\nPatient has no known allergies.\n"]) {
      assert.strictEqual(extract.extractAllergies(t).status, "nkda", t);
    }
    const none = extract.extractAllergies(read("no-allergy-section.txt"));
    assert.strictEqual(none.status, "unknown");
    assert.strictEqual(none.items.length, 0);
  });

  await test("reaction is only filled with a real reaction, never a date or payer", () => {
    const a = extract.extractAllergies("Allergies\nAspirin 11/12/26\nCodeine MT MEDICAID\nPenicillin hives\n");
    const byName = Object.fromEntries(a.items.map((i) => [i.allergen, i]));
    assert.strictEqual(byName.Aspirin.reaction, "");
    assert.ok(!byName.Codeine || byName.Codeine.reaction === "");
    assert.strictEqual(byName.Penicillin.reaction, "hives");
  });

  await test("fields that are not in the referral stay blank", () => {
    const f = extract.extractFields("Allergies: NKDA\nProblem List\nHypertension I10\n", { lookup });
    assert.strictEqual(f.name, "");
    assert.strictEqual(f.dob, "");
    assert.strictEqual(f.hospital, "");
    assert.strictEqual(f.payer, "");
    assert.strictEqual(f.dateReceived, "");
    assert.strictEqual(f.expectedAdmitDate, "");
    assert.deepStrictEqual(f.needs, []);
  });

  await test("hospital admit date is not used as the expected SNF admit date", () => {
    const f = extract.extractFields("Admit Date: 11/12/2026\nAdmission Date: 11/10/2026\n");
    assert.strictEqual(f.expectedAdmitDate, "");
  });

  await test("impossible dates are left blank", () => {
    assert.strictEqual(extract.extractFields("DOB: 13/45/1950").dob, "");
    assert.strictEqual(extract.extractFields("DOB: 02/30/1950").dob, "");
    assert.strictEqual(extract.extractFields("DOB: 01/01/2099").dob, "");
  });

  await test("care needs ignore negations and look-alikes", () => {
    const f = extract.extractFields("Isolation: None\nST. MARY HOSPITAL\nPt is 80 years old\nCKD stage IV\nDementia without behavioral disturbance\nTube feeding not required\nNo oxygen\n");
    assert.deepStrictEqual(f.needs, []);
  });

  console.log(`\n${passed} synthetic-referral tests passed, ${failed} failed.`);
  if (failed) process.exit(1);
})();
