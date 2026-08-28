import fs from "node:fs/promises";
import path from "node:path";
import { loadArtifactTool, usage } from "./runtime.mjs";
import { resolveTemplate, validateCatalog, validatePlan } from "./validate.mjs";
import { patchPptxTextRuns } from "./patch_text_runs.mjs";

const [source, catalogPath, planPath, out] = process.argv.slice(2);
if (!source || !catalogPath || !planPath || !out) usage("build_presentation.mjs", "<template.pptx> <catalog.json> <lesson-plan.json> <output.pptx>");
const catalog = validateCatalog(JSON.parse(await fs.readFile(catalogPath, "utf8")));
const plan = validatePlan(JSON.parse(await fs.readFile(planPath, "utf8")), catalog);
const { FileBlob, PresentationFile } = await loadArtifactTool();
const deck = await PresentationFile.importPptx(await FileBlob.load(source));
const originals = deck.slides.items.slice();
const outputSlides = [];
const textPatches = [];
const imagePatches = [];
const stripOperations = [];
const isHeadingSlot = (slot) => slot === "title" || slot === "subtitle" || /_(?:title|label)$/.test(slot);
const uppercaseSlotValue = (value) => typeof value === "string"
  ? value.toUpperCase()
  : { segments: value.segments.map((segment) => ({ ...segment, text: segment.text.toUpperCase() })) };

for (const [planIndex, item] of plan.slides.entries()) {
  const spec = item.kind === "title" ? catalog.titleTemplate : catalog.compositions[item.composition];
  const sourceTemplate = resolveTemplate(catalog, spec, `plan.slides[${planIndex}]`);
  if (sourceTemplate.sourceSlide > originals.length) throw new Error(`plan.slides[${planIndex}] points to missing source slide ${sourceTemplate.sourceSlide}`);
  const clone = originals[sourceTemplate.sourceSlide - 1].duplicate();
  for (const [slot, value] of Object.entries(item.slots)) {
    const finalValue = isHeadingSlot(slot) ? uppercaseSlotValue(value) : value;
    textPatches.push({
      slideIndex: planIndex + 1,
      slot,
      objectName: spec.slots[slot],
      value: finalValue,
      runStyles: spec.runStyles?.[slot] ?? null
    });
  }
  if (spec.stripToSlots) {
    stripOperations.push({
      slideIndex: planIndex + 1,
      keepObjectNames: [...new Set(Object.values(spec.slots))]
    });
  }
  if (item.kind === "dialogue") {
    imagePatches.push({
      slideIndex: planIndex + 1,
      slot: "scene",
      objectName: spec.imageSlots.scene,
      imagePath: path.resolve(path.dirname(planPath), item.scenePath)
    });
  }
  outputSlides.push(clone);
}
// Imported slide facades can be index-backed. Deleting from the end prevents
// earlier deletions from shifting the remaining original-slide references.
for (let index = originals.length - 1; index >= 0; index -= 1) originals[index].delete();
for (const [index, slide] of outputSlides.entries()) slide.moveTo(index);
await (await PresentationFile.exportPptx(deck)).save(out);
await patchPptxTextRuns(out, textPatches, stripOperations, imagePatches);
console.log(`Created ${outputSlides.length} slides from selected templates only, replacing text and ${imagePatches.length} dialogue scene image(s) inside existing template objects.`);
