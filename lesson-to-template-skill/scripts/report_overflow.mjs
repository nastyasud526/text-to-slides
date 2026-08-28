import fs from "node:fs/promises";
import { usage } from "./runtime.mjs";
import { slotText, validateCatalog, validatePlan } from "./validate.mjs";

const [catalogPath, planPath, reportPath] = process.argv.slice(2);
if (!catalogPath || !planPath || !reportPath) {
  usage("report_overflow.mjs", "<catalog.json> <lesson-plan.json> <overflow-report.json>");
}

const catalog = validateCatalog(JSON.parse(await fs.readFile(catalogPath, "utf8")));
const plan = validatePlan(JSON.parse(await fs.readFile(planPath, "utf8")), catalog);
const overflow = [];

for (const [index, item] of plan.slides.entries()) {
  const spec = item.kind === "title" ? catalog.titleTemplate : catalog.compositions[item.composition];
  for (const [slot, value] of Object.entries(item.slots)) {
    const declared = spec.capacity?.[slot];
    if (declared === undefined) continue;
    const capacity = typeof declared === "number" ? { maxChars: declared } : declared;
    const text = slotText(value);
    const chars = [...text].length;
    const lines = text.split("\n").length;
    const exceedsChars = capacity.maxChars !== undefined && chars > capacity.maxChars;
    const exceedsLines = capacity.maxLines !== undefined && lines > capacity.maxLines;
    if (exceedsChars || exceedsLines) {
      overflow.push({
        sourceSlide: item.kind === "content" ? item.sourceSlide : null,
        outputSlide: index + 1,
        slot,
        chars,
        lines,
        capacity,
        reasons: [
          exceedsChars && `characters: ${chars} > ${capacity.maxChars}`,
          exceedsLines && `source lines: ${lines} > ${capacity.maxLines}`
        ].filter(Boolean)
      });
    }
  }
}

await fs.writeFile(reportPath, JSON.stringify({
  overflow,
  note: "Informational only. The builder preserves source text and does not change font sizes, layouts, or slide count."
}, null, 2), "utf8");
console.log(`Recorded ${overflow.length} declared capacity risks.`);
