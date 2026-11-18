#!/usr/bin/env python3
"""Render a printed referral to images and wrap them in a text-layer-free PDF."""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "test"
FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
FONT_BOLD = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
DPI = 200
PAGE = (int(8.5 * DPI), int(11 * DPI))
MARGIN = int(0.7 * DPI)
# PDF page in points (72 dpi)
PDF_W, PDF_H = 612, 792

PAGE1 = [
    ("title", "POST-ACUTE REFERRAL"),
    ("blank", ""),
    ("line", "Patient Name: Helen Ann Carter"),
    ("line", "Date of Birth: 03/17/1941"),
    ("line", "Referring Hospital: Mercy General Hospital"),
    ("line", "Insurance: Medicare"),
    ("line", "Referral Date: 11/18/2026"),
    ("line", "Proposed Discharge Date: 11/21/2026"),
    ("blank", ""),
    ("line", "Primary Diagnosis: J18.9 Pneumonia, unspecified organism"),
    ("line", "Secondary Diagnoses:"),
    ("line", "E11.9 Type 2 diabetes mellitus without complications"),
    ("line", "I10 Essential (primary) hypertension"),
]

PAGE2 = [
    ("title", "POST-ACUTE REFERRAL (page 2)"),
    ("blank", ""),
    ("line", "Allergies: Penicillin (rash), sulfa"),
    ("blank", ""),
    ("line", "Care Needs: PT, OT, oxygen"),
    ("line", "Notes: Family requests a quiet room."),
]

PHOTO = PAGE1[0:1] + PAGE1[2:] + [
    ("blank", ""),
    ("line", "Allergies: Penicillin (rash), sulfa"),
    ("blank", ""),
    ("line", "Care Needs: PT, OT, oxygen"),
    ("line", "Notes: Family requests a quiet room."),
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_BOLD if bold else FONT
    return ImageFont.truetype(str(path), size)


def render_page(lines: list[tuple[str, str]]) -> Image.Image:
    img = Image.new("RGB", PAGE, "#ffffff")
    draw = ImageDraw.Draw(img)
    y = MARGIN
    title_font = font(36, bold=True)
    body_font = font(28)
    for kind, text in lines:
        if kind == "blank":
            y += 28
            continue
        f = title_font if kind == "title" else body_font
        draw.text((MARGIN, y), text, fill="#111111", font=f)
        y += int(f.size * 1.7)
    return img


def jpeg_bytes(img: Image.Image, quality: int = 92) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def write_image_only_pdf(jpegs: list[bytes], dest: Path) -> None:
    """Write a PDF that contains only JPEG XObjects — no text operators."""
    objects: list[bytes] = []

    def add(payload: bytes) -> int:
        objects.append(payload)
        return len(objects)

    kids = []
    for jpeg in jpegs:
    # Image object first, then contents, then page — we'll patch refs after collecting.
        pass

    # Build objects: catalog(1), pages(2), then for each page: image, contents, page
    # Easier: assign numbers as we go, then fix Pages kids at the end.
    add(b"<< /Type /Catalog /Pages 2 0 R >>\n")  # 1
    pages_index = add(b"")  # 2 placeholder

    kid_refs = []
    for jpeg in jpegs:
        img_num = add(
            (
                f"<< /Type /XObject /Subtype /Image /Width {PAGE[0]} /Height {PAGE[1]} "
                f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode "
                f"/Length {len(jpeg)} >>\nstream\n"
            ).encode("ascii")
            + jpeg
            + b"\nendstream\n"
        )
        content = f"q {PDF_W} 0 0 {PDF_H} 0 0 cm /Im0 Do Q\n".encode("ascii")
        contents_num = add(
            f"<< /Length {len(content)} >>\nstream\n".encode("ascii") + content + b"endstream\n"
        )
        page_num = add(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PDF_W} {PDF_H}] "
                f"/Resources << /XObject << /Im0 {img_num} 0 R >> >> "
                f"/Contents {contents_num} 0 R >>\n"
            ).encode("ascii")
        )
        kid_refs.append(f"{page_num} 0 R")

    objects[pages_index - 1] = (
        f"<< /Type /Pages /Kids [{' '.join(kid_refs)}] /Count {len(kid_refs)} >>\n".encode("ascii")
    )

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode("ascii") + body + b"endobj\n"
    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode("ascii")
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode("ascii")
    out += (
        f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n"
    ).encode("ascii")
    dest.write_bytes(bytes(out))


def main() -> None:
    page1 = render_page(PAGE1)
    page2 = render_page(PAGE2)
    photo = render_page(PHOTO)
    pdf_path = OUT_DIR / "sample-referral-scan.pdf"
    png_path = OUT_DIR / "sample-referral-scan.png"
    jpg_path = OUT_DIR / "sample-referral-scan.jpg"
    write_image_only_pdf([jpeg_bytes(page1), jpeg_bytes(page2)], pdf_path)
    photo.save(png_path, "PNG")
    photo.save(jpg_path, "JPEG", quality=92)
    raw = pdf_path.read_bytes()
    checks = {
        "Helen Ann Carter": b"Helen Ann Carter" in raw,
        "Penicillin": b"Penicillin" in raw,
        "J18.9": b"J18.9" in raw,
        "BT": b"BT\n" in raw or b"BT " in raw,
        "Tj": b"Tj" in raw,
        "/Font": b"/Font" in raw,
        "/Image": b"/Image" in raw,
        "/DCTDecode": b"/DCTDecode" in raw,
    }
    for k, v in checks.items():
        print(f"contains {k}: {v}")
    print("wrote", pdf_path, pdf_path.stat().st_size)
    print("wrote", png_path, png_path.stat().st_size)
    print("wrote", jpg_path, jpg_path.stat().st_size)


if __name__ == "__main__":
    main()
