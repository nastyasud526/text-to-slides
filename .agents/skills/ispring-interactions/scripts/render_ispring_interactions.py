"""Render approved iSpring interaction specs into an already built PPTX.

The script intentionally clones real iSpring slides and resources. It never
constructs undocumented iSpring tags from scratch and never edits a template.
"""

from __future__ import annotations

import argparse
import copy
import json
import posixpath
import re
import shutil
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET


P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
TAG_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/tags"
NOTES_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"
IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
SLIDE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
TAG_CT = "application/vnd.openxmlformats-officedocument.presentationml.tags+xml"

ET.register_namespace("p", P_NS)
ET.register_namespace("r", R_NS)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def archive_json(path: Path, member: str = "document.json") -> dict:
    with zipfile.ZipFile(path) as archive:
        return json.loads(archive.read(member).decode("utf-8"))


def write_archive_json(template: Path, destination: Path, document: dict, metainfo: dict | None = None) -> None:
    with zipfile.ZipFile(template) as source, zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as output:
        for entry in source.infolist():
            data = source.read(entry.filename)
            if entry.filename == "document.json":
                data = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            elif entry.filename == "metainfo.json" and metainfo is not None:
                data = json.dumps(metainfo, ensure_ascii=False, indent=2).encode("utf-8")
            output.writestr(entry, data)


def rich_text(text: str) -> dict:
    return {"d": [{"tp": "paragraph", "c": [{"t": text, "r": False, "l": False, "tp": "text"}]}]}


def ispring_id(prefix: str | None = None) -> str:
    value = f"{uuid.uuid4().hex[:12]}-{uuid.uuid4().hex[:12]}"
    return f"{prefix}_{value}" if prefix else value


def set_text(target: dict, text: str) -> None:
    target["d"] = rich_text(text)["d"]


def require_text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} должен содержать текст.")
    return value


def validate_interaction_spec(spec: dict) -> None:
    kind = spec.get("type")
    require_text(spec.get("title"), "interactionSpec.title")
    if kind == "quiz":
        questions = spec.get("questions")
        if not isinstance(questions, list) or not questions:
            raise ValueError("Тест должен содержать хотя бы один вопрос.")
        for question_index, question in enumerate(questions, start=1):
            question_type = question.get("type")
            prefix = f"Вопрос {question_index}"
            if question_type not in {"multiple_choice", "multiple_response", "matching"}:
                raise ValueError(f"{prefix}: неподдерживаемый тип {question_type!r}.")
            require_text(question.get("prompt"), f"{prefix}.prompt")
            feedback = question.get("feedback")
            if not isinstance(feedback, dict):
                raise ValueError(f"{prefix}.feedback должен быть объектом.")
            require_text(feedback.get("correct"), f"{prefix}.feedback.correct")
            incorrect = feedback.get("incorrect")
            if not isinstance(incorrect, (str, dict)) or not incorrect:
                raise ValueError(f"{prefix}.feedback.incorrect должен содержать текст или тексты по вариантам.")
            if question_type == "matching":
                pairs = question.get("pairs")
                if not isinstance(pairs, list) or not pairs:
                    raise ValueError(f"{prefix}: сопоставление должно содержать хотя бы одну пару.")
                for pair_index, pair in enumerate(pairs, start=1):
                    if not isinstance(pair, dict):
                        raise ValueError(f"{prefix}, пара {pair_index}: ожидается объект left/right.")
                    require_text(pair.get("left"), f"{prefix}.pairs[{pair_index}].left")
                    require_text(pair.get("right"), f"{prefix}.pairs[{pair_index}].right")
                continue
            choices = question.get("choices")
            correct = question.get("correct")
            if not isinstance(choices, list) or len(choices) < 2:
                raise ValueError(f"{prefix}: требуется не меньше двух вариантов.")
            for choice_index, choice in enumerate(choices, start=1):
                require_text(choice, f"{prefix}.choices[{choice_index}]")
            if not isinstance(correct, list) or not correct or any(not isinstance(value, int) or isinstance(value, bool) or value < 1 or value > len(choices) for value in correct):
                raise ValueError(f"{prefix}.correct должен содержать допустимые номера вариантов.")
            if question_type == "multiple_choice" and len(set(correct)) != 1:
                raise ValueError(f"{prefix}: одиночный выбор требует ровно одного правильного ответа.")
    elif kind in {"steps", "tabs"}:
        items = spec.get("items")
        if not isinstance(items, list) or not items:
            raise ValueError(f"{kind} требует хотя бы один элемент.")
        for item_index, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                raise ValueError(f"{kind}, элемент {item_index}: ожидается объект title/body.")
            require_text(item.get("title"), f"{kind}.items[{item_index}].title")
            require_text(item.get("body"), f"{kind}.items[{item_index}].body")
        for field in ("intro", "outro"):
            if spec.get(field) is not None and not isinstance(spec[field], str):
                raise ValueError(f"{kind}.{field} должен быть строкой или null.")
    else:
        raise ValueError(f"Неподдерживаемый тип: {kind}.")


def feedback_text(value: str | dict) -> str:
    if isinstance(value, str):
        return value
    return "\n".join(f"Вариант {number}: {text}" for number, text in value.items())


def apply_question_feedback(result: dict, question: dict) -> None:
    feedback = question["feedback"]
    try:
        set_text(result["s"]["F"]["c"]["v"], feedback["correct"])
        set_text(result["s"]["F"]["i"]["v"], feedback_text(feedback["incorrect"]))
    except KeyError as error:
        raise ValueError("Прототип вопроса не содержит нативные поля правильной и неправильной обратной связи.") from error


def first_prototype(group: dict, question_type: str) -> dict:
    internal = {"multiple_choice": "MultipleChoice", "multiple_response": "MultipleResponse", "matching": "Matching"}[question_type]
    try:
        return next(item for item in group["S"] if item.get("tp") == internal)
    except StopIteration as error:
        raise ValueError(f"В шаблоне теста нет прототипа {internal}.") from error


def build_choice_question(prototype: dict, question: dict, multiple: bool) -> dict:
    result = copy.deepcopy(prototype)
    result["i"] = ispring_id()
    set_text(result["D"], question["prompt"])
    choices = question["choices"]
    correct = set(question["correct"])
    source_choice = result["C"]["chs"][0]
    result["C"]["chs"] = []
    for number, label in enumerate(choices, start=1):
        choice = copy.deepcopy(source_choice)
        choice["i"] = ispring_id()
        choice["t"] = rich_text(label)
        choice["c"] = number in correct
        result["C"]["chs"].append(choice)
    apply_question_feedback(result, question)
    if not multiple and len(correct) != 1:
        raise ValueError("Одиночный выбор требует ровно одного правильного ответа.")
    return result


def build_matching_question(prototype: dict, question: dict) -> dict:
    """Populate the template's native C.m left/right pair collection."""
    result = copy.deepcopy(prototype)
    result["i"] = ispring_id()
    set_text(result["D"], question["prompt"])
    pairs = question["pairs"]
    if "C" not in result or "m" not in result["C"] or not result["C"]["m"]:
        raise ValueError("Прототип Matching не содержит C.m; требуется обновить адаптер.")
    prototype_pair = result["C"]["m"][0]
    generated = []
    for pair in pairs:
        item = copy.deepcopy(prototype_pair)
        item["i"] = ispring_id()
        for key, value in (("p", pair["left"]), ("r", pair["right"])):
            if key not in item:
                raise ValueError(f"Прототип Matching не содержит поле {key}; требуется обновить адаптер.")
            item[key]["i"] = ispring_id()
            item[key]["t"] = rich_text(value)
        generated.append(item)
    result["C"]["m"] = generated
    apply_question_feedback(result, question)
    return result


def render_quiz(template: Path, destination: Path, spec: dict) -> None:
    document = archive_json(template)
    metainfo = archive_json(template, "metainfo.json")
    group = document["sl"]["g"][0]
    info = [item for item in group["S"] if item.get("tp") == "InfoSlide"]
    questions = []
    for question in spec["questions"]:
        kind = question["type"]
        prototype = first_prototype(group, kind)
        if kind == "multiple_choice":
            questions.append(build_choice_question(prototype, question, multiple=False))
        elif kind == "multiple_response":
            questions.append(build_choice_question(prototype, question, multiple=True))
        else:
            questions.append(build_matching_question(prototype, question))
    if not questions:
        raise ValueError("Тест не содержит вопросов.")
    group["T"] = spec["title"]
    group["S"] = info + questions
    # QuizMaker keeps per-slide rendering settings in ``sr``.  The template
    # contains settings for its sample questions; leaving those orphaned after
    # replacing the sample list makes the generated quiz unreadable in iSpring.
    active_slide_ids = [item["i"] for item in group["S"]]
    source_slide_settings = document.get("sr", {})
    fallback_settings = next(iter(source_slide_settings.values()), {"applyMode": "applyToSameThemeName"})
    document["sr"] = {
        slide_id: copy.deepcopy(source_slide_settings.get(slide_id, fallback_settings))
        for slide_id in active_slide_ids
    }
    document["i"] = ispring_id("quiz")
    document["T"] = spec["title"]
    metainfo["title"] = spec["title"]
    write_archive_json(template, destination, document, metainfo)


def render_visuals(template: Path, destination: Path, spec: dict) -> None:
    document = archive_json(template)
    content = document["C"]
    prototype = content["is"][0]
    generated = []
    for item_spec in spec["items"]:
        item = copy.deepcopy(prototype)
        item["i"] = ispring_id("item")
        set_text(item["t"], item_spec["title"])
        set_text(item["c"], item_spec["body"])
        generated.append(item)
    if not generated:
        raise ValueError(f"{spec['type']} требует хотя бы один элемент.")
    content["is"] = generated
    if spec.get("intro"):
        content["i"]["v"] = True
        set_text(content["i"]["t"], spec["intro"])
    else:
        content["i"]["v"] = False
    if spec.get("outro"):
        content["s"]["v"] = True
        set_text(content["s"]["t"], spec["outro"])
    else:
        content["s"]["v"] = False
    write_archive_json(template, destination, document)


def xml(data: bytes) -> ET.Element:
    return ET.fromstring(data)


def xml_bytes(root: ET.Element) -> bytes:
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def rel_target(base: str, target: str) -> str:
    return str(PurePosixPath(base).parent.joinpath(target).resolve()) if target.startswith("/") else str(PurePosixPath(base).parent.joinpath(target))


def relationship_target(base: str, target: str) -> str:
    return str(PurePosixPath(base).parent.joinpath(target)).replace("\\", "/")


def slide_parts(parts: dict[str, bytes]) -> list[str]:
    presentation = xml(parts["ppt/presentation.xml"])
    rels = xml(parts["ppt/_rels/presentation.xml.rels"])
    targets = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
    return ["ppt/" + targets[node.attrib[f"{{{R_NS}}}id"]].lstrip("/") for node in presentation.findall(f".//{{{P_NS}}}sldId")]


def next_part(parts: dict[str, bytes], pattern: str) -> int:
    values = [int(match.group(1)) for name in parts if (match := re.fullmatch(pattern, name))]
    return max(values, default=0) + 1


def slide_rels_path(slide_name: str) -> str:
    name = PurePosixPath(slide_name).name
    return f"ppt/slides/_rels/{name}.rels"


def resolve_from_slide(slide_name: str, target: str) -> str:
    return posixpath.normpath(str(PurePosixPath(slide_name).parent.joinpath(target)).replace("\\", "/"))


def update_tag(root: ET.Element, resource_path: Path, project_name: str) -> None:
    values = {tag.attrib.get("name"): tag for tag in root.findall(f"{{{P_NS}}}tag")}
    is_quiz = "ISPRING_RESOURCE_QUIZ" in values
    relative = str(Path(project_name) / resource_path.parent.name / resource_path.name).replace("/", "\\")
    if is_quiz:
        values["ISPRING_RESOURCE_QUIZ"].set("val", resource_path.name)
        values["ISPRING_QUIZ_FULL_PATH"].set("val", str(resource_path))
        values["ISPRING_QUIZ_RELATIVE_PATH"].set("val", relative)
    else:
        values["ISPRING_INTERACTION_FULL_PATH"].set("val", str(resource_path))
        values["ISPRING_INTERACTION_RELATIVE_PATH"].set("val", relative)
    uid = values.get("GENSWF_SLIDE_UID")
    if uid is not None:
        uid.set("val", f"{{{str(uuid.uuid4()).upper()}}}:1")


def copy_player_tag(parts: dict[str, bytes], template_parts: dict[str, bytes]) -> None:
    rels_name = "ppt/_rels/presentation.xml.rels"
    rels = xml(parts[rels_name])
    if any(rel.attrib.get("Type") == TAG_REL for rel in rels):
        return
    source_rels = xml(template_parts[rels_name])
    source = next((rel for rel in source_rels if rel.attrib.get("Type") == TAG_REL), None)
    if source is None:
        return
    source_tag = "ppt/" + source.attrib["Target"].lstrip("/")
    tag_no = next_part(parts, r"ppt/tags/tag(\d+)\.xml")
    destination = f"ppt/tags/tag{tag_no}.xml"
    parts[destination] = template_parts[source_tag]
    used = {rel.attrib["Id"] for rel in rels}
    index = 1
    while f"rId{index}" in used:
        index += 1
    ET.SubElement(rels, f"{{{REL_NS}}}Relationship", {"Id": f"rId{index}", "Type": TAG_REL, "Target": f"tags/tag{tag_no}.xml"})
    parts[rels_name] = xml_bytes(rels)


def replace_slide(parts: dict[str, bytes], template_parts: dict[str, bytes], target_slide: str, template_slide: str, resource_path: Path, project_name: str) -> None:
    source_rels_name = slide_rels_path(template_slide)
    target_rels_name = slide_rels_path(target_slide)
    source_rels = xml(template_parts[source_rels_name])
    target_rels = xml(parts[target_rels_name])
    target_layout = next(rel for rel in target_rels if rel.attrib.get("Type", "").endswith("/slideLayout"))
    layout_relationship = copy.deepcopy(target_layout)
    used_ids = {rel.attrib["Id"] for rel in source_rels if not rel.attrib.get("Type", "").endswith("/slideLayout")}
    next_id = 1
    while f"rId{next_id}" in used_ids:
        next_id += 1
    layout_relationship.set("Id", f"rId{next_id}")
    tag_number = next_part(parts, r"ppt/tags/tag(\d+)\.xml")

    for rel in list(source_rels):
        kind = rel.attrib.get("Type")
        if kind and kind.endswith("/slideLayout"):
            source_rels.remove(rel)
            source_rels.append(layout_relationship)
        elif kind == IMAGE_REL:
            source_part = resolve_from_slide(template_slide, rel.attrib["Target"])
            extension = PurePosixPath(source_part).suffix
            destination = f"ppt/media/ispring-{uuid.uuid4().hex[:12]}{extension}"
            parts[destination] = template_parts[source_part]
            rel.set("Target", "../media/" + PurePosixPath(destination).name)
        elif kind == TAG_REL:
            source_tag = resolve_from_slide(template_slide, rel.attrib["Target"])
            tag = xml(template_parts[source_tag])
            update_tag(tag, resource_path, project_name)
            destination = f"ppt/tags/tag{tag_number}.xml"
            parts[destination] = xml_bytes(tag)
            rel.set("Target", f"../tags/tag{tag_number}.xml")
        elif kind == NOTES_REL:
            source_notes = resolve_from_slide(template_slide, rel.attrib["Target"])
            target_notes_rel = next((item for item in target_rels if item.attrib.get("Type") == NOTES_REL), None)
            if target_notes_rel is None:
                raise ValueError(f"Слайд {target_slide} не содержит заметок для iSpring-клона.")
            target_notes = resolve_from_slide(target_slide, target_notes_rel.attrib["Target"])
            notes = template_parts[source_notes].replace(template_slide.encode(), target_slide.encode())
            parts[target_notes] = notes
            rel.set("Target", target_notes_rel.attrib["Target"])

    parts[target_slide] = template_parts[template_slide]
    parts[target_rels_name] = xml_bytes(source_rels)


def ensure_tag_content_types(parts: dict[str, bytes]) -> None:
    root = xml(parts["[Content_Types].xml"])
    existing = {item.attrib.get("PartName") for item in root.findall(f"{{{CT_NS}}}Override")}
    for name in parts:
        if not name.startswith("ppt/tags/"):
            continue
        part_name = "/" + name
        if part_name not in existing:
            ET.SubElement(root, f"{{{CT_NS}}}Override", {"PartName": part_name, "ContentType": TAG_CT})
    parts["[Content_Types].xml"] = xml_bytes(root)


def update_project_manifest(output_project: Path, presentation: Path, resources: list[Path]) -> None:
    root = ET.parse(output_project / "presentations.xml").getroot()
    presentation_node = root.find("presentation")
    presentation_node.set("src", str(presentation))
    for node in list(presentation_node):
        presentation_node.remove(node)
    for resource in resources:
        ET.SubElement(presentation_node, "resource", {"src": str(resource.relative_to(output_project)).replace("/", "\\")})
    ET.ElementTree(root).write(output_project / "presentations.xml", encoding="utf-8", xml_declaration=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-pptx", type=Path, required=True)
    parser.add_argument("--lesson-plan", type=Path, required=True)
    parser.add_argument("--template-pptx", type=Path, required=True)
    parser.add_argument("--template-project", type=Path, required=True)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.output_dir.exists():
        raise SystemExit(f"Выходная папка уже существует: {args.output_dir}")
    for source in (args.input_pptx, args.lesson_plan, args.template_pptx, args.template_project, args.registry):
        if not source.exists():
            raise SystemExit(f"Не найден вход: {source}")

    plan, registry = read_json(args.lesson_plan), read_json(args.registry)
    args.output_dir.mkdir(parents=True)
    output_pptx = args.output_dir / args.input_pptx.name
    output_project = args.output_dir / args.template_project.name
    shutil.copytree(args.template_project, output_project)
    resources: list[Path] = []
    unresolved, rendered = [], []
    with zipfile.ZipFile(args.input_pptx) as source, zipfile.ZipFile(args.template_pptx) as template:
        parts = {entry.filename: source.read(entry.filename) for entry in source.infolist()}
        template_parts = {entry.filename: template.read(entry.filename) for entry in template.infolist()}
    output_slides = slide_parts(parts)
    template_slides = slide_parts(template_parts)

    for output_index, item in enumerate(plan["slides"], start=1):
        if not item.get("interactive"):
            continue
        spec = item.get("interactionSpec")
        if not spec:
            unresolved.append({"sourceSlide": item.get("sourceSlide"), "sourceText": item.get("sourceText", ""), "reason": "Не создан interactionSpec."})
            continue
        kind = spec.get("type")
        if kind not in registry["templates"]:
            unresolved.append({"sourceSlide": item.get("sourceSlide"), "sourceText": item.get("sourceText", ""), "reason": f"Неподдерживаемый тип: {kind}."})
            continue
        try:
            validate_interaction_spec(spec)
        except ValueError as error:
            unresolved.append({"sourceSlide": item.get("sourceSlide"), "sourceText": item.get("sourceText", ""), "reason": str(error)})
            continue
        entry = registry["templates"][kind]
        source_resource = args.template_project / entry["resource"]
        generated_resource = output_project / Path(entry["resource"]).parent / f"generated_{kind}_{uuid.uuid4().hex[:8]}{source_resource.suffix}"
        generated_resource.parent.mkdir(parents=True, exist_ok=True)
        if kind == "quiz":
            render_quiz(source_resource, generated_resource, spec)
        else:
            render_visuals(source_resource, generated_resource, spec)
        replace_slide(parts, template_parts, output_slides[output_index - 1], template_slides[entry["sourceSlide"] - 1], generated_resource, output_project.name)
        resources.append(generated_resource)
        rendered.append({"sourceSlide": item.get("sourceSlide"), "outputSlide": output_index, "type": kind, "resource": str(generated_resource.relative_to(output_project))})

    ensure_tag_content_types(parts)
    copy_player_tag(parts, template_parts)
    with zipfile.ZipFile(output_pptx, "w", zipfile.ZIP_DEFLATED) as output:
        for name, data in parts.items():
            output.writestr(name, data)
    update_project_manifest(output_project, output_pptx, resources)
    report = {"presentation": str(output_pptx), "project": str(output_project), "rendered": rendered, "unresolved": unresolved}
    (args.output_dir / "ispring-generation-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output_dir / "ispring-unresolved.json").write_text(json.dumps(unresolved, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
