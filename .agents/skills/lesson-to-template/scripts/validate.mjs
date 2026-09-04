import { PRIMARY_TYPES, primaryFromAnswers } from "./bridge.mjs";
function object(value, label) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${label} must be an object`);
}

function integer(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${label} must be an integer greater than or equal to ${minimum}`);
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
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

function template(value, label, requireTitleSlot, requireContext = true) {
  object(value, label);
  nonEmptyString(value.templateId, `${label}.templateId`);
  slotBindings(value.slots, `${label}.slots`);
  imageBindings(value.imageSlots, `${label}.imageSlots`);
  runStyleBindings(value.runStyles, value.slots, `${label}.runStyles`);
  if (value.stripToSlots !== undefined && typeof value.stripToSlots !== "boolean") throw new Error(`${label}.stripToSlots must be boolean`);
  if (value.stripToSlots && value.imageSlots && Object.keys(value.imageSlots).length) throw new Error(`${label} cannot combine stripToSlots with imageSlots`);
  if (requireTitleSlot && value.slots.title === undefined) throw new Error(`${label}.slots.title is required`);
  if (requireContext) {
    if (!Array.isArray(value.groups) || !value.groups.length || value.groups.some((group) => typeof group !== "string" || !group.trim())) throw new Error(`${label}.groups must be a non-empty array of strings`);
    nonEmptyString(value.description, `${label}.description`);
    nonEmptyString(value.example, `${label}.example`);
  }
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

function sourceReading(value, label) {
  object(value, label);
  nonEmptyString(value.function, `${label}.function`);
  if (!Array.isArray(value.units) || !value.units.length) throw new Error(`${label}.units must be a non-empty array`);
  value.units.forEach((unit, index) => nonEmptyString(unit, `${label}.units[${index}]`));
  nonEmptyString(value.relationships, `${label}.relationships`);
  if (value.excludedNotes !== undefined) {
    if (!Array.isArray(value.excludedNotes)) throw new Error(`${label}.excludedNotes must be an array when present`);
    value.excludedNotes.forEach((note, index) => nonEmptyString(note, `${label}.excludedNotes[${index}]`));
  }
}


const PRIMARY_RELATION_TYPES = new Set([
  "comparison",
  "cause-effect",
  "sequence",
  "complementary",
  "composition",
  "classification",
  "rule-example",
  "situation-solution",
  "none",
  "uncertain"
]);

function ledgerRelation(value, label, primary) {
  object(value, label);
  nonEmptyString(value.type, `${label}.type`);
  if (primary && !PRIMARY_RELATION_TYPES.has(value.type)) {
    throw new Error(`${label}.type must be one of: ${[...PRIMARY_RELATION_TYPES].join(", ")}`);
  }
  if (!Array.isArray(value.evidence) || !value.evidence.length) throw new Error(`${label}.evidence must be a non-empty array`);
  value.evidence.forEach((fragment, index) => nonEmptyString(fragment, `${label}.evidence[${index}]`));
  nonEmptyString(primary ? value.whyPrimary : value.whyPresent, `${label}.${primary ? "whyPrimary" : "whyPresent"}`);
}

const ANSWER_KEYS = ["chain", "sides", "research", "list", "definition", "example", "conclusion"];

function stringArray(value, label, required = false) {
  if (value === undefined) {
    if (required) throw new Error(`${label} is required`);
    return;
  }
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  value.forEach((item, index) => nonEmptyString(item, `${label}[${index}]`));
}

function validateAnswers(answers, label) {
  object(answers, label);
  for (const key of ANSWER_KEYS) {
    const a = answers[key];
    object(a, `${label}.${key}`);
    if (typeof a.answer !== "boolean") throw new Error(`${label}.${key}.answer must be true or false`);
    if (!a.answer) continue;
    switch (key) {
      case "chain":
        stringArray(a.links, `${label}.chain.links`, true);
        if (a.links.length < 2) throw new Error(`${label}.chain.links needs at least two links`);
        if (a.outcome !== undefined) nonEmptyString(a.outcome, `${label}.chain.outcome`);
        break;
      case "sides":
        if (a.kind !== "poor-good" && a.kind !== "two-sides") throw new Error(`${label}.sides.kind must be poor-good or two-sides`);
        stringArray(a.left, `${label}.sides.left`, true);
        stringArray(a.right, `${label}.sides.right`, true);
        break;
      case "list":
        integer(a.count, `${label}.list.count`, 2);
        if (typeof a.ordered !== "boolean") throw new Error(`${label}.list.ordered must be true or false`);
        stringArray(a.items, `${label}.list.items`, true);
        if (a.items.length !== a.count) throw new Error(`${label}.list.items must contain exactly count=${a.count} fragments`);
        break;
      default:
        stringArray(a.evidence, `${label}.${key}.evidence`, true);
    }
  }
}

function validateLedgerV2(ledger) {
  ledger.slides.forEach((entry, index) => {
    const label = `readingLedger.slides[${index}]`;
    object(entry, label);
    integer(entry.sourceSlide, `${label}.sourceSlide`, 1);
    nonEmptyString(entry.sourceText, `${label}.sourceText`);
    if (entry.authorType !== undefined && entry.authorType !== null) nonEmptyString(entry.authorType, `${label}.authorType`);
    const r = entry.reading;
    object(r, `${label}.reading`);
    nonEmptyString(r.function, `${label}.reading.function`);
    nonEmptyString(r.keyMessage, `${label}.reading.keyMessage`);
    validateAnswers(r.answers, `${label}.reading.answers`);
    stringArray(r.intro, `${label}.reading.intro`);
    nonEmptyString(r.primary, `${label}.reading.primary`);
    if (!PRIMARY_TYPES.includes(r.primary)) throw new Error(`${label}.reading.primary must be one of: ${PRIMARY_TYPES.join(", ")}`);
    const derived = primaryFromAnswers(r.answers);
    if (!["checklist", "statistics"].includes(r.primary) && derived !== r.primary) {
      throw new Error(`${label}.reading.primary is ${r.primary} but the answers imply ${derived}; fix the answers or the primary`);
    }
    nonEmptyString(r.whyPrimary, `${label}.reading.whyPrimary`);
  });
}

function validateLedgerV1(ledger) {
  const sourceSlides = new Set();
  ledger.slides.forEach((entry, index) => {
    object(entry, `readingLedger.slides[${index}]`);
    integer(entry.sourceSlide, `readingLedger.slides[${index}].sourceSlide`, 1);
    nonEmptyString(entry.sourceText, `readingLedger.slides[${index}].sourceText`);
    const reading = entry.reading;
    object(reading, `readingLedger.slides[${index}].reading`);
    nonEmptyString(reading.function, `readingLedger.slides[${index}].reading.function`);
    nonEmptyString(reading.keyMessage, `readingLedger.slides[${index}].reading.keyMessage`);
    if (!Array.isArray(reading.units) || !reading.units.length) throw new Error(`readingLedger.slides[${index}].reading.units must be a non-empty array`);
    reading.units.forEach((unit, unitIndex) => {
      object(unit, `readingLedger.slides[${index}].reading.units[${unitIndex}]`);
      nonEmptyString(unit.text, `readingLedger.slides[${index}].reading.units[${unitIndex}].text`);
      nonEmptyString(unit.role, `readingLedger.slides[${index}].reading.units[${unitIndex}].role`);
      nonEmptyString(unit.level, `readingLedger.slides[${index}].reading.units[${unitIndex}].level`);
    });
    object(reading.framing, `readingLedger.slides[${index}].reading.framing`);
    for (const field of ["intro", "conclusion"]) {
      if (!Array.isArray(reading.framing[field])) throw new Error(`readingLedger.slides[${index}].reading.framing.${field} must be an array`);
      reading.framing[field].forEach((fragment, fragmentIndex) => nonEmptyString(fragment, `readingLedger.slides[${index}].reading.framing.${field}[${fragmentIndex}]`));
    }
    object(reading.relationships, `readingLedger.slides[${index}].reading.relationships`);
    ledgerRelation(reading.relationships.primary, `readingLedger.slides[${index}].reading.relationships.primary`, true);
    if (!Array.isArray(reading.relationships.secondary)) throw new Error(`readingLedger.slides[${index}].reading.relationships.secondary must be an array`);
    reading.relationships.secondary.forEach((relation, relationIndex) => ledgerRelation(relation, `readingLedger.slides[${index}].reading.relationships.secondary[${relationIndex}]`, false));
    if (reading.excludedNotes !== undefined) {
      if (!Array.isArray(reading.excludedNotes)) throw new Error(`readingLedger.slides[${index}].reading.excludedNotes must be an array`);
      reading.excludedNotes.forEach((note, noteIndex) => nonEmptyString(note, `readingLedger.slides[${index}].reading.excludedNotes[${noteIndex}]`));
    }
  });
}

export function validateReadingLedger(ledger) {
  object(ledger, "readingLedger");
  if (ledger.version !== 1 && ledger.version !== 2) throw new Error("readingLedger.version must equal 1 or 2");
  nonEmptyString(ledger.lessonTitle, "readingLedger.lessonTitle");
  if (!Array.isArray(ledger.slides) || !ledger.slides.length) throw new Error("readingLedger.slides must be a non-empty array");
  const sourceSlides = new Set();
  for (const entry of ledger.slides) {
    if (sourceSlides.has(entry?.sourceSlide)) throw new Error(`readingLedger contains duplicate sourceSlide ${entry.sourceSlide}`);
    sourceSlides.add(entry?.sourceSlide);
  }
  if (ledger.version === 2) validateLedgerV2(ledger); else validateLedgerV1(ledger);
  return ledger;
}

export function ledgerUnits(entry) {
  const a = entry.reading.answers;
  const out = [];
  if (a.chain?.answer) { out.push(...a.chain.links); if (a.chain.outcome) out.push(a.chain.outcome); }
  if (a.sides?.answer) out.push(...a.sides.left, ...a.sides.right);
  if (a.research?.answer) { out.push(...a.research.evidence); if (a.research.conclusion) out.push(a.research.conclusion); }
  if (a.list?.answer) out.push(...a.list.items);
  for (const k of ["definition", "example", "conclusion"]) if (a[k]?.answer) out.push(...a[k].evidence);
  return out;
}

export function planReadingFromLedger(entry) {
  if (entry.reading.answers) {
    return {
      function: entry.reading.function,
      units: ledgerUnits(entry),
      relationships: `Главная связь: ${entry.reading.primary}. ${entry.reading.whyPrimary}`,
      excludedNotes: []
    };
  }
  const primary = entry.reading.relationships.primary;
  const secondary = entry.reading.relationships.secondary.map((relation) => `Вторичная связь: ${relation.type}. ${relation.whyPresent}`);
  return {
    function: entry.reading.function,
    units: entry.reading.units.map((unit) => unit.text),
    relationships: [`Главная связь: ${primary.type}. ${primary.whyPrimary}`, ...secondary].join(" "),
    excludedNotes: entry.reading.excludedNotes ?? []
  };
}

function semanticSelection(value, label, requiresFallback, requiresCardsReason, requiresInteractionReason) {
  object(value, label);
  nonEmptyString(value.rationale, `${label}.rationale`);
  if (requiresCardsReason) {
    object(value.cardsReason, `${label}.cardsReason`);
    nonEmptyString(value.cardsReason.independence, `${label}.cardsReason.independence`);
    nonEmptyString(value.cardsReason.commonLevel, `${label}.cardsReason.commonLevel`);
  }
  if (requiresInteractionReason) nonEmptyString(value.learnerAction, `${label}.learnerAction`);
  if (value.competitor !== undefined) {
    object(value.competitor, `${label}.competitor`);
    nonEmptyString(value.competitor.templateId, `${label}.competitor.templateId`);
    nonEmptyString(value.competitor.whyNot, `${label}.competitor.whyNot`);
  }
  if (!requiresFallback) return;
  object(value.fallback, `${label}.fallback`);
  nonEmptyString(value.fallback.neededStructure, `${label}.fallback.neededStructure`);
  nonEmptyString(value.fallback.reason, `${label}.fallback.reason`);
  if (value.fallback.considered !== undefined) {
    if (!Array.isArray(value.fallback.considered)) throw new Error(`${label}.fallback.considered must be an array when present`);
    value.fallback.considered.forEach((item, index) => nonEmptyString(item, `${label}.fallback.considered[${index}]`));
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
  if (catalog.version !== 2) throw new Error("catalog.version must equal 2; rebuild it with the separate prepare-template-library skill");
  catalogSlides(catalog.slides);
  object(catalog.groups, "catalog.groups");
  if (!Object.keys(catalog.groups).length) throw new Error("catalog.groups must contain at least one group");
  for (const [groupName, group] of Object.entries(catalog.groups)) {
    if (!groupName.trim()) throw new Error("catalog.groups has an empty name");
    object(group, `catalog.groups.${groupName}`);
    nonEmptyString(group.description, `catalog.groups.${groupName}.description`);
    if (!Array.isArray(group.templates) || !group.templates.length || group.templates.some((name) => typeof name !== "string" || !name.trim())) throw new Error(`catalog.groups.${groupName}.templates must be a non-empty array of composition IDs`);
  }
  template(catalog.titleTemplate, "catalog.titleTemplate", true);
  resolveTemplate(catalog, catalog.titleTemplate, "catalog.titleTemplate");
  object(catalog.compositions, "catalog.compositions");
  if (!Object.keys(catalog.compositions).length) throw new Error("catalog.compositions must contain at least one composition");
  for (const [name, spec] of Object.entries(catalog.compositions)) {
    if (!name.trim()) throw new Error("catalog.compositions has an empty name");
    const kinds = spec.kinds ?? (spec.kind ? [spec.kind] : []);
    template(spec, `catalog.compositions.${name}`, !kinds.includes("dialogue") && !kinds.includes("interactive-staging"));
    resolveTemplate(catalog, spec, `catalog.compositions.${name}`);
    if (spec.kind !== undefined && typeof spec.kind !== "string") throw new Error(`catalog.compositions.${name}.kind must be a string`);
    if (spec.kinds !== undefined && (!Array.isArray(spec.kinds) || spec.kinds.some((kind) => typeof kind !== "string"))) throw new Error(`catalog.compositions.${name}.kinds must be an array of strings`);
    for (const groupName of spec.groups) {
      if (!catalog.groups[groupName]) throw new Error(`catalog.compositions.${name}.groups references missing group ${JSON.stringify(groupName)}`);
      if (!catalog.groups[groupName].templates.includes(name)) throw new Error(`catalog.groups.${groupName}.templates must include ${JSON.stringify(name)}`);
    }
    capacity(spec.capacity, `catalog.compositions.${name}.capacity`);
  }
  for (const [groupName, group] of Object.entries(catalog.groups)) {
    for (const name of group.templates) {
      const spec = catalog.compositions[name];
      if (!spec) throw new Error(`catalog.groups.${groupName}.templates references missing composition ${JSON.stringify(name)}`);
      if (!spec.groups.includes(groupName)) throw new Error(`catalog.compositions.${name}.groups must include ${JSON.stringify(groupName)}`);
    }
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
    if (item.manualLayout !== undefined && (typeof item.manualLayout !== "string" || !item.manualLayout.trim())) {
      throw new Error(`plan.slides[${index}].manualLayout must be a non-empty string when present`);
    }
    for (const [slot, value] of Object.entries(item.slots)) {
      if (spec.slots[slot] === undefined) throw new Error(`plan.slides[${index}].slots.${slot} is not in its catalog template`);
      slotValue(value, `plan.slides[${index}].slots.${slot}`, spec.runStyles?.[slot]);
    }
    for (const slot of Object.keys(spec.slots)) {
      if (item.slots[slot] === undefined) throw new Error(`plan.slides[${index}].slots.${slot} is required so template sample text cannot remain`);
    }
    const kinds = spec.kinds ?? (spec.kind ? [spec.kind] : []);
    const isInteractionStaging = item.kind === "content" && kinds.includes("interactive-staging");
    if (item.kind !== "dialogue" && !isInteractionStaging && item.slots.title === undefined) throw new Error(`plan.slides[${index}].slots.title is required`);
    if (item.kind === "title" && index !== 0) throw new Error("a title slide may appear only at the start of plan.slides");
    if (item.kind === "content") {
      integer(item.sourceSlide, `plan.slides[${index}].sourceSlide`, 1);
      nonEmptyString(item.sourceText, `plan.slides[${index}].sourceText`);
      sourceReading(item.reading, `plan.slides[${index}].reading`);
      semanticSelection(
        item.selection,
        `plan.slides[${index}].selection`,
        spec.templateId === "text.plain",
        spec.templateId.startsWith("cards."),
        isInteractionStaging
      );
      if (item.interactive === true && !isInteractionStaging) throw new Error(`plan.slides[${index}] interactive content must use an interactive-staging composition`);
      if (isInteractionStaging && item.interactive !== true) throw new Error(`plan.slides[${index}] interactive-staging composition requires interactive: true`);
      if (isInteractionStaging && spec.templateId === "staging.blank") throw new Error(`plan.slides[${index}] interaction must not use dialogue-only staging.blank`);
    }
    if (item.kind === "dialogue") {
      if (!kinds.includes("dialogue")) throw new Error(`plan.slides[${index}] uses a non-dialogue composition`);
      if (spec.templateId !== "staging.blank") throw new Error(`plan.slides[${index}] dialogue must use staging.blank`);
      if (typeof item.scenePath !== "string" || !item.scenePath.trim()) throw new Error(`plan.slides[${index}].scenePath must be a non-empty image path`);

    }
    if (item.interactive !== undefined && typeof item.interactive !== "boolean") throw new Error(`plan.slides[${index}].interactive must be boolean when present`);
  });
  return plan;
}
