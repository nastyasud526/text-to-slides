import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { usage } from "./runtime.mjs";

const args = process.argv.slice(2);
const [source, catalogPath, output] = args;
const removeAt = args.indexOf("--remove-slides");
const removeText = removeAt >= 0 ? args[removeAt + 1] : "";
if (!source || !catalogPath || !output || (removeAt >= 0 && !removeText)) usage("apply_catalog_to_library.mjs", "<source.pptx> <catalog.json> <output.pptx> [--remove-slides <comma-separated-1-based-slides>]");

function decodeXml(value) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function attribute(xml, name) {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1] ?? null;
}
function resolveTarget(baseFile, target) {
  if (target.startsWith("/")) return path.posix.normalize(target.slice(1));
  return path.posix.normalize(path.posix.join(path.posix.dirname(baseFile), target));
}
function relationshipEntries(xml) {
  return [...xml.matchAll(/<Relationship\b[^>]*\/>/g)].map((match) => ({
    xml: match[0],
    id: attribute(match[0], "Id"),
    type: attribute(match[0], "Type"),
    target: attribute(match[0], "Target")
  }));
}
function slideOrder(presentationXml, relationshipsXml) {
  const targets = new Map(relationshipEntries(relationshipsXml).map((entry) => [entry.id, entry.target]));
  return [...presentationXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/>/g)].map((match) => ({
    xml: match[0],
    relationshipId: decodeXml(match[1]),
    slideFile: resolveTarget("ppt/presentation.xml", targets.get(decodeXml(match[1])))
  }));
}
function relsPath(part) {
  return path.posix.join(path.posix.dirname(part), "_rels", `${path.posix.basename(part)}.rels`);
}
function contentTypeWithout(contentTypes, part) {
  const partName = `/${part}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return contentTypes.replace(new RegExp(`<Override\\b[^>]*PartName="${partName}"[^>]*/>`, "g"), "");
}
function bodyShapeRange(notesXml) {
  const start = /<p:sp(?=\s|>)[^>]*>/g;
  let match;
  while ((match = start.exec(notesXml))) {
    let depth = 0;
    const token = /<(\/?)p:sp(?=\s|>)[^>]*>/g;
    token.lastIndex = match.index;
    let endMatch;
    while ((endMatch = token.exec(notesXml))) {
      if (endMatch[0].endsWith("/>")) continue;
      depth += endMatch[1] ? -1 : 1;
      if (depth === 0) break;
    }
    const end = token.lastIndex;
    const xml = notesXml.slice(match.index, end);
    if (/<p:ph\b[^>]*type="body"/.test(xml)) return { start: match.index, end, xml };
    start.lastIndex = end;
  }
  throw new Error("Notes slide has no body placeholder.");
}
function notesWithText(notesXml, text) {
  const shape = bodyShapeRange(notesXml);
  const txBody = /<p:txBody(?=\s|>)[\s\S]*?<\/p:txBody>/.exec(shape.xml)?.[0];
  const firstParagraph = txBody?.match(/<a:p(?=\s|>)[\s\S]*?<\/a:p>/)?.[0];
  const templateRun = firstParagraph?.match(/<a:r(?=\s|>)[\s\S]*?<\/a:r>/)?.[0] ?? '<a:r><a:rPr lang="ru-RU" dirty="0"/><a:t></a:t></a:r>';
  if (!txBody || !firstParagraph) throw new Error("Notes body has no editable text paragraph.");
  const prefix = txBody.slice(0, txBody.indexOf(firstParagraph));
  const paragraphStart = firstParagraph.match(/^<a:p(?=\s|>)[^>]*>/)?.[0] ?? "<a:p>";
  const pPr = firstParagraph.match(/<a:pPr(?=\s|>)[\s\S]*?<\/a:pPr>|<a:pPr\b[^>]*\/>/)?.[0] ?? "";
  const endParaRPr = firstParagraph.match(/<a:endParaRPr(?=\s|>)[\s\S]*?<\/a:endParaRPr>|<a:endParaRPr\b[^>]*\/>/)?.[0] ?? "";
  const runStart = templateRun.match(/^<a:r(?=\s|>)[^>]*>/)?.[0] ?? "<a:r>";
  const rPr = templateRun.match(/<a:rPr(?=\s|>)[\s\S]*?<\/a:rPr>|<a:rPr\b[^>]*\/>/)?.[0] ?? "";
  const paragraphs = text.split("\n").map((line) => `${paragraphStart}${pPr}${runStart}${rPr}<a:t>${escapeXml(line)}</a:t></a:r>${endParaRPr}</a:p>`).join("");
  const replacementTxBody = `${prefix}${paragraphs}</p:txBody>`;
  const replacementShape = shape.xml.replace(txBody, replacementTxBody);
  return `${notesXml.slice(0, shape.start)}${replacementShape}${notesXml.slice(shape.end)}`;
}

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
if (!Array.isArray(catalog.slides) || !catalog.slides.length) throw new Error("catalog.slides must be a non-empty array.");
const specs = [catalog.titleTemplate, ...Object.values(catalog.compositions ?? {})].filter(Boolean);
const byTemplateId = new Map(specs.map((spec) => [spec.templateId, spec]));
const removeSlides = removeText ? removeText.split(",").map((value) => Number(value.trim())) : [];
if (removeSlides.some((value) => !Number.isInteger(value) || value < 1)) throw new Error("--remove-slides must contain positive 1-based slide numbers.");
if (new Set(removeSlides).size !== removeSlides.length) throw new Error("--remove-slides contains duplicates.");

const modules = process.env.RUNTIME_NODE_MODULES;
if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
const require = createRequire(path.join(modules, "prepare-template-library-runtime.cjs"));
const JSZip = require("jszip");
const zip = await JSZip.loadAsync(await fs.readFile(source));
let presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
let presentationRels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
let contentTypes = await zip.file("[Content_Types].xml")?.async("string");
if (!presentationXml || !presentationRels || !contentTypes) throw new Error("PPTX is missing presentation package metadata.");
const originalOrder = slideOrder(presentationXml, presentationRels);
const removedParts = new Set();

for (const slideNumber of [...removeSlides].sort((a, b) => b - a)) {
  const slide = originalOrder[slideNumber - 1];
  if (!slide) throw new Error(`Cannot remove missing slide ${slideNumber}.`);
  presentationXml = presentationXml.replace(slide.xml, "");
  const presentationRel = relationshipEntries(presentationRels).find((entry) => entry.id === slide.relationshipId);
  if (presentationRel) presentationRels = presentationRels.replace(presentationRel.xml, "");
  const slideRelsFile = relsPath(slide.slideFile);
  const slideRels = await zip.file(slideRelsFile)?.async("string") ?? "";
  for (const rel of relationshipEntries(slideRels)) {
    if (!rel.target || (!rel.type?.endsWith("/notesSlide") && !rel.type?.endsWith("/comments"))) continue;
    const relatedPart = resolveTarget(slide.slideFile, rel.target);
    removedParts.add(relatedPart);
    removedParts.add(relsPath(relatedPart));
  }
  removedParts.add(slide.slideFile);
  removedParts.add(slideRelsFile);
}

for (const part of removedParts) {
  zip.remove(part);
  contentTypes = contentTypeWithout(contentTypes, part);
}
zip.file("ppt/presentation.xml", presentationXml);
zip.file("ppt/_rels/presentation.xml.rels", presentationRels);
zip.file("[Content_Types].xml", contentTypes);
const appXml = await zip.file("docProps/app.xml")?.async("string");
if (appXml) zip.file("docProps/app.xml", appXml.replace(/<Slides>\d+<\/Slides>/, `<Slides>${catalog.slides.length}</Slides>`));

const finalOrder = slideOrder(presentationXml, presentationRels);
if (finalOrder.length !== catalog.slides.length) throw new Error(`Prepared deck would have ${finalOrder.length} slides, but catalog describes ${catalog.slides.length}.`);
for (const entry of catalog.slides) {
  if (!entry.templateId) continue;
  const slide = finalOrder[entry.sourceSlide - 1];
  if (!slide) throw new Error(`Catalog points to missing slide ${entry.sourceSlide}.`);
  const spec = byTemplateId.get(entry.templateId);
  if (!spec) throw new Error(`No semantic catalog entry exists for ${JSON.stringify(entry.templateId)}.`);
  const slideRelsFile = relsPath(slide.slideFile);
  const slideRels = await zip.file(slideRelsFile)?.async("string") ?? "";
  const notesRel = relationshipEntries(slideRels).find((rel) => rel.type?.endsWith("/notesSlide"));
  if (!notesRel?.target) throw new Error(`Slide ${entry.sourceSlide} has no notes slide for template metadata.`);
  const notesFile = resolveTarget(slide.slideFile, notesRel.target);
  const notesXml = await zip.file(notesFile)?.async("string");
  if (!notesXml) throw new Error(`Missing ${notesFile}.`);
  const notes = [`template_id: ${entry.templateId}`, spec.description, `Пример: ${spec.example}`].filter(Boolean).join("\n");
  zip.file(notesFile, notesWithText(notesXml, notes));
}

await fs.writeFile(output, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(`Prepared ${finalOrder.length} library slides, removed ${removeSlides.length}, and wrote ${catalog.slides.filter((slide) => slide.templateId).length} template metadata blocks while preserving untouched package parts.`);
