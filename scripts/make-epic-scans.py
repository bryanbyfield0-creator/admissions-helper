#!/usr/bin/env python3
"""Render synthetic Epic/PCC referral text fixtures into noisy, image-only
scanned PDFs (no text layer) so the on-device OCR path can be tested.
All names, numbers and facilities are fictional."""
from __future__ import annotations

import io
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util

spec = importlib.util.spec_from_file_location("msr", Path(__file__).resolve().parent / "make-scanned-referral.py")
msr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(msr)

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "test" / "fixtures" / "epic"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
PAGE = msr.PAGE
MARGIN = msr.MARGIN


def render_pages(text: str, noisy: bool, seed: int) -> list[Image.Image]:
    rnd = random.Random(seed)
    body = ImageFont.truetype(FONT, 25)
    bold = ImageFont.truetype(FONT_BOLD, 26)
    line_h = 40
    pages, img, draw, y = [], None, None, 0

    def new_page():
        nonlocal img, draw, y
        img = Image.new("L", PAGE, 255)
        draw = ImageDraw.Draw(img)
        y = MARGIN
        pages.append(img)

    new_page()
    for line in text.splitlines():
        if y + line_h > PAGE[1] - MARGIN:
            new_page()
        if not line.strip():
            y += line_h // 2
            continue
        is_header = line.strip() == line.strip().upper() and len(line.strip()) < 40 or line.strip() in {
            "Contacts", "Insurance", "Allergies", "Allergen Reactions", "Past Medical History",
            "Hospital Problem List", "Assessment and Plan", "Problem List", "Surgical History",
            "Social History", "Discharge Diagnoses", "History and Physical", "Face Sheet", "Coverage",
            "Emergency Contacts", "Medications", "Diagnoses", "Diagnosis Information", "Payer Information",
            "Medications Prior to Admission",
        }
        f = bold if is_header else body
        draw.text((MARGIN + (rnd.randint(-2, 2) if noisy else 0), y), line, fill=20, font=f)
        y += line_h

    out = []
    for p in pages:
        if noisy:
            p = p.rotate(rnd.uniform(-0.9, 0.9), resample=Image.BICUBIC, fillcolor=255, expand=False)
            p = p.filter(ImageFilter.GaussianBlur(0.8))
            px = p.load()
            w, h = p.size
            for _ in range(9000):  # speckle
                x, yy = rnd.randrange(w), rnd.randrange(h)
                px[x, yy] = rnd.choice((0, 90, 160))
            # faint grey background like a fax/scan
            p = p.point(lambda v: min(255, int(v * 0.93 + 8)))
        out.append(p.convert("RGB"))
    return out


def jpeg(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def main() -> None:
    jobs = [
        ("epic-cellulitis.txt", "epic-cellulitis-scan.pdf", True, 1, 55),
        ("pcc-facesheet.txt", "pcc-facesheet-scan.pdf", True, 2, 60),
        ("epic-nkda.txt", "epic-nkda-scan.pdf", False, 3, 85),
    ]
    for src, dest, noisy, seed, q in jobs:
        text = (FIX / src).read_text()
        pages = render_pages(text, noisy, seed)
        msr.write_image_only_pdf([jpeg(p, q) for p in pages], FIX / dest)
        raw = (FIX / dest).read_bytes()
        assert b"/Font" not in raw
        print("wrote", dest, len(pages), "pages", len(raw), "bytes")


if __name__ == "__main__":
    main()
