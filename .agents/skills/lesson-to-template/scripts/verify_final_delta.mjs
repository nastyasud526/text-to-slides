import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { usage } from "./runtime.mjs";
import { orderedSlideFileNames } from "./patch_text_runs.mjs";
import { validateCatalog, validatePlan } from "./validate.mjs";

const [approvedPptx, finalPptx, catalogPath, planPath, reportPath] = process.argv.slice(2);
if (!approvedPptx || !finalPptx || !catalogPath || !planPath || !reportPath) {
  usage("verify_final_delta.mjs", "<approved.pptx> <final.pptx> <catalog.json> <lesson-plan.json> <report.json>");
}

const modules = process.env.RUNTIME_NODE_MODULES;
if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
const require = createRequire(path.join(modules, "lesson-to-template-runtime.cjs"));
const JSZip = require("jszip");
const catalog = validateCatalog(JSON.parse(await fs.readFile(catalogPath, "utf8")));
const plan = validatePlan(JSON.parse(await fs.readFile(planPath, "utf8")), catalog);
const approved = await JSZip.loadAsync(await fs.readFile(approvedPptx));
const final = await JSZip.loadAsync(await fs.readFile(finalPptx));
const dialogueSlides = new Set(plan.slides.flatMap((item, index) => item.kind === "dialogue" ? [index + 1] : []));
const orderedSlides = await orderedSlideFileNames(approved);
const dialogueSlideParts = new Set([...dialogueSlides].map((slideNumber) => orderedSlides[slideNumber - 1]));
if (dialogueSlideParts.has(undefined)) throw new Error("Lesson plan references a dialogue slide outside the approved PPTX.");
const dialogueRelationshipParts = new Set([...dialogueSlideParts].map((name) => {
  const parsed = path.posix.parse(name);
  return path.posix.join(parsed.dir, "_rels", `${parsed.base}.rels`);
}));
const dialogueNotes = new Set();
for (const slideNumber of dialogueSlides) {
  const slidePart = orderedSlides[slideNumber - 1];
  const parsed = path.posix.parse(slidePart);
  const relsName = path.posix.join(parsed.dir, "_rels", `${parsed.base}.rels`);
  const rels = await approved.file(relsName)?.async("string");
  if (!rels) throw new Error(`Approved PPTX is missing ${relsName}.`);
  const relationship = [...rels.matchAll(/<Relationship\b[^>]*>/g)]
    .map((match) => match[0])
    .find((entry) => /Type="[^"]*\/notesSlide"/.test(entry));
  const target = relationship && /Target="([^"]+)"/.exec(relationship)?.[1];
  if (!target) throw new Error(`Slide ${slideNumber} has no notes relationship.`);
  dialogueNotes.add(path.posix.normalize(target.startsWith("/") ? target.slice(1) : path.posix.join("ppt/slides", target)));
}

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const changed = [];
const names = new Set([...Object.keys(approved.files), ...Object.keys(final.files)]);
for (const name of [...names].sort()) {
  const left = approved.file(name);
  const right = final.file(name);
  if (left?.dir || right?.dir || name.endsWith("/")) continue;
  const leftBytes = left ? await left.async("nodebuffer") : null;
  const rightBytes = right ? await right.async("nodebuffer") : null;
  if (leftBytes && rightBytes && digest(leftBytes) === digest(rightBytes)) continue;
  changed.push(name);
}

const allowed = (name) => {
  if (name === "[Content_Types].xml") return true;
  if (/^ppt\/media\/dialogue-scene-\d+\.png$/.test(name)) return true;
  if (dialogueSlideParts.has(name) || dialogueRelationshipParts.has(name)) return true;
  return dialogueNotes.has(name);
};
const unexpectedChanges = changed.filter((name) => !allowed(name));
const changedTags = changed.filter((name) => name.startsWith("ppt/tags/"));
const result = {
  approvedPresentation: path.resolve(approvedPptx),
  finalPresentation: path.resolve(finalPptx),
  dialogueSlides: [...dialogueSlides],
  dialogueSlideParts: [...dialogueSlideParts],
  changedParts: changed,
  unexpectedChanges,
  ispringTagsUnchanged: changedTags.length === 0,
  status: unexpectedChanges.length || changedTags.length ? "failed" : "complete"
};
await fs.mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (result.status !== "complete") process.exitCode = 3;
