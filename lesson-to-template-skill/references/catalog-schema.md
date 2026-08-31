# Catalog schema

`catalog.json` is a prepared version-2 registry supplied with the course template library. Lesson assembly reads it but never creates, refreshes, or edits it. It has two levels.

`slides` describes the matching PowerPoint library. Each item has a `sourceSlide`, an optional `templateId`, comments and notes, and text objects with their PowerPoint `objectName`. The lesson pipeline accepts these addresses only after `preflight_library.mjs` confirms that they still match the supplied PPTX.

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

A dialogue slide uses the first blank library slide as a controlled exception. Register that physical slide as `staging.blank`, include `dialogue` in `kinds`, and map its existing editable text field for the speaker-labelled replicas:

```json
{
  "templateId": "staging.blank",
  "kinds": ["dialogue"],
  "stripToSlots": true,
  "slots": {
    "dialogue": "STAGING_BODY"
  }
}
```

The source `staging.blank` slide does not need to contain `DIALOGUE_SCENE` or speech bubbles. For a dialogue plan item, the builder removes the blank placeholder, creates one full-slide picture named `DIALOGUE_SCENE`, and writes the replicas into the existing mapped field. It must not create a title, speech bubbles, speaker labels, or other overlay objects. The builder creates a separate media relationship for every output dialogue slide, so one scene cannot overwrite another in a batch. Ordinary `imageSlots` are still reserved for replacing pictures that already exist in a physical template.

Interaction staging uses a separate physical slide that is visually identical to `staging.blank`:

```json
{
  "templateId": "staging.interaction",
  "kinds": ["interactive-staging", "unsupported-visual-staging"],
  "stripToSlots": true,
  "slots": {
    "body": "STAGING_BODY"
  }
}
```

Never map an interaction plan item to `staging.blank`. The separate physical template keeps dialogue image insertion and interactive authoring independent while reusing the same visual blank-slide design.

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

Every prepared template has a stable `template_id` in its PowerPoint comment or speaker notes. The lesson pipeline checks these identifiers and mapped object names before every build. A missing or mismatched identifier is a stopping condition; resolving it belongs to a separate library-preparation task.
