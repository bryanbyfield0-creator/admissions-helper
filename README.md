# Admissions Tracker

A free, simple admissions tracker for skilled nursing and rehab teams. It runs entirely in your browser. There is no sign-in and nothing to install.

**Referral information stays on this device.** The tracker does not upload patient or referral details to a server.

Open it at: https://bryanbyfield0-creator.github.io/admissions-helper/

## What you can do

- Log a referral (name or initials, date of birth, hospital, diagnoses with ICD-10 codes, allergies, payer, care needs, and notes)
- Drop a referral PDF, Word file (.docx), text, or a photo (JPG, PNG, or HEIC) onto the dashboard, or paste email text, then check the filled-in fields before you save. Every item filled in from a referral is marked **Please verify** until you edit or confirm it, and each list has a **Clear all** button. Anything the tracker is not sure about is left blank instead of guessed.
  - **Diagnoses** are read only from diagnosis, problem list, medical history and assessment sections. A code is kept only if it is in the official CMS ICD-10-CM code set (bundled with the app), and the official description is shown. Codes in contacts, insurance, provider, isolation and timestamp lines are ignored. Codes are also found without a dot (I509), in brackets, after “ICD-10:” / “Dx:”, and with common scan mix-ups fixed (O/0, I/l/1, S/5). If the sections hold no codes, the whole document is checked.
  - **Diagnosis names to codes:** many referrals (Epic discharge summaries especially) list only names. About 350 common skilled-nursing diagnoses and abbreviations (CHF, COPD, AKI, UTI, s/p TKA, hip fracture, and so on) are turned into a **suggested code – please verify**, with the most specific code when the side is written (left/right/bilateral) and other choices in a dropdown. Negated, ruled-out and family-history mentions (“denies”, “no history of”, “r/o”, “mother had”) are skipped. Problem list and diagnosis sections are searched first, then the whole document.
  - **Show what it read:** after every import a button opens what the app read: the text of each page (text layer or OCR), character counts, the sections it recognized, and each code-like item kept or skipped and why. A Copy button copies it (cover patient details before sharing). It never leaves the device. If very little text came through, the app says the file may be a low-quality scan.
  - **Allergies** are read only from the allergy section, up to the next section. NKDA / NKA / “No known allergies” is shown as NKDA. Epic's “Not on File” is shown as “Allergy status unknown – confirm”, not NKDA. A reaction is filled in only when the referral names one (rash, hives, swelling, and so on). If no allergy section is found, the form says “None found — check the file.”
  - Image-only scanned PDFs, faxed PDFs (a scanned picture with only a fax header as real text) and photos are read on this device with OCR. Pages that already have real text are not OCR'd. Several scanned pages are read at once, and the reader starts loading in the background when the page opens.
- Track each referral through New, Reviewing, Pending insurance auth, Accepted, Admitted, or Declined
- Work through an admission checklist with a progress bar
- See today's expected admits, items still waiting on a decision, and a simple admission rate
- Copy acceptance or decline messages and a daily admissions summary
- Download a JSON or CSV backup, restore a backup, or clear everything
- Optionally set a passcode that encrypts the copy stored in this browser

## Privacy

- Data is stored only in this browser (local storage). It is not synced to other devices unless you restore a backup file you saved yourself.
- Referral PDFs (including scanned, image-only packets), Word files (.docx), text files, and photos of referrals are read on the device so text can be suggested into the form. The file itself is not saved or sent anywhere. ICD-10-CM lookup uses a copy of the official CMS code set stored with the app; referral text never leaves this device.
- A passcode, if you set one, encrypts the stored copy on this device. If you forget it, that copy cannot be unlocked. Keep a backup in a safe place.
- Prefer initials when a full name is not needed. Do not use this on a shared computer unless you lock it and understand that a backup file is still sensitive.

This is a personal tracker, not an official medical record, EHR, or insurance system.

## What it does not do

- It does not use an AI model and does not score clinical fit or project reimbursement.
- It does not verify insurance eligibility or obtain authorization.
- It does not connect to an EHR, hospital portal, or payer system.
- It cannot read password-protected PDFs or older Word .doc files. Handwriting, very blurry scans, and some HEIC photos (in browsers that cannot open that format) may not be readable. Enter those by hand.
- ICD-10-CM codes are checked against the official CMS FY2027 code set bundled with the app, not a live server. A code being valid does not make it the right code for the patient. Review every code. The app does not confirm medical necessity or coding guidelines.
- Extraction is tuned for Epic-style face sheets and H&Ps, PointClickCare admission records, and typed referral emails. Unusual layouts, handwriting, or badly skewed scans can still be missed. When in doubt it leaves the field blank.

## Add it to your phone

Open the link in your browser, then use Share or the browser menu and choose **Add to Home Screen**.

pdf.js (Apache License 2.0) is included locally to read PDF text and to render scanned pages on the device. tesseract.js and its English language data (Apache License 2.0) are included locally so image-only scans and photos can be read in the browser; nothing is sent to a server. Word (.docx) files are unpacked in the browser.

## Tests

```
for t in test/*.test.js; do node "$t"; done   # parser, allergy, ICD-10, name-to-code, layout and synthetic-referral tests
python3 test/e2e.py && python3 test/qa_e2e.py && python3 test/ocr_e2e.py && python3 test/upload_e2e.py   # browser tests (Playwright; upload tests run in Chromium and WebKit)
node scripts/compare-before-after.js           # item counts before vs after the parser rewrite
```

All test referrals in `test/fixtures` are synthetic. `scripts/make-epic-scans.py` renders them into noisy, image-only scanned PDFs, and `test/capture_ocr.py` saves what the app's on-device OCR reads from them.
