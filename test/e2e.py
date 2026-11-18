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
SAMPLE_SCAN = ROOT / "test" / "sample-referral-scan.pdf"
SAMPLE_SCAN_PNG = ROOT / "test" / "sample-referral-scan.png"
FIXTURES = ROOT / "test" / "fixtures"
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


def expect_extracted(page, *, name, dob, hospital, diagnosis, payer=None, source_snippet=None, timeout=15000):
    expect(page.get_by_test_id("referral-dialog")).to_be_visible(timeout=timeout)
    expect(page.get_by_test_id("extract-panel")).to_be_visible(timeout=timeout)
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
    wait_for_uncoded_with_suggestions(page, {"Hypertension": "I10", "Type 2 diabetes mellitus": "E11.9"})
    jane_dx = diagnosis_rows(page)
    assert [r["description"] for r in jane_dx] == [
        "Right hip fracture, s/p ORIF",
        "Hypertension",
        "Type 2 diabetes mellitus",
    ], jane_dx
    assert jane_dx[0]["primary"] is True
    by_desc = {r["description"]: r for r in jane_dx}
    assert by_desc["Hypertension"]["code"] == ""
    assert by_desc["Type 2 diabetes mellitus"]["code"] == ""
    expect(page.get_by_test_id("verify-pill").first).to_be_visible()
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
    expect(page.get_by_test_id("diagnoses-detail")).to_contain_text("Right hip fracture, s/p ORIF")
    expect(page.get_by_test_id("diagnoses-detail")).to_contain_text("Hypertension")
    expect(page.get_by_test_id("diagnoses-detail")).to_contain_text("Type 2 diabetes mellitus")
    expect(page.get_by_test_id("diagnoses-detail")).to_contain_text("no code found")
    expect(page.get_by_test_id("allergies-detail")).to_contain_text("not listed")


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


def diagnosis_rows(page):
    rows = page.get_by_test_id("diagnosis-row")
    out = []
    for i in range(rows.count()):
        row = rows.nth(i)
        badge = row.get_by_test_id("diagnosis-code-badge")
        out.append({
            "code": row.get_by_test_id("diagnosis-code").input_value(),
            "description": row.get_by_test_id("diagnosis-description").input_value(),
            "primary": row.get_by_test_id("diagnosis-primary").is_checked(),
            "badge": badge.inner_text() if badge.count() else "",
        })
    return out


def wait_for_suggested_codes(page, expected, timeout=20000):
    page.wait_for_function(
        """(expected) => {
          const rows = [...document.querySelectorAll('[data-testid=diagnosis-row]')];
          const map = {};
          for (const row of rows) {
            const desc = (row.querySelector('[data-testid=diagnosis-description]')?.value || '').trim();
            const code = (row.querySelector('[data-testid=diagnosis-code]')?.value || '').trim();
            if (desc) map[desc] = code;
          }
          return Object.entries(expected).every(([desc, code]) => map[desc] === code);
        }""",
        arg=expected,
        timeout=timeout,
    )


def wait_for_uncoded_with_suggestions(page, expected, timeout=20000):
    """Uncoded diagnoses stay uncoded (no invented code) but the picker offers codes."""
    page.wait_for_function(
        """(expected) => {
          const rows = [...document.querySelectorAll('[data-testid=diagnosis-row]')];
          return Object.entries(expected).every(([desc, code]) => {
            const row = rows.find((r) => (r.querySelector('[data-testid=diagnosis-description]')?.value || '').trim() === desc);
            if (!row) return false;
            const own = (row.querySelector('[data-testid=diagnosis-code]')?.value || '').trim();
            const alts = [...row.querySelectorAll('[data-testid=diagnosis-code-alternatives] option')].map((o) => o.value);
            return own === '' && alts.includes(code);
          });
        }""",
        arg=expected,
        timeout=timeout,
    )


def allergy_rows(page):
    rows = page.get_by_test_id("allergy-row")
    out = []
    for i in range(rows.count()):
        row = rows.nth(i)
        out.append({
            "allergen": row.get_by_test_id("allergy-allergen").input_value(),
            "reaction": row.get_by_test_id("allergy-reaction").input_value(),
            "severity": row.get_by_test_id("allergy-severity").input_value(),
            "type": row.get_by_test_id("allergy-type").input_value(),
        })
    return [r for r in out if r["allergen"]]


def test_multi_diagnosis_extraction(page):
    page.get_by_test_id("nav-dashboard").click()
    page.get_by_test_id("dash-paste-toggle").click()
    expect(page.get_by_test_id("dash-paste-panel")).to_be_visible()
    text = (FIXTURES / "code-then-desc.txt").read_text(encoding="utf-8")
    page.get_by_test_id("dash-paste-text").fill(text)
    page.get_by_test_id("dash-paste-apply").click()
    expect_extracted(
        page,
        name="Helen C. Park",
        dob="1941-02-11",
        hospital="Desert Regional Medical Center",
        diagnosis="E11.9 Type 2 diabetes mellitus without complications",
        payer="medicare",
        source_snippet="Helen C. Park",
    )
    rows = diagnosis_rows(page)
    codes = [r["code"] for r in rows]
    assert codes == ["E11.9", "I10", "N18.30", "Z99.81", "S72.001A"], codes
    assert rows[0]["primary"] is True
    assert "diabetes" in rows[0]["description"].lower()
    assert any("hypertension" in r["description"].lower() for r in rows)
    assert any(r["code"] == "S72.001A" and "femur" in r["description"].lower() for r in rows)

    page.get_by_test_id("toast").evaluate("el => el.hidden = true")
    page.wait_for_timeout(200)
    page.locator("#referral-dialog").screenshot(path=str(ROOT / "diagnoses-form.png"))

    page.get_by_test_id("save-referral-btn").click()
    expect(page.get_by_test_id("view-detail")).to_contain_text("Helen C. Park")
    expect(page.get_by_test_id("diagnoses-detail")).to_contain_text("E11.9")
    expect(page.get_by_test_id("diagnoses-detail")).to_contain_text("S72.001A")
    expect(page.get_by_test_id("diagnoses-detail")).to_contain_text("Primary")
    expect(page.get_by_test_id("accept-template")).to_contain_text("E11.9")
    expect(page.get_by_test_id("accept-template")).to_contain_text("N18.30")

    page.get_by_test_id("nav-referrals").click()
    page.get_by_test_id("search-input").fill("S72.001A")
    expect(page.get_by_test_id("referral-list")).to_contain_text("Helen C. Park")

    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    page.get_by_test_id("nav-settings").click()
    with page.expect_download() as csv_info:
        page.get_by_test_id("export-csv-btn").click()
    csv = csv_info.value
    csv_path = DOWNLOADS / csv.suggested_filename
    csv.save_as(str(csv_path))
    csv_text = csv_path.read_text(encoding="utf-8")
    assert "Helen C. Park" in csv_text
    assert "E11.9" in csv_text
    assert "S72.001A" in csv_text
    assert "Diagnoses" in csv_text

    with page.expect_download() as json_info:
        page.get_by_test_id("export-json-btn").click()
    payload = json_info.value
    json_path = DOWNLOADS / payload.suggested_filename
    payload.save_as(str(json_path))
    raw = json_path.read_text(encoding="utf-8")
    assert "Helen C. Park" in raw
    assert "S72.001A" in raw
    assert '"diagnoses"' in raw



def test_suggested_codes_and_allergies(page):
    page.get_by_test_id("nav-dashboard").click()
    page.get_by_test_id("dash-paste-toggle").click()
    expect(page.get_by_test_id("dash-paste-panel")).to_be_visible()
    text = (FIXTURES / "uncoded-dx-and-allergies.txt").read_text(encoding="utf-8")
    page.get_by_test_id("dash-paste-text").fill(text)
    page.get_by_test_id("dash-paste-apply").click()
    expect_extracted(
        page,
        name="Rosa M. Delgado",
        dob="1944-04-18",
        hospital="St. Mary Medical Center",
        diagnosis="Type 2 diabetes mellitus",
        payer="medicare",
        source_snippet="Rosa M. Delgado",
    )
    wait_for_uncoded_with_suggestions(page, {
        "Type 2 diabetes mellitus": "E11.9",
        "Hypertension": "I10",
        "CHF": "I50.9",
        "COPD": "J44.9",
        "CKD stage 3": "N18.30",
        "Dementia": "F03.90",
    })
    rows = diagnosis_rows(page)
    assert all(r["code"] == "" for r in rows), rows
    # The user picks a code from the suggestions for the primary diagnosis.
    page.get_by_test_id("diagnosis-code-alternatives").first.select_option("E11.9")
    expect(page.get_by_test_id("diagnosis-code").first).to_have_value("E11.9")

    allergens = allergy_rows(page)
    names = {a["allergen"].lower(): a for a in allergens}
    assert "pcn" in names, allergens
    assert names["pcn"]["reaction"].lower() == "rash"
    assert names["pcn"]["type"] == "drug"
    assert "sulfa" in names
    expect(page.get_by_test_id("allergies-banner")).to_contain_text("Allergies are safety-critical")
    expect(page.get_by_test_id("allergies-verify-note")).to_be_visible()
    expect(page.get_by_test_id("allergies-legend-badge")).to_be_visible()
    expect(page.get_by_test_id("diagnosis-code-alternatives").first).to_contain_text("E11.9")

    page.get_by_test_id("toast").evaluate("el => el.hidden = true")
    page.set_viewport_size({"width": 1440, "height": 2400})
    page.evaluate(
        """() => {
          const dlg = document.querySelector("#referral-dialog");
          const form = document.querySelector("#referral-form");
          if (dlg) { dlg.style.maxHeight = "none"; dlg.style.height = "auto"; dlg.style.width = "min(820px, calc(100vw - 24px))"; }
          if (form) { form.style.maxHeight = "none"; form.style.overflow = "visible"; }
        }"""
    )
    page.wait_for_timeout(200)
    page.locator("#referral-dialog").screenshot(path=str(ROOT / "diagnoses-form.png"))
    page.set_viewport_size({"width": 1440, "height": 900})

    page.get_by_test_id("save-referral-btn").click()
    expect(page.get_by_test_id("view-detail")).to_contain_text("Rosa M. Delgado")
    expect(page.get_by_test_id("diagnoses-detail")).to_contain_text("E11.9")
    expect(page.get_by_test_id("diagnoses-detail")).to_contain_text("Hypertension")
    expect(page.get_by_test_id("diagnoses-detail")).to_contain_text("no code found")
    expect(page.get_by_test_id("allergies-detail")).to_contain_text("PCN")
    expect(page.get_by_test_id("allergies-detail")).to_contain_text("sulfa")
    expect(page.get_by_test_id("accept-template")).to_contain_text("Allergies: PCN")
    expect(page.get_by_test_id("accept-template")).to_contain_text("E11.9")

    page.get_by_test_id("nav-referrals").click()
    page.get_by_test_id("search-input").fill("PCN")
    expect(page.get_by_test_id("referral-list")).to_contain_text("Rosa M. Delgado")

    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    page.get_by_test_id("nav-settings").click()
    with page.expect_download() as csv_info:
        page.get_by_test_id("export-csv-btn").click()
    csv_path = DOWNLOADS / csv_info.value.suggested_filename
    csv_info.value.save_as(str(csv_path))
    csv_text = csv_path.read_text(encoding="utf-8")
    assert "Rosa M. Delgado" in csv_text
    assert "E11.9" in csv_text
    assert "PCN" in csv_text
    assert "Allergies" in csv_text

    with page.expect_download() as json_info:
        page.get_by_test_id("export-json-btn").click()
    json_path = DOWNLOADS / json_info.value.suggested_filename
    json_info.value.save_as(str(json_path))
    raw = json_path.read_text(encoding="utf-8")
    assert "Rosa M. Delgado" in raw
    assert "PCN" in raw


def attach_external_request_log(page, origin=BASE.rstrip("/")):
    seen = []

    def on_request(req):
        url = req.url
        if url.startswith(origin) or url.startswith("blob:") or url.startswith("data:"):
            return
        seen.append(url)

    page.on("request", on_request)
    return seen


def assert_helen_carter_extract(page, timeout=180000):
    expect_extracted(
        page,
        name="Helen Ann Carter",
        dob="1941-03-17",
        hospital="Mercy General Hospital",
        diagnosis="J18.9 Pneumonia, unspecified organism",
        payer="medicare",
        source_snippet="Helen Ann Carter",
        timeout=timeout,
    )
    extract = page.get_by_test_id("extract-text").inner_text()
    assert "J18.9" in extract, extract
    assert "E11.9" in extract, extract
    assert "I10" in extract, extract
    assert "Penicillin" in extract, extract
    assert "sulfa" in extract.lower(), extract
    codes = {row["code"] for row in diagnosis_rows(page)}
    assert "J18.9" in codes, codes
    assert "E11.9" in codes, codes
    assert "I10" in codes, codes
    allergens = {row["allergen"].lower(): row for row in allergy_rows(page)}
    assert any("penicillin" in name for name in allergens), allergens
    assert any("sulfa" in name for name in allergens), allergens
    penicillin = next(row for name, row in allergens.items() if "penicillin" in name)
    assert "rash" in (penicillin.get("reaction") or "").lower(), penicillin


def test_scanned_pdf_and_photo_ocr(page):
    """Image-only scanned PDF and a PNG photo are read on-device and fill the form."""
    offsite = attach_external_request_log(page)
    page.get_by_test_id("nav-dashboard").click()
    drop_file(page, "dash-dropzone", SAMPLE_SCAN, "application/pdf")
    progress = page.get_by_test_id("dash-import-progress")
    expect(progress).to_be_visible(timeout=30000)
    expect(progress).to_contain_text("Reading scanned page")
    page.wait_for_function(
        """() => {
          const el = document.querySelector('[data-testid=dash-import-progress]');
          return el && /Reading scanned page 2 of 2/.test(el.textContent || "");
        }""",
        timeout=180000,
    )
    assert_helen_carter_extract(page)
    assert not offsite, f"OCR sent requests off this device: {offsite}"
    page.get_by_test_id("save-referral-btn").click()
    expect(page.get_by_test_id("view-detail")).to_contain_text("Helen Ann Carter")

    page.get_by_test_id("nav-dashboard").click()
    drop_file(page, "dash-dropzone", SAMPLE_SCAN_PNG, "image/png")
    photo_progress = page.get_by_test_id("dash-import-progress")
    expect(photo_progress).to_be_visible(timeout=30000)
    expect(photo_progress).to_contain_text("Reading scanned photo")
    assert_helen_carter_extract(page)
    assert not offsite, f"OCR sent requests off this device: {offsite}"
    page.get_by_test_id("cancel-referral-btn").click()


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

        test_multi_diagnosis_extraction(page)
        page.get_by_test_id("nav-settings").click()
        page.get_by_test_id("clear-confirm").fill("DELETE")
        page.get_by_test_id("clear-all-btn").click()
        expect(page.get_by_test_id("stat-new")).to_contain_text("0")

        test_suggested_codes_and_allergies(page)
        page.get_by_test_id("nav-settings").click()
        page.get_by_test_id("clear-confirm").fill("DELETE")
        page.get_by_test_id("clear-all-btn").click()
        expect(page.get_by_test_id("stat-new")).to_contain_text("0")

        test_scanned_pdf_and_photo_ocr(page)
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
    print("diagnoses-form:", ROOT / "diagnoses-form.png")


if __name__ == "__main__":
    main()
