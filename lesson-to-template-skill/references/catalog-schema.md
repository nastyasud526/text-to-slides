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

Place `template_id: cards.2.row` in the template slide's PowerPoint comment or speaker notes. The rest of the comment stays free-form and is saved in the catalog. On the next scan use `--merge` with the previous catalog: the semantic entries are retained when their identifiers are found again, while the current slide numbers and object inventory are refreshed.

Choose a concise, stable ID based on composition rather than a slide number. For example, `dialogue.scene`, `cards.2.row`, `contrast.proscons`, or `case.inline`.
