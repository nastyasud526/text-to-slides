import fs from "node:fs/promises";
import { usage } from "./runtime.mjs";
import { validateCatalog, validatePlan } from "./validate.mjs";

const [catalogPath, planPath, reportPath] = process.argv.slice(2);
if (!catalogPath || !planPath || !reportPath) usage("review_plan.mjs", "<catalog.json> <lesson-plan.json> <semantic-review.json>");

const catalog = validateCatalog(JSON.parse(await fs.readFile(catalogPath, "utf8")));
const plan = validatePlan(JSON.parse(await fs.readFile(planPath, "utf8")), catalog);
const distribution = {};
const plainFallbacks = [];

for (const [index, item] of plan.slides.entries()) {
  if (item.kind !== "content") continue;
  const spec = catalog.compositions[item.composition];
  distribution[spec.templateId] = (distribution[spec.templateId] ?? 0) + 1;
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

const report = {
  contentSlides: plan.slides.filter((item) => item.kind === "content").length,
  compositionDistribution: distribution,
  textPlainFallbacks: plainFallbacks,
  status: "complete",
  note: "The review confirms that every content slide has a recorded semantic selection and every text.plain fallback has a recorded justification. It does not replace editorial judgement about the lesson."
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Semantically reviewed ${report.contentSlides} content slide(s); ${plainFallbacks.length} text.plain fallback(s) recorded.`);
