import fs from "node:fs/promises";
import { usage } from "./runtime.mjs";

const [previousPath, contextPath, outputPath] = process.argv.slice(2);
if (!previousPath || !contextPath || !outputPath) usage("rebuild_catalog_context.mjs", "<previous-catalog.json> <context.json> <output-catalog.json>");

const previous = JSON.parse(await fs.readFile(previousPath, "utf8"));
const context = JSON.parse(await fs.readFile(contextPath, "utf8"));
if (!context.groups || !context.titleTemplate || !context.compositions || !Array.isArray(context.slideOrder)) throw new Error("context.json needs groups, titleTemplate, compositions, and slideOrder.");

const compositions = {};
for (const [name, metadata] of Object.entries(context.compositions)) {
  const sourceName = metadata.source ?? name;
  const source = previous.compositions?.[sourceName];
  if (!source) throw new Error(`Context composition ${JSON.stringify(name)} references missing source ${JSON.stringify(sourceName)}.`);
  const spec = { ...source, ...metadata };
  delete spec.source;
  if (Array.isArray(metadata.omitSlots)) {
    spec.slots = Object.fromEntries(Object.entries(spec.slots).filter(([slot]) => !metadata.omitSlots.includes(slot)));
    delete spec.omitSlots;
  }
  compositions[name] = spec;
}

const titleTemplate = { ...previous.titleTemplate, ...context.titleTemplate };
const knownIds = new Set([titleTemplate.templateId, ...Object.values(compositions).map((spec) => spec.templateId)]);
for (const templateId of context.slideOrder) if (!knownIds.has(templateId)) throw new Error(`slideOrder references unknown templateId ${JSON.stringify(templateId)}.`);
if (new Set(context.slideOrder).size !== context.slideOrder.length) throw new Error("slideOrder contains duplicate templateId values.");

const slides = context.slideOrder.map((templateId, index) => ({ sourceSlide: index + 1, templateId }));
const catalog = {
  version: 2,
  groups: context.groups,
  titleTemplate,
  compositions,
  slides,
  instructions: context.instructions ?? "Prepared semantic catalog. Refresh the physical inventory after applying template metadata."
};
await fs.writeFile(outputPath, JSON.stringify(catalog, null, 2), "utf8");
console.log(`Built catalog context for ${slides.length} templates in ${Object.keys(context.groups).length} groups.`);
