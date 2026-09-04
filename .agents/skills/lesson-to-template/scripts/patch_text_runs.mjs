import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

function normalize(value) {
  return value.replace(/\r\n?/g, "\n");
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function findMatchingElement(xml, start, tag) {
  const token = new RegExp(`<(/?)${tag}(?=\\s|/?>)[^>]*>`, "g");
  token.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = token.exec(xml))) {
    const full = match[0];
    if (full.endsWith("/>")) {
      if (match.index === start && depth === 0) return token.lastIndex;
      continue;
    }
    if (!match[1]) depth += 1;
    else depth -= 1;
    if (depth === 0) return token.lastIndex;
  }
  throw new Error(`Unclosed <${tag}> element in slide XML.`);
}

function findShapeRanges(xml) {
  const ranges = [];
  const start = /<p:sp(?=\s|>)[^>]*>/g;
  let match;
  while ((match = start.exec(xml))) {
    const end = findMatchingElement(xml, match.index, "p:sp");
    ranges.push({ start: match.index, end, xml: xml.slice(match.index, end) });
    start.lastIndex = end;
  }
  return ranges;
}

function findElementRanges(xml, tag) {
  const ranges = [];
  const start = new RegExp(`<${tag}(?=\\s|>)[^>]*>`, "g");
  let match;
  while ((match = start.exec(xml))) {
    const end = findMatchingElement(xml, match.index, tag);
    ranges.push({ start: match.index, end, xml: xml.slice(match.index, end) });
    start.lastIndex = end;
  }
  return ranges;
}

function pictureObjectName(pictureXml) {
  const cNvPr = /<p:cNvPr(?=\s|>)[^>]*>/.exec(pictureXml)?.[0];
  return cNvPr ? attribute(cNvPr, "name") : null;
}

function pictureEmbedRelationshipId(pictureXml) {
  const blip = /<a:blip(?=\s|>)[^>]*\br:embed="([^"]+)"[^>]*\/?>(?:<\/a:blip>)?/.exec(pictureXml);
  return blip ? decodeXml(blip[1]) : null;
}

function slideRelationshipsFileName(slideFileName) {
  return path.posix.join(path.posix.dirname(slideFileName), "_rels", `${path.posix.basename(slideFileName)}.rels`);
}

function relationshipTarget(xml, relationshipId) {
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?>(?:<\/Relationship>)?/g)) {
    if (attribute(match[0], "Id") === relationshipId) return attribute(match[0], "Target");
  }
  return null;
}

function replaceRelationshipTarget(xml, relationshipId, target) {
  let replaced = false;
  const result = xml.replace(/<Relationship\b[^>]*\/?>(?:<\/Relationship>)?/g, (entry) => {
    if (attribute(entry, "Id") !== relationshipId) return entry;
    replaced = true;
    if (!/\bTarget="[^"]*"/.test(entry)) throw new Error(`Relationship ${JSON.stringify(relationshipId)} has no Target attribute.`);
    return entry.replace(/\bTarget="[^"]*"/, `Target="${target}"`);
  });
  if (!replaced) throw new Error(`Missing relationship ${JSON.stringify(relationshipId)}.`);
  return result;
}

function resolveRelationshipTarget(slideFileName, target) {
  if (target.startsWith("/")) return path.posix.normalize(target.slice(1));
  if (target.startsWith("ppt/")) return path.posix.normalize(target);
  return path.posix.normalize(path.posix.join(path.posix.dirname(slideFileName), target));
}

function attribute(xml, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(xml);
  return match ? decodeXml(match[1]) : null;
}

async function orderedSlideFileNames(zip) {
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  const relationships = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  if (!presentation || !relationships) throw new Error("PPTX is missing presentation slide-order metadata.");
  const targets = new Map();
  for (const match of relationships.matchAll(/<Relationship\b[^>]*\/?>(?:<\/Relationship>)?/g)) {
    const id = attribute(match[0], "Id");
    const target = attribute(match[0], "Target");
    if (id && target) targets.set(id, target);
  }
  const result = [];
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/?>(?:<\/p:sldId>)?/g)) {
    const target = targets.get(decodeXml(match[1]));
    if (!target) throw new Error(`Presentation slide relationship ${JSON.stringify(match[1])} has no target.`);
    const normalized = path.posix.normalize(target.startsWith("/") ? target.slice(1) : `ppt/${target}`);
    result.push(normalized);
  }
  if (!result.length) throw new Error("PPTX presentation order contains no slides.");
  return result;
}

function shapeObjectName(shapeXml) {
  const cNvPr = /<p:cNvPr(?=\s|>)[^>]*>/.exec(shapeXml)?.[0];
  return cNvPr ? attribute(cNvPr, "name") : null;
}

function getShapeText(shapeXml) {
  const values = [];
  const token = /<a:br\b[^>]*\/>|<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let match;
  while ((match = token.exec(shapeXml))) values.push(match[1] === undefined ? "\n" : decodeXml(match[1]));
  return normalize(values.join(""));
}

function extractElement(xml, tag) {
  const paired = new RegExp(`<${tag}(?=\\s|>)[^>]*>[\\s\\S]*?<\\/${tag}>`).exec(xml)?.[0];
  if (paired) return paired;
  return new RegExp(`<${tag}(?=\\s|\\/>)[^>]*\\/>`).exec(xml)?.[0] ?? "";
}

function makeRun(templateRun, text) {
  const start = templateRun.match(/^<a:r(?=\s|>)[^>]*>/)?.[0];
  const rPr = extractElement(templateRun, "a:rPr");
  const tStart = templateRun.match(/<a:t(?=\s|>)[^>]*>/)?.[0] ?? "<a:t>";
  if (!start) throw new Error("A text run has no <a:r> opening tag.");
  const xmlSpace = /^\s|\s$/.test(text) && !/\bxml:space=/.test(tStart) ? tStart.replace(/>$/, ' xml:space="preserve">') : tStart;
  return `${start}${rPr}${xmlSpace}${escapeXml(text)}</a:t></a:r>`;
}

function replaceShapeText(shapeXml, value, runStyles = null) {
  const txBodyStart = shapeXml.indexOf("<p:txBody");
  if (txBodyStart < 0) throw new Error("Mapped shape has no <p:txBody>.");
  const txBodyEnd = findMatchingElement(shapeXml, txBodyStart, "p:txBody");
  const txBody = shapeXml.slice(txBodyStart, txBodyEnd);
  const firstParagraph = txBody.match(/<a:p(?=\s|>)[\s\S]*?<\/a:p>/)?.[0];
  if (!firstParagraph) throw new Error("Mapped text shape has no paragraph.");
  const templateRuns = [...txBody.matchAll(/<a:r(?=\s|>)[\s\S]*?<\/a:r>/g)].map((match) => match[0]);
  if (!templateRuns.length) throw new Error("Mapped text shape has no styled <a:r> to preserve.");
  const paragraphStart = firstParagraph.match(/^<a:p(?=\s|>)[^>]*>/)?.[0] ?? "<a:p>";
  const pPr = extractElement(firstParagraph, "a:pPr");
  const endParaRPr = extractElement(firstParagraph, "a:endParaRPr");
  const segments = typeof value === "string" ? [{ text: value, run: 1 }] : value.segments.map((segment) => {
    const run = runStyles?.[segment.style];
    if (!run) throw new Error(`No template run is mapped for style ${JSON.stringify(segment.style)}.`);
    return { text: segment.text, run };
  });
  let needsBreak = false;
  const content = [];
  for (const segment of segments) {
    const templateRun = templateRuns[segment.run - 1];
    if (!templateRun) throw new Error(`Template run ${segment.run} does not exist; found ${templateRuns.length} run(s).`);
    for (const [lineIndex, line] of normalize(segment.text).split("\n").entries()) {
      if (needsBreak || lineIndex) content.push("<a:br/>");
      content.push(makeRun(templateRun, line));
      needsBreak = lineIndex < normalize(segment.text).split("\n").length - 1;
    }
    needsBreak = false;
  }
  const replacementParagraph = `${paragraphStart}${pPr}${content.join("")}${endParaRPr}</a:p>`;
  const beforeParagraph = txBody.slice(0, txBody.indexOf(firstParagraph));
  const replacementTxBody = `${beforeParagraph}${replacementParagraph}</p:txBody>`;
  return `${shapeXml.slice(0, txBodyStart)}${replacementTxBody}${shapeXml.slice(txBodyEnd)}`;
}

function patchSlideXml(xml, patch) {
  const matches = findShapeRanges(xml).filter((shape) => shapeObjectName(shape.xml) === patch.objectName);
  if (matches.length !== 1) {
    throw new Error(`Slide ${patch.slideIndex}, slot ${patch.slot}: expected one text shape named ${JSON.stringify(patch.objectName)}, found ${matches.length}.`);
  }
  const match = matches[0];
  const replacement = replaceShapeText(match.xml, patch.value, patch.runStyles);
  return `${xml.slice(0, match.start)}${replacement}${xml.slice(match.end)}`;
}

function stripSlideToNamedShapes(xml, operation) {
  const spTreeStart = xml.indexOf("<p:spTree");
  if (spTreeStart < 0) throw new Error(`Slide ${operation.slideIndex}: missing <p:spTree>.`);
  const spTreeEnd = findMatchingElement(xml, spTreeStart, "p:spTree");
  const keep = new Set(operation.keepObjectNames);
  const removableTags = ["p:sp", "p:pic", "p:graphicFrame", "p:cxnSp", "p:grpSp"];
  const removals = [];
  for (const tag of removableTags) {
    for (const range of findElementRanges(xml.slice(spTreeStart, spTreeEnd), tag)) {
      const absolute = { ...range, start: range.start + spTreeStart, end: range.end + spTreeStart };
      if (tag === "p:sp" && keep.has(shapeObjectName(range.xml))) continue;
      if (tag === "p:pic" && keep.has(pictureObjectName(range.xml))) continue;
      if (tag === "p:grpSp" && findShapeRanges(range.xml).some((shape) => keep.has(shapeObjectName(shape.xml)))) continue;
      removals.push(absolute);
    }
  }
  const outermost = removals.filter((candidate, index, all) => !all.some((other, otherIndex) =>
    otherIndex !== index && other.start <= candidate.start && other.end >= candidate.end
  ));
  outermost.sort((a, b) => b.start - a.start);
  let result = xml;
  for (const removal of outermost) result = `${result.slice(0, removal.start)}${result.slice(removal.end)}`;
  for (const objectName of keep) {
    const shapeMatches = findShapeRanges(result).filter((shape) => shapeObjectName(shape.xml) === objectName);
    const pictureMatches = findElementRanges(result, "p:pic").filter((picture) => pictureObjectName(picture.xml) === objectName);
    const retainedCount = shapeMatches.length + pictureMatches.length;
    if (retainedCount !== 1) {
      throw new Error(`Slide ${operation.slideIndex}: expected one retained object named ${JSON.stringify(objectName)}, found ${retainedCount}.`);
    }
  }
  return result;
}

function dialoguePicture(objectName, relationshipId, id) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${escapeXml(objectName)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${escapeXml(relationshipId)}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function nextShapeId(xml) {
  let maximum = 0;
  for (const match of xml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"[^>]*\/?>(?:<\/p:cNvPr>)?/g)) maximum = Math.max(maximum, Number(match[1]));
  return maximum + 1;
}

function insertDialogueScene(xml, operation, relationshipId) {
  let namespaced = xml.replace(/<p:sld(?=\s|>)([^>]*)>/, (opening, attributes) => {
    const aNamespace = /\bxmlns:a=/.test(opening) ? "" : ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
    const rNamespace = /\bxmlns:r=/.test(opening) ? "" : ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    return `<p:sld${attributes}${aNamespace}${rNamespace}>`;
  });
  const spTreeStart = namespaced.indexOf("<p:spTree");
  if (spTreeStart < 0) throw new Error(`Slide ${operation.slideIndex}: missing <p:spTree>.`);
  const groupPropertiesStart = namespaced.indexOf("<p:grpSpPr", spTreeStart);
  if (groupPropertiesStart < 0) throw new Error(`Slide ${operation.slideIndex}: missing <p:grpSpPr>.`);
  const groupPropertiesEnd = findMatchingElement(namespaced, groupPropertiesStart, "p:grpSpPr");
  return `${namespaced.slice(0, groupPropertiesEnd)}${dialoguePicture(operation.objectName, relationshipId, nextShapeId(namespaced))}${namespaced.slice(groupPropertiesEnd)}`;
}

function appendRelationship(xml, relationshipId, target) {
  if (relationshipTarget(xml, relationshipId)) throw new Error(`Relationship ${JSON.stringify(relationshipId)} already exists.`);
  const closing = xml.lastIndexOf("</Relationships>");
  if (closing < 0) throw new Error("Slide relationships XML has no closing Relationships element.");
  const entry = `<Relationship Id="${escapeXml(relationshipId)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${escapeXml(target)}"/>`;
  return `${xml.slice(0, closing)}${entry}${xml.slice(closing)}`;
}

function ensurePngContentType(xml) {
  if (/Extension="png"/i.test(xml)) return xml;
  const closing = xml.lastIndexOf("</Types>");
  if (closing < 0) throw new Error("[Content_Types].xml has no closing Types element.");
  return `${xml.slice(0, closing)}<Default Extension="png" ContentType="image/png"/>${xml.slice(closing)}`;
}

export async function getPptxNamedShapeTexts(pptxPath) {
  const modules = process.env.RUNTIME_NODE_MODULES;
  if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
  const require = createRequire(path.join(modules, "lesson-to-template-runtime.cjs"));
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(await fs.readFile(pptxPath));
  const result = new Map();
  const slideFiles = await orderedSlideFileNames(zip);
  for (const [index, name] of slideFiles.entries()) {
    const values = new Map();
    for (const shape of findShapeRanges(await zip.file(name).async("string"))) {
      const objectName = shapeObjectName(shape.xml);
      if (!objectName) continue;
      // Decorative template objects may retain duplicated generic names such as
      // "Shape 0". Mapped fields have already been required to be unique by
      // patchSlideXml; retain the first unrelated duplicate for inventory.
      if (!values.has(objectName)) values.set(objectName, getShapeText(shape.xml));
    }
    result.set(index + 1, values);
  }
  return result;
}

export async function getPptxNamedImageHashes(pptxPath) {
  const modules = process.env.RUNTIME_NODE_MODULES;
  if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
  const require = createRequire(path.join(modules, "lesson-to-template-runtime.cjs"));
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(await fs.readFile(pptxPath));
  const result = new Map();
  const slideFiles = await orderedSlideFileNames(zip);
  for (const [index, slideFileName] of slideFiles.entries()) {
    const slideXml = await zip.file(slideFileName)?.async("string");
    const relationshipsFileName = slideRelationshipsFileName(slideFileName);
    const relationshipsXml = await zip.file(relationshipsFileName)?.async("string");
    if (!slideXml || !relationshipsXml) throw new Error(`Slide ${index + 1} is missing picture relationships.`);
    const images = new Map();
    for (const picture of findElementRanges(slideXml, "p:pic")) {
      const objectName = pictureObjectName(picture.xml);
      const relationshipId = pictureEmbedRelationshipId(picture.xml);
      if (!objectName || !relationshipId) continue;
      const target = relationshipTarget(relationshipsXml, relationshipId);
      if (!target) throw new Error(`Slide ${index + 1}, image ${JSON.stringify(objectName)} has no media target.`);
      const mediaFileName = resolveRelationshipTarget(slideFileName, target);
      const media = zip.file(mediaFileName);
      if (!media) throw new Error(`Slide ${index + 1}, image ${JSON.stringify(objectName)} points to missing ${mediaFileName}.`);
      images.set(objectName, createHash("sha256").update(await media.async("nodebuffer")).digest("hex"));
    }
    result.set(index + 1, images);
  }
  return result;
}

export async function getPptxSlideCount(pptxPath) {
  const modules = process.env.RUNTIME_NODE_MODULES;
  if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
  const require = createRequire(path.join(modules, "lesson-to-template-runtime.cjs"));
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(await fs.readFile(pptxPath));
  return (await orderedSlideFileNames(zip)).length;
}

function speakerNotesWithAppendedText(notesXml, text) {
  const body = findShapeRanges(notesXml).find((shape) => /<p:ph\b[^>]*\btype="body"/.test(shape.xml));
  if (!body) throw new Error("Notes slide has no body placeholder.");
  const txBodyStart = body.xml.indexOf("<p:txBody");
  if (txBodyStart < 0) throw new Error("Notes body has no text frame.");
  const txBodyEnd = findMatchingElement(body.xml, txBodyStart, "p:txBody");
  const paragraphs = normalize(text).split("\n").map((line) => `<a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:rPr lang="ru-RU"/><a:t>${escapeXml(line)}</a:t></a:r><a:endParaRPr lang="ru-RU"/></a:p>`).join("");
  const updatedBody = `${body.xml.slice(0, txBodyEnd - "</p:txBody>".length)}${paragraphs}</p:txBody>${body.xml.slice(txBodyEnd)}`;
  return `${notesXml.slice(0, body.start)}${updatedBody}${notesXml.slice(body.end)}`;
}

async function notesFileName(zip, slideFileName) {
  const rels = await zip.file(slideRelationshipsFileName(slideFileName))?.async("string");
  if (!rels) throw new Error(`Slide ${slideFileName}: missing relationship data for speaker notes.`);
  for (const match of rels.matchAll(/<Relationship\b[^>]*\/?>(?:<\/Relationship>)?/g)) {
    if (attribute(match[0], "Type")?.endsWith("/notesSlide")) {
      const target = attribute(match[0], "Target");
      if (target) return resolveRelationshipTarget(slideFileName, target);
    }
  }
  throw new Error(`Slide ${slideFileName}: no speaker notes relationship.`);
}

export async function getPptxSpeakerNotes(pptxPath) {
  const modules = process.env.RUNTIME_NODE_MODULES;
  if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
  const require = createRequire(path.join(modules, "lesson-to-template-runtime.cjs"));
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(await fs.readFile(pptxPath));
  const result = new Map();
  for (const [index, slideFile] of (await orderedSlideFileNames(zip)).entries()) {
    const notesFile = await notesFileName(zip, slideFile);
    const notesXml = await zip.file(notesFile)?.async("string");
    if (!notesXml) throw new Error(`Slide ${index + 1}: missing ${notesFile}.`);
    result.set(index + 1, [...notesXml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => decodeXml(match[1])).join("\n"));
  }
  return result;
}

export async function patchPptxTextRuns(pptxPath, patches, stripOperations = [], imagePatches = [], dialogueOperations = [], speakerNoteOperations = []) {
  const modules = process.env.RUNTIME_NODE_MODULES;
  if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
  const require = createRequire(path.join(modules, "lesson-to-template-runtime.cjs"));
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(await fs.readFile(pptxPath));
  const slideFiles = await orderedSlideFileNames(zip);
  for (const operation of speakerNoteOperations) {
    const slideFileName = slideFiles[operation.slideIndex - 1];
    if (!slideFileName) throw new Error(`Missing output slide ${operation.slideIndex} for speaker notes.`);
    const notesPath = await notesFileName(zip, slideFileName);
    const notesFile = zip.file(notesPath);
    if (!notesFile) throw new Error(`Slide ${operation.slideIndex}: missing ${notesPath}.`);
    zip.file(notesPath, speakerNotesWithAppendedText(await notesFile.async("string"), operation.text));
  }
  for (const operation of dialogueOperations) {
    const fileName = slideFiles[operation.slideIndex - 1];
    if (!fileName) throw new Error(`Missing output slide ${operation.slideIndex} for dialogue scene.`);
    const slideFile = zip.file(fileName);
    const relationshipsFileName = slideRelationshipsFileName(fileName);
    const relationshipsFile = zip.file(relationshipsFileName);
    if (!slideFile || !relationshipsFile) throw new Error(`Slide ${operation.slideIndex}: missing dialogue relationship data.`);
    await fs.access(operation.imagePath);
    if (path.extname(operation.imagePath).toLowerCase() !== ".png") throw new Error(`Slide ${operation.slideIndex}: dialogue scene must be a PNG.`);
    const relationshipId = `rIdDialogueScene${operation.slideIndex}`;
    const mediaFileName = `ppt/media/dialogue-scene-${String(operation.slideIndex).padStart(3, "0")}.png`;
    zip.file(mediaFileName, await fs.readFile(operation.imagePath));
    zip.file(fileName, insertDialogueScene(await slideFile.async("string"), operation, relationshipId));
    zip.file(relationshipsFileName, appendRelationship(await relationshipsFile.async("string"), relationshipId, `../media/${path.posix.basename(mediaFileName)}`));
    const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
    if (!contentTypes) throw new Error("PPTX is missing [Content_Types].xml.");
    zip.file("[Content_Types].xml", ensurePngContentType(contentTypes));
  }
  for (const operation of stripOperations) {
    const fileName = slideFiles[operation.slideIndex - 1];
    if (!fileName) throw new Error(`Missing output slide ${operation.slideIndex} in exported presentation.`);
    const file = zip.file(fileName);
    if (!file) throw new Error(`Missing ${fileName} in exported presentation.`);
    zip.file(fileName, stripSlideToNamedShapes(await file.async("string"), operation));
  }
  const grouped = new Map();
  for (const patch of patches) {
    const items = grouped.get(patch.slideIndex) ?? [];
    items.push(patch);
    grouped.set(patch.slideIndex, items);
  }
  for (const [slideIndex, slidePatches] of grouped) {
    const fileName = slideFiles[slideIndex - 1];
    if (!fileName) throw new Error(`Missing output slide ${slideIndex} in exported presentation.`);
    const file = zip.file(fileName);
    if (!file) throw new Error(`Missing ${fileName} in exported presentation.`);
    let xml = await file.async("string");
    for (const patch of slidePatches) xml = patchSlideXml(xml, patch);
    zip.file(fileName, xml);
  }
  const seenImageTargets = new Set();
  for (const patch of imagePatches) {
    const key = `${patch.slideIndex}:${patch.objectName}`;
    if (seenImageTargets.has(key)) throw new Error(`Slide ${patch.slideIndex}, image slot ${patch.slot}: duplicate image patch target ${JSON.stringify(patch.objectName)}.`);
    seenImageTargets.add(key);
    const fileName = slideFiles[patch.slideIndex - 1];
    if (!fileName) throw new Error(`Missing output slide ${patch.slideIndex} for image slot ${patch.slot}.`);
    const slideFile = zip.file(fileName);
    const relationshipsFileName = slideRelationshipsFileName(fileName);
    const relationshipsFile = zip.file(relationshipsFileName);
    if (!slideFile || !relationshipsFile) throw new Error(`Slide ${patch.slideIndex}, image slot ${patch.slot}: missing image relationship data.`);
    const slideXml = await slideFile.async("string");
    const matches = findElementRanges(slideXml, "p:pic").filter((picture) => pictureObjectName(picture.xml) === patch.objectName);
    if (matches.length !== 1) throw new Error(`Slide ${patch.slideIndex}, image slot ${patch.slot}: expected one image named ${JSON.stringify(patch.objectName)}, found ${matches.length}.`);
    const relationshipId = pictureEmbedRelationshipId(matches[0].xml);
    if (!relationshipId) throw new Error(`Slide ${patch.slideIndex}, image slot ${patch.slot}: image ${JSON.stringify(patch.objectName)} has no embedded relationship.`);
    await fs.access(patch.imagePath);
    const extension = path.extname(patch.imagePath).toLowerCase() || ".png";
    const mediaFileName = `ppt/media/dialogue-scene-${String(patch.slideIndex).padStart(3, "0")}${extension}`;
    zip.file(mediaFileName, await fs.readFile(patch.imagePath));
    const relationshipsXml = await relationshipsFile.async("string");
    zip.file(relationshipsFileName, replaceRelationshipTarget(relationshipsXml, relationshipId, `../media/${path.posix.basename(mediaFileName)}`));
  }
  await fs.writeFile(pptxPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
