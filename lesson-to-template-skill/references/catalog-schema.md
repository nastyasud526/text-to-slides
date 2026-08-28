# Catalog schema

`catalog.json` is a version-2 working registry created by `inspect_templates.mjs`. It has two levels.

`slides` is the scanner result for the current PowerPoint library. Each item has a current `sourceSlide`, an optional `templateId`, extracted `comments` and `notes`, and text objects with their PowerPoint `objectName`. `sourceSlide` may change whenever the library is rearranged.

`titleTemplate` and `compositions` are the maintained semantic layer. Each entry points to a `templateId` and maps semantic slots to exact object names:

```json
{
  "templateId": "cards.2.row",
  "slots": {
    "title": "TITLE",
    "card_1": "CARD_1",
    "card_2": "CARD_2"
  }
}
```

A composition may also have `kinds`, an array of compatible semantic uses, and `stripToSlots: true` for an agreed clean staging slide. `templateId` identifies the physical template; `kinds` describes several valid ways to use it. Keep one ID for one physical template even when it supports several lesson structures.

A dialogue template has one named full-slide image object and named text fields. Keep this slide inside the same PowerPoint template library as the other compositions, then register it once in the catalog:

```json
{
  "templateId": "dialogue.scene",
  "kinds": ["dialogue"],
  "slots": {
    "title": "TITLE",
    "alexey_text": "ALEXEY_TEXT",
    "denis_text": "DENIS_TEXT"
  },
  "imageSlots": {
    "scene": "DIALOGUE_SCENE"
  }
}
```

`DIALOGUE_SCENE` must name exactly one PowerPoint picture object. The builder creates a separate media relationship for every output dialogue slide, so one scene cannot overwrite another in a batch. Do not combine `imageSlots` with `stripToSlots`.

When one editable shape deliberately contains several text styles, add `runStyles`. The number is the one-based styled run in the source shape:

```json
{
  "templateId": "term.explanation",
  "slots": {
    "title": "TITLE",
    "definition": "DEFINITION"
  },
  "runStyles": {
    "definition": {
      "accent": 1,
      "body": 3
    }
  }
}
```

The lesson plan may then use a structured slot value. Concatenating `segments[].text` must reproduce the exact approved text:

```json
{
  "definition": {
    "segments": [
      { "style": "accent", "text": "Нормо-час" },
      { "style": "body", "text": " — это мера объёма работы." }
    ]
  }
}
```

Use semantic style names such as `accent`, `body`, and `label`. Map them only to runs that already exist in that named template object.

Place `template_id: cards.2.row` in the template slide's PowerPoint comment or speaker notes. The rest of the comment stays free-form and is saved in the catalog. On the next scan use `--merge` with the previous catalog: the semantic entries are retained when their identifiers are found again, while the current slide numbers and object inventory are refreshed.

Choose a concise, stable ID based on composition rather than a slide number. For example, `dialogue.scene`, `cards.2.row`, `contrast.proscons`, or `case.inline`.
