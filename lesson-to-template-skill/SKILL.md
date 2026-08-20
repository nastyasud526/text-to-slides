---
name: lesson-to-template
description: Select existing PowerPoint lesson templates and fill their named text fields while preserving each template's formatting.
---

# Lesson to Template

Use when the user supplies a PowerPoint library of finished template slides and lesson text and wants a new deck assembled from copies of those slides. The user supplies the library and lesson source only; the catalog, lesson plan, and overflow report are working files.

## Decision ownership

Read the complete lesson and inspect every template slide before choosing a composition. Scripts do not infer teaching structure or choose layouts: they extract library metadata, copy mapped slides, write text into named fields, verify the output, render it, and report declared capacity risks.

Treat a slide's PowerPoint comment or speaker note as its design brief. A reusable slide needs a stable line `template_id: meaningful.id`; the remaining text may describe composition, density, restrictions, and intended use in ordinary language. The user owns visual design and those comments. You own the catalog, semantic field mapping, lesson plan, and technical checks.

## Catalog contract

Run `scripts/inspect_templates.mjs <template.pptx> <catalog.json> <template-qa-directory>` whenever the library changes. It renders every slide and extracts the current slide number, `template_id`, comment/note text, and names and text of editable PowerPoint shape objects.

The catalog addresses a composition by `templateId` and each text slot by PowerPoint object name, never by a numerical shape index. On a later library revision, rerun inspection with `--merge <previous-catalog.json>`; entries whose `template_id` is still present retain their composition and field mappings even if the slide has moved. See [catalog schema](references/catalog-schema.md).

Assign clear object names such as `TITLE`, `INTRO`, `CARD_1`, and `CARD_2` to editable text shapes. Do not include logos, navigation, fixed labels, brand text, or decorative text as slots. If a template still has generic object names, the agent may map those exact names temporarily, but rename them before treating the template as stable.

## Content contract

- Preserve approved course wording and source order. You may distribute one source block across the selected template's fields when that follows its structure, and may make an editorial adaptation only when the user explicitly accepts it.
- Treat an explicit author format as authoritative. Otherwise select from compositions actually present in the current catalog; never invent a layout identifier.
- If no exact template fits, first adapt the material to an existing composition. Use an available title-and-text template only when that is the closest honest fit, and record the choice in the lesson plan.
- Ignore slot limits at this stage and record overflow risk only. Never change font size, layout, or slide count automatically.
- Make a separate title slide from the catalogued title template. Uppercase content-slide titles only, and append `Интерактивность` when `interactive: true`.

## Workflow

1. Set `RUNTIME_NODE_MODULES` to the bundled Node packages directory reported by `load_workspace_dependencies`.
2. Inspect every slide, review every PNG, add or confirm `template_id` markers, then complete the catalog's title template, compositions, named slots, and optional per-slot `capacity` thresholds.
3. Read the complete `.docx`, `.md`, or `.txt` lesson source. For `.docx`, extract the complete paragraph text with the Documents skill before reading it. Create the internal version-2 `lesson-plan.json`; the user never prepares it.
4. Run `scripts/report_overflow.mjs <catalog.json> <lesson-plan.json> <overflow-report.json>` before building. It reports only declared capacity risks.
5. Run `scripts/build_presentation.mjs <template.pptx> <catalog.json> <lesson-plan.json> <output.pptx>`. It duplicates only mapped template slides and replaces text inside the existing named shape's first styled `<a:r>`. It preserves that run's `<a:rPr>` and clones it around `<a:br/>` for multi-line content; it must never recreate text boxes or call a high-level `text.set`.
6. Run `scripts/verify_output.mjs <output.pptx> <catalog.json> <lesson-plan.json> <qa-directory>`. It verifies text by named object, title casing, slide count, and creates a PNG and layout export for every output slide. Inspect every rendered slide for wrapping, clipping, and overflow.

## Limits

- The run-patching path supports one text style per editable shape. A deliberately mixed-style field needs a separate multi-run replacement path.
- `template_id` values must be unique. A missing or duplicated marker is a catalog error, because the system must not guess which slide represents a template.
- Object names must be unique within a slide. If PowerPoint has duplicated a name, rename the conflicting editable objects before mapping them.
