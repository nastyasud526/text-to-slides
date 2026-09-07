"""Verify iSpring resource bindings created by render_ispring_interactions.py."""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NOTES_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    report_path = args.output_dir / "ispring-generation-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    pptx = Path(report["presentation"])
    project = Path(report["project"])
    if not pptx.exists() or not project.exists():
        raise SystemExit("Не найдены итоговый PPTX или папка iSpring-ресурсов.")

    manifest = ET.parse(project / "presentations.xml").getroot()
    presentation = manifest.find("presentation")
    listed = {node.attrib["src"].replace("\\", "/") for node in presentation.findall("resource")}
    missing_resources = []
    quiz_structure_errors = []
    for item in report["rendered"]:
        resource = item["resource"].replace("\\", "/")
        if resource not in listed or not (project / resource).exists():
            missing_resources.append(resource)
            continue
        if item.get("type") != "quiz":
            continue
        try:
            with zipfile.ZipFile(project / resource) as quiz_archive:
                if quiz_archive.testzip() is not None:
                    quiz_structure_errors.append({"resource": resource, "problem": "повреждён ZIP-архив"})
                    continue
                document = json.loads(quiz_archive.read("document.json").decode("utf-8"))
            slides = [slide for group in document.get("sl", {}).get("g", []) for slide in group.get("S", [])]
            questions = [slide for slide in slides if slide.get("tp") not in {"InfoSlide", "ResultSlide"}]
            if not questions:
                quiz_structure_errors.append({"resource": resource, "problem": "нет вопросов"})
            for question in questions:
                if not isinstance(question.get("D"), dict) or "d" not in question["D"] or "f" not in question["D"]:
                    quiz_structure_errors.append({
                        "resource": resource,
                        "question": question.get("i"),
                        "problem": "текст вопроса не содержит обязательные D.d и D.f",
                    })
                feedback = question.get("s", {}).get("F", {})
                if not feedback.get("c", {}).get("v", {}).get("d") or not feedback.get("i", {}).get("v", {}).get("d"):
                    quiz_structure_errors.append({
                        "resource": resource,
                        "question": question.get("i"),
                        "problem": "вопрос не содержит правильную и неправильную обратную связь",
                    })
            slide_ids = {slide.get("i") for slide in slides}
            orphan_settings = sorted(set(document.get("sr", {})) - slide_ids)
            if orphan_settings:
                quiz_structure_errors.append({
                    "resource": resource,
                    "problem": "в sr остались ссылки на отсутствующие слайды",
                    "ids": orphan_settings,
                })
        except (KeyError, json.JSONDecodeError, zipfile.BadZipFile) as error:
            quiz_structure_errors.append({"resource": resource, "problem": str(error)})

    with zipfile.ZipFile(pptx) as archive:
        names = archive.namelist()
        tag_text = "\n".join(archive.read(name).decode("utf-8", "ignore") for name in names if name.startswith("ppt/tags/"))
        note_targets = []
        for name in names:
            if not re.fullmatch(r"ppt/slides/_rels/slide\d+\.xml\.rels", name):
                continue
            root = ET.fromstring(archive.read(name))
            note_targets.extend(rel.attrib["Target"] for rel in root if rel.attrib.get("Type") == NOTES_REL)
    duplicate_notes = len(note_targets) != len(set(note_targets))
    unbound = [item["resource"] for item in report["rendered"] if Path(item["resource"]).name not in tag_text]
    result = {
        "presentation": str(pptx),
        "renderedCount": len(report["rendered"]),
        "unresolvedCount": len(report["unresolved"]),
        "resourcesListed": not missing_resources,
        "resourcesMissing": missing_resources,
        "pptxBindings": not unbound,
        "unboundResources": unbound,
        "uniqueNotes": not duplicate_notes,
        "quizStructureValid": not quiz_structure_errors,
        "quizStructureErrors": quiz_structure_errors,
    }
    if report["unresolved"] or missing_resources or unbound or duplicate_notes or quiz_structure_errors:
        raise SystemExit(json.dumps(result, ensure_ascii=False, indent=2))
    (args.output_dir / "ispring-verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
