#!/usr/bin/env python3
"""End-to-end tests for Admissions Tracker."""
from __future__ import annotations

import http.server
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path("/workspace/admissions-helper")
PORT = 8876
BASE = f"http://127.0.0.1:{PORT}/"
SAMPLE = ROOT / "test" / "sample-referral.pdf"
SAMPLE_DOCX = ROOT / "test" / "sample-referral.docx"
SAMPLE_TXT = ROOT / "test" / "sample-referral.txt"
DOWNLOADS = ROOT / "test" / "downloads"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):  # noqa: A003
        pass


class ReuseServer(socketserver.TCPServer):
    allow_reuse_address = True


def start_server():
    httpd = ReuseServer(("127.0.0.1", PORT), QuietHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd



def drop_file(page, test_id, path, mime=""):
    payload = list(path.read_bytes())
    page.evaluate(
        """([id, name, mime, data]) => {
          const target = document.querySelector(`[data-testid="${id}"]`);
          const dt = new DataTransfer();
          const file = new File([new Uint8Array(data)], name, { type: mime });
          dt.items.add(file);
          const fire = (type) => {
            const ev = new Event(type, { bubbles: true, cancelable: true, composed: true });
            Object.defineProperty(ev, "dataTransfer", { value: dt });
            target.dispatchEvent(ev);
          };
          target.classList.add("is-dragover");
          fire("dragenter");
          fire("dragover");
          fire("drop");
        }""",
        [test_id, path.name, mime, payload],
    )


def expect_extracted(page, *, name, dob, hospital, diagnosis, payer=None, source_snippet=None):
    expect(page.get_by_test_id("referral-dialog")).to_be_visible()
    expect(page.get_by_test_id("extract-panel")).to_be_visible(timeout=15000)
    expect(page.get_by_test_id("review-banner")).to_be_visible()
    expect(page.get_by_test_id("referral-name")).to_have_value(name)
    expect(page.get_by_test_id("referral-dob")).to_have_value(dob)
    expect(page.get_by_test_id("referral-hospital")).to_have_value(hospital)
    expect(page.get_by_test_id("referral-diagnosis")).to_have_value(diagnosis)
    if payer:
        expect(page.get_by_test_id("referral-payer")).to_have_value(payer)
    if source_snippet:
        expect(page.get_by_test_id("extract-text")).to_contain_text(source_snippet)


def test_dashboard_drops_and_paste(page):
    page.get_by_test_id("nav-dashboard").click()
    expect(page.get_by_test_id("dash-dropzone")).to_be_visible()

    drop_file(page, "dash-dropzone", SAMPLE, "application/pdf")
    expect_extracted(
        page,
        name="Jane Marie Doe",
        dob="1948-03-14",
        hospital="Inland Valley Medical Center",
        diagnosis="Right hip fracture, s/p ORIF",
        payer="medicare-medicaid",
        source_snippet="Jane Marie Doe",
    )
    page.get_by_test_id("save-referral-btn").click()
    expect(page.get_by_test_id("view-detail")).to_contain_text("Jane Marie Doe")

    page.get_by_test_id("nav-dashboard").click()
    drop_file(
        page,
        "dash-dropzone",
        SAMPLE_DOCX,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    expect_extracted(
        page,
        name="Robert Alan Chen",
        dob="1955-01-22",
        hospital="Arrowhead Regional Medical Center",
        diagnosis="CVA with left-sided weakness",
        payer="mco",
        source_snippet="Robert Alan Chen",
    )
    assert page.get_by_test_id("need-pt").is_checked()
    assert page.get_by_test_id("need-st").is_checked()
    page.get_by_test_id("save-referral-btn").click()
    expect(page.get_by_test_id("view-detail")).to_contain_text("Robert Alan Chen")

    page.get_by_test_id("nav-dashboard").click()
    drop_file(page, "dash-dropzone", SAMPLE_TXT, "text/plain")
    expect_extracted(
        page,
        name="Maria Elena Santos",
        dob="1943-08-09",
        hospital="St. Bernardine Medical Center",
        diagnosis="Pneumonia, deconditioning",
        payer="medicaid",
        source_snippet="Maria Elena Santos",
    )
    page.get_by_test_id("save-referral-btn").click()
    expect(page.get_by_test_id("view-detail")).to_contain_text("Maria Elena Santos")

    page.get_by_test_id("nav-dashboard").click()
    page.get_by_test_id("dash-paste-toggle").click()
    expect(page.get_by_test_id("dash-paste-panel")).to_be_visible()
    page.get_by_test_id("dash-paste-text").fill(
        "Patient Name: Anita Flores\n"
        "Date of Birth: 04/02/1960\n"
        "Referring Hospital: Community Hospital of San Bernardino\n"
        "Primary Diagnosis: Left total knee arthroplasty\n"
        "Insurance: Private insurance\n"
        "Referral Date: 11/13/2026\n"
        "Care Needs: PT, OT, wound care\n"
    )
    page.get_by_test_id("dash-paste-apply").click()
    expect_extracted(
        page,
        name="Anita Flores",
        dob="1960-04-02",
        hospital="Community Hospital of San Bernardino",
        diagnosis="Left total knee arthroplasty",
        payer="private",
        source_snippet="Anita Flores",
    )
    page.get_by_test_id("save-referral-btn").click()
    expect(page.get_by_test_id("view-detail")).to_contain_text("Anita Flores")

    # Unsupported older Word .doc stays on the dashboard with a clear error
    page.get_by_test_id("nav-dashboard").click()
    doc_path = DOWNLOADS / "old-referral.doc"
    doc_path.write_bytes(b"this is not a real word document")
    drop_file(page, "dash-dropzone", doc_path, "application/msword")
    expect(page.get_by_test_id("dash-import-error")).to_be_visible()
    expect(page.get_by_test_id("dash-import-error")).to_contain_text("Older Word .doc")
    expect(page.get_by_test_id("referral-dialog")).not_to_be_visible()

    page.get_by_test_id("nav-referrals").click()
    page.get_by_test_id("search-input").fill("")
    expect(page.get_by_test_id("referral-list")).to_contain_text("Jane Marie Doe")
    expect(page.get_by_test_id("referral-list")).to_contain_text("Robert Alan Chen")
    expect(page.get_by_test_id("referral-list")).to_contain_text("Maria Elena Santos")
    expect(page.get_by_test_id("referral-list")).to_contain_text("Anita Flores")


def add_manual_referral(page):
    page.get_by_test_id("new-referral-btn").click()
    expect(page.get_by_test_id("referral-dialog")).to_be_visible()
    page.get_by_test_id("referral-name").fill("M.R.")
    page.get_by_test_id("referral-dob").fill("1952-06-02")
    page.get_by_test_id("referral-hospital").fill("San Bernardino Community Hospital")
    page.get_by_test_id("referral-diagnosis").fill("CHF exacerbation")
    page.get_by_test_id("referral-payer").select_option("medicare")
    page.get_by_test_id("referral-date-received").fill("2026-11-13")
    # expected admit = today in the browser's local zone
    today = page.evaluate("() => { const d=new Date(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${d.getFullYear()}-${m}-${day}`; }")
    page.get_by_test_id("referral-expected-admit").fill(today)
    page.get_by_test_id("need-pt").check()
    page.get_by_test_id("need-ot").check()
    page.get_by_test_id("referral-notes").fill("Family requests a private room if available.")
    page.get_by_test_id("save-referral-btn").click()
    expect(page.get_by_test_id("view-detail")).to_be_visible()
    expect(page.get_by_test_id("view-detail")).to_contain_text("M.R.")
    return today


def add_pdf_referral(page):
    page.get_by_test_id("new-referral-btn").click()
    expect(page.get_by_test_id("referral-dialog")).to_be_visible()
    page.get_by_test_id("pdf-upload").set_input_files(str(SAMPLE))
    expect(page.get_by_test_id("extract-panel")).to_be_visible(timeout=15000)
    expect(page.get_by_test_id("review-banner")).to_be_visible()
    extract = page.get_by_test_id("extract-text")
    expect(extract).to_contain_text("Jane Marie Doe")
    expect(extract).to_contain_text("03/14/1948")
    expect(extract.locator("mark").first).to_be_visible()
    expect(page.get_by_test_id("referral-name")).to_have_value("Jane Marie Doe")
    expect(page.get_by_test_id("referral-dob")).to_have_value("1948-03-14")
    expect(page.get_by_test_id("referral-hospital")).to_have_value("Inland Valley Medical Center")
    expect(page.get_by_test_id("referral-diagnosis")).to_have_value("Right hip fracture, s/p ORIF")
    expect(page.get_by_test_id("referral-payer")).to_have_value("medicare-medicaid")
    expect(page.get_by_test_id("referral-date-received")).to_have_value("2026-11-13")
    expect(page.get_by_test_id("referral-expected-admit")).to_have_value("2026-11-14")
    assert page.get_by_test_id("need-pt").is_checked()
    assert page.get_by_test_id("need-ot").is_checked()
    assert page.get_by_test_id("need-wound").is_checked()
    assert page.get_by_test_id("need-iv").is_checked()
    page.get_by_test_id("save-referral-btn").click()
    expect(page.get_by_test_id("view-detail")).to_contain_text("Jane Marie Doe")
    expect(page.get_by_test_id("view-detail")).to_contain_text("Text saved from the file")


def move_statuses_and_checklist(page):
    # Jane is open. Walk the pipeline and complete the checklist.
    for status, label in [
        ("reviewing", "Reviewing"),
        ("pending-auth", "Pending insurance auth"),
        ("accepted", "Accepted"),
        ("admitted", "Admitted"),
    ]:
        page.locator(f'[data-set-status="{status}"]').click()
        expect(page.get_by_test_id("detail-status")).to_have_text(label)

    checks = [
        "insurance-verified",
        "auth-obtained",
        "hp-received",
        "med-list",
        "face-sheet",
        "discharge-summary",
        "bed-assigned",
        "family-contacted",
        "consent-signed",
        "orders-received",
        "transport-arranged",
        "special-needs",
    ]
    for item in checks:
        box = page.get_by_test_id(f"check-{item}")
        if not box.is_checked():
            box.check()
    expect(page.get_by_test_id("checklist-progress")).to_contain_text("12 of 12 complete (100%)")
    expect(page.get_by_test_id("status-history")).to_contain_text("Admitted")


def check_dashboard(page):
    page.get_by_test_id("nav-dashboard").click()
    expect(page.get_by_test_id("stat-new")).to_contain_text("1")
    expect(page.get_by_test_id("stat-admitted")).to_contain_text("1")
    expect(page.get_by_test_id("stat-reviewing")).to_contain_text("0")
    expect(page.get_by_test_id("awaiting-count")).to_have_text("1")
    expect(page.get_by_test_id("conversion-rate")).to_have_text("100%")
    expect(page.get_by_test_id("today-admits")).to_contain_text("M.R.")
    expect(page.get_by_test_id("today-admits")).to_contain_text("Jane Marie Doe")


def export_and_clear_prep(page):
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    page.get_by_test_id("nav-settings").click()
    with page.expect_download() as dl_info:
        page.get_by_test_id("export-json-btn").click()
    download = dl_info.value
    json_path = DOWNLOADS / download.suggested_filename
    download.save_as(str(json_path))
    text = json_path.read_text(encoding="utf-8")
    assert "Jane Marie Doe" in text
    assert "M.R." in text
    with page.expect_download() as csv_info:
        page.get_by_test_id("export-csv-btn").click()
    csv = csv_info.value
    csv_path = DOWNLOADS / csv.suggested_filename
    csv.save_as(str(csv_path))
    csv_text = csv_path.read_text(encoding="utf-8")
    assert "Jane Marie Doe" in csv_text
    assert "M.R." in csv_text
    return json_path, csv_path


def test_persistence(page):
    page.reload()
    expect(page.get_by_test_id("stat-new")).to_contain_text("1")
    expect(page.get_by_test_id("stat-admitted")).to_contain_text("1")
    expect(page.get_by_test_id("today-admits")).to_contain_text("M.R.")
    page.get_by_test_id("nav-referrals").click()
    expect(page.get_by_test_id("referral-list")).to_contain_text("Jane Marie Doe")
    expect(page.get_by_test_id("referral-list")).to_contain_text("M.R.")
    page.get_by_test_id("search-input").fill("hip fracture")
    expect(page.get_by_test_id("referral-list")).to_contain_text("Jane Marie Doe")
    expect(page.get_by_test_id("referral-list")).not_to_contain_text("M.R.")


def clear_all(page):
    page.get_by_test_id("nav-settings").click()
    page.get_by_test_id("clear-confirm").fill("DELETE")
    page.get_by_test_id("clear-all-btn").click()
    expect(page.get_by_test_id("view-dashboard")).to_be_visible()
    expect(page.get_by_test_id("stat-new")).to_contain_text("0")
    expect(page.get_by_test_id("stat-admitted")).to_contain_text("0")
    expect(page.get_by_test_id("today-admits")).to_contain_text("No referrals yet")


def screenshots(page, context):
    page.get_by_test_id("nav-dashboard").click()
    page.get_by_test_id("toast").evaluate("el => el.hidden = true")
    page.wait_for_timeout(200)
    page.screenshot(path=str(ROOT / "desktop.png"), full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_test_id("nav-dashboard").click()
    page.wait_for_timeout(200)
    page.screenshot(path=str(ROOT / "mobile.png"), full_page=True)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.get_by_test_id("nav-dashboard").click()


def main():
    httpd = start_server()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            accept_downloads=True,
        )
        page = context.new_page()
        page.on("dialog", lambda d: d.accept())
        page.goto(BASE)
        expect(page.get_by_role("heading", name="Admissions Tracker")).to_be_visible()
        expect(page.get_by_test_id("privacy-strip")).to_be_visible()
        expect(page.get_by_test_id("dash-dropzone")).to_be_visible()

        add_manual_referral(page)
        add_pdf_referral(page)
        move_statuses_and_checklist(page)
        check_dashboard(page)
        export_and_clear_prep(page)
        screenshots(page, context)
        test_persistence(page)
        clear_all(page)

        test_dashboard_drops_and_paste(page)
        page.get_by_test_id("nav-settings").click()
        page.get_by_test_id("clear-confirm").fill("DELETE")
        page.get_by_test_id("clear-all-btn").click()
        expect(page.get_by_test_id("stat-new")).to_contain_text("0")

        # Mobile smoke: empty state after clear, then add one referral
        page.set_viewport_size({"width": 390, "height": 844})
        page.get_by_test_id("new-referral-btn").click()
        page.get_by_test_id("referral-name").fill("A.B.")
        page.get_by_test_id("save-referral-btn").click()
        expect(page.get_by_test_id("view-detail")).to_contain_text("A.B.")
        page.get_by_test_id("nav-settings").click()
        page.get_by_test_id("clear-confirm").fill("DELETE")
        page.get_by_test_id("clear-all-btn").click()
        expect(page.get_by_test_id("stat-new")).to_contain_text("0")

        browser.close()
    httpd.shutdown()
    print("ALL TESTS PASSED")
    print("desktop:", ROOT / "desktop.png")
    print("mobile:", ROOT / "mobile.png")


if __name__ == "__main__":
    main()
