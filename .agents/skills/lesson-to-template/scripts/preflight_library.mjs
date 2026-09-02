import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { usage } from "./runtime.mjs";
import { validateCatalog } from "./validate.mjs";

function decodeXml(value) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function attribute(xml, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(xml);
  return match ? decodeXml(match[1]) : null;
}

function relationshipEntries(xml) {
  return [...xml.matchAll(/<Relationship\b[^>]*\/?>(?:<\/Relationship>)?/g)].map((match) => ({
    id: attribute(match[0], "Id"),
    type: attribute(match[0], "Type"),
    target: attribute(match[0], "Target")
  }));
}

function resolveTarget(baseFile, target) {
  if (target.startsWith("/")) return path.posix.normalize(target.slice(1));
  return path.posix.normalize(path.posix.join(path.posix.dirname(baseFile), target));
}

function textNodes(xml) {
  const values = [];
  for (const match of xml.matchAll(/<(?:a:t|p:text)(?:\s[^>]*)?>([\s\S]*?)<\/(?:a:t|p:text)>/g)) values.push(decodeXml(match[1]));
  return values.join("\n").trim();
}

function templateIdFromMetadata(metadata) {
  return /(?:^|\n)\s*template_id\s*:\s*([A-Za-z0-9._-]+)\s*(?:$|\n)/im.exec(metadata)?.[1] ?? null;
}

async function orderedSlideFiles(zip) {
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  const relationships = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  if (!presentation || !relationships) throw new Error("PPTX is missing presentation slide-order metadata.");
  const targets = new Map(relationshipEntries(relationships).map((entry) => [entry.id, entry.target]));
  const files = [];
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/?>(?:<\/p:sldId>)?/g)) {
    const target = targets.get(decodeXml(match[1]));
    if (!target) throw new Error(`Presentation relationship ${JSON.stringify(match[1])} has no target.`);
    files.push(target.startsWith("/") ? path.posix.normalize(target.slice(1)) : path.posix.normalize(`ppt/${target}`));
  }
  return files;
}

async function slideMetadata(zip, slideFile) {
  const relsFile = path.posix.join(path.posix.dirname(slideFile), "_rels", `${path.posix.basename(slideFile)}.rels`);
  const rels = await zip.file(relsFile)?.async("string") ?? "";
  const parts = [];
  for (const entry of relationshipEntries(rels)) {
    if (!entry.target || (!entry.type?.endsWith("/notesSlide") && !entry.type?.endsWith("/comments"))) continue;
    const xml = await zip.file(resolveTarget(slideFile, entry.target))?.async("string");
    if (xml) parts.push(textNodes(xml));
  }
  return parts.filter(Boolean).join("\n\n");
}

export async function preflightLibrary(templatePath, catalogValue) {
  const started = performance.now();
  const catalog = validateCatalog(catalogValue);
  const modules = process.env.RUNTIME_NODE_MODULES;
  if (!modules) throw new Error("RUNTIME_NODE_MODULES is not set.");
  const require = createRequire(path.join(modules, "lesson-to-template-preflight.cjs"));
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(await fs.readFile(templatePath));
  const slideFiles = await orderedSlideFiles(zip);
  if (slideFiles.length !== catalog.slides.length) throw new Error(`Prepared library has ${slideFiles.length} slides, catalog has ${catalog.slides.length}. Request a separate library-preparation task.`);

  const specs = [catalog.titleTemplate, ...Object.values(catalog.compositions)];
  for (const spec of specs) {
    const catalogSlide = catalog.slides.find((slide) => slide.templateId === spec.templateId);
    const slideFile = slideFiles[catalogSlide.sourceSlide - 1];
    if (!slideFile) throw new Error(`Catalog template ${JSON.stringify(spec.templateId)} points to missing slide ${catalogSlide.sourceSlide}.`);
    const slideXml = await zip.file(slideFile)?.async("string");
    if (!slideXml) throw new Error(`Prepared library is missing ${slideFile}.`);
    const actualTemplateId = templateIdFromMetadata(await slideMetadata(zip, slideFile));
    if (actualTemplateId !== spec.templateId) throw new Error(`Slide ${catalogSlide.sourceSlide}: expected template_id ${JSON.stringify(spec.templateId)}, found ${JSON.stringify(actualTemplateId)}. Request a separate library-preparation task.`);
    const objectNames = new Set([...slideXml.matchAll(/<p:cNvPr\b[^>]*\bname="([^"]*)"[^>]*\/?>(?:<\/p:cNvPr>)?/g)].map((match) => decodeXml(match[1])));
    for (const objectName of [...Object.values(spec.slots), ...Object.values(spec.imageSlots ?? {})]) {
      if (!objectNames.has(objectName)) throw new Error(`Slide ${catalogSlide.sourceSlide}, template ${JSON.stringify(spec.templateId)}: mapped object ${JSON.stringify(objectName)} is missing. Request a separate library-preparation task.`);
    }
  }
  const elapsedMs = Math.round(performance.now() - started);
  return { slideCount: slideFiles.length, templateCount: specs.length, elapsedMs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [templatePath, catalogPath] = process.argv.slice(2);
  if (!templatePath || !catalogPath) usage("preflight_library.mjs", "<template.pptx> <catalog.json>");
  const result = await preflightLibrary(templatePath, JSON.parse(await fs.readFile(catalogPath, "utf8")));
  console.log(`Prepared library matches catalog: ${result.slideCount} slides, ${result.templateCount} mapped templates, ${result.elapsedMs} ms.`);
}
