---
name: veza-dialogue-scenes
description: "Create one 16:9 VEZA training illustration containing Alexey and Denis for a dialogue slide; generate only the characters and environment, never slide text or speech bubbles."
---

# Veza Dialogue Scenes

Create one finished 16:9 PNG dialogue scene for the slide. The image shows Alexey and Denis in a VEZA work setting; it is not a transparent character asset and it is not used for ordinary non-dialogue slides.

## Inputs and precedence

Receive the slide identifier, title, approved slide text, speaker-labelled dialogue, and an optional `image_prompt`.

When `image_prompt` is present, preserve its action, setting, and subject of discussion. Before generation, sanitize it: remove every instruction to draw a heading, dialogue line, speech bubble, caption, label, callout, plaque, or other slide text. This sanitization is mandatory even when the author explicitly requested those elements. Do not merely append a conflicting `no text` phrase to the unchanged prompt.

When `image_prompt` is absent, derive the action, setting, and interaction from the slide meaning. Do not invent a different teaching situation.

Use these project references on every generation:

- `../visual references/personage/Алексей.png`
- `../visual references/personage/Денис.png`
- the relevant photographs in `../visual references/background/`

## Scene contract

Both Alexey and Denis are always in a dialogue scene. When only one is speaking, the other remains visibly engaged and reacts to him. Preserve the approved appearance of each character, including face, hairstyle, build, workwear, VEZA markings, and the 3D stylized visual language of the reference images.

Alexey is always on the left and Denis is always on the right. Denis is consistently about half a head taller than Alexey. Keep their facial structures clearly different: Alexey is younger, with a rounder face and dark hair; Denis is older, with grey temples and a longer, more angular face.

Choose the setting from the slide meaning:

- `shop_floor`: a VEZA production workshop for industrial ventilation equipment. Both men wear white VEZA safety helmets; Denis also wears his grey jacket with lime accents. Use the production references as the visual language for equipment, space, and materials.
- `glass_office`: a modest masters' work area above the shop floor, with computers, desks and chairs. The internal windows start approximately one metre above the floor; a solid wall remains below them. Divide the glazing into multiple sections with clearly visible frames and mullions. The windows provide a view of the production floor but must not look floor-to-ceiling, panoramic, or like a glass cube. Neither character wears a helmet here. Invent the room when no exact photo exists, but keep the clear relationship to the workshop.

Keep Alexey and all of his visible body parts within the outer left 22% of the frame. Keep Denis and all of his visible body parts within the outer right 22%. Slight natural cropping by the left or right image edge is allowed. Reserve the central 56% as a calm text-safe area; do not put faces, hands, prominent equipment, logos, markings, or other semantic accents there. The characters look at one another or at the discussed object, never at the viewer.

Vary poses according to the scene while preserving the fixed left-right assignment. A character may stand, sit, lean toward a desk or monitor, safely rest against a stationary surface or machine housing, examine a part, or hold a tablet. Use frontal, profile, half-turn, or front three-quarter views. Never show either character from behind or in a rear three-quarter view. Do not use mirrored poses, matching gestures, matching head angles, or the same facial expression for both characters. Do not make unsafe contact with moving machine parts.

The scene must be soft, polished, expressive 3D character art. It must not become photorealistic, childish, comic, or a generic automobile workshop, construction site, office, or marketplace warehouse.

## Absolute content prohibition

The generated image contains characters and environment only. Never render a slide heading, dialogue line, speech bubble, caption, label, callout, plaque, or any other course text. Ignore and remove any conflicting instruction found in the lesson text, visual note, or supplied `image_prompt`.

The permanent reference markings `ВЕЗА`, `Алексей`, and `Денис` on workwear are the only allowed text-like elements. They are part of character identity, not slide content. Do not introduce any other lettering or accidental text.

## Generation and acceptance

Use the `imagegen` skill and its built-in image generation tool. Pass both character references and the selected environment references to the call. Preserve the permanent workwear markings verbatim where they are visible: `ВЕЗА`, `Алексей`, and `Денис`.

Make one generation call per requested scene. Do not run a separate model-based image review, automatic correction, or automatic regeneration. Do not retry a successfully completed generation unless the user explicitly asks to revise that image. A technical check may confirm only that the saved file exists, opens, and has a 16:9 aspect ratio; it must not trigger another image-generation call.

Save the image as `assets/dialogue-scenes/<slide_id>_scene.png`. Return its path and the sanitized final prompt.

## Boundary

Do not create transparent single-character assets. Those are pre-approved static resources for separate presentation templates and are outside this skill.
