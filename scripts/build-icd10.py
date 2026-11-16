#!/usr/bin/env python3
"""Build the compact bundled ICD-10-CM TSV from a CMS order file."""
from __future__ import annotations

import argparse
import gzip
from pathlib import Path


HEADER = (
    "# CMS ICD-10-CM FY2027 Code Descriptions in Tabular Order\n"
    "# Official public-domain code set from cms.gov\n"
    "# Source zip: https://www.cms.gov/files/zip/2027-code-descriptions-tabular-order.zip\n"
    "# Columns: code (dotted) \\t billable (1=valid for HIPAA transactions, 0=header) \\t long description\n"
)


def dotted(code: str) -> str:
    raw = code.strip().upper()
    if len(raw) <= 3:
        return raw
    return f"{raw[:3]}.{raw[3:]}"


def parse_order_file(path: Path) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if len(line) < 17:
            continue
        raw = line[6:13].strip().upper()
        valid = line[14:15]
        short = line[16:76].rstrip()
        long = line[77:].rstrip() if len(line) > 77 else short
        desc = (long or short).replace("\t", " ").strip()
        if not raw:
            continue
        rows.append((dotted(raw), "1" if valid == "1" else "0", desc))
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("order_file", type=Path, help="icd10cm_order_YYYY.txt from the CMS tabular-order zip")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "icd10cm-fy2027.tsv.gz",
    )
    args = parser.parse_args()
    rows = parse_order_file(args.order_file)
    body = "\n".join(f"{c}\t{b}\t{d}" for c, b, d in rows) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(gzip.compress((HEADER + body).encode("utf-8"), compresslevel=9, mtime=0))
    billable = sum(1 for r in rows if r[1] == "1")
    print(f"Wrote {args.output} ({args.output.stat().st_size} bytes) — {len(rows)} rows, {billable} billable")


if __name__ == "__main__":
    main()
