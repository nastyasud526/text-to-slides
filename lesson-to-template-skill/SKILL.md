---
name: lesson-to-template
description: Select existing PowerPoint lesson templates and fill their named text fields while preserving each template's formatting.
---

# Lesson to Template

Use when the user supplies a PowerPoint library of finished template slides and lesson text and wants a new deck assembled from copies of those slides. The user supplies the library and lesson source only; the catalog, lesson plan, and overflow report are working files.

## Action boundary

Treat questions, discussion, comparison of options, requests for an explanation, review, or diagnosis as discussion only. They do not authorize editing files, changing the skill, rebuilding a presentation, overwriting an artifact, or running a pipeline that creates output. Before any such action, state the exact proposed change and affected artifacts, ask for explicit confirmation, and wait for it.

An explicit imperative in the current user message, such as `внеси правило`, `исправь код`, `собери презентацию`, or `пересобери файл`, is confirmation only for the named action. Do not extend it to adjacent improvements. When the message expresses doubt, explores alternatives, or asks why something happened, answer and discuss the options first.

## Decision ownership

Read the complete lesson before choosing compositions. When the template library has changed and its catalog must be refreshed, inspect every template slide once; otherwise reuse the current catalog. Dialogue slides bypass general composition selection and use the dedicated dialogue composition. Scripts do not infer teaching structure or choose layouts: they extract library metadata, copy mapped slides, write text into named fields, verify the output, render it, and report declared capacity risks.

Treat a slide's PowerPoint comment or speaker note as its design brief. A reusable slide needs a stable line `template_id: meaningful.id`; the remaining text may describe composition, density, restrictions, and intended use in ordinary language. The user owns visual design and those comments. You own the catalog, semantic field mapping, lesson plan, and technical checks.

Keep a template image or illustration as its existing placeholder unless the user explicitly asks to replace it. A recognised dialogue slide uses the project's dedicated dialogue composition and routes its full-slide image to `../veza-dialogue-scenes`. The physical dialogue template belongs inside the current PowerPoint template library and has the named image object `DIALOGUE_SCENE`; do not construct it from an external test slide during a course run. If it is absent, stop for the user to add the approved template and then refresh the catalog once. Finding a dialogue slide must not trigger a scan or comparison of the general template catalog.

## Catalog contract

Run `scripts/inspect_templates.mjs <template.pptx> <catalog.json> <template-qa-directory>` whenever the library changes. It renders every slide and extracts the current slide number, `template_id`, comment/note text, and names and text of editable PowerPoint shape objects.

The catalog addresses a composition by `templateId` and each text slot by PowerPoint object name, never by a numerical shape index. On a later library revision, rerun inspection with `--merge <previous-catalog.json>`; entries whose `template_id` is still present retain their composition and field mappings even if the slide has moved. See [catalog schema](references/catalog-schema.md).

Give each physical template one stable `templateId`. When the same slide supports several teaching purposes, keep that single ID and list the compatible semantic uses in `kinds`; do not create duplicate template IDs for the same slide. Choose among candidates by required fields and density first, then use `kinds` for semantic matching and variety.

Assign clear object names such as `TITLE`, `INTRO`, `CARD_1`, and `CARD_2` to editable text shapes. Do not include logos, navigation, fixed labels, brand text, or decorative text as slots. If a template still has generic object names, the agent may map those exact names temporarily, but rename them before treating the template as stable.

For a finished template library, create a copy and run `scripts/rename_template_text_fields.mjs <template.pptx> <field-map.json> <output.pptx>`. The field map binds stable OOXML object IDs to semantic names. It changes only `p:cNvPr/@name` on mapped text shapes; it must not edit text, formatting, images, or decorative shapes.

## Content contract

- Preserve approved course wording and source order. You may distribute one source block across the selected template's fields when that follows its structure, and may make an editorial adaptation only when the user explicitly accepts it.
- Treat formal layout markup such as an agreed `layout:` field as authoritative. An `image_prompt:` attached to a dialogue slide is also authoritative for the semantic content of its scene. Treat free-form production notes inside the lesson source, including `Визуал:` and `Интерактив:`, as draft hints that may be stale or noisy. Judge the actual text structure and available template capacity before following them.
- If no exact template fits, first adapt the material to an existing composition. Use an available title-and-text template only when that is the closest honest fit, and record the choice in the lesson plan.
- When two or more templates fit the same teaching purpose and text density, rotate among the least recently used compatible variants. Apply this to processes, numbered lists, cards, columns, and similar repeated compositions; choose density and required fields before variety.
- For a process, timeline, numbered list, or marked list, leave unused item fields empty when the template has more slots than the source needs. When the source has more items than the selected template can hold, fill the available slots in source order and record the remaining items in that output slide's speaker notes under `ДОВЕРСТАТЬ ВРУЧНУЮ`, with the selected template ID and the reason. Include the same items in the overflow report so they can be reviewed across the deck. A closer process or timeline composition may still be chosen despite this overflow.
- Classify speaker-labelled character dialogue as dialogue content. Use the dedicated dialogue composition directly; do not search, rank, or compare it against general catalog compositions. Preserve the dialogue wording and resolve an `image_prompt` before invoking `../veza-dialogue-scenes`: use the author's prompt when supplied; otherwise create one from the slide meaning by the guide in [dialogue-image-prompt.md](references/dialogue-image-prompt.md). The image skill sanitizes either prompt and removes requests for headings, dialogue text, speech bubbles, captions, labels, callouts, plaques, and other course text before generation. The scene always contains Alexey on the left and Denis on the right, including a continuation where only one has a spoken line. Do not route dialogue through a decorative title-and-text composition.
- In the dialogue composition, the left speech-bubble field always belongs to Alexey and the right speech-bubble field always belongs to Denis. Map lines by character name, never by speaking order. If only Alexey speaks, fill the left field and leave the right field empty. If only Denis speaks, fill the right field and leave the left field empty. Keep the unused bubble and its empty field in the slide; do not delete, hide, move, resize, or restyle them automatically.
- A lesson note that says `Интерактив` does not by itself make the slide interactive. First test whether the material fits an existing static composition while preserving all approved text. Use an interaction staging slide only when the material is genuinely too dense for one available static slide or when the interaction mechanic is essential to understanding the task.
- Before building, keep a slide-decision log with the selected composition, field mapping, rejected alternatives, reasoning, confidence (`high`, `medium`, or `low`), and any template gap. Stop for user review when confidence is low or no honest composition exists. Do not create a PPTX while unresolved decisions remain.
- When prose contains a clear key idea but no list, cards, comparison, process, example, or other registered structure, check for a key-idea or emphasis composition. If none exists, record a template gap instead of silently routing repeated slides to title-and-text.
- Treat slot limits as advisory and record overflow risk. If reducing type size would solve an actual rendered overflow, you may reduce only the affected body text, preserving its typeface, color, weight, and other formatting, down to 14 pt. Do not reduce titles, labels, or accent runs unless the user separately approves it. Record the slide, slot, original size, final size, and whether overflow remains. If 14 pt is insufficient, keep the remaining overflow visible and report it; do not alter the wording, layout, or slide count automatically.
- Choose the semantically correct composition before considering capacity. A closer semantic match remains the preferred choice when its text overflows; record the overflow instead of switching to a less accurate composition merely because it has larger text boxes.
- Make a separate title slide from the catalogued title template. Uppercase every semantic heading field: `title`, `subtitle`, and fields ending in `_title` or `_label`. Preserve the casing of body, definition, explanation, and other non-heading fields.
- Preserve intentional mixed formatting inside an editable field. When a template field contains an accent run followed by a body run, put only the meaningful term, lead-in, or conclusion fragment into the accent segment and keep the remaining text in the smaller body segment. Never apply the first run's color, font, or size to the whole field.

## Workflow

1. Set `RUNTIME_NODE_MODULES` to the bundled Node packages directory reported by `load_workspace_dependencies`.
2. Reuse the current catalog when the template library has not changed. Only when the library changes, inspect every template slide, review every PNG, add or confirm `template_id` markers, then refresh the catalog's title template, compositions, named slots, and optional per-slot `capacity` thresholds. Recognising a dialogue slide never counts as a library change and never triggers catalog inspection.
3. Read the complete `.docx`, `.md`, or `.txt` lesson source. For `.docx`, extract the complete paragraph text with the Documents skill before reading it. Create and review the slide-decision log, resolve every low-confidence choice or template gap, and only then create the internal version-2 `lesson-plan.json`; the user never prepares it.
4. For every dialogue slide, use the dedicated dialogue composition and resolve `image_prompt` before image generation. If the source contains an author prompt, preserve its semantic scene decision; if it does not, create the prompt from the dialogue and slide meaning using [dialogue-image-prompt.md](references/dialogue-image-prompt.md). Invoke `../veza-dialogue-scenes`, which sanitizes the prompt and makes one generation call. Save the returned scene path and sanitized prompt in the internal lesson plan. Do not run a separate model-based image review or automatic regeneration.
5. Run `scripts/report_overflow.mjs <catalog.json> <lesson-plan.json> <overflow-report.json>` before building. It reports only declared capacity risks.
6. Run `scripts/build_presentation.mjs <template.pptx> <catalog.json> <lesson-plan.json> <output.pptx>`. It duplicates only mapped template slides and replaces text inside existing styled `<a:r>` elements. Plain string values preserve the first run style. A structured value with `segments` selects catalogued run styles and preserves each chosen run's `<a:rPr>`; this supports a highlighted term followed by smaller body text in the same shape. The builder must never recreate text boxes or call a high-level `text.set`. For a dialogue slide, it also replaces the named inherited `DIALOGUE_SCENE` picture with the plan's `scenePath`, creating a separate media relationship for each output slide. An agreed staging composition may set `stripToSlots: true`: the builder then keeps the mapped text fields and the inherited background while removing other slide-local objects. Do not substitute an unresolved dialogue or interaction with an unrelated decorative composition.
7. Run `scripts/verify_output.mjs <output.pptx> <catalog.json> <lesson-plan.json> <qa-directory>`. It verifies slide count, exact text by named object, heading casing, and the hash of every embedded dialogue scene. It does not render slides or call an image-review model during batch production. Rendered visual review is a separate user-requested action; do not claim it was completed otherwise.

## Limits

- Mixed-style replacement reuses styles already present in the template field. It does not invent a new typeface, color, size, or emphasis that the source shape does not contain.
- `template_id` values must be unique. A missing or duplicated marker is a catalog error, because the system must not guess which slide represents a template.
- Object names must be unique within a slide. If PowerPoint has duplicated a name, rename the conflicting editable objects before mapping them.
