// Join the compact model output with the extractor result: fill plan.slides[].sourceText from
// source.json, fill plan.slides[].reading from reading-ledger.json, and verify that the plan did
// not alter the approved course text. Runs before review_plan.mjs. Usage:
//   hydrate_plan.mjs <source.json> <reading-ledger.json> <lesson-plan.json> [<out-plan.json>]
import fs from "node:fs/promises";
import { usage } from "./runtime.mjs";
import { planReadingFromLedger, validateCatalog, validatePlan, validateReadingLedger } from "./validate.mjs";

const [sourcePath, ledgerPath, planPath, outPath, catalogPath] = process.argv.slice(2);
if (!sourcePath || !ledgerPath || !planPath) {
  usage("hydrate_plan.mjs", "<source.json> <reading-ledger.json> <lesson-plan.json> [<out-plan.json>] [<catalog.json>]");
}

const normalize = (value) => value.replace(/\s+/g, " ").trim();

const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const ledger = validateReadingLedger(JSON.parse(await fs.readFile(ledgerPath, "utf8")));
const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
if (!Array.isArray(plan.slides)) throw new Error("plan.slides must be an array");

const sourceBySlide = new Map();
for (const slide of source.slides ?? []) {
  const paragraphs = (slide.blocks ?? []).filter((block) => block.kind === "paragraph");
  sourceBySlide.set(slide.sourceSlide, {
    paragraphs: paragraphs.map((block) => block.text),
    hasTable: (slide.blocks ?? []).some((block) => block.kind !== "paragraph")
  });
}
const ledgerBySlide = new Map(ledger.slides.map((entry) => [entry.sourceSlide, entry]));

const problems = [];
const filled = { sourceText: 0, reading: 0, ledgerSourceText: 0 };

function sourceTextFor(sourceSlide, label) {
  const entry = sourceBySlide.get(sourceSlide);
  if (!entry) throw new Error(`${label}: source.json has no slide ${sourceSlide}`);
  if (entry.hasTable) {
    throw new Error(`${label}: slide ${sourceSlide} contains a table, so sourceText cannot be joined automatically; write it explicitly`);
  }
  return entry.paragraphs.join("\n");
}

// Fill the ledger first: planReadingFromLedger reads sourceText for author-tagged slides.
for (const entry of ledger.slides) {
  if (entry.sourceText !== undefined) continue;
  entry.sourceText = sourceTextFor(entry.sourceSlide, `readingLedger slide ${entry.sourceSlide}`);
  filled.ledgerSourceText += 1;
}

for (const [index, item] of plan.slides.entries()) {
  if (item.kind !== "content") continue;
  const label = `plan.slides[${index}]`;
  if (!Number.isInteger(item.sourceSlide)) throw new Error(`${label}.sourceSlide must be an integer`);
  const known = sourceBySlide.get(item.sourceSlide);
  if (!known) throw new Error(`${label}: source.json has no slide ${item.sourceSlide}`);

  if (item.sourceText === undefined) {
    item.sourceText = sourceTextFor(item.sourceSlide, label);
    filled.sourceText += 1;
  } else {
    // The approved course text is the extractor output. Catch a plan that paraphrased, dropped or
    // invented a paragraph while writing sourceText; nothing downstream compares the two.
    const planLines = item.sourceText.split(/\r?\n/).map(normalize).filter(Boolean);
    const sourceLines = known.paragraphs.map(normalize).filter(Boolean);
    const planSet = new Set(planLines);
    const sourceSet = new Set(sourceLines);
    for (const line of sourceLines) {
      if (!planSet.has(line)) problems.push({ sourceSlide: item.sourceSlide, outputSlide: index + 1, kind: "missing", text: line });
    }
    for (const line of planLines) {
      if (!sourceSet.has(line)) problems.push({ sourceSlide: item.sourceSlide, outputSlide: index + 1, kind: "invented", text: line });
    }
  }

  if (item.reading === undefined) {
    const entry = ledgerBySlide.get(item.sourceSlide);
    if (!entry) throw new Error(`${label}: reading-ledger.json has no entry for slide ${item.sourceSlide}`);
    item.reading = planReadingFromLedger(entry);
    filled.reading += 1;
  }
}

if (problems.length) {
  for (const problem of problems.slice(0, 20)) {
    console.error(`  slide ${problem.sourceSlide}: ${problem.kind === "missing" ? "текст исходника отсутствует в плане" : "в плане есть текст, которого нет в исходнике"}: ${JSON.stringify(problem.text)}`);
  }
  throw new Error(`plan sourceText does not match ${sourcePath}: ${problems.length} difference(s). The approved course text must be reproduced verbatim.`);
}

if (catalogPath) validatePlan(plan, validateCatalog(JSON.parse(await fs.readFile(catalogPath, "utf8"))));
await fs.writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
await fs.writeFile(outPath ?? planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(`Hydrated plan: filled sourceText on ${filled.sourceText} slide(s), reading on ${filled.reading} slide(s), ledger sourceText on ${filled.ledgerSourceText} entry(ies); course text verified against ${sourcePath}.`);
