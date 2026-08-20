import fs from "node:fs/promises";
import path from "node:path";
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
    if (full.endsWith("/>")) continue;
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

function attribute(xml, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(xml);
  return match ? decodeXml(match[1]) : null;
}

function shapeObjectName(shapeXml) {
  const cNvPr = /<p:cNvPr(?=\s|>)[^>]*>/.exec(shapeXml)?.[0];
  return cNvPr ? attribute(cNvPr, "name") : null;
}

function getShapeText(shapeXml) {
  const withBreaks = shapeXml
    .replace(/<a:br\b[^>]*\/>/g, "\n")
    .replace(/<\/a:p>\s*<a:p(?=\s|>)[^>]*>/g, "\n");
  const values = [];
  const token = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let match;
  while ((match = token.exec(withBreaks))) values.push(decodeXml(match[1]));
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

function replaceShapeText(shapeXml, value) {
  const txBodyStart = shapeXml.indexOf("<p:txBody");
  if (txBodyStart < 0) throw new Error("Mapped shape has no <p:txBody>.");
  const txBodyEnd = findMatchingElement(shapeXml, txBodyStart, "p:txBody");
  const txBody = shapeXml.slice(txBodyStart, txBodyEnd);
  const firstParagraph = txBody.match(/<a:p(?=\s|>)[\s\S]*?<\/a:p>/)?.[0];
  if (!firstParagraph) throw new Error("Mapped text shape has no paragraph.");
  const templateRun = firstParagraph.match(/<a:r(?=\s|>)[\s\S]*?<\/a:r>/)?.[0];
  if (!templateRun) throw new Error("Mapped text shape has no styled <a:r> to preserve.");
  const paragraphStart = firstParagraph.match(/^<a:p(?=\s|>)[^>]*>/)?.[0] ?? "<a:p>";
  const pPr = extractElement(firstParagraph, "a:pPr");
  const endParaRPr = extractElement(firstParagraph, "a:endParaRPr");
  const lines = normalize(value).split("\n");
  const replacementParagraph = `${paragraphStart}${pPr}${lines.map((line, index) => `${index ? "<a:br/>" : ""}${makeRun(templateRun, line)}`).join("")}${endParaRPr}</a:p>`;
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
  const replacement = replaceShapeText(match.xml, patch.value);
  return `${xml.slice(0, match.start)}${replacement}${xml.slice(match.end)}`;
}

export async function getPptxNamedShapeTexts(pptxPath) {
  const modules = process.env.RUNTIME_NODE_MODULES;
  if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
  const require = createRequire(path.join(modules, "lesson-to-template-runtime.cjs"));
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(await fs.readFile(pptxPath));
  const result = new Map();
  for (const name of Object.keys(zip.files)) {
    const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name);
    if (!match) continue;
    const values = new Map();
    for (const shape of findShapeRanges(await zip.file(name).async("string"))) {
      const objectName = shapeObjectName(shape.xml);
      if (!objectName) continue;
      if (values.has(objectName)) throw new Error(`Slide ${match[1]} has duplicate object name ${JSON.stringify(objectName)}.`);
      values.set(objectName, getShapeText(shape.xml));
    }
    result.set(Number(match[1]), values);
  }
  return result;
}

export async function patchPptxTextRuns(pptxPath, patches) {
  const modules = process.env.RUNTIME_NODE_MODULES;
  if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
  const require = createRequire(path.join(modules, "lesson-to-template-runtime.cjs"));
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(await fs.readFile(pptxPath));
  const grouped = new Map();
  for (const patch of patches) {
    const items = grouped.get(patch.slideIndex) ?? [];
    items.push(patch);
    grouped.set(patch.slideIndex, items);
  }
  for (const [slideIndex, slidePatches] of grouped) {
    const fileName = `ppt/slides/slide${slideIndex}.xml`;
    const file = zip.file(fileName);
    if (!file) throw new Error(`Missing ${fileName} in exported presentation.`);
    let xml = await file.async("string");
    for (const patch of slidePatches) xml = patchSlideXml(xml, patch);
    zip.file(fileName, xml);
  }
  await fs.writeFile(pptxPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
