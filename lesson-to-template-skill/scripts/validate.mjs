function object(value, label) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${label} must be an object`);
}

function integer(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${label} must be an integer greater than or equal to ${minimum}`);
}

function slotBindings(value, label) {
  object(value, label);
  const usedNames = new Set();
  for (const [slot, objectName] of Object.entries(value)) {
    if (!slot.trim()) throw new Error(`${label} has an empty slot name`);
    if (typeof objectName !== "string" || !objectName.trim()) throw new Error(`${label}.${slot} must be a non-empty PowerPoint object name`);
    if (usedNames.has(objectName)) throw new Error(`${label} maps more than one slot to object ${JSON.stringify(objectName)}`);
    usedNames.add(objectName);
  }
}

function imageBindings(value, label) {
  if (value === undefined) return;
  object(value, label);
  const usedNames = new Set();
  for (const [slot, objectName] of Object.entries(value)) {
    if (!slot.trim()) throw new Error(`${label} has an empty image slot name`);
    if (typeof objectName !== "string" || !objectName.trim()) throw new Error(`${label}.${slot} must be a non-empty PowerPoint image object name`);
    if (usedNames.has(objectName)) throw new Error(`${label} maps more than one image slot to object ${JSON.stringify(objectName)}`);
    usedNames.add(objectName);
  }
}

function runStyleBindings(value, slots, label) {
  if (value === undefined) return;
  object(value, label);
  for (const [slot, styles] of Object.entries(value)) {
    if (slots[slot] === undefined) throw new Error(`${label}.${slot} has no matching slot`);
    object(styles, `${label}.${slot}`);
    if (!Object.keys(styles).length) throw new Error(`${label}.${slot} must map at least one style`);
    for (const [style, run] of Object.entries(styles)) {
      if (!style.trim()) throw new Error(`${label}.${slot} has an empty style name`);
      integer(run, `${label}.${slot}.${style}`, 1);
    }
  }
}

function template(value, label, requireTitleSlot) {
  object(value, label);
  if (typeof value.templateId !== "string" || !value.templateId.trim()) throw new Error(`${label}.templateId must be a non-empty string`);
  slotBindings(value.slots, `${label}.slots`);
  imageBindings(value.imageSlots, `${label}.imageSlots`);
  runStyleBindings(value.runStyles, value.slots, `${label}.runStyles`);
  if (value.stripToSlots !== undefined && typeof value.stripToSlots !== "boolean") throw new Error(`${label}.stripToSlots must be boolean`);
  if (value.stripToSlots && value.imageSlots && Object.keys(value.imageSlots).length) throw new Error(`${label} cannot combine stripToSlots with imageSlots`);
  if (requireTitleSlot && value.slots.title === undefined) throw new Error(`${label}.slots.title is required`);
}

export function slotText(value) {
  return typeof value === "string" ? value : value.segments.map((segment) => segment.text).join("");
}

function slotValue(value, label, runStyles) {
  if (typeof value === "string") return;
  object(value, label);
  if (!Array.isArray(value.segments) || !value.segments.length) throw new Error(`${label}.segments must be a non-empty array`);
  for (const [index, segment] of value.segments.entries()) {
    object(segment, `${label}.segments[${index}]`);
    if (typeof segment.style !== "string" || !segment.style.trim()) throw new Error(`${label}.segments[${index}].style must be a non-empty string`);
    if (typeof segment.text !== "string") throw new Error(`${label}.segments[${index}].text must be a string`);
    if (!runStyles?.[segment.style]) throw new Error(`${label}.segments[${index}].style ${JSON.stringify(segment.style)} is not mapped in catalog runStyles`);
  }
}

function capacity(value, label) {
  if (value === undefined) return;
  object(value, label);
  for (const [slot, limit] of Object.entries(value)) {
    if (typeof limit === "number") {
      integer(limit, `${label}.${slot}`, 1);
      continue;
    }
    object(limit, `${label}.${slot}`);
    if (limit.maxChars !== undefined) integer(limit.maxChars, `${label}.${slot}.maxChars`, 1);
    if (limit.maxLines !== undefined) integer(limit.maxLines, `${label}.${slot}.maxLines`, 1);
    if (limit.maxChars === undefined && limit.maxLines === undefined) throw new Error(`${label}.${slot} needs maxChars or maxLines`);
  }
}

function catalogSlides(value) {
  if (!Array.isArray(value) || !value.length) throw new Error("catalog.slides must be a non-empty array");
  const ids = new Set();
  for (const [index, slide] of value.entries()) {
    object(slide, `catalog.slides[${index}]`);
    integer(slide.sourceSlide, `catalog.slides[${index}].sourceSlide`, 1);
    if (slide.templateId === null || slide.templateId === undefined) continue;
    if (typeof slide.templateId !== "string" || !slide.templateId.trim()) throw new Error(`catalog.slides[${index}].templateId must be a non-empty string or null`);
    if (ids.has(slide.templateId)) throw new Error(`catalog.slides contains duplicate templateId ${JSON.stringify(slide.templateId)}`);
    ids.add(slide.templateId);
  }
}

export function resolveTemplate(catalog, spec, label = "template") {
  const matches = catalog.slides.filter((slide) => slide.templateId === spec.templateId);
  if (matches.length !== 1) throw new Error(`${label}.templateId ${JSON.stringify(spec.templateId)} must identify exactly one current library slide; found ${matches.length}`);
  return matches[0];
}

export function validateCatalog(catalog) {
  object(catalog, "catalog");
  if (catalog.version !== 2) throw new Error("catalog.version must equal 2; regenerate it with inspect_templates.mjs and add template_id comments to reusable slides");
  catalogSlides(catalog.slides);
  template(catalog.titleTemplate, "catalog.titleTemplate", true);
  resolveTemplate(catalog, catalog.titleTemplate, "catalog.titleTemplate");
  object(catalog.compositions, "catalog.compositions");
  if (!Object.keys(catalog.compositions).length) throw new Error("catalog.compositions must contain at least one composition");
  for (const [name, spec] of Object.entries(catalog.compositions)) {
    if (!name.trim()) throw new Error("catalog.compositions has an empty name");
    template(spec, `catalog.compositions.${name}`, true);
    resolveTemplate(catalog, spec, `catalog.compositions.${name}`);
    if (spec.kind !== undefined && typeof spec.kind !== "string") throw new Error(`catalog.compositions.${name}.kind must be a string`);
    if (spec.kinds !== undefined && (!Array.isArray(spec.kinds) || spec.kinds.some((kind) => typeof kind !== "string"))) throw new Error(`catalog.compositions.${name}.kinds must be an array of strings`);
    capacity(spec.capacity, `catalog.compositions.${name}.capacity`);
  }
  return catalog;
}

export function validatePlan(plan, catalog) {
  object(plan, "plan");
  if (plan.version !== 2) throw new Error("plan.version must equal 2");
  if (typeof plan.lessonTitle !== "string" || !plan.lessonTitle.trim()) throw new Error("plan.lessonTitle must be a non-empty string");
  if (!Array.isArray(plan.slides) || !plan.slides.length) throw new Error("plan.slides must be a non-empty array");
  if (plan.slides[0].kind !== "title") throw new Error("plan.slides[0] must be the title slide");
  plan.slides.forEach((item, index) => {
    object(item, `plan.slides[${index}]`);
    if (item.kind !== "title" && item.kind !== "content" && item.kind !== "dialogue") throw new Error(`plan.slides[${index}].kind must be title, content, or dialogue`);
    const spec = item.kind === "title" ? catalog.titleTemplate : catalog.compositions[item.composition];
    if (!spec) throw new Error(`plan.slides[${index}] has no mapped composition`);
    object(item.slots, `plan.slides[${index}].slots`);
    for (const [slot, value] of Object.entries(item.slots)) {
      if (spec.slots[slot] === undefined) throw new Error(`plan.slides[${index}].slots.${slot} is not in its catalog template`);
      slotValue(value, `plan.slides[${index}].slots.${slot}`, spec.runStyles?.[slot]);
    }
    for (const slot of Object.keys(spec.slots)) {
      if (item.slots[slot] === undefined) throw new Error(`plan.slides[${index}].slots.${slot} is required so template sample text cannot remain`);
    }
    if (item.slots.title === undefined) throw new Error(`plan.slides[${index}].slots.title is required`);
    if (item.kind === "title" && index !== 0) throw new Error("a title slide may appear only at the start of plan.slides");
    if (item.kind === "content") integer(item.sourceSlide, `plan.slides[${index}].sourceSlide`, 1);
    if (item.kind === "dialogue") {
      const kinds = spec.kinds ?? (spec.kind ? [spec.kind] : []);
      if (!kinds.includes("dialogue")) throw new Error(`plan.slides[${index}] uses a non-dialogue composition`);
      if (!spec.imageSlots?.scene) throw new Error(`plan.slides[${index}] dialogue composition needs catalog.imageSlots.scene`);
      if (typeof item.scenePath !== "string" || !item.scenePath.trim()) throw new Error(`plan.slides[${index}].scenePath must be a non-empty image path`);
    }
    if (item.interactive !== undefined && typeof item.interactive !== "boolean") throw new Error(`plan.slides[${index}].interactive must be boolean when present`);
  });
  return plan;
}
