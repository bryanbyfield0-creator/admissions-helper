// Varied real-world referral layouts (all fictional): Cerner discharge summary,
// Meditech header block, fax cover + H&P, face sheet only, inline "ICD-10-CM:"
// codes, and a plain e-mail with no headers. Checks codes, allergies and that
// section headers never become the hospital name.
const fs = require("fs");
const path = require("path");
const X = require("../extract.js");
const I = require("../icd10.js");
const DIR = path.join(__dirname, "fixtures", "layouts");
const CASES = {
  "cerner-discharge.txt": { codes: ["I50.33", "N18.31", "I48.0", "E11.65"], primary: "I50.33", allergies: ["codeine", "latex"], hospital: "Riverside Regional Medical Center" },
  "meditech.txt": { codes: ["S72.001A", "M81.0", "F03.90"], allergies: ["morphine", "bactrim"] },
  "fax-cover-hp.txt": { codes: ["I63.9", "R13.12", "E78.5", "I10", "K21.9"], nkda: true, notHospital: /problems/i },
  "facesheet-only.txt": { codes: ["J69.0", "J96.01", "G20.A1"], primary: "J69.0", nkda: true, hospital: "Valley Medical Center" },
  "icd-inline.txt": { codes: ["L89.154", "A41.9"], allergies: ["vancomycin"] },
  "no-headers.txt": { codes: ["J44.1", "I50.9", "E11.9"] },
};
const JUNK = /\d{3}[-\s]\d{4}|medicare|policy|son\)|attend|run\s+(?:date|time)|acct|fax|phone/i;
(async () => {
  await I.ensureLoaded();
  const lookup = (c) => { const e = I.lookup(c); return e ? { code: e.code, description: e.description, billable: e.billable } : null; };
  let pass = 0, fail = 0;
  for (const [file, want] of Object.entries(CASES)) {
    const r = X.extractFields(fs.readFileSync(path.join(DIR, file), "utf8"), { lookup });
    const codes = r.diagnoses.filter((d) => d.code).map((d) => d.code);
    const problems = [];
    if (JSON.stringify(codes) !== JSON.stringify(want.codes)) problems.push(`codes ${codes} != ${want.codes}`);
    if (want.primary && (r.diagnoses.find((d) => d.primary) || {}).code !== want.primary) problems.push("primary");
    for (const d of r.diagnoses) if (JUNK.test(d.description)) problems.push(`junk dx ${d.description}`);
    const allergens = r.allergies.items.map((a) => a.allergen.toLowerCase()).join(" ");
    for (const a of want.allergies || []) if (!allergens.includes(a)) problems.push(`missing allergy ${a}`);
    for (const a of r.allergies.items) if (JUNK.test(a.allergen)) problems.push(`junk allergy ${a.allergen}`);
    if (want.nkda && r.allergies.status !== "nkda") problems.push("expected NKDA");
    if (want.hospital && r.hospital !== want.hospital) problems.push(`hospital ${r.hospital}`);
    if (want.notHospital && want.notHospital.test(r.hospital)) problems.push(`hospital is a header: ${r.hospital}`);
    if (problems.length) { fail++; console.error(`FAIL ${file}: ${problems.join("; ")}`); } else pass++;
  }
  console.log(`\n${pass} layout tests passed, ${fail} failed.`);
  if (fail) process.exit(1);
})();
