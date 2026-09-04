#!/usr/bin/env python3
"""Compare lesson-plan.json files with a gold template markup (CSV).

Usage:
    eval_plan.py gold.csv plan1.json [plan2.json ...] [--report report.json]

gold.csv is the semicolon-separated file with columns
    урок; слайд; templateId; примечание
where "урок" starts with "Урок X.Y" and "слайд" starts with "Слайд N.".

Each plan is a lesson-plan.json produced by lesson-to-template. Content
slides are matched by (lesson number, sourceSlide). Dialogue items have no
sourceSlide and are only counted.

Three accuracies are reported:
    exact      the same templateId
    equivalent the same templateId or one from the same equivalence class
               (variants that differ only by count/capacity or that were
               treated as interchangeable when the gold set was built)
    family     the same semantic family (text / example / compare / ...)

Misses are listed as "expected -> got" pairs sorted by frequency, because
the pairs tell which catalog neighbours the model confuses.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

LESSON_RE = re.compile(r"Урок\s+(\d+\.\d+)", re.I)
SLIDE_RE = re.compile(r"Слайд\s+(\d+)", re.I)

FAMILY = {
    "text.plain": "text", "text.illustration": "text", "text.long.illustration": "text",
    "text.key-idea": "text", "key-idea.quote": "text", "text.character-comment": "text",
    "intro.body.conclusion": "text",
    "text.example": "example", "example.full": "example", "thesis.example.illustration": "example",
    "term.explanation": "concept", "context.definition.explanation": "concept",
    "term.context.explanation.example": "concept",
    "compare.poor-good": "compare", "compare.two.intro.short": "compare",
    "compare.two.intro.detailed": "compare", "compare.two.no-intro": "compare",
    "situation.action.a": "situation", "situation.action.b": "situation",
    "problem.solution": "situation", "process.situation-outcome.4": "situation",
    "cards.3": "list", "cards.4": "list", "cards.4.intro": "list", "cards.5.intro": "list",
    "cards.6": "list", "cards.6.columns": "list", "numbered-list.3": "list",
    "numbered-list.4": "list", "numbered-list.5": "list", "numbered-list.6": "list",
    "numbered-list.4.illustration": "list", "list.6.center-message": "list",
    "classification.3": "classification", "classification.4": "classification",
    "process.4": "process", "process.6": "process", "process.4.stages": "process",
    "process.cards.4": "process", "process.4.detailed": "process", "process.3.detailed": "process",
    "timeline.5": "process",
    "statistics.3": "data", "statistics.4": "data",
    "checklist.6": "checklist",
    "staging.blank": "staging", "staging.interaction": "staging",
}

EQUIVALENT = [
    {"numbered-list.3", "cards.3"},
    {"numbered-list.4", "cards.4", "cards.4.intro", "numbered-list.4.illustration", "process.cards.4"},
    {"numbered-list.5", "cards.5.intro"},
    {"numbered-list.6", "cards.6", "cards.6.columns", "list.6.center-message"},
    {"compare.two.intro.short", "compare.two.intro.detailed", "compare.two.no-intro"},
    {"text.illustration", "text.long.illustration", "text.plain"},
    {"text.example", "thesis.example.illustration"},
    {"process.4", "process.4.stages", "process.4.detailed"},
    {"process.3.detailed", "numbered-list.3"},
    {"statistics.3", "statistics.4"},
    {"classification.3", "classification.4"},
    {"intro.body.conclusion", "text.key-idea"},
    {"situation.action.a", "situation.action.b"},
]


def equivalent(a: str, b: str) -> bool:
    if a == b:
        return True
    return any(a in cls and b in cls for cls in EQUIVALENT)


def family(t: str) -> str:
    return FAMILY.get(t, t.split(".")[0])


def load_gold(path: Path) -> dict[tuple[str, int], dict]:
    gold = {}
    with path.open(encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter=";"):
            lm = LESSON_RE.search(row.get("урок") or "")
            sm = SLIDE_RE.match(row.get("слайд") or "")
            if not (lm and sm):
                continue
            gold[(lm.group(1), int(sm.group(1)))] = {
                "templateId": row["templateId"].strip(),
                "title": row["слайд"],
                "note": (row.get("примечание") or "").strip(),
            }
    return gold


def load_plan(path: Path) -> tuple[str | None, list[dict]]:
    plan = json.loads(path.read_text(encoding="utf-8"))
    lm = LESSON_RE.search(plan.get("lessonTitle") or "")
    return (lm.group(1) if lm else None), plan.get("slides", [])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("gold", type=Path)
    ap.add_argument("plans", type=Path, nargs="+")
    ap.add_argument("--report", type=Path, help="write the full comparison as JSON")
    ap.add_argument("--lesson", help="lesson number (e.g. 3.2) when lessonTitle is missing in the plan")
    args = ap.parse_args()

    gold = load_gold(args.gold)
    rows = []
    unmatched = []
    dialogue_count = 0
    for plan_path in args.plans:
        lesson, slides = load_plan(plan_path)
        lesson = lesson or args.lesson
        if not lesson:
            print(f"{plan_path}: cannot determine lesson number, pass --lesson", file=sys.stderr)
            return 2
        for item in slides:
            if item.get("kind") == "dialogue":
                dialogue_count += 1
                continue
            if item.get("kind") != "content":
                continue
            key = (lesson, item.get("sourceSlide"))
            g = gold.get(key)
            got = item.get("composition")
            if g is None:
                unmatched.append({"plan": plan_path.name, "sourceSlide": key[1], "got": got})
                continue
            exp = g["templateId"]
            rows.append({
                "lesson": lesson, "sourceSlide": key[1], "title": g["title"],
                "expected": exp, "got": got,
                "exact": exp == got, "equivalent": equivalent(exp, got), "family": family(exp) == family(got),
                "rationale": (item.get("selection") or {}).get("rationale"),
                "note": g["note"],
            })

    n = len(rows)
    if n == 0:
        print("no content slides matched the gold set")
        return 1

    def pct(k):
        return 100.0 * sum(1 for r in rows if r[k]) / n

    print(f"content slides compared: {n}   dialogue items in plans: {dialogue_count}   unmatched: {len(unmatched)}")
    print(f"exact      {pct('exact'):5.1f}%")
    print(f"equivalent {pct('equivalent'):5.1f}%")
    print(f"family     {pct('family'):5.1f}%")

    per_family = defaultdict(lambda: [0, 0])
    for r in rows:
        per_family[family(r["expected"])][1] += 1
        if r["family"]:
            per_family[family(r["expected"])][0] += 1
    print("\nby expected family (family-level hits / total):")
    for fam, (hit, tot) in sorted(per_family.items(), key=lambda x: -x[1][1]):
        print(f"  {fam:14s} {hit:3d}/{tot:<3d} {100.0*hit/tot:5.1f}%")

    pairs = Counter((r["expected"], r["got"]) for r in rows if not r["equivalent"])
    if pairs:
        print("\nmost frequent confusions (expected -> got):")
        for (e, g), c in pairs.most_common(15):
            print(f"  {c:3d}  {e} -> {g}")

    print("\nmisses:")
    for r in rows:
        if not r["equivalent"]:
            print(f"  {r['lesson']} слайд {r['sourceSlide']:2d}  ожидали {r['expected']:32s} получили {r['got']}   {r['title'][:50]}")

    if args.report:
        args.report.write_text(json.dumps({
            "compared": n, "dialogue": dialogue_count, "unmatched": unmatched,
            "exact": pct("exact"), "equivalent": pct("equivalent"), "family": pct("family"),
            "confusions": [{"expected": e, "got": g, "count": c} for (e, g), c in pairs.most_common()],
            "rows": rows,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
