import fs from "node:fs/promises";
import path from "node:path";
import { loadArtifactTool, usage } from "./runtime.mjs";
import { validateCatalog, validatePlan } from "./validate.mjs";
import { getPptxNamedShapeTexts } from "./patch_text_runs.mjs";

const [pptx, catalogPath, planPath, qaDir] = process.argv.slice(2);
if (!pptx || !catalogPath || !planPath || !qaDir) usage("verify_output.mjs", "<output.pptx> <catalog.json> <lesson-plan.json> <qa-directory>");
const catalog = validateCatalog(JSON.parse(await fs.readFile(catalogPath, "utf8")));
const plan = validatePlan(JSON.parse(await fs.readFile(planPath, "utf8")), catalog);
const { FileBlob, PresentationFile } = await loadArtifactTool();
const deck = await PresentationFile.importPptx(await FileBlob.load(pptx));
if (deck.slides.count !== plan.slides.length) throw new Error(`Expected ${plan.slides.length} output slides, got ${deck.slides.count}`);
await fs.mkdir(qaDir, { recursive: true });
const namedText = await getPptxNamedShapeTexts(pptx);

for (const [slideIndex, item] of plan.slides.entries()) {
  const spec = item.kind === "title" ? catalog.titleTemplate : catalog.compositions[item.composition];
  const slide = deck.slides.getItem(slideIndex);
  for (const [slot, expected] of Object.entries(item.slots)) {
    const actual = namedText.get(slideIndex + 1)?.get(spec.slots[slot]);
    if (actual === undefined) throw new Error(`Slide ${slideIndex + 1}, slot ${slot}: no text shape named ${JSON.stringify(spec.slots[slot])}`);
    const expectedValue = slot === "title" && item.kind === "content" ? `${expected}${item.interactive ? " Интерактивность" : ""}`.toUpperCase() : expected;
    if (actual !== expectedValue) throw new Error(`Slide ${slideIndex + 1}, slot ${slot}: expected exact text ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actual)}`);
  }
  const png = await slide.export({ format: "png", scale: 1 });
  await fs.writeFile(path.join(qaDir, `slide-${String(slideIndex + 1).padStart(2, "0")}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(qaDir, `slide-${String(slideIndex + 1).padStart(2, "0")}.layout.json`), await layout.text(), "utf8");
}
const inspection = await deck.inspect({ kind: "slide,textbox,image,notes,layout", maxChars: 50000 });
await fs.writeFile(path.join(qaDir, "final.inspect.ndjson"), inspection.ndjson, "utf8");
console.log(`Verified ${deck.slides.count} slides, exact mapped text, title casing, and rendered every slide to ${qaDir}.`);
