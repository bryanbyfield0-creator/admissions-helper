#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
const icd = require("../icd10.js");

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

function topCode(q) {
  const hits = icd.suggest(q, { limit: 5 });
  assert.ok(hits.length, "no suggestions for " + q);
  return hits[0].code;
}

(async () => {
  await icd.ensureLoaded({ file: path.join(__dirname, "..", "data", "icd10cm-fy2027.tsv.gz") });
  assert.ok(icd.isReady());
  assert.ok(icd.getBundle().entries.length > 70000);

  const cases = [
    ["Hypertension", "I10"],
    ["Type 2 diabetes mellitus", "E11.9"],
    ["CHF", "I50.9"],
    ["COPD", "J44.9"],
    ["Dementia", "F03.90"],
    ["UTI", "N39.0"],
    ["Atrial fibrillation", "I48.91"],
    ["CKD stage 3", "N18.30"],
    ["HTN", "I10"],
    ["DM2", "E11.9"],
    ["T2DM", "E11.9"],
    ["A-fib", "I48.91"],
    ["GERD", "K21.9"],
    ["BPH", "N40.0"],
  ];

  for (const [q, code] of cases) {
    test("maps \"" + q + "\" → " + code, () => {
      assert.strictEqual(topCode(q), code);
    });
  }

  test("validates document codes, including non-billable headers", () => {
    assert.strictEqual(icd.validate("I10").status, "valid");
    assert.strictEqual(icd.validate("E119").status, "valid");
    assert.strictEqual(icd.validate("E11").status, "nonbillable");
    assert.strictEqual(icd.validate("ZZZ.99").status, "invalid");
  });

  test("applyToDiagnoses fills suggestions and flags found codes", () => {
    const out = icd.applyToDiagnoses([
      { code: "", description: "Hypertension", primary: false },
      { code: "E11.9", description: "Type 2 diabetes mellitus", primary: true },
      { code: "E11", description: "Type 2 diabetes", primary: false },
      { code: "QQ99", description: "Made-up diagnosis", primary: false },
    ]);
    assert.strictEqual(out[0].code, "I10");
    assert.strictEqual(out[0].codeSource, "suggested");
    assert.ok(out[0].suggestions.length >= 1);
    assert.strictEqual(out[1].code, "E11.9");
    assert.strictEqual(out[1].codeSource, "found");
    assert.strictEqual(out[1].codeStatus, "valid");
    assert.strictEqual(out[2].codeSource, "found");
    assert.strictEqual(out[2].codeStatus, "nonbillable");
    assert.ok(out[2].suggestions.some((s) => s.code === "E11.9"));
    assert.strictEqual(out[3].codeStatus, "invalid");
  });

  test("search finds codes by code prefix and by words", () => {
    const byCode = icd.search("N18.3", { limit: 8 });
    assert.ok(byCode.some((h) => h.code === "N18.30"));
    const byWord = icd.search("essential hypertension", { limit: 8 });
    assert.ok(byWord.some((h) => h.code === "I10"));
  });

  test("alternatives for an unspecified diagnosis prefer a billable unspecified code first", () => {
    const hits = icd.suggest("Type 2 diabetes mellitus", { limit: 5 });
    assert.strictEqual(hits[0].code, "E11.9");
    assert.ok(hits[0].billable);
    assert.ok(hits.length >= 2);
  });

  if (process.exitCode) {
    console.error("\nSome ICD-10 lookup tests failed.");
    process.exit(process.exitCode);
  }
  console.log("\n" + passed + " ICD-10 lookup tests passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
