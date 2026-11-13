#!/usr/bin/env python3
"""End-to-end tests for Weeshee Admissions Helper."""
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
    expect(page.get_by_test_id("view-detail")).to_contain_text("Text saved from PDF")


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
        expect(page.get_by_role("heading", name="Weeshee Admissions Helper")).to_be_visible()
        expect(page.get_by_test_id("privacy-strip")).to_be_visible()

        add_manual_referral(page)
        add_pdf_referral(page)
        move_statuses_and_checklist(page)
        check_dashboard(page)
        export_and_clear_prep(page)
        screenshots(page, context)
        test_persistence(page)
        clear_all(page)

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
