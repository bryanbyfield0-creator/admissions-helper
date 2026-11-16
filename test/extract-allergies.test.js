#!/usr/bin/env node
"use strict";

const assert = require("assert");
const extract = require("../extract.js");

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

function byAllergen(items, name) {
  return items.find((i) => i.allergen.toLowerCase() === name.toLowerCase());
}

test("Allergies: PCN (rash), sulfa", () => {
  const a = extract.extractAllergies("Patient Name: Test\nAllergies: PCN (rash), sulfa\nInsurance: Medicare\n");
  assert.strictEqual(a.status, "listed");
  assert.strictEqual(a.items.length, 2);
  const pcn = byAllergen(a.items, "PCN");
  assert.ok(pcn);
  assert.strictEqual(pcn.reaction.toLowerCase(), "rash");
  assert.strictEqual(pcn.type, "drug");
  const sulfa = byAllergen(a.items, "sulfa");
  assert.ok(sulfa);
  assert.strictEqual(sulfa.type, "drug");
});

test("NKDA is distinct from not found", () => {
  const none = extract.extractAllergies("Patient Name: Test\nPrimary Diagnosis: Pneumonia\nInsurance: Medicare\n");
  assert.strictEqual(none.status, "unknown");
  assert.strictEqual(none.items.length, 0);
  assert.strictEqual(extract.formatAllergies(none), "");

  const nkda = extract.extractAllergies("Patient Name: Test\nAllergies: NKDA\nInsurance: Medicare\n");
  assert.strictEqual(nkda.status, "nkda");
  assert.strictEqual(nkda.items.length, 0);
  assert.strictEqual(extract.formatAllergies(nkda), "NKDA");

  const nka = extract.extractAllergies("Allergy list:\nNo known allergies\n");
  assert.strictEqual(nka.status, "nkda");
});

test("Drug / food / environmental / latex sections", () => {
  const text = `
Drug Allergies: Penicillin - hives (severe)
Food Allergies: peanuts
Environmental: pollen, dust mites
Latex: rash
`;
  const a = extract.extractAllergies(text);
  assert.strictEqual(a.status, "listed");
  const names = a.items.map((i) => i.allergen.toLowerCase());
  assert.ok(names.includes("penicillin"));
  assert.ok(names.includes("peanuts"));
  assert.ok(names.includes("pollen"));
  assert.ok(names.includes("dust mites"));
  assert.ok(names.includes("Latex") || names.includes("latex"));
  const pcn = byAllergen(a.items, "Penicillin");
  assert.strictEqual(pcn.reaction.toLowerCase(), "hives");
  assert.strictEqual(pcn.severity, "severe");
  assert.strictEqual(pcn.type, "drug");
  assert.strictEqual(byAllergen(a.items, "peanuts").type, "food");
  assert.strictEqual(byAllergen(a.items, "pollen").type, "environmental");
  const latex = a.items.find((i) => /latex/i.test(i.allergen));
  assert.ok(latex);
  assert.strictEqual(latex.type, "latex");
  assert.ok(/rash/i.test(latex.reaction));
});

test("Allergy/Intolerance table with reaction and severity", () => {
  const text = `
Allergy/Intolerance
Allergen          Reaction        Severity
Penicillin        Rash            Moderate
Codeine           Nausea          Mild
`;
  const a = extract.extractAllergies(text);
  assert.strictEqual(a.status, "listed", JSON.stringify(a, null, 2));
  const pcn = byAllergen(a.items, "Penicillin");
  assert.ok(pcn, JSON.stringify(a.items));
  assert.strictEqual(pcn.reaction.toLowerCase(), "rash");
  assert.strictEqual(pcn.severity, "moderate");
  const codeine = byAllergen(a.items, "Codeine");
  assert.ok(codeine);
  assert.strictEqual(codeine.reaction.toLowerCase(), "nausea");
  assert.strictEqual(codeine.severity, "mild");
  assert.strictEqual(codeine.type, "drug");
});

test("does not treat diagnoses as allergies", () => {
  const text = `
Primary Diagnosis: Pneumonia, deconditioning
Secondary: Hypertension, Type 2 diabetes mellitus
Insurance: Medicare
`;
  const a = extract.extractAllergies(text);
  assert.strictEqual(a.status, "unknown");
  const dx = require("../extract.js").extractDiagnoses(text);
  assert.ok(dx.some((d) => /pneumonia/i.test(d.description)));
});

test("formatAllergies lists items", () => {
  const a = extract.extractAllergies("Allergies: PCN (rash), sulfa\n");
  const s = extract.formatAllergies(a);
  assert.ok(/PCN/i.test(s) && /rash/i.test(s));
  assert.ok(/sulfa/i.test(s));
});

test("extractFields includes allergies and leaves uncoded diagnoses for later lookup", () => {
  const fs = require("fs");
  const path = require("path");
  const text = fs.readFileSync(path.join(__dirname, "fixtures", "uncoded-dx-and-allergies.txt"), "utf8");
  const fields = extract.extractFields(text);
  assert.strictEqual(fields.name, "Rosa M. Delgado");
  assert.strictEqual(fields.diagnosis, "Type 2 diabetes mellitus");
  assert.ok(fields.diagnoses.some((d) => d.description === "Hypertension" && !d.code));
  assert.strictEqual(fields.allergies.status, "listed");
  assert.ok(fields.allergies.items.some((a) => a.allergen === "PCN" && /rash/i.test(a.reaction)));
  assert.ok(fields.allergies.items.some((a) => /^sulfa$/i.test(a.allergen)));
});

test("NKA, NKDA, and no known drug allergies are all NKDA", () => {
  assert.strictEqual(extract.extractAllergies("Allergies: NKA").status, "nkda");
  assert.strictEqual(extract.extractAllergies("Allergies: No known drug allergies").status, "nkda");
  assert.strictEqual(extract.extractFields("Patient Name: A\nAllergies: NKDA\n").allergies.status, "nkda");
});

if (process.exitCode) {
  console.error("\nSome allergy tests failed.");
  process.exit(process.exitCode);
}
console.log("\n" + passed + " allergy tests passed.");
