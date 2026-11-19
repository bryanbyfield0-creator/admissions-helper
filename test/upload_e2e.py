#!/usr/bin/env python3
"""Regression tests for the desktop upload path (Nov 19 2026 bug: a fax-style
PDF with a tiny real text layer over a scanned picture skipped OCR, showed no
progress and filled in nothing). Runs in Chromium and WebKit at a laptop size.
All patient data is fictional."""
import sys
import time

from e2e import BASE, ROOT, start_server, sync_playwright, expect, diagnosis_rows, allergy_rows

FAX = ROOT / "test" / "fixtures" / "epic" / "epic-cellulitis-fax-stamped.pdf"
TEXT_PDF = ROOT / "test" / "sample-referral.pdf"
BLANKISH = ROOT / "test" / "fixtures" / "nothing-to-find.txt"
NOTHING_LONG = ROOT / "test" / "fixtures" / "nothing-to-find-long.txt"
MULTI = ROOT / "test" / "fixtures" / "epic" / "multi-6page-scan.pdf"  # 2 + 1 + 1 + 2 scanned pages, read in parallel


def open_fresh(browser):
    ctx = browser.new_context(viewport={"width": 1366, "height": 768})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)
    page.goto(BASE)
    expect(page.get_by_test_id("dash-dropzone")).to_be_visible()
    return ctx, page, errors


def pick_with_chooser(page, trigger, path):
    with page.expect_file_chooser() as fc:
        trigger()
    fc.value.set_files(str(path))


def wait_progress_then_dialog(page, progress_id):
    saw = ""
    deadline = time.time() + 120
    while time.time() < deadline:
        pr = page.get_by_test_id(progress_id)
        if pr.is_visible():
            saw = saw or pr.inner_text()
        if page.get_by_test_id("extract-panel").is_visible() and not pr.is_visible():
            break
        page.wait_for_timeout(50)
    return saw


def check_fax(page, label):
    page.wait_for_function("() => [...document.querySelectorAll('[data-testid=diagnosis-code]')].some(i => i.value.trim() === 'L03.116')", timeout=60000)
    expect(page.get_by_test_id("referral-name")).to_have_value("Mateo Andres Delacruz")
    codes = [r["code"] for r in diagnosis_rows(page) if r["code"]]
    for c in ("L03.116", "I10", "E11.9"):
        assert c in codes, (label, codes)
    allergens = " ".join(a["allergen"].lower() for a in allergy_rows(page))
    assert "penicillin" in allergens and "sulfa" in allergens, (label, allergens)
    assert not page.get_by_test_id("pdf-error").is_visible(), label


def run(browser, engine):
    # 1. Fax-stamped PDF via the dashboard "Choose file" button.
    ctx, page, errors = open_fresh(browser)
    pick_with_chooser(page, lambda: page.locator("label[for=dash-file-input]").click(), FAX)
    saw = wait_progress_then_dialog(page, "dash-import-progress")
    assert saw, f"{engine}: no progress shown while reading"
    check_fax(page, f"{engine} dash chooser")

    # 2. Same file from inside the New referral dialog.
    page.get_by_test_id("cancel-referral-btn").click()
    page.get_by_test_id("new-referral-btn").click()
    pick_with_chooser(page, lambda: page.locator("label[for=pdf-upload]").click(), FAX)
    check_fax(page, f"{engine} dialog chooser")
    page.get_by_test_id("cancel-referral-btn").click()

    # 3. Clicking the empty part of the drop area opens the file picker.
    pick_with_chooser(page, lambda: page.locator("#dash-dropzone .dropzone-title").click(), TEXT_PDF)
    expect(page.get_by_test_id("referral-name")).to_have_value("Jane Marie Doe", timeout=30000)
    page.get_by_test_id("cancel-referral-btn").click()

    # 4. A drop that carries no file (a link dragged from a browser or Outlook) says so.
    page.evaluate("""() => {
      const target = document.querySelector('[data-testid=dash-dropzone]');
      const dt = new DataTransfer();
      dt.setData('text/uri-list', 'https://mail.example.com/attachment/123');
      for (const type of ['dragenter', 'dragover', 'drop']) {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'dataTransfer', { value: dt });
        target.dispatchEvent(ev);
      }
    }""")
    expect(page.get_by_test_id("dash-import-error")).to_contain_text("did not come through as a file")

    # 5a. Very little text: says it may be a low-quality scan, and "Show what it read" shows the text.
    page.get_by_test_id("dash-file-input").set_input_files(str(BLANKISH))
    expect(page.get_by_test_id("pdf-error")).to_contain_text("Couldn't read much text from this file", timeout=30000)
    report = page.get_by_test_id("read-report")
    expect(report).to_be_visible()
    expect(page.get_by_test_id("read-report-text")).to_be_hidden()
    page.locator("#read-report-toggle").click()
    rt = page.get_by_test_id("read-report-text")
    expect(rt).to_be_visible()
    expect(rt).to_contain_text("Characters read:")
    expect(rt).to_contain_text("Thanks for the call today.")
    expect(rt).to_contain_text("Sections found (0)")
    expect(page.locator("#read-report-copy")).to_be_visible()
    page.get_by_test_id("cancel-referral-btn").click()

    # 5b. Plenty of readable text but nothing to fill in: a clear message.
    page.get_by_test_id("dash-file-input").set_input_files(str(NOTHING_LONG))
    expect(page.get_by_test_id("pdf-error")).to_contain_text("Nothing could be filled in", timeout=30000)
    expect(page.get_by_test_id("read-report")).to_be_visible()
    page.get_by_test_id("cancel-referral-btn").click()

    # 6. Several scanned pages are read in parallel; every page keeps its own text, in order.
    page.get_by_test_id("dash-file-input").set_input_files(str(MULTI))
    expect(page.get_by_test_id("extract-panel")).to_be_visible(timeout=120000)
    page.wait_for_function("() => document.querySelector('[data-testid=dash-import-progress]').hidden", timeout=120000)
    txt = page.get_by_test_id("extract-text").inner_text().upper()
    order = [txt.find("DELACRUZ"), txt.find("HARTLEY"), txt.find("PRUITT"), txt.rfind("DELACRUZ")]
    assert all(i >= 0 for i in order) and order == sorted(order) and order[3] > order[2], (engine, order)
    assert txt.count("PAGE 1 OF 4") >= 2 and txt.count("PAGE 4 OF 4") >= 2, (engine, "a scanned page was lost or duplicated")
    page.get_by_test_id("cancel-referral-btn").click()

    assert not errors, f"{engine} errors: {errors}"
    ctx.close()
    print(f"{engine}: upload regression tests passed")


def main():
    httpd = start_server()
    engines = sys.argv[1:] or ["chromium", "webkit"]
    with sync_playwright() as p:
        for engine in engines:
            browser = getattr(p, engine).launch()
            try:
                run(browser, engine)
            finally:
                browser.close()
    httpd.shutdown()
    print("UPLOAD TESTS PASSED")


if __name__ == "__main__":
    main()
