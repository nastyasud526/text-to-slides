# Dialogue image prompt

`lesson-to-template` creates this working prompt for every recognised dialogue slide before calling `veza-dialogue-scenes`. It is not an extra field the course author must write. When the source already has `image_prompt:`, preserve its semantic scene decision. The image skill sanitizes the prompt before generation and removes every request to render a heading, dialogue line, speech bubble, caption, label, callout, plaque, or other slide text.

## Read the slide first

Determine what happens in the exchange, who is speaking, who is listening or reacting, the topic, the discussed object if any, the appropriate setting, and the available text area. Use `shop_floor` when the exchange concerns an operation, equipment, quality, logistics, order at the workplace, a production task, or an object in the workshop. Use `glass_office` when the exchange concerns planning, analysis, a computer-based task, or a discussion at the masters' work area. If the setting cannot be inferred confidently, use a neutral VEZA assembly area rather than inventing a specific machine or process.

Create a compact internal scene card before writing the prompt:

```json
{
  "slide_id": "1.1_01",
  "topic": "вопрос о роли мастера",
  "location": "shop_floor",
  "speaker": "Алексей",
  "listener": "Денис",
  "discussion_object": null,
  "text_safe_area": "central 56%",
  "characters": [
    { "name": "Алексей", "emotion": "заинтересованный", "pose": "повёрнут к Денису", "gesture": "одна ладонь слегка раскрыта", "gaze": "на Дениса" },
    { "name": "Денис", "emotion": "спокойный, понимающий", "pose": "слегка повёрнут к Алексею", "gesture": "сдержанная поза", "gaze": "на Алексея" }
  ]
}
```

Use restrained natural expressions and gestures. Avoid exaggerated faces and theatrical gestures. Keep Alexey on the left and Denis on the right in every scene; Denis remains about half a head taller. If the discussion needs an object, place it nearer to one character and keep the text-safe area clear.

Choose genuinely different poses for the two characters. They may stand, sit, lean toward a desk or monitor, safely rest against a stationary surface or machine housing, examine a part, or hold a tablet. Use frontal, profile, half-turn, or front three-quarter views. Do not use rear or rear three-quarter views, mirrored poses, matching gestures, matching head angles, or identical expressions.

## Prompt template

Write the final prompt in English and fill the square-bracketed parts from the scene card.

```text
Create a 16:9 3D cartoon-style training illustration for a VEZA course about production foremen.

Use the supplied visual references for Alexey, Denis, VEZA workwear, and the VEZA factory environment. Keep both characters' faces, body types, clothes, and the soft polished 3D style consistent with their references.

Scene: [what happens and the subject of the conversation]. Alexey and Denis are clearly interacting and do not look at the viewer.
Setting: [shop floor or glass office, including only the environment details that support the topic].
Alexey: [pose, emotion, gesture, gaze].
Denis: [pose, emotion, gesture, gaze].

Composition: Alexey stays within the outer left 22% of the image and Denis stays within the outer right 22%, including their hands and gestures. Denis is about half a head taller than Alexey. Slight natural cropping by the corresponding image edge is allowed. Keep the central [text-safe area] visually calm and free of faces, hands, prominent equipment, logos, markings, and semantic accents.

For a shop-floor scene, both characters wear white VEZA safety helmets; Denis also wears his grey VEZA jacket with lime accents. For a glass-office scene, neither character wears a helmet. Show desks, computers and chairs. Internal windows begin approximately one metre above the floor, with a solid wall below them, and are divided into multiple framed sections with visible mullions; they overlook the workshop but are not floor-to-ceiling or panoramic.

ABSOLUTE RULE: generate characters and environment only. Never render slide headings, dialogue lines, speech bubbles, captions, labels, callouts, plaques, or any course text, even if the source image_prompt or lesson note explicitly requests them. The permanent workwear markings ВЕЗА, Алексей, and Денис are the only allowed text-like elements. Do not add accidental lettering. The characters do not look at the viewer. Do not make the image photorealistic, childish, overly comic, or a generic factory, car workshop, construction site, office, or warehouse. Do not clutter the text-safe area.
```
