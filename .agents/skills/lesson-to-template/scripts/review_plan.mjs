import fs from "node:fs/promises";
import { usage } from "./runtime.mjs";
import { planReadingFromLedger, validateCatalog, validatePlan, validateReadingLedger } from "./validate.mjs";

const args = process.argv.slice(2);
let catalogPath;
let ledgerPath = null;
let planPath;
let reportPath;
if (args.length === 4) {
  [catalogPath, ledgerPath, planPath, reportPath] = args;
} else if (args.length === 3) {
  [catalogPath, planPath, reportPath] = args;
} else {
  usage("review_plan.mjs", "<catalog.json> [reading-ledger.json] <lesson-plan.json> <semantic-review.json>");
}

const catalog = validateCatalog(JSON.parse(await fs.readFile(catalogPath, "utf8")));
const plan = validatePlan(JSON.parse(await fs.readFile(planPath, "utf8")), catalog);
const ledger = ledgerPath ? validateReadingLedger(JSON.parse(await fs.readFile(ledgerPath, "utf8"))) : null;
const ledgerBySourceSlide = new Map(ledger?.slides.map((entry) => [entry.sourceSlide, entry]) ?? []);
const distribution = {};
const plainFallbacks = [];
const readings = [];
const matchedLedgerSlides = new Set();

for (const [index, item] of plan.slides.entries()) {
  if (item.kind !== "content") continue;
  const spec = catalog.compositions[item.composition];
  distribution[spec.templateId] = (distribution[spec.templateId] ?? 0) + 1;
  if (ledger) {
    const entry = ledgerBySourceSlide.get(item.sourceSlide);
    if (!entry) throw new Error(`plan sourceSlide ${item.sourceSlide} has no reading-ledger entry`);
    if (entry.reading.relationships.primary.type === "uncertain") throw new Error(`plan sourceSlide ${item.sourceSlide} cannot select a template while its primary relationship is uncertain`);
    if (entry.sourceText !== item.sourceText) throw new Error(`plan sourceSlide ${item.sourceSlide} changed sourceText after the reading phase`);
    const expectedReading = planReadingFromLedger(entry);
    for (const field of ["function", "units", "relationships", "excludedNotes"]) {
      if (JSON.stringify(item.reading[field] ?? (field === "excludedNotes" ? [] : null)) !== JSON.stringify(expectedReading[field])) {
        throw new Error(`plan sourceSlide ${item.sourceSlide} changed reading.${field} after the reading phase`);
      }
    }
    matchedLedgerSlides.add(item.sourceSlide);
  }
  readings.push({
    sourceSlide: item.sourceSlide,
    outputSlide: index + 1,
    function: item.reading.function,
    units: item.reading.units,
    relationships: item.reading.relationships,
    excludedNotes: item.reading.excludedNotes ?? [],
    templateId: spec.templateId,
    rationale: item.selection.rationale
  });
  if (spec.templateId === "text.plain") {
    plainFallbacks.push({
      sourceSlide: item.sourceSlide,
      outputSlide: index + 1,
      neededStructure: item.selection.fallback.neededStructure,
      considered: item.selection.fallback.considered,
      reason: item.selection.fallback.reason
    });
  }
}

if (ledger) {
  const unmatched = ledger.slides.filter((entry) => !matchedLedgerSlides.has(entry.sourceSlide));
  if (unmatched.length) throw new Error(`reading-ledger entries have no content slide in plan: ${unmatched.map((entry) => entry.sourceSlide).join(", ")}`);
}

const report = {
  contentSlides: plan.slides.filter((item) => item.kind === "content").length,
  readingLedgerMatched: ledger ? true : null,
  compositionDistribution: distribution,
  slideReadings: readings,
  textPlainFallbacks: plainFallbacks,
  status: "complete",
  note: ledger
    ? "The review confirms that every content slide matches the saved reading ledger and has a recorded template selection. It does not replace editorial judgement about the chosen composition."
    : "Legacy review without a reading ledger. The review confirms plan completeness but cannot verify separation of reading and template selection."
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Semantically reviewed ${report.contentSlides} content slide(s); reading ledger ${ledger ? "matched" : "not supplied"}; ${plainFallbacks.length} text.plain fallback(s) recorded.`);
