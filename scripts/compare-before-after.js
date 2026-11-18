#!/usr/bin/env node
/* Before/after item counts on the synthetic referrals.
   "Before" = extract.js at commit a745e12 (what Bryan used), "after" = current. */
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const oldPath = path.join(os.tmpdir(), "extract-a745e12.js");
fs.writeFileSync(oldPath, execSync("git show a745e12:extract.js", { cwd: ROOT }));
const before = require(oldPath);
const after = require(path.join(ROOT, "extract.js"));
const icd = require(path.join(ROOT, "icd10.js"));
const DIR = path.join(ROOT, "test", "fixtures", "epic");
(async () => {
  await icd.ensureLoaded();
  const lookup = (c) => { const e = icd.lookup(c); return e ? { code: e.code, description: e.description, billable: e.billable } : null; };
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort();
  console.log("file | dx before | dx after | allergies before | allergies after");
  for (const f of files) {
    const t = fs.readFileSync(path.join(DIR, f), "utf8");
    const b = before.extractFields(t);
    const a = after.extractFields(t, { lookup });
    const al = (x) => (x.allergies.status === "nkda" ? "NKDA" : x.allergies.status === "unknown" ? "none found" : String(x.allergies.items.length));
    console.log(`${f} | ${b.diagnoses.length} | ${a.diagnoses.length} | ${b.allergies.status === "nkda" ? "NKDA" : b.allergies.items.length} | ${al(a)}`);
  }
})();
