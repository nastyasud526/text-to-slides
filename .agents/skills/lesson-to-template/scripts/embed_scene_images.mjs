import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { usage } from "./runtime.mjs";
import { patchPptxTextRuns } from "./patch_text_runs.mjs";
import { validateCatalog, validatePlan } from "./validate.mjs";

const [approvedPptx, approvedSha256, catalogPath, planPath, finalPptx, reportPath] = process.argv.slice(2);
if (!approvedPptx || !approvedSha256 || !catalogPath || !planPath || !finalPptx || !reportPath) {
  usage("embed_scene_images.mjs", "<approved.pptx> <approved-sha256> <catalog.json> <lesson-plan.json> <final.pptx> <report.json>");
}

const approved = path.resolve(approvedPptx);
const final = path.resolve(finalPptx);
if (approved === final) throw new Error("Final PPTX must be a new file; the approved presentation is immutable.");
if (path.dirname(approved) !== path.dirname(final)) {
  throw new Error("Final PPTX must stay beside the approved PPTX so relative iSpring resource paths remain valid.");
}
await fs.access(approved);
if (await fs.access(final).then(() => true, () => false)) throw new Error(`Final PPTX already exists: ${final}`);

const catalog = validateCatalog(JSON.parse(await fs.readFile(catalogPath, "utf8")));
const plan = validatePlan(JSON.parse(await fs.readFile(planPath, "utf8")), catalog);
const approvedBytes = await fs.readFile(approved);
const approvedHash = createHash("sha256").update(approvedBytes).digest("hex");
if (!/^[a-f0-9]{64}$/i.test(approvedSha256) || approvedHash !== approvedSha256.toLowerCase()) {
  throw new Error(`Approved PPTX SHA-256 mismatch: expected ${approvedSha256}, got ${approvedHash}.`);
}
const dialogueOperations = [];
const noteOperations = [];

for (const [index, item] of plan.slides.entries()) {
  if (item.kind !== "dialogue") continue;
  const imagePath = path.resolve(path.dirname(planPath), item.scenePath);
  await fs.access(imagePath);
  dialogueOperations.push({ slideIndex: index + 1, objectName: "DIALOGUE_SCENE", imagePath });
  noteOperations.push({
    slideIndex: index + 1,
    mode: "remove",
    text: `СЦЕНА НЕ СГЕНЕРИРОВАНА\n${item.scenePath}`
  });
}

await fs.copyFile(approved, final);
await patchPptxTextRuns(final, [], [], [], dialogueOperations, noteOperations);

const approvedHashAfter = createHash("sha256").update(await fs.readFile(approved)).digest("hex");
if (approvedHashAfter !== approvedHash) throw new Error("The approved PPTX changed while images were being inserted.");
const finalHash = createHash("sha256").update(await fs.readFile(final)).digest("hex");
const report = {
  approvedPresentation: approved,
  approvedSha256: approvedHash,
  approvedUnchanged: true,
  finalPresentation: final,
  finalSha256: finalHash,
  insertedScenes: dialogueOperations.map((item) => ({ slide: item.slideIndex, image: item.imagePath }))
};
await fs.mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
