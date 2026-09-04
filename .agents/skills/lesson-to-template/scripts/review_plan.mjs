import fs from "node:fs/promises";
import { usage } from "./runtime.mjs";
import { planReadingFromLedger, validateCatalog, validatePlan, validateReadingLedger } from "./validate.mjs";
import { BRIDGE, NEAREST, allNo, familyOf, slotCount } from "./bridge.mjs";

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
const problems = [];
const matchedLedgerSlides = new Set();

function problem(item, index, text) {
  problems.push({ sourceSlide: item.sourceSlide, outputSlide: index + 1, problem: text });
}

for (const [index, item] of plan.slides.entries()) {
  if (item.kind !== "content") continue;
  const spec = catalog.compositions[item.composition];
  distribution[spec.templateId] = (distribution[spec.templateId] ?? 0) + 1;
  const kinds = spec.kinds ?? [];
  const isStaging = kinds.includes("interactive-staging") || kinds.includes("dialogue");
  let entry = null;
  if (ledger) {
    entry = ledgerBySourceSlide.get(item.sourceSlide);
    if (!entry) throw new Error(`plan sourceSlide ${item.sourceSlide} has no reading-ledger entry`);
    if (entry.reading.relationships?.primary?.type === "uncertain") throw new Error(`plan sourceSlide ${item.sourceSlide} cannot select a template while its primary relationship is uncertain`);
    if (entry.sourceText !== item.sourceText) throw new Error(`plan sourceSlide ${item.sourceSlide} changed sourceText after the reading phase`);
    const expectedReading = planReadingFromLedger(entry);
    for (const field of ["function", "units", "relationships", "excludedNotes"]) {
      if (JSON.stringify(item.reading[field] ?? (field === "excludedNotes" ? [] : null)) !== JSON.stringify(expectedReading[field])) {
        throw new Error(`plan sourceSlide ${item.sourceSlide} changed reading.${field} after the reading phase`);
      }
    }
    matchedLedgerSlides.add(item.sourceSlide);
  }

  // --- consistency checks between the questionnaire and the chosen composition (ledger v2 only)
  if (entry?.reading?.answers && !isStaging) {
    const r = entry.reading;
    const a = r.answers;
    const allowed = BRIDGE[r.primary] ?? [];
    const fam = familyOf(spec.templateId);
    const longList = a.list?.answer && a.list.count > 6;
    if (r.primary !== "text" && !allowed.includes(spec.templateId) && !(spec.templateId === "text.plain" && longList)) {
      problem(item, index, `главная связь ${r.primary} не допускает шаблон ${spec.templateId}; допустимы: ${allowed.join(", ")}`);
    }
    if (a.chain?.answer && (fam === "items" || fam === "steps")) {
      problem(item, index, `в чтении есть цепочка событий, а выбран перечень ${spec.templateId}`);
    }
    if (a.list?.answer) {
      const n = slotCount(spec);
      if (n && Math.abs(n - a.list.count) > 1 && !item.manualLayout) {
        problem(item, index, `в перечне ${a.list.count} элементов, у шаблона ${spec.templateId} ${n} мест, остаток не записан в manualLayout`);
      }
    }
    if (spec.templateId === "text.plain") {
      if (!allNo(a) && !longList) {
        problem(item, index, `text.plain выбран, хотя анкета дала положительные ответы; нужен шаблон семейства ${r.primary}`);
      }
    }
    if (entry.authorType && !allowed.includes(spec.templateId) && r.primary !== entry.authorType) {
      problem(item, index, `автор указал тип ${entry.authorType}, выбран ${spec.templateId}`);
    }
    const comp = item.selection?.competitor;
    if (!comp) {
      problem(item, index, `не назван ближайший конкурирующий шаблон (selection.competitor)`);
    } else if (NEAREST[spec.templateId] && comp.templateId === spec.templateId) {
      problem(item, index, `конкурент совпадает с выбранным шаблоном`);
    }
    if (item.selection?.rationale && readings.some((x) => x.rationale === item.selection.rationale)) {
      problem(item, index, `обоснование дословно повторяет обоснование другого слайда`);
    }
  }

  readings.push({
    sourceSlide: item.sourceSlide,
    outputSlide: index + 1,
    function: item.reading.function,
    units: item.reading.units,
    relationships: item.reading.relationships,
    excludedNotes: item.reading.excludedNotes ?? [],
    templateId: spec.templateId,
    rationale: item.selection.rationale,
    competitor: item.selection.competitor ?? null
  });
  if (spec.templateId === "text.plain") {
    plainFallbacks.push({
      sourceSlide: item.sourceSlide,
      outputSlide: index + 1,
      neededStructure: item.selection.fallback?.neededStructure ?? null,
      reason: item.selection.fallback?.reason ?? null
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
  problems,
  status: problems.length ? "needs_revision" : "complete",
  note: ledger
    ? "The review confirms that every content slide matches the saved reading ledger and lists consistency problems between the questionnaire and the chosen composition. Fix every problem before assets and build."
    : "Legacy review without a reading ledger. The review confirms plan completeness but cannot verify separation of reading and template selection."
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Semantically reviewed ${report.contentSlides} content slide(s); reading ledger ${ledger ? "matched" : "not supplied"}; ${plainFallbacks.length} text.plain fallback(s); ${problems.length} problem(s).`);
for (const p of problems) console.log(`  slide ${p.sourceSlide}: ${p.problem}`);
if (problems.length) process.exitCode = 3;
