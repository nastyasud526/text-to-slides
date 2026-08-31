import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { loadArtifactTool } from "../../lesson-to-template-skill/scripts/runtime.mjs";


const [sourcePath, outputPath, qaDir] = process.argv.slice(2);
if (!sourcePath || !outputPath || !qaDir) {
  throw new Error("Usage: duplicate_interaction_template.mjs <source.pptx> <output.pptx> <qa-dir>");
}

const { FileBlob, PresentationFile } = await loadArtifactTool();
const deck = await PresentationFile.importPptx(await FileBlob.load(sourcePath));
if (deck.slides.count !== 49) throw new Error(`Expected 49 source slides, found ${deck.slides.count}.`);

const dialogueTemplate = deck.slides.getItem(0);
dialogueTemplate.speakerNotes.textFrame.setText([
  "template_id: staging.blank",
  "Пустой слайд только для диалоговых сцен"
]);

const interactionTemplate = dialogueTemplate.duplicate();
interactionTemplate.moveTo(deck.slides.count - 1);
interactionTemplate.speakerNotes.textFrame.setText([
  "template_id: staging.interaction",
  "Пустой слайд только для интерактивностей"
]);

if (deck.slides.count !== 50) throw new Error(`Expected 50 output slides, found ${deck.slides.count}.`);
await fs.mkdir(qaDir, { recursive: true });

async function saveBlob(blob, output) {
  await fs.writeFile(output, new Uint8Array(await blob.arrayBuffer()));
}

await saveBlob(await dialogueTemplate.export({ format: "png", scale: 1 }), path.join(qaDir, "dialogue-template.png"));
await saveBlob(await interactionTemplate.export({ format: "png", scale: 1 }), path.join(qaDir, "interaction-template.png"));
await fs.writeFile(path.join(qaDir, "dialogue-template.layout.json"), await (await dialogueTemplate.export({ format: "layout" })).text(), "utf8");
await fs.writeFile(path.join(qaDir, "interaction-template.layout.json"), await (await interactionTemplate.export({ format: "layout" })).text(), "utf8");

await (await PresentationFile.exportPptx(deck)).save(outputPath);

const modules = process.env.RUNTIME_NODE_MODULES;
if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
const require = createRequire(path.join(modules, "interaction-template-runtime.cjs"));
const JSZip = require("jszip");
const [sourceZip, outputZip] = await Promise.all([
  JSZip.loadAsync(await fs.readFile(sourcePath)),
  JSZip.loadAsync(await fs.readFile(outputPath))
]);

function decodeXml(value) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function xmlAttribute(xml, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(xml);
  return match ? decodeXml(match[1]) : null;
}
function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function nextRelationshipId(xml) {
  const used = new Set([...xml.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1])));
  let value = 1;
  while (used.has(value)) value += 1;
  return `rId${value}`;
}
function addRelationship(xml, type, target) {
  if ([...xml.matchAll(/<Relationship\b[^>]*\/>/g)].some((match) => xmlAttribute(match[0], "Type") === type)) return xml;
  const relationship = `<Relationship Id="${nextRelationshipId(xml)}" Type="${type}" Target="${target}"/>`;
  return xml.replace(/<\/Relationships>\s*$/, `${relationship}</Relationships>`);
}
function addOverride(xml, partName, contentType) {
  if (xml.includes(`PartName="${partName}"`)) return xml;
  return xml.replace(/<\/Types>\s*$/, `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`);
}
function setOverride(xml, partName, contentType) {
  const escapedPart = partName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<Override\\b(?=[^>]*\\bPartName="${escapedPart}")[^>]*/>`);
  const replacement = `<Override PartName="${partName}" ContentType="${contentType}"/>`;
  return pattern.test(xml) ? xml.replace(pattern, replacement) : xml.replace(/<\/Types>\s*$/, `${replacement}</Types>`);
}
function replaceNotesBody(xml, lines) {
  const text = escapeXml(lines.join("\n"));
  let count = 0;
  const next = xml.replace(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>/g, (match) => {
    const replacement = count === 0 ? text : "";
    count += 1;
    return match.replace(/>[\s\S]*<\/a:t>$/, `>${replacement}</a:t>`);
  });
  if (!count) throw new Error("Notes slide has no editable a:t body text.");
  return next;
}

for (const name of Object.keys(sourceZip.files).filter((item) => /^ppt\/theme\/theme[^/]*\.xml$/i.test(item))) {
  outputZip.file(name, await sourceZip.file(name).async("uint8array"));
}

for (const name of Object.keys(sourceZip.files).filter((item) => /^ppt\/(?:notesSlides|notesMasters)\//i.test(item))) {
  if (!sourceZip.files[name].dir) outputZip.file(name, await sourceZip.file(name).async("uint8array"));
}

const notesSlideType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
const notesMasterType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster";
for (let slideNumber = 1; slideNumber <= 49; slideNumber += 1) {
  const relPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
  const sourceRels = await sourceZip.file(relPath)?.async("string") ?? "";
  const notesRel = [...sourceRels.matchAll(/<Relationship\b[^>]*\/>/g)].map((match) => match[0]).find((item) => xmlAttribute(item, "Type") === notesSlideType);
  if (!notesRel) continue;
  const outputRels = await outputZip.file(relPath)?.async("string");
  if (!outputRels) throw new Error(`Missing ${relPath} after export.`);
  outputZip.file(relPath, addRelationship(outputRels, notesSlideType, xmlAttribute(notesRel, "Target")));
}

const sourcePresentationRels = await sourceZip.file("ppt/_rels/presentation.xml.rels")?.async("string") ?? "";
const notesMasterRel = [...sourcePresentationRels.matchAll(/<Relationship\b[^>]*\/>/g)].map((match) => match[0]).find((item) => xmlAttribute(item, "Type") === notesMasterType);
if (notesMasterRel) {
  const outputPresentationRels = await outputZip.file("ppt/_rels/presentation.xml.rels").async("string");
  outputZip.file("ppt/_rels/presentation.xml.rels", addRelationship(outputPresentationRels, notesMasterType, xmlAttribute(notesMasterRel, "Target")));
}

const slide1Rels = await sourceZip.file("ppt/slides/_rels/slide1.xml.rels").async("string");
const slide1NotesRel = [...slide1Rels.matchAll(/<Relationship\b[^>]*\/>/g)].map((match) => match[0]).find((item) => xmlAttribute(item, "Type") === notesSlideType);
if (!slide1NotesRel) throw new Error("Source slide 1 has no notes slide relationship.");
const slide1NotesTarget = xmlAttribute(slide1NotesRel, "Target");
const slide1NotesPath = path.posix.normalize(path.posix.join("ppt/slides", slide1NotesTarget));
const slide1NotesRelsPath = path.posix.join(path.posix.dirname(slide1NotesPath), "_rels", `${path.posix.basename(slide1NotesPath)}.rels`);
const slide1NotesXml = await sourceZip.file(slide1NotesPath).async("string");
outputZip.file(slide1NotesPath, replaceNotesBody(slide1NotesXml, ["template_id: staging.blank", "Пустой слайд только для диалоговых сцен"]));

const noteNumbers = Object.keys(sourceZip.files).map((name) => /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/i.exec(name)?.[1]).filter(Boolean).map(Number);
const newNotesNumber = Math.max(...noteNumbers) + 1;
const newNotesPath = `ppt/notesSlides/notesSlide${newNotesNumber}.xml`;
const newNotesRelsPath = `ppt/notesSlides/_rels/notesSlide${newNotesNumber}.xml.rels`;
outputZip.file(newNotesPath, replaceNotesBody(slide1NotesXml, ["template_id: staging.interaction", "Пустой слайд только для интерактивностей"]));
const newNotesRels = (await sourceZip.file(slide1NotesRelsPath).async("string")).replace(/Target="\.\.\/slides\/slide1\.xml"/g, 'Target="../slides/slide50.xml"');
outputZip.file(newNotesRelsPath, newNotesRels);
const slide50RelsPath = "ppt/slides/_rels/slide50.xml.rels";
const slide50Rels = await outputZip.file(slide50RelsPath).async("string");
outputZip.file(slide50RelsPath, addRelationship(slide50Rels, notesSlideType, `../notesSlides/notesSlide${newNotesNumber}.xml`));

let contentTypes = await outputZip.file("[Content_Types].xml").async("string");
const sourceContentTypes = await sourceZip.file("[Content_Types].xml").async("string");
for (const match of sourceContentTypes.matchAll(/<Override\b[^>]*\/>/g)) {
  const partName = xmlAttribute(match[0], "PartName");
  const contentType = xmlAttribute(match[0], "ContentType");
  if (partName?.startsWith("/ppt/notesSlides/") || partName?.startsWith("/ppt/notesMasters/") || partName?.startsWith("/ppt/theme/")) contentTypes = setOverride(contentTypes, partName, contentType);
}
contentTypes = setOverride(contentTypes, `/ppt/notesSlides/notesSlide${newNotesNumber}.xml`, "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml");
outputZip.file("[Content_Types].xml", contentTypes);

await fs.writeFile(outputPath, await outputZip.generateAsync({ type: "nodebuffer" }));

console.log(`Created ${outputPath} with ${deck.slides.count} slides; appended staging.interaction as an exact visual clone of slide 1.`);
