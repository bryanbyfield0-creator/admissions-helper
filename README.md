# Admissions Tracker

A free, simple admissions tracker for skilled nursing and rehab teams. It runs entirely in your browser. There is no sign-in and nothing to install.

**Referral information stays on this device.** The tracker does not upload patient or referral details to a server.

Open it at: https://bryanbyfield0-creator.github.io/admissions-helper/

## What you can do

- Log a referral (name or initials, date of birth, hospital, diagnoses with ICD-10 codes, allergies, payer, care needs, and notes)
- Drop a referral PDF, Word file (.docx), text, or a photo (JPG, PNG, or HEIC) onto the dashboard, or paste email text, then review suggested fields before you save. The tracker finds every diagnosis and ICD-10-CM code in the text, suggests official codes when a diagnosis is listed without one, and captures allergies (including NKDA). Image-only scanned PDFs and photos are read on this device.
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
- Suggested ICD-10-CM codes come from the official CMS FY2027 code set bundled with the app, not from a live server. They are a starting point, not a coding decision. Review every suggested or document-listed code. The app does not confirm medical necessity or coding guidelines.

## Add it to your phone

Open the link in your browser, then use Share or the browser menu and choose **Add to Home Screen**.

pdf.js (Apache License 2.0) is included locally to read PDF text and to render scanned pages on the device. tesseract.js and its English language data (Apache License 2.0) are included locally so image-only scans and photos can be read in the browser; nothing is sent to a server. Word (.docx) files are unpacked in the browser.
