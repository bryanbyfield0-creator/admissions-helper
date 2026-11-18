#!/usr/bin/env python3
"""Focused end-to-end test for on-device OCR of scanned referrals."""
from e2e import (
    BASE,
    start_server,
    sync_playwright,
    expect,
    test_scanned_pdf_and_photo_ocr,
)


def main():
    httpd = start_server()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("dialog", lambda d: d.accept())
        page.goto(BASE)
        expect(page.get_by_test_id("dash-dropzone")).to_be_visible()
        test_scanned_pdf_and_photo_ocr(page)
        browser.close()
    httpd.shutdown()
    print("OCR TESTS PASSED")


if __name__ == "__main__":
    main()
