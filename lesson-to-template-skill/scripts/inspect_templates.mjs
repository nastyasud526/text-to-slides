import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { loadArtifactTool, usage } from "./runtime.mjs";

const args = process.argv.slice(2);
const [pptx, out, qaDir] = args;
const mergeAt = args.indexOf("--merge");
const mergePath = mergeAt >= 0 ? args[mergeAt + 1] : null;
if (!pptx || !out || !qaDir || (mergeAt >= 0 && !mergePath)) usage("inspect_templates.mjs", "<template.pptx> <catalog.json> <template-qa-directory> [--merge <previous-catalog.json>]");

function decodeXml(value) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function attribute(xml, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(xml);
  return match ? decodeXml(match[1]) : null;
}
function findMatchingElement(xml, start, tag) {
  const token = new RegExp(`<(/?)${tag}(?=\\s|/?>)[^>]*>`, "g");
  token.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = token.exec(xml))) {
    if (match[0].endsWith("/>")) continue;
    depth += match[1] ? -1 : 1;
    if (depth === 0) return token.lastIndex;
  }
  throw new Error(`Unclosed <${tag}> element in slide XML.`);
}
function getShapeText(shapeXml) {
  const withBreaks = shapeXml.replace(/<a:br\b[^>]*\/>/g, "\n").replace(/<\/a:p>\s*<a:p(?=\s|>)[^>]*>/g, "\n");
  const values = [];
  const token = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let match;
  while ((match = token.exec(withBreaks))) values.push(decodeXml(match[1]));
  return values.join("").replace(/\r\n?/g, "\n");
}
function textNodes(xml) {
  const values = [];
  const token = /<(?:a:t|p:text)(?:\s[^>]*)?>([\s\S]*?)<\/(?:a:t|p:text)>/g;
  let match;
  while ((match = token.exec(xml))) values.push(decodeXml(match[1]));
  return values.join("\n").trim();
}
function shapesFromXml(xml) {
  const shapes = [];
  const start = /<p:sp(?=\s|>)[^>]*>/g;
  let match;
  while ((match = start.exec(xml))) {
    const end = findMatchingElement(xml, match.index, "p:sp");
    const shapeXml = xml.slice(match.index, end);
    const cNvPr = /<p:cNvPr(?=\s|>)[^>]*>/.exec(shapeXml)?.[0];
    const objectName = cNvPr ? attribute(cNvPr, "name") : null;
    const objectId = cNvPr ? attribute(cNvPr, "id") : null;
    const text = getShapeText(shapeXml);
    if (objectName && text.trim()) shapes.push({ objectName, objectId: objectId ? Number(objectId) : null, text });
    start.lastIndex = end;
  }
  return shapes;
}
function relationshipTargets(relsXml, typeFragment) {
  const targets = [];
  for (const rel of relsXml.match(/<Relationship\b[^>]*\/>/g) ?? []) {
    if ((attribute(rel, "Type") ?? "").includes(typeFragment)) targets.push(attribute(rel, "Target"));
  }
  return targets.filter(Boolean);
}
function relationshipPath(target) { return path.posix.normalize(path.posix.join("ppt/slides", target)); }
function templateIdFromMetadata(metadata) {
  const match = /(?:^|\n)\s*template_id\s*:\s*([A-Za-z0-9._-]+)\s*(?:$|\n)/im.exec(metadata);
  return match?.[1] ?? null;
}
function mergeSelections(next, previous) {
  if (!previous || previous.version !== 2) return next;
  const liveIds = new Set(next.slides.map((slide) => slide.templateId).filter(Boolean));
  const keep = (spec) => spec && liveIds.has(spec.templateId) ? spec : null;
  return { ...next, titleTemplate: keep(previous.titleTemplate), compositions: Object.fromEntries(Object.entries(previous.compositions ?? {}).filter(([, spec]) => keep(spec))) };
}

const modules = process.env.RUNTIME_NODE_MODULES;
if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
const require = createRequire(path.join(modules, "lesson-to-template-runtime.cjs"));
const JSZip = require("jszip");
const zip = await JSZip.loadAsync(await fs.readFile(pptx));
const { FileBlob, PresentationFile } = await loadArtifactTool();
const deck = await PresentationFile.importPptx(await FileBlob.load(pptx));
const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
const presentationRels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
if (!presentationXml || !presentationRels) throw new Error("PPTX is missing presentation slide-order metadata.");
const presentationTargets = new Map();
for (const match of presentationRels.matchAll(/<Relationship\b[^>]*\/?>(?:<\/Relationship>)?/g)) {
  const id = attribute(match[0], "Id");
  const target = attribute(match[0], "Target");
  if (id && target) presentationTargets.set(id, target);
}
const orderedSlideFiles = [];
for (const match of presentationXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/?>(?:<\/p:sldId>)?/g)) {
  const target = presentationTargets.get(decodeXml(match[1]));
  if (!target) throw new Error(`Presentation slide relationship ${JSON.stringify(match[1])} has no target.`);
  orderedSlideFiles.push(path.posix.normalize(target.startsWith("/") ? target.slice(1) : `ppt/${target}`));
}
if (orderedSlideFiles.length !== deck.slides.count) throw new Error(`PPTX order has ${orderedSlideFiles.length} slides, importer has ${deck.slides.count}.`);
const slides = [];
for (const [index, slideFile] of orderedSlideFiles.entries()) {
  const slideIndex = index + 1;
  const slideXml = await zip.file(slideFile)?.async("string");
  if (!slideXml) throw new Error(`Missing ${slideFile}.`);
  const relsFile = path.posix.join(path.posix.dirname(slideFile), "_rels", `${path.posix.basename(slideFile)}.rels`);
  const rels = await zip.file(relsFile)?.async("string") ?? "";
  const comments = [];
  const notes = [];
  for (const target of relationshipTargets(rels, "/comments")) { const xml = await zip.file(relationshipPath(target))?.async("string"); if (xml) comments.push(textNodes(xml)); }
  for (const target of relationshipTargets(rels, "/notesSlide")) { const xml = await zip.file(relationshipPath(target))?.async("string"); if (xml) notes.push(textNodes(xml)); }
  const metadata = [...comments, ...notes].filter(Boolean).join("\n\n");
  const text = shapesFromXml(slideXml);
  const suggestedSlots = Object.fromEntries(text.map((shape, index) => [`text_${index + 1}`, shape.objectName]));
  const names = text.map((shape) => shape.objectName);
  slides.push({ sourceSlide: slideIndex, templateId: templateIdFromMetadata(metadata), comments, notes, text, suggestedSlots, objectNamesAreUnique: names.length === new Set(names).size });
}
const baseCatalog = {
  version: 2,
  titleTemplate: null,
  compositions: {},
  slides,
  instructions: "Add `template_id: meaningful.id` to the comment or notes of every reusable slide. Then map titleTemplate and compositions to templateId and map each semantic slot to an existing PowerPoint object name. sourceSlide is refreshed on every inspection and is never a persistent address."
};
const previous = mergePath ? JSON.parse(await fs.readFile(mergePath, "utf8")) : null;
const catalog = mergeSelections(baseCatalog, previous);
await fs.mkdir(qaDir, { recursive: true });
for (const [index, slide] of deck.slides.items.entries()) {
  const stem = `template-slide-${String(index + 1).padStart(2, "0")}`;
  const png = await slide.export({ format: "png", scale: 1 });
  await fs.writeFile(path.join(qaDir, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(qaDir, `${stem}.layout.json`), await layout.text(), "utf8");
}
const inspection = await deck.inspect({ kind: "slide,textbox,image,notes,layout", maxChars: 50000 });
await fs.writeFile(path.join(qaDir, "template.inspect.ndjson"), inspection.ndjson, "utf8");
await fs.writeFile(out, JSON.stringify(catalog, null, 2), "utf8");
console.log(`Catalogued and rendered ${slides.length} slides; found ${slides.filter((slide) => slide.templateId).length} template_id markers.`);
