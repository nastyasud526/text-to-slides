import fs from "node:fs/promises";
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

for (const [planIndex, item] of plan.slides.entries()) {
  const spec = item.kind === "title" ? catalog.titleTemplate : catalog.compositions[item.composition];
  const sourceTemplate = resolveTemplate(catalog, spec, `plan.slides[${planIndex}]`);
  if (sourceTemplate.sourceSlide > originals.length) throw new Error(`plan.slides[${planIndex}] points to missing source slide ${sourceTemplate.sourceSlide}`);
  const clone = originals[sourceTemplate.sourceSlide - 1].duplicate();
  for (const [slot, value] of Object.entries(item.slots)) {
    const finalValue = slot === "title" && item.kind === "content" ? `${value}${item.interactive ? " Интерактивность" : ""}`.toUpperCase() : value;
    textPatches.push({ slideIndex: planIndex + 1, slot, objectName: spec.slots[slot], value: finalValue });
  }
  outputSlides.push(clone);
}
for (const slide of originals) slide.delete();
for (const [index, slide] of outputSlides.entries()) slide.moveTo(index);
await (await PresentationFile.exportPptx(deck)).save(out);
await patchPptxTextRuns(out, textPatches);
console.log(`Created ${outputSlides.length} slides from selected templates only, replacing text inside existing styled runs.`);
