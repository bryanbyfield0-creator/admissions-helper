#!/usr/bin/env python3
"""Run each synthetic scanned PDF through the app's real on-device OCR path in
Chromium and save the recognized text next to it (*.ocr.txt) for the Node tests."""
from pathlib import Path
from e2e import BASE, start_server, sync_playwright, expect, drop_file

FIX = Path(__file__).resolve().parent / "fixtures" / "epic"
SCANS = ["epic-cellulitis-scan.pdf", "pcc-facesheet-scan.pdf", "epic-nkda-scan.pdf"]


def main():
    httpd = start_server()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("dialog", lambda d: d.accept())
        page.goto(BASE)
        for name in SCANS:
            page.get_by_test_id("nav-dashboard").click()
            drop_file(page, "dash-dropzone", FIX / name, "application/pdf")
            expect(page.get_by_test_id("extract-panel")).to_be_visible(timeout=300000)
            text = page.get_by_test_id("extract-text").inner_text()
            (FIX / name.replace(".pdf", ".ocr.txt")).write_text(text)
            print(name, len(text), "chars")
            page.get_by_test_id("cancel-referral-btn").click()
        browser.close()
    httpd.shutdown()


if __name__ == "__main__":
    main()
