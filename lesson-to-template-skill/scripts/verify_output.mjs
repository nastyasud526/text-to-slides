import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { usage } from "./runtime.mjs";
import { slotText, validateCatalog, validatePlan } from "./validate.mjs";
import { getPptxNamedImageHashes, getPptxNamedShapeTexts, getPptxSlideCount } from "./patch_text_runs.mjs";

const [pptx, catalogPath, planPath, qaDir] = process.argv.slice(2);
if (!pptx || !catalogPath || !planPath || !qaDir) usage("verify_output.mjs", "<output.pptx> <catalog.json> <lesson-plan.json> <qa-directory>");
const catalog = validateCatalog(JSON.parse(await fs.readFile(catalogPath, "utf8")));
const plan = validatePlan(JSON.parse(await fs.readFile(planPath, "utf8")), catalog);
const isHeadingSlot = (slot) => slot === "title" || slot === "subtitle" || /_(?:title|label)$/.test(slot);
const slideCount = await getPptxSlideCount(pptx);
if (slideCount !== plan.slides.length) throw new Error(`Expected ${plan.slides.length} output slides, got ${slideCount}`);
await fs.mkdir(qaDir, { recursive: true });
const namedText = await getPptxNamedShapeTexts(pptx);
const namedImageHashes = await getPptxNamedImageHashes(pptx);

for (const [slideIndex, item] of plan.slides.entries()) {
  const spec = item.kind === "title" ? catalog.titleTemplate : catalog.compositions[item.composition];
  for (const [slot, expected] of Object.entries(item.slots)) {
    const actual = namedText.get(slideIndex + 1)?.get(spec.slots[slot]);
    if (actual === undefined) throw new Error(`Slide ${slideIndex + 1}, slot ${slot}: no text shape named ${JSON.stringify(spec.slots[slot])}`);
    const plainExpected = slotText(expected);
    const expectedValue = isHeadingSlot(slot) ? plainExpected.toUpperCase() : plainExpected;
    if (actual !== expectedValue) throw new Error(`Slide ${slideIndex + 1}, slot ${slot}: expected exact text ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actual)}`);
  }
  if (item.kind === "dialogue") {
    const actualHash = namedImageHashes.get(slideIndex + 1)?.get(spec.imageSlots.scene);
    if (!actualHash) throw new Error(`Slide ${slideIndex + 1}, dialogue scene: no image named ${JSON.stringify(spec.imageSlots.scene)}.`);
    const expectedHash = createHash("sha256").update(await fs.readFile(path.resolve(path.dirname(planPath), item.scenePath))).digest("hex");
    if (actualHash !== expectedHash) throw new Error(`Slide ${slideIndex + 1}, dialogue scene: embedded image does not match ${JSON.stringify(item.scenePath)}.`);
  }
}
await fs.writeFile(path.join(qaDir, "technical-verification.json"), JSON.stringify({
  slideCount,
  exactNamedText: true,
  dialogueSceneAssets: true,
  rendered: false,
  renderReason: "Production batch verification is structural. Visual review is a separate user-requested action."
}, null, 2), "utf8");
console.log(`Verified ${slideCount} slides, exact mapped text, dialogue scene assets, and heading casing without rendering to ${qaDir}.`);
