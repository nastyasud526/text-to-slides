import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { validateCatalog, validatePlan } from "../../lesson-to-template-skill/scripts/validate.mjs";


const [sourcePath, outputPath, sourceRenderDir, outputRenderDir, scanPath, catalogPath, smokePlanPath] = process.argv.slice(2);
const modules = process.env.RUNTIME_NODE_MODULES;
if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
const require = createRequire(path.join(modules, "verify-library-runtime.cjs"));
const JSZip = require("jszip");
const [sourceZip, outputZip] = await Promise.all([
  JSZip.loadAsync(await fs.readFile(sourcePath)),
  JSZip.loadAsync(await fs.readFile(outputPath))
]);

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
function attr(xml, name) {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1] ?? null;
}
function rels(xml, typeSuffix) {
  return [...xml.matchAll(/<Relationship\b[^>]*\/>/g)].map((match) => match[0]).filter((item) => attr(item, "Type")?.endsWith(typeSuffix));
}

const outputPresentation = await outputZip.file("ppt/presentation.xml").async("string");
const slideCount = [...outputPresentation.matchAll(/<p:sldId\b/g)].length;
if (slideCount !== 50) throw new Error(`Expected 50 slides, found ${slideCount}.`);

for (const name of Object.keys(sourceZip.files).filter((item) => /^ppt\/theme\/theme[^/]*\.xml$/i.test(item))) {
  const [before, after] = await Promise.all([sourceZip.file(name).async("uint8array"), outputZip.file(name).async("uint8array")]);
  if (hash(before) !== hash(after)) throw new Error(`Theme changed: ${name}`);
}

const notesTargets = [];
for (let slideNumber = 1; slideNumber <= 50; slideNumber += 1) {
  const relPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
  const xml = await outputZip.file(relPath).async("string");
  const noteRels = rels(xml, "/notesSlide");
  if (noteRels.length !== 1) throw new Error(`Slide ${slideNumber} has ${noteRels.length} notes slide relationships.`);
  notesTargets.push(attr(noteRels[0], "Target"));
}
if (new Set(notesTargets).size !== 50) throw new Error("Notes slide targets are not unique.");

for (const [slideNumber, marker] of [[1, "template_id: staging.blank"], [50, "template_id: staging.interaction"]]) {
  const target = notesTargets[slideNumber - 1];
  const notesPath = `ppt/notesSlides/${path.posix.basename(target)}`;
  const xml = await outputZip.file(notesPath).async("string");
  if (!xml.includes(marker)) throw new Error(`Slide ${slideNumber} notes do not contain ${marker}.`);
}

const renderHashMismatches = [];
for (let slideNumber = 1; slideNumber <= 49; slideNumber += 1) {
  const stem = `template-slide-${String(slideNumber).padStart(2, "0")}.png`;
  const [before, after] = await Promise.all([fs.readFile(path.join(sourceRenderDir, stem)), fs.readFile(path.join(outputRenderDir, stem))]);
  if (hash(before) !== hash(after)) renderHashMismatches.push(slideNumber);
}
const [dialoguePng, interactionPng] = await Promise.all([
  fs.readFile(path.join(outputRenderDir, "template-slide-01.png")),
  fs.readFile(path.join(outputRenderDir, "template-slide-50.png"))
]);
if (hash(dialoguePng) !== hash(interactionPng)) throw new Error("Interaction template is not an exact visual clone of dialogue template.");

const scan = JSON.parse(await fs.readFile(scanPath, "utf8"));
const markers = new Map(scan.slides.filter((slide) => slide.templateId).map((slide) => [slide.sourceSlide, slide.templateId]));
if (markers.get(1) !== "staging.blank" || markers.get(50) !== "staging.interaction") throw new Error(`Unexpected staging markers: ${JSON.stringify([...markers])}`);

const catalog = validateCatalog(JSON.parse(await fs.readFile(catalogPath, "utf8")));
validatePlan(JSON.parse(await fs.readFile(smokePlanPath, "utf8")), catalog);
if (catalog.slides.length !== 50 || Object.keys(catalog.compositions).length !== 50) throw new Error("Catalog does not contain 50 slides and 50 compositions.");

console.log(`LIBRARY_OK slides=50 notes_targets_unique=50 themes_preserved catalog=50/50 interaction_plan=valid render_hash_mismatches=${renderHashMismatches.join(",") || "none"}`);
