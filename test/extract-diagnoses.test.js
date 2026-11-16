#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const extract = require("../extract.js");

const FIX = path.join(__dirname, "fixtures");
const read = (name) => fs.readFileSync(path.join(FIX, name), "utf8");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("ok  - " + name);
  } catch (err) {
    console.error("FAIL - " + name);
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
}

function codes(items) {
  return items.map((d) => d.code);
}

function descriptions(items) {
  return items.map((d) => d.description);
}

function byCode(items, code) {
  return items.find((d) => d.code === code);
}

test("normalizes dotted, undotted, and 7th-character codes", () => {
  assert.strictEqual(extract.normalizeIcd10Code("i10"), "I10");
  assert.strictEqual(extract.normalizeIcd10Code("E11.9"), "E11.9");
  assert.strictEqual(extract.normalizeIcd10Code("E119"), "E11.9");
  assert.strictEqual(extract.normalizeIcd10Code("n18.30"), "N18.30");
  assert.strictEqual(extract.normalizeIcd10Code("N1830"), "N18.30");
  assert.strictEqual(extract.normalizeIcd10Code("Z99.81"), "Z99.81");
  assert.strictEqual(extract.normalizeIcd10Code("Z9981"), "Z99.81");
  assert.strictEqual(extract.normalizeIcd10Code("S72.001A"), "S72.001A");
  assert.strictEqual(extract.normalizeIcd10Code("S72001A"), "S72.001A");
  assert.strictEqual(extract.normalizeIcd10Code("U07.1"), "U07.1");
  assert.strictEqual(extract.normalizeIcd10Code("not-a-code"), "");
});

test("code-then-description list with a labeled primary", () => {
  const text = read("code-then-desc.txt");
  const fields = extract.extractFields(text);
  const dx = fields.diagnoses;
  assert.strictEqual(fields.name, "Helen C. Park");
  assert.strictEqual(fields.diagnosis, "E11.9 Type 2 diabetes mellitus without complications");
  assert.deepStrictEqual(codes(dx), ["E11.9", "I10", "N18.30", "Z99.81", "S72.001A"]);
  assert.strictEqual(dx[0].primary, true);
  assert.ok(dx.slice(1).every((d) => !d.primary));
  assert.ok(byCode(dx, "I10").description.toLowerCase().includes("hypertension"));
  assert.ok(byCode(dx, "S72.001A").description.toLowerCase().includes("femur"));
});

test("description then parenthetical code, plus uncoded item", () => {
  const dx = extract.extractDiagnoses(read("desc-then-paren.txt"));
  assert.strictEqual(dx[0].code, "I50.23");
  assert.strictEqual(dx[0].primary, true);
  assert.ok(dx[0].description.toLowerCase().includes("heart failure"));
  assert.deepStrictEqual(codes(dx), ["I50.23", "E11.9", "N18.30", "Z99.81", ""]);
  const uncoded = dx.find((d) => !d.code);
  assert.strictEqual(uncoded.description, "Deconditioning");
  assert.ok(extract.formatDiagnosesList(dx).includes("Deconditioning (no code found)"));
});

test("two-column diagnosis / ICD-10 table", () => {
  const fields = extract.extractFields(read("dx-table.txt"));
  const dx = fields.diagnoses;
  assert.deepStrictEqual(codes(dx), ["E11.9", "I10", "N18.30", "Z99.81"]);
  assert.ok(byCode(dx, "E11.9").description.toLowerCase().includes("diabetes"));
  assert.ok(byCode(dx, "I10").description.toLowerCase().includes("hypertension"));
  assert.ok(byCode(dx, "Z99.81").description.toLowerCase().includes("oxygen"));
  assert.strictEqual(fields.hospital, "Loma Linda University Medical Center");
  assert.ok(fields.needs.includes("oxygen"));
});

test("undotted codes are normalized and problem-list items are deduped", () => {
  const dx = extract.extractDiagnoses(read("undotted-and-problem-list.txt"));
  assert.deepStrictEqual(codes(dx), ["E11.9", "I10", "N18.30", "Z99.81", ""]);
  assert.strictEqual(dx[0].primary, true);
  assert.strictEqual(dx[0].code, "E11.9");
  const uncoded = dx.find((d) => !d.code);
  assert.ok(/gait instability/i.test(uncoded.description));
});

test("does not treat dates, phones, rooms, zip, NPI, or meds as codes", () => {
  const text = read("false-positives.txt");
  const fields = extract.extractFields(text);
  const dx = fields.diagnoses;
  const allCodes = codes(dx).filter(Boolean);
  assert.deepStrictEqual(allCodes, [], "unexpected codes: " + allCodes.join(", "));
  assert.strictEqual(fields.diagnosis, "Community-acquired pneumonia");
  assert.strictEqual(dx.length, 1);
  assert.strictEqual(dx[0].description, "Community-acquired pneumonia");
  assert.ok(!codes(dx).includes("A214"));
  assert.ok(!dx.some((d) => /D5W|B12|A1C|Q4H/i.test(d.code)));
});

test("existing sample primary stays intact and secondaries are captured", () => {
  const text = read("uncoded-secondary.txt");
  const fields = extract.extractFields(text);
  assert.strictEqual(fields.diagnosis, "Right hip fracture, s/p ORIF");
  assert.strictEqual(fields.name, "Jane Marie Doe");
  const dx = fields.diagnoses;
  assert.strictEqual(dx[0].description, "Right hip fracture, s/p ORIF");
  assert.strictEqual(dx[0].primary, true);
  assert.ok(dx[0].code === "");
  const labels = descriptions(dx).map((s) => s.toLowerCase());
  assert.ok(labels.some((s) => s === "hypertension"));
  assert.ok(labels.some((s) => s.includes("type 2 diabetes")));
});

test("original sample-referral.txt still yields the same primary diagnosis", () => {
  const text = fs.readFileSync(path.join(__dirname, "sample-referral.txt"), "utf8");
  const fields = extract.extractFields(text);
  assert.strictEqual(fields.name, "Maria Elena Santos");
  assert.strictEqual(fields.diagnosis, "Pneumonia, deconditioning");
  assert.strictEqual(fields.payer, "medicaid");
  assert.ok(fields.needs.includes("pt"));
  assert.ok(fields.needs.includes("oxygen"));
});

test("COVID U07.1 is kept as a valid ICD-10-CM code", () => {
  const text = "Primary Diagnosis: U07.1 COVID-19 pneumonia\nSecondary Diagnoses: I10 Essential hypertension\n";
  const dx = extract.extractDiagnoses(text);
  assert.strictEqual(dx[0].code, "U07.1");
  assert.ok(/covid/i.test(dx[0].description));
  assert.strictEqual(dx[0].primary, true);
  assert.strictEqual(dx[1].code, "I10");
});

if (process.exitCode) {
  console.error("\nSome extraction tests failed.");
  process.exit(process.exitCode);
} else {
  console.log("\n" + passed + " extraction tests passed.");
}
