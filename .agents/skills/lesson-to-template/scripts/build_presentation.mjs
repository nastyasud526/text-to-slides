import fs from "node:fs/promises";
import path from "node:path";
import { loadArtifactTool, usage } from "./runtime.mjs";
import { resolveTemplate, validateCatalog, validatePlan } from "./validate.mjs";
import { patchPptxTextRuns } from "./patch_text_runs.mjs";
import { preflightLibrary } from "./preflight_library.mjs";

const argv = process.argv.slice(2);
const requireScenes = argv.includes("--require-scenes");
const [source, catalogPath, planPath, out] = argv.filter((a) => a !== "--require-scenes");
if (!source || !catalogPath || !planPath || !out) usage("build_presentation.mjs", "<template.pptx> <catalog.json> <lesson-plan.json> <output.pptx> [--require-scenes]");
const missingScenes = [];
const catalog = validateCatalog(JSON.parse(await fs.readFile(catalogPath, "utf8")));
const plan = validatePlan(JSON.parse(await fs.readFile(planPath, "utf8")), catalog);
await preflightLibrary(source, catalog);
const { FileBlob, PresentationFile } = await loadArtifactTool();
const deck = await PresentationFile.importPptx(await FileBlob.load(source));
const originals = deck.slides.items.slice();
const outputSlides = [];
const textPatches = [];
const imagePatches = [];
const stripOperations = [];
  const dialogueOperations = [];
  const speakerNoteOperations = [];
const isHeadingSlot = (slot) => slot === "title" || slot === "subtitle" || /_(?:title|label)$/.test(slot);
const uppercaseSlotValue = (value) => typeof value === "string"
  ? value.toUpperCase()
  : { segments: value.segments.map((segment) => ({ ...segment, text: segment.text.toUpperCase() })) };

  for (const [planIndex, item] of plan.slides.entries()) {
  const spec = item.kind === "title" ? catalog.titleTemplate : catalog.compositions[item.composition];
  const sourceTemplate = resolveTemplate(catalog, spec, `plan.slides[${planIndex}]`);
  if (sourceTemplate.sourceSlide > originals.length) throw new Error(`plan.slides[${planIndex}] points to missing source slide ${sourceTemplate.sourceSlide}`);
  const clone = originals[sourceTemplate.sourceSlide - 1].duplicate();
  if (item.kind === "dialogue") {
    const imagePath = path.resolve(path.dirname(planPath), item.scenePath);
    const exists = await fs.access(imagePath).then(() => true, () => false);
    if (exists) {
      dialogueOperations.push({ slideIndex: planIndex + 1, objectName: "DIALOGUE_SCENE", imagePath });
    } else if (requireScenes) {
      throw new Error(`plan.slides[${planIndex}]: dialogue scene ${item.scenePath} is missing`);
    } else {
      // Build without the picture: the slide keeps the dialogue text in its service field and a note
      // tells the author which scene is still to be generated. Re-running the build after the
      // scenes step embeds the pictures without changing anything else.
      missingScenes.push({ slide: planIndex + 1, scenePath: item.scenePath });
      speakerNoteOperations.push({ slideIndex: planIndex + 1, text: `СЦЕНА НЕ СГЕНЕРИРОВАНА\n${item.scenePath}` });
    }
  }
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
      keepObjectNames: [...new Set([...Object.values(spec.slots), ...(item.kind === "dialogue" ? ["DIALOGUE_SCENE"] : [])])]
    });
    }
    if (item.manualLayout) {
      speakerNoteOperations.push({ slideIndex: planIndex + 1, text: `ДОВЕРСТАТЬ ВРУЧНУЮ\n${item.manualLayout}` });
    }
  outputSlides.push(clone);
}
// Imported slide facades can be index-backed. Deleting from the end prevents
// earlier deletions from shifting the remaining original-slide references.
for (let index = originals.length - 1; index >= 0; index -= 1) originals[index].delete();
for (const [index, slide] of outputSlides.entries()) slide.moveTo(index);
await (await PresentationFile.exportPptx(deck)).save(out);
  await patchPptxTextRuns(out, textPatches, stripOperations, imagePatches, dialogueOperations, speakerNoteOperations);
console.log(`Created ${outputSlides.length} slides from selected templates only, including ${dialogueOperations.length} dialogue slide(s) with scenes and ${missingScenes.length} dialogue slide(s) awaiting a scene.`);
if (missingScenes.length) {
  await fs.writeFile(`${out}.missing-scenes.json`, `${JSON.stringify(missingScenes, null, 2)}\n`, "utf8");
  for (const m of missingScenes) console.log(`  slide ${m.slide}: scene pending ${m.scenePath}`);
}
