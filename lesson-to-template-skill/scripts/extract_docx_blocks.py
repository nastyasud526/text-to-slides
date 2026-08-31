#!/usr/bin/env python3
"""Extract a DOCX source into an ordered, loss-minimizing lesson ledger.

The standard library is intentional: this is a fast first pass used before
semantic slide planning. Paragraphs nested in tables, text boxes, and content
controls are collected through the OOXML tree rather than python-docx's
paragraph-only view.
"""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def node_text(node: ET.Element) -> str:
    parts: list[str] = []
    for child in node.iter():
        if local_name(child.tag) in {"t", "delText"} and child.text:
            parts.append(child.text)
    return "".join(parts)


def parse_part(xml_bytes: bytes) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    container = root
    if local_name(root.tag) == "document":
        container = next(
            (candidate for candidate in root.iter() if local_name(candidate.tag) == "body"),
            root,
        )
    blocks: list[dict] = []
    for body_index, child in enumerate(list(container)):
        kind = local_name(child.tag)
        if kind == "p":
            text = node_text(child)
            if text:
                blocks.append({"kind": "paragraph", "body_index": body_index, "text": text})
        elif kind == "tbl":
            rows: list[list[str]] = []
            for row in child.iter():
                if local_name(row.tag) != "tr":
                    continue
                cells = [node_text(cell) for cell in list(row) if local_name(cell.tag) == "tc"]
                if cells:
                    rows.append(cells)
            if rows:
                blocks.append({"kind": "table", "body_index": body_index, "rows": rows})
    return blocks


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_docx", type=Path)
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args()

    header_footer_re = re.compile(r"word/(?:header|footer)\d+\.xml$")
    with zipfile.ZipFile(args.input_docx) as archive:
        document = parse_part(archive.read("word/document.xml"))
        extras: dict[str, list[dict]] = {}
        for name in sorted(archive.namelist()):
            if header_footer_re.match(name):
                extras[name] = parse_part(archive.read(name))

    result = {
        "source": str(args.input_docx),
        "body": document,
        "headers_footers": extras,
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
