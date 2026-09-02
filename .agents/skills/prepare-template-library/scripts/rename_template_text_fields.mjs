import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { usage } from "./runtime.mjs";

const [source, fieldMapPath, output] = process.argv.slice(2);
if (!source || !fieldMapPath || !output) usage("rename_template_text_fields.mjs", "<template.pptx> <field-map.json> <output.pptx>");

function decodeXml(value) {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  throw new Error(`Unclosed <${tag}> element.`);
}

function textShapeRanges(xml) {
  const shapes = [];
  const start = /<p:sp(?=\s|>)[^>]*>/g;
  let match;
  while ((match = start.exec(xml))) {
    const end = findMatchingElement(xml, match.index, "p:sp");
    const shapeXml = xml.slice(match.index, end);
    const cNvPrMatch = /<p:cNvPr(?=\s|>)[^>]*>/.exec(shapeXml);
    const cNvPr = cNvPrMatch?.[0];
    const id = cNvPr?.match(/\bid="([^"]*)"/)?.[1];
    const name = cNvPr?.match(/\bname="([^"]*)"/)?.[1];
    if (cNvPr && id && name && /<p:txBody\b/.test(shapeXml)) {
      shapes.push({ start: match.index, end, shapeXml, id: Number(id), name: decodeXml(name) });
    }
    start.lastIndex = end;
  }
  return shapes;
}

function pictureRanges(xml) {
  const pictures = [];
  const start = /<p:pic(?=\s|>)[^>]*>/g;
  let match;
  while ((match = start.exec(xml))) {
    const end = findMatchingElement(xml, match.index, "p:pic");
    const pictureXml = xml.slice(match.index, end);
    const cNvPrMatch = /<p:cNvPr(?=\s|>)[^>]*>/.exec(pictureXml);
    const cNvPr = cNvPrMatch?.[0];
    const id = cNvPr?.match(/\bid="([^"]*)"/)?.[1];
    const name = cNvPr?.match(/\bname="([^"]*)"/)?.[1];
    if (cNvPr && id !== undefined && name !== undefined) pictures.push({ start: match.index, end, pictureXml, id: Number(id), name: decodeXml(name) });
    start.lastIndex = end;
  }
  return pictures;
}

function renameTextShapes(xml, renames, slideIndex) {
  const expected = new Map(Object.entries(renames).map(([id, name]) => [Number(id), name]));
  const seen = new Set();
  const existingNames = new Set();
  for (const shape of textShapeRanges(xml)) {
    const nextName = expected.get(shape.id);
    if (!nextName) {
      existingNames.add(shape.name);
      continue;
    }
    if (existingNames.has(nextName)) throw new Error(`Slide ${slideIndex}: duplicate final object name ${JSON.stringify(nextName)}.`);
    existingNames.add(nextName);
    seen.add(shape.id);
  }
  if (seen.size !== expected.size) {
    const missing = [...expected.keys()].filter((id) => !seen.has(id));
    throw new Error(`Slide ${slideIndex}: expected text object IDs were not found: ${missing.join(", ")}.`);
  }
  const reverse = [...textShapeRanges(xml)].reverse();
  for (const shape of reverse) {
    const nextName = expected.get(shape.id);
    if (!nextName) continue;
    const replacement = shape.shapeXml.replace(/(<p:cNvPr(?=\s|>)[^>]*\bname=")[^"]*(")/, `$1${escapeAttribute(nextName)}$2`);
    xml = `${xml.slice(0, shape.start)}${replacement}${xml.slice(shape.end)}`;
  }
  return xml;
}

function renamePictures(xml, renames, slideIndex) {
  const expected = new Map(Object.entries(renames).map(([id, name]) => [Number(id), name]));
  const seen = new Set();
  const existingNames = new Set();
  for (const picture of pictureRanges(xml)) {
    const nextName = expected.get(picture.id);
    if (!nextName) {
      existingNames.add(picture.name);
      continue;
    }
    if (existingNames.has(nextName)) throw new Error(`Slide ${slideIndex}: duplicate final image object name ${JSON.stringify(nextName)}.`);
    existingNames.add(nextName);
    seen.add(picture.id);
  }
  if (seen.size !== expected.size) {
    const missing = [...expected.keys()].filter((id) => !seen.has(id));
    throw new Error(`Slide ${slideIndex}: expected image object IDs were not found: ${missing.join(", ")}.`);
  }
  for (const picture of [...pictureRanges(xml)].reverse()) {
    const nextName = expected.get(picture.id);
    if (!nextName) continue;
    const replacement = picture.pictureXml.replace(/(<p:cNvPr(?=\s|>)[^>]*\bname=")[^"]*(")/, `$1${escapeAttribute(nextName)}$2`);
    xml = `${xml.slice(0, picture.start)}${replacement}${xml.slice(picture.end)}`;
  }
  return xml;
}

const fieldMap = JSON.parse(await fs.readFile(fieldMapPath, "utf8"));
if ((fieldMap.version !== 1 && fieldMap.version !== 2) || !fieldMap.slides || typeof fieldMap.slides !== "object") throw new Error("field-map.json must have version 1 or 2 and a slides object.");
const modules = process.env.RUNTIME_NODE_MODULES;
if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
const require = createRequire(path.join(modules, "lesson-to-template-runtime.cjs"));
const JSZip = require("jszip");
const zip = await JSZip.loadAsync(await fs.readFile(source));
for (const [slide, entry] of Object.entries(fieldMap.slides)) {
  const slideIndex = Number(slide);
  if (!Number.isInteger(slideIndex) || slideIndex < 1 || !entry || Array.isArray(entry)) throw new Error(`Invalid field map entry for slide ${JSON.stringify(slide)}.`);
  const textRenames = fieldMap.version === 1 ? entry : entry.text ?? {};
  const imageRenames = fieldMap.version === 1 ? {} : entry.images ?? {};
  if (!textRenames || Array.isArray(textRenames) || !imageRenames || Array.isArray(imageRenames)) throw new Error(`Slide ${slideIndex}: text and images maps must be objects.`);
  const fileName = `ppt/slides/slide${slideIndex}.xml`;
  const file = zip.file(fileName);
  if (!file) throw new Error(`Missing ${fileName}.`);
  let xml = await file.async("string");
  xml = renameTextShapes(xml, textRenames, slideIndex);
  xml = renamePictures(xml, imageRenames, slideIndex);
  zip.file(fileName, xml);
}
await fs.writeFile(output, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(`Renamed mapped text and image fields on ${Object.keys(fieldMap.slides).length} slides without changing text, formatting, or media.`);
