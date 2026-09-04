import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { usage } from "./runtime.mjs";
import { slotText, validateCatalog, validatePlan } from "./validate.mjs";
import { getPptxNamedImageHashes, getPptxNamedShapeTexts, getPptxSlideCount, getPptxSpeakerNotes } from "./patch_text_runs.mjs";

const [pptx, catalogPath, planPath, verificationDir] = process.argv.slice(2);
const pendingScenes = [];
if (!pptx || !catalogPath || !planPath || !verificationDir) usage("verify_output.mjs", "<output.pptx> <catalog.json> <lesson-plan.json> <verification-directory>");
const catalog = validateCatalog(JSON.parse(await fs.readFile(catalogPath, "utf8")));
const plan = validatePlan(JSON.parse(await fs.readFile(planPath, "utf8")), catalog);
const isHeadingSlot = (slot) => slot === "title" || slot === "subtitle" || /_(?:title|label)$/.test(slot);
const normalizeForCoverage = (value) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru-RU");
const slideCount = await getPptxSlideCount(pptx);
if (slideCount !== plan.slides.length) throw new Error(`Expected ${plan.slides.length} output slides, got ${slideCount}`);
await fs.mkdir(verificationDir, { recursive: true });
const namedText = await getPptxNamedShapeTexts(pptx);
  const namedImageHashes = await getPptxNamedImageHashes(pptx);
  const speakerNotes = await getPptxSpeakerNotes(pptx);

for (const [slideIndex, item] of plan.slides.entries()) {
  const spec = item.kind === "title" ? catalog.titleTemplate : catalog.compositions[item.composition];
    for (const [slot, expected] of Object.entries(item.slots)) {
    const actual = namedText.get(slideIndex + 1)?.get(spec.slots[slot]);
    if (actual === undefined) throw new Error(`Slide ${slideIndex + 1}, slot ${slot}: no text shape named ${JSON.stringify(spec.slots[slot])}`);
    const plainExpected = slotText(expected);
    const expectedValue = isHeadingSlot(slot) ? plainExpected.toUpperCase() : plainExpected;
      if (actual !== expectedValue) throw new Error(`Slide ${slideIndex + 1}, slot ${slot}: expected exact text ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actual)}`);
    }
    if (item.kind === "content") {
      const retained = [...Object.values(item.slots).map(slotText), item.manualLayout ?? ""].join("\n");
      const normalizedRetained = normalizeForCoverage(retained);
      for (const fragment of item.sourceText.split(/\r?\n/).map(normalizeForCoverage).filter(Boolean)) {
        if (!normalizedRetained.includes(fragment)) throw new Error(`Slide ${slideIndex + 1}: source fragment is absent from mapped fields and manual layout: ${JSON.stringify(fragment)}.`);
      }
    }
    if (item.kind === "dialogue") {
    const actualHash = namedImageHashes.get(slideIndex + 1)?.get("DIALOGUE_SCENE");
    const scenePath = path.resolve(path.dirname(planPath), item.scenePath);
    const sceneExists = await fs.access(scenePath).then(() => true, () => false);
    if (!sceneExists) {
      if (actualHash) throw new Error(`Slide ${slideIndex + 1}, dialogue scene: image embedded but ${JSON.stringify(item.scenePath)} does not exist.`);
      pendingScenes.push(slideIndex + 1);
      continue;
    }
    if (!actualHash) throw new Error(`Slide ${slideIndex + 1}, dialogue scene: no image named "DIALOGUE_SCENE".`);
    const expectedHash = createHash("sha256").update(await fs.readFile(path.resolve(path.dirname(planPath), item.scenePath))).digest("hex");
    if (actualHash !== expectedHash) throw new Error(`Slide ${slideIndex + 1}, dialogue scene: embedded image does not match ${JSON.stringify(item.scenePath)}.`);
    }
    if (item.manualLayout) {
      const actualNote = speakerNotes.get(slideIndex + 1);
      const expectedNote = `ДОВЕРСТАТЬ ВРУЧНУЮ\n${item.manualLayout}`;
      if (!actualNote?.includes(expectedNote)) throw new Error(`Slide ${slideIndex + 1}: manual-layout text is missing from speaker notes.`);
    }
}
await fs.writeFile(path.join(verificationDir, "technical-verification.json"), JSON.stringify({
  slideCount,
  exactNamedText: true,
  dialogueSceneAssets: true,
  manualLayoutNotes: true
}, null, 2), "utf8");
console.log(`Structurally verified ${slideCount} slides, exact mapped text, dialogue scene assets, and heading casing in ${verificationDir}.${pendingScenes.length ? ` Scenes pending on slides ${pendingScenes.join(", ")}.` : ""}`);
