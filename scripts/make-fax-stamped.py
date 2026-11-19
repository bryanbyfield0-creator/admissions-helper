#!/usr/bin/env python3
"""Make a fax-style referral PDF: each page is a scanned image with a small
real text layer (the e-fax header stamp) on top. Many real referrals arrive
this way. Fictional data only."""
import subprocess, sys, tempfile, glob
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

ROOT = Path(__file__).resolve().parents[1]
src = ROOT / "test/fixtures/epic/epic-cellulitis-scan.pdf"
out = ROOT / "test/fixtures/epic/epic-cellulitis-fax-stamped.pdf"
with tempfile.TemporaryDirectory() as d:
    subprocess.run(["pdftoppm", "-r", "100", "-png", str(src), f"{d}/pg"], check=True)
    pages = sorted(glob.glob(f"{d}/pg*.png"))
    c = canvas.Canvas(str(out), pagesize=letter)
    w, h = letter
    for i, p in enumerate(pages, 1):
        c.drawImage(p, 0, 0, width=w, height=h - 18)
        c.setFont("Helvetica", 8)
        c.drawString(20, h - 12, f"11/18/2026 2:14:07 PM  FROM: Riverside General Case Management  FAX: (555) 555-0100  TO: Admissions  PAGE {i} OF {len(pages)}")
        c.showPage()
    c.save()
print(out)
