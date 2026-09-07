#!/usr/bin/env python3
"""Quickly scan DOCX paragraphs for possible layout and interaction markup.

The scanner reports candidates but does not decide what they mean. The
orchestrator reviews the compact JSON, asks the user whether layout marks
should be used, and writes a canonical markup map for the extractor.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


TEMPLATE_CANDIDATE = re.compile(r"^\s*(?:\[\s*тип\s*:|шаблон\s*:|макет\s*:|композиция\s*:)", re.I)
TEMPLATE_VALUE = re.compile(r"^\s*(?:\[\s*тип\s*:\s*([^\]]+)|(?:шаблон|макет|композиция)\s*:\s*([A-Za-z][\w.-]+))", re.I)
INTERACTION_CANDIDATE = re.compile(
    r"(?:интерактив|упражнен|закрепляющ\w*\s+вопрос|контрольн\w*\s+вопрос|тест(?:ирование)?|вопросы?\s+(?:к|для)\s+урок)",
    re.I,
)
QUESTION_LINE = re.compile(r"^\s*вопрос\s+\d+\s*[\.:]", re.I)


def load_extractor():
    extractor_path = Path(__file__).resolve().parents[2] / "lesson-to-template" / "scripts" / "extract_docx_blocks.py"
    spec = importlib.util.spec_from_file_location("lesson_to_template_extractor", extractor_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Не удалось загрузить извлекатель: {extractor_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def catalog_template_ids(catalog_path: Path | None) -> set[str]:
    if catalog_path is None:
        return set()
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    ids: set[str] = set()
    title = catalog.get("titleTemplate", {})
    if isinstance(title, dict) and isinstance(title.get("templateId"), str):
        ids.add(title["templateId"])
    for composition in catalog.get("compositions", {}).values():
        if isinstance(composition, dict) and isinstance(composition.get("templateId"), str):
            ids.add(composition["templateId"])
    return ids


def lesson_matches(current_lesson: str | None, requested: str | None) -> bool:
    if requested is None:
        return True
    if current_lesson is None:
        return False
    return re.search(rf"\bурок\s+{re.escape(requested)}(?:\D|$)", current_lesson, re.I) is not None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_docx", type=Path)
    parser.add_argument("output_json", type=Path)
    parser.add_argument("--lesson")
    parser.add_argument("--catalog", type=Path)
    args = parser.parse_args()

    extractor = load_extractor()
    with zipfile.ZipFile(args.input_docx) as archive:
        styles = extractor.load_styles(archive)
        document = extractor.parse_body(ET.fromstring(archive.read("word/document.xml")), styles)

    known_ids = catalog_template_ids(args.catalog)
    module = lesson = None
    source_slide = None
    slide_count = 0
    candidates = []
    interaction_sections = []
    active_interaction = None
    paragraph_ordinal = 0

    for block in document:
        if block["kind"] != "paragraph":
            continue
        paragraph_ordinal += 1
        text = block["text"]
        heading = extractor.is_heading(block)
        if heading == "module":
            module = block["text"]
            active_interaction = None
            continue
        if heading == "lesson":
            lesson = block["text"]
            source_slide = None
            active_interaction = None
            continue
        if heading == "slide" and extractor.SLIDE_HEAD.match(text):
            match = extractor.SLIDE_HEAD.match(block["text"])
            source_slide = int(match.group(1)) if match else None
            if lesson_matches(lesson, args.lesson):
                slide_count += 1
            active_interaction = None
            continue
        if not lesson_matches(lesson, args.lesson):
            continue

        kind = None
        proposed_value = None
        confidence = None
        if TEMPLATE_CANDIDATE.search(text):
            kind = "template"
            match = TEMPLATE_VALUE.search(text)
            proposed_value = next((value.strip().lower() for value in match.groups() if value), None) if match else None
            confidence = "exact" if proposed_value and (not known_ids or proposed_value in known_ids) else "needs_review"
        elif INTERACTION_CANDIDATE.search(text):
            kind = "interaction"
            proposed_value = "quiz" if re.search(r"вопрос|тест", text, re.I) else None
            confidence = "likely" if proposed_value else "needs_review"

        if kind:
            candidate = {
                "bodyIndex": block["body_index"],
                "paragraphOrdinal": paragraph_ordinal,
                "module": module,
                "lesson": lesson,
                "sourceSlide": source_slide,
                "kind": kind,
                "originalText": text,
                "proposedValue": proposed_value,
                "confidence": confidence,
            }
            candidates.append(candidate)
            if kind == "interaction":
                active_interaction = {**candidate, "questionCount": 0}
                interaction_sections.append(active_interaction)
            continue
        if active_interaction is not None and QUESTION_LINE.match(text):
            active_interaction["questionCount"] += 1

    template_candidates = [item for item in candidates if item["kind"] == "template"]
    interaction_candidates = [item for item in candidates if item["kind"] == "interaction"]
    result = {
        "version": 1,
        "source": str(args.input_docx.resolve()),
        "sourceSha256": hashlib.sha256(args.input_docx.read_bytes()).hexdigest(),
        "lessonFilter": args.lesson,
        "summary": {
            "slideCount": slide_count,
            "templateCandidateCount": len(template_candidates),
            "knownTemplateCount": sum(item["confidence"] == "exact" for item in template_candidates),
            "interactionCandidateCount": len(interaction_candidates),
            "questionCount": sum(item["questionCount"] for item in interaction_sections),
        },
        "candidates": candidates,
        "interactionSections": interaction_sections,
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
