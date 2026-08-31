from pathlib import Path
from zipfile import ZipFile

from lxml import etree


DOCX = Path(__file__).resolve().parents[2] / "Курс_мастеров_итоговый текст.docx"
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def text_of(node):
    parts = node.xpath('.//*[local-name()="t" or local-name()="delText"]/text()')
    return "".join(parts).strip()


with ZipFile(DOCX) as archive:
    root = etree.fromstring(archive.read("word/document.xml"))

body = root.find("w:body", NS)
inside = False
for index, child in enumerate(body):
    tag = etree.QName(child).localname
    if tag == "p":
        text = text_of(child)
        if "Урок 1.4" in text:
            inside = True
        elif inside and "Модуль 2" in text:
            break
        if inside and text:
            print(f"P\t{index}\t{text}")
    elif tag == "tbl" and inside:
        rows = []
        for row in child.xpath("./w:tr", namespaces=NS):
            cells = [text_of(cell) for cell in row.xpath("./w:tc", namespaces=NS)]
            rows.append(cells)
        for row_number, cells in enumerate(rows, start=1):
            print(f"T\t{index}\t{row_number}\t" + "\t".join(cells))
