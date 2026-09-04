#!/usr/bin/env python3
"""Extract a DOCX lesson source into structured blocks with formatting cues.

Backward compatible with the previous version: the output still contains
``body`` (flat ordered blocks) and ``headers_footers``. Each paragraph block
now carries the formatting the planner needs to see structure:

  style        Word paragraph style name (Heading 3, Dialogue, Normal ...)
  bold         True when every non-empty run is bold
  numbered     True when the paragraph belongs to a numbered/bulleted list
  list_level   list nesting level (0-based) or null
  role         inferred role of the paragraph, see ROLE_* below
  title/body   set when an inline "Заголовок. Текст" item was split
  flags        list of structural markers found in the text

Additionally the output contains ``slides``: the same blocks grouped by
"Слайд N." headings, with lesson/module labels, an ``authorType`` taken from
an explicit ``[тип: ...]`` tag, and ``interactive`` when the slide carries an
interactivity instruction. The planner should read ``slides``; ``body`` is
kept for older tooling.

Only the standard library is used.
"""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# --- inferred roles ---------------------------------------------------------
ROLE_HEADING = "heading"          # slide / lesson / module heading
ROLE_SUBHEAD = "subhead"          # short line naming the next block (card title, column label)
ROLE_ITEM = "item"                # list item (numbered, bulleted, or inline "Title. Body")
ROLE_SPEECH = "speech"            # "Имя: реплика" or Dialogue style
ROLE_QUOTE = "quote"              # line that is a quotation only
ROLE_TEXT = "text"                # ordinary paragraph
ROLE_INSTRUCTION = "instruction"  # author instruction for the builder (interactivity, type tag)
ROLE_LABELLED = "labelled"        # "Метка: текст" that is not speech (e.g. "Квалификация: ...")
ROLE_CONNECTOR = "connector"      # a lone arrow between steps

TYPE_TAG = re.compile(r"^\[\s*тип\s*:\s*([^\]]+)\]\s*$", re.I)
INTERACTIVE = re.compile(r"интерактив", re.I)
SLIDE_HEAD = re.compile(r"^Слайд\s+(\d+)\s*[\.:]", re.I)
LESSON_HEAD = re.compile(r"^Урок\s+\d+(\.\d+)?", re.I)
MODULE_HEAD = re.compile(r"^Модуль\s+\d+", re.I)
SPEAKER = re.compile(r"^([А-ЯЁ][а-яё]+(?:\s[А-ЯЁ][а-яё]+)?)\s*:\s*\S")
LABEL = re.compile(r"^([А-ЯЁ][^:\.\!\?]{1,45}):\s+\S")
INLINE_ITEM = re.compile(r"^([А-ЯЁ«\"][^\.\!\?]{1,60})[\.\!\?]\s+(\S.+)$")
DEFAULT_SPEAKERS = {"Алексей", "Денис", "Мастер", "Рабочий", "Наставник", "Новичок", "Начальник", "Оператор", "Сборщик"}
NON_SPEAKERS = re.compile(r"^(Формат|Форма|Визуал|Пример|Например|Приложение|Плохо|Хорошо|Факт|Итог|Вывод|Сигналы|Можно|Попросите|Нужно|Важно|Лайфхак|Действие|Решение|Задача|Цель|Причина|Проверка|Обратная связь)$", re.I)
ARROW = re.compile(r"[→↓]|\s->\s")
POOR_GOOD = re.compile(r"^(плохо|хорошо|не работает|работает|так не надо|так лучше|как не надо|как надо|неправильно|правильно|до|после|было|стало)\s*[:\.]?\s*$", re.I)
EXAMPLE_HEAD = re.compile(r"^(пример|например|факт)\s*[:\.]?\s*$", re.I)
EXAMPLE_INLINE = re.compile(r"^(пример|например)\s*[:\.]", re.I)
QUESTION = re.compile(r"\?\s*$")
DEFINITION = re.compile(r"\s—\s(это|мера|способ|момент|список|таблица)\b|\bназыва(ют|ется)\b")
SEQUENCE = re.compile(r"\b(сначала|затем|потом|после этого|шаг\s\d|этап\s\d|первый (день|месяц|случай)|второй|третий)\b", re.I)


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def node_text(node: ET.Element) -> str:
    return "".join(t.text for t in node.iter() if local(t.tag) in {"t", "delText"} and t.text)


def paragraph_props(p: ET.Element, styles: dict[str, str]) -> dict:
    ppr = p.find(f"{W}pPr")
    style_id = None
    numbered = False
    level = None
    if ppr is not None:
        ps = ppr.find(f"{W}pStyle")
        if ps is not None:
            style_id = ps.get(f"{W}val")
        numpr = ppr.find(f"{W}numPr")
        if numpr is not None:
            numbered = True
            ilvl = numpr.find(f"{W}ilvl")
            if ilvl is not None:
                try:
                    level = int(ilvl.get(f"{W}val"))
                except (TypeError, ValueError):
                    level = 0
    style = styles.get(style_id, style_id or "Normal")
    runs = [r for r in p.iter() if local(r.tag) == "r"]
    texts = []
    bold_flags = []
    for r in runs:
        t = "".join(x.text for x in r.iter() if local(x.tag) == "t" and x.text)
        if not t.strip():
            continue
        texts.append(t)
        rpr = r.find(f"{W}rPr")
        b = rpr is not None and rpr.find(f"{W}b") is not None and rpr.find(f"{W}b").get(f"{W}val", "true") not in {"0", "false"}
        bold_flags.append(b)
    bold = bool(bold_flags) and all(bold_flags)
    if style and style.lower().startswith("list"):
        numbered = True
    return {"style": style, "bold": bold, "numbered": numbered, "list_level": level}


def load_styles(archive: zipfile.ZipFile) -> dict[str, str]:
    try:
        root = ET.fromstring(archive.read("word/styles.xml"))
    except KeyError:
        return {}
    out = {}
    for s in root.iter(f"{W}style"):
        sid = s.get(f"{W}styleId")
        name = s.find(f"{W}name")
        if sid and name is not None:
            out[sid] = name.get(f"{W}val", sid)
    return out


def text_flags(text: str) -> list[str]:
    flags = []
    if ARROW.search(text):
        flags.append("arrow")
    if POOR_GOOD.match(text):
        flags.append("poor_good_label")
    if EXAMPLE_HEAD.match(text):
        flags.append("example_head")
    elif EXAMPLE_INLINE.match(text):
        flags.append("example_inline")
    if QUESTION.search(text) and len(text) < 160:
        flags.append("question")
    if DEFINITION.search(text):
        flags.append("definition")
    if SEQUENCE.search(text):
        flags.append("sequence_word")
    if INTERACTIVE.search(text):
        flags.append("interactive")
    return flags


def parse_body(root: ET.Element, styles: dict[str, str]) -> list[dict]:
    container = root
    if local(root.tag) == "document":
        container = next((c for c in root.iter() if local(c.tag) == "body"), root)
    blocks: list[dict] = []
    for body_index, child in enumerate(list(container)):
        kind = local(child.tag)
        if kind == "p":
            text = node_text(child).strip()
            if not text:
                continue
            block = {"kind": "paragraph", "body_index": body_index, "text": text}
            block.update(paragraph_props(child, styles))
            block["flags"] = text_flags(text)
            blocks.append(block)
        elif kind == "tbl":
            rows = []
            for row in child.iter():
                if local(row.tag) != "tr":
                    continue
                cells = [node_text(c).strip() for c in list(row) if local(c.tag) == "tc"]
                if cells:
                    rows.append(cells)
            if rows:
                blocks.append({"kind": "table", "body_index": body_index, "rows": rows, "flags": []})
    return blocks


def is_heading(block: dict) -> str | None:
    if block["kind"] != "paragraph":
        return None
    t = block["text"]
    styled = block["style"].lower().startswith("heading") or block["bold"]
    if MODULE_HEAD.match(t) and styled:
        return "module"
    if LESSON_HEAD.match(t) and styled and len(t) < 120:
        return "lesson"
    if SLIDE_HEAD.match(t) and (styled or len(t) < 120):
        return "slide"
    if block["style"].lower() == "heading 3" and len(t) < 160:
        return "slide"
    return None


def assign_roles(blocks: list[dict], speakers: set[str]) -> None:
    """Infer roles for paragraphs inside one slide (in place)."""
    paras = [b for b in blocks if b["kind"] == "paragraph"]
    for i, b in enumerate(paras):
        t = b["text"]
        nxt = paras[i + 1] if i + 1 < len(paras) else None
        if TYPE_TAG.match(t) or "interactive" in b["flags"] and len(t) < 120:
            b["role"] = ROLE_INSTRUCTION
            continue
        if t in {"↓", "→", "->"}:
            b["role"] = ROLE_CONNECTOR
            continue
        sp = SPEAKER.match(t)
        if b["style"].lower() == "dialogue" or (sp and sp.group(1) in speakers):
            b["role"] = ROLE_SPEECH
            b["label"] = sp.group(1) if sp else None
            continue
        lb = LABEL.match(t)
        if lb and not NON_SPEAKERS.match(lb.group(1)) and not POOR_GOOD.match(lb.group(1) + ":"):
            b["role"] = ROLE_LABELLED
            b["title"] = lb.group(1)
            b["body"] = t.split(":", 1)[1].strip()
            continue
        prev = paras[i - 1] if i > 0 else None
        prev_item = prev is not None and prev.get("role") == ROLE_ITEM
        if t.endswith(";") or (prev is not None and (prev["text"].endswith(":") or (prev_item and prev["text"].endswith(";"))) and len(t) <= 160 and not t.endswith(":")):
            b["role"] = ROLE_ITEM
            continue
        if b["numbered"] or re.match(r"^\d+[\.\)]\s", t) or re.match(r"^[•\-–—]\s", t):
            b["role"] = ROLE_ITEM
            continue
        if b["style"].lower() == "heading 4" or b["bold"] and len(t) < 90:
            b["role"] = ROLE_SUBHEAD
            continue
        if "poor_good_label" in b["flags"] or "example_head" in b["flags"]:
            b["role"] = ROLE_SUBHEAD
            continue
        if re.match(r"^[«\"].+[»\"][\.\!\?]?$", t) and len(t) < 200:
            b["role"] = ROLE_QUOTE
            continue
        # unformatted subhead: short line, no terminal punctuation, followed by a longer paragraph
        if len(t) <= 70 and not re.search(r"[\.\!\?…;:]$", t) and nxt is not None and len(nxt["text"]) > len(t):
            b["role"] = ROLE_SUBHEAD
            continue
        m = INLINE_ITEM.match(t)
        if m and len(t) < 400 and len(m.group(1).split()) <= 5 and not QUESTION.search(m.group(1)):
            # "Время. Когда именно выполняется..." → title + body
            b["role"] = ROLE_ITEM
            b["title"] = m.group(1).strip()
            b["body"] = m.group(2).strip()
            continue
        b["role"] = ROLE_TEXT


def group_slides(blocks: list[dict]) -> list[dict]:
    slides: list[dict] = []
    module = lesson = None
    current = None
    for b in blocks:
        h = is_heading(b)
        if h == "module":
            module = b["text"]
            b["role"] = ROLE_HEADING
            continue
        if h == "lesson":
            lesson = b["text"]
            b["role"] = ROLE_HEADING
            continue
        if h == "slide":
            b["role"] = ROLE_HEADING
            m = SLIDE_HEAD.match(b["text"])
            current = {
                "module": module,
                "lesson": lesson,
                "sourceSlide": int(m.group(1)) if m else None,
                "title": b["text"],
                "authorType": None,
                "interactive": False,
                "blocks": [],
            }
            slides.append(current)
            continue
        if current is None:
            continue
        current["blocks"].append(b)
    speakers = set(DEFAULT_SPEAKERS)
    for b in blocks:
        if b["kind"] == "paragraph" and b["style"].lower() == "dialogue":
            m = SPEAKER.match(b["text"])
            if m:
                speakers.add(m.group(1))
    for s in slides:
        assign_roles(s["blocks"], speakers)
        for b in s["blocks"]:
            if b["kind"] != "paragraph":
                continue
            m = TYPE_TAG.match(b["text"])
            if m:
                s["authorType"] = m.group(1).strip().lower()
            if "interactive" in b["flags"] and len(b["text"]) < 160:
                s["interactive"] = True
        s["summary"] = summarize(s)
    return slides


def summarize(slide: dict) -> dict:
    """Cheap structural signature the planner can read before the text."""
    paras = [b for b in slide["blocks"] if b["kind"] == "paragraph"]
    roles = [b["role"] for b in paras]
    flags = [f for b in paras for f in b["flags"]]
    return {
        "paragraphs": len(paras),
        "chars": sum(len(b["text"]) for b in paras),
        "subheads": roles.count(ROLE_SUBHEAD),
        "items": roles.count(ROLE_ITEM),
        "speech_lines": roles.count(ROLE_SPEECH),
        "labelled": roles.count(ROLE_LABELLED),
        "connectors": roles.count(ROLE_CONNECTOR),
        "quotes": roles.count(ROLE_QUOTE),
        "tables": sum(1 for b in slide["blocks"] if b["kind"] == "table"),
        "has_arrow": "arrow" in flags,
        "has_poor_good": "poor_good_label" in flags,
        "has_example": any(f in flags for f in ("example_head", "example_inline")),
        "has_definition": "definition" in flags,
        "has_sequence_words": "sequence_word" in flags,
        "questions": flags.count("question"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_docx", type=Path)
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args()

    header_footer_re = re.compile(r"word/(?:header|footer)\d+\.xml$")
    with zipfile.ZipFile(args.input_docx) as archive:
        styles = load_styles(archive)
        document = parse_body(ET.fromstring(archive.read("word/document.xml")), styles)
        extras = {}
        for name in sorted(archive.namelist()):
            if header_footer_re.match(name):
                extras[name] = parse_body(ET.fromstring(archive.read(name)), styles)

    slides = group_slides(document)
    result = {
        "source": str(args.input_docx),
        "version": 2,
        "body": document,
        "slides": slides,
        "headers_footers": extras,
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(slides)} slides, {len(document)} blocks")


if __name__ == "__main__":
    main()
