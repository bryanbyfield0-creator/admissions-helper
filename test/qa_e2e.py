#!/usr/bin/env python3
"""Browser QA for the referral parser: synthetic Epic / PCC referrals, noisy
scanned PDFs through the on-device OCR path, the "Please verify" cue, clear-all
buttons, NKDA / none-found banners, console errors, off-device requests, and
phone-width layouts. All patient data is fictional."""
from pathlib import Path
import re

from e2e import BASE, ROOT, start_server, sync_playwright, expect, drop_file, diagnosis_rows, allergy_rows, attach_external_request_log

FIX = Path(__file__).resolve().parent / "fixtures" / "epic"
SHOTS = ROOT / "test" / "downloads"
JUNK = re.compile(r"printed|sullivan|holloway|contacts|relation|home work|friend|attending|isolation|subscriber|medicaid|payer|\d{1,2}:\d{2}|\d{3}[-\s]\d{4}|surgical|hernia|groubs|bugs|risk of|diagnosis date", re.I)


def watch_console(page, errors):
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))


def paste_into_new(page, text):
    page.get_by_test_id("nav-dashboard").click()
    page.get_by_test_id("dash-paste-toggle").click()
    page.get_by_test_id("dash-paste-text").fill(text)
    page.get_by_test_id("dash-paste-apply").click()
    expect(page.get_by_test_id("extract-panel")).to_be_visible(timeout=30000)


def assert_no_junk(page, label):
    for r in diagnosis_rows(page):
        assert r["code"] != "ICD-10", (label, r)
        assert not JUNK.search(r["description"]), (label, r)
    for a in allergy_rows(page):
        assert not JUNK.search(a["allergen"]) and not re.search(r"\d+/\d+/\d+|medicaid", a["reaction"], re.I), (label, a)


def wait_rows(page, n_codes, timeout=30000):
    page.wait_for_function(
        """(n) => [...document.querySelectorAll('[data-testid=diagnosis-code]')].filter((i) => i.value.trim()).length >= n""",
        arg=n_codes, timeout=timeout)


def scanned_epic(page):
    page.get_by_test_id("nav-dashboard").click()
    drop_file(page, "dash-dropzone", FIX / "epic-cellulitis-scan.pdf", "application/pdf")
    expect(page.get_by_test_id("extract-panel")).to_be_visible(timeout=300000)
    expect(page.get_by_test_id("referral-name")).to_have_value("Mateo Andres Delacruz")
    expect(page.get_by_test_id("referral-dob")).to_have_value("1959-06-02")
    expect(page.get_by_test_id("referral-hospital")).to_have_value("Northvale Regional Medical Center")
    expect(page.get_by_test_id("referral-payer")).to_have_value("medicaid")
    expect(page.get_by_test_id("referral-expected-admit")).to_have_value("")
    wait_rows(page, 4)
    rows = diagnosis_rows(page)
    codes = sorted(r["code"] for r in rows if r["code"])
    assert codes == ["E11.9", "F41.9", "I10", "L03.116"], rows
    free = [r["description"] for r in rows if not r["code"]]
    assert free == [], rows  # "Concern for MRSA" in the plan is not a diagnosis
    assert next(r for r in rows if r["code"] == "L03.116")["description"] == "Cellulitis of left lower limb"
    assert next(r for r in rows if r["code"] == "L03.116")["primary"] is True
    allergens = [(a["allergen"], a["reaction"]) for a in allergy_rows(page)]
    assert allergens == [("Penicillins", "hives"), ("Sulfa (Sulfonamide Antibiotics)", "rash"), ("Lisinopril", "swelling")], allergens
    assert_no_junk(page, "epic scan")
    # Visible "Please verify" cue on every extracted item.
    n_items = len(rows) + len(allergens)
    expect(page.get_by_test_id("verify-pill")).to_have_count(n_items)
    expect(page.get_by_test_id("diagnoses-verify-note")).to_contain_text("Please verify")
    expect(page.get_by_test_id("allergies-verify-note")).to_contain_text("3 items")
    expect(page.get_by_test_id("review-banner")).to_contain_text("Please verify")
    # Editing an item clears its cue.
    page.get_by_test_id("allergy-reaction").first.fill("hives, itching")
    expect(page.get_by_test_id("verify-pill")).to_have_count(n_items - 1)
    expect(page.get_by_test_id("allergies-verify-note")).to_contain_text("2 items")
    return n_items


def clear_all_buttons(page):
    page.get_by_test_id("clear-diagnoses-btn").click()
    expect(page.get_by_test_id("diagnosis-row")).to_have_count(1)
    expect(page.get_by_test_id("diagnosis-code").first).to_have_value("")
    expect(page.get_by_test_id("diagnosis-description").first).to_have_value("")
    expect(page.get_by_test_id("diagnoses-verify-note")).to_be_hidden()
    page.get_by_test_id("clear-allergies-btn").click()
    assert allergy_rows(page) == []
    expect(page.get_by_test_id("allergies-banner")).to_contain_text("have not been recorded yet")
    expect(page.get_by_test_id("verify-pill")).to_have_count(0)


def second_import_replaces_first(page):
    # Paste a different referral into the same open form: nothing from the
    # first file may be left behind.
    page.get_by_test_id("dialog-paste-toggle").click() if page.get_by_test_id("dialog-paste-toggle").count() else None
    page.get_by_test_id("dialog-paste-text").fill((FIX / "no-allergy-section.txt").read_text())
    page.get_by_test_id("dialog-paste-apply").click()
    expect(page.get_by_test_id("referral-name")).to_have_value("Harold B. Finch", timeout=15000)
    expect(page.get_by_test_id("referral-payer")).to_have_value("private")
    expect(page.get_by_test_id("referral-hospital")).to_have_value("Mount Pleasant Hospital")
    assert not page.get_by_test_id("need-isolation").is_checked()
    assert not page.get_by_test_id("need-iv").is_checked()
    expect(page.get_by_test_id("allergies-banner")).to_contain_text("None found — check the file")
    wait_rows(page, 1)
    rows = diagnosis_rows(page)
    assert [r["code"] for r in rows] == ["Z47.1"], rows
    page.get_by_test_id("cancel-referral-btn").click()


def nkda_case(page):
    paste_into_new(page, (FIX / "epic-nkda.txt").read_text())
    expect(page.get_by_test_id("referral-name")).to_have_value("Evelyn Joan Pruitt")
    assert page.get_by_test_id("allergies-nkda").is_checked()
    expect(page.get_by_test_id("allergies-banner")).to_contain_text("no known allergies (NKDA)")
    expect(page.get_by_test_id("allergies-banner")).to_contain_text("verify")
    wait_rows(page, 2)
    rows = diagnosis_rows(page)
    found = sorted(r["code"] for r in rows if r["badge"] == "from referral")
    assert found == ["I50.33", "N18.31"], rows
    suggested = {r["description"]: r["code"] for r in rows if r["badge"].startswith("suggested")}
    assert suggested == {"Atrial fibrillation": "I48.91", "Generalized weakness": "M62.81", "Hypothyroidism": "E03.9"}, rows
    assert_no_junk(page, "nkda")
    page.get_by_test_id("save-referral-btn").click()
    expect(page.get_by_test_id("view-detail")).to_contain_text("Evelyn Joan Pruitt")
    expect(page.get_by_test_id("allergies-detail")).to_contain_text("NKDA")


def pcc_scan(page):
    page.get_by_test_id("nav-dashboard").click()
    drop_file(page, "dash-dropzone", FIX / "pcc-facesheet-scan.pdf", "application/pdf")
    expect(page.get_by_test_id("extract-panel")).to_be_visible(timeout=300000)
    expect(page.get_by_test_id("referral-name")).to_have_value("Margaret L Hartley")
    expect(page.get_by_test_id("referral-dob")).to_have_value("1937-04-07")
    expect(page.get_by_test_id("referral-date-received")).to_have_value("2026-11-17")
    expect(page.get_by_test_id("referral-expected-admit")).to_have_value("2026-11-20")
    expect(page.get_by_test_id("referral-payer")).to_have_value("medicare")
    wait_rows(page, 5)
    rows = diagnosis_rows(page)
    assert sorted(r["code"] for r in rows) == ["E78.5", "I48.91", "I63.9", "R13.12", "Z79.01"], rows
    allergens = [(a["allergen"], a["reaction"], a["severity"]) for a in allergy_rows(page)]
    assert allergens == [("Penicillin", "hives", "moderate"), ("Shellfish", "throat swelling", "severe"), ("Adhesive tape", "skin redness", "")], allergens
    assert_no_junk(page, "pcc scan")
    page.get_by_test_id("save-referral-btn").click()
    expect(page.get_by_test_id("view-detail")).to_contain_text("Margaret L Hartley")


def phone_layout(p, device_name, errors):
    device = dict(p.devices[device_name])
    browser = p.chromium.launch()
    ctx = browser.new_context(**device)
    page = ctx.new_page()
    watch_console(page, errors)
    page.on("dialog", lambda d: d.accept())
    page.goto(BASE)
    expect(page.get_by_test_id("dash-dropzone")).to_be_visible()
    over = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    assert over <= 1, f"{device_name}: dashboard overflows by {over}px"
    paste_into_new(page, (FIX / "epic-cellulitis.txt").read_text())
    wait_rows(page, 4)
    expect(page.get_by_test_id("verify-pill").first).to_be_visible()
    over = page.evaluate("""() => {
      const d = document.querySelector('#referral-dialog');
      const bad = [...d.querySelectorAll('input,select,button,.verify-pill,.verify-note,.allergy-banner')]
        .filter((el) => el.offsetParent && el.getBoundingClientRect().right > window.innerWidth + 1)
        .map((el) => (el.dataset.testid || el.id || el.className) + ':' + Math.round(el.getBoundingClientRect().right));
      return bad;
    }""")
    assert not over, f"{device_name}: elements past the right edge: {over}"
    page.get_by_test_id("toast").evaluate("el => el.hidden = true")
    page.locator("#diagnoses-fieldset").scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / f"qa-{device_name.replace(' ', '_')}-dx.png"))
    page.locator("#allergies-fieldset").scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / f"qa-{device_name.replace(' ', '_')}-allergies.png"))
    browser.close()


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    httpd = start_server()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        watch_console(page, errors)
        offsite = attach_external_request_log(page)
        page.on("dialog", lambda d: d.accept())
        page.goto(BASE)
        expect(page.get_by_test_id("dash-dropzone")).to_be_visible()
        scanned_epic(page)
        page.get_by_test_id("toast").evaluate("el => el.hidden = true")
        page.locator("#referral-dialog").screenshot(path=str(SHOTS / "qa-desktop-epic-scan.png"))
        clear_all_buttons(page)
        second_import_replaces_first(page)
        nkda_case(page)
        pcc_scan(page)
        assert not offsite, f"requests left the device: {offsite}"
        browser.close()
        for dev in ("iPhone 13", "iPhone SE", "Pixel 7"):
            phone_layout(p, dev, errors)
    httpd.shutdown()
    assert not errors, "console errors:\n" + "\n".join(errors)
    print("QA TESTS PASSED (no console errors, no off-device requests)")


if __name__ == "__main__":
    main()
