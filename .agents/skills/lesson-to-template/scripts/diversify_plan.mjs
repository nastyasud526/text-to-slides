// Second pass over a finished plan: within one lesson, when the same composition is used on
// consecutive content slides, switch every second one to an equivalent variant that fits the
// same content. Runs after review_plan.mjs and never touches reading, sourceText or slot text
// beyond a mechanical remap of slot names. Usage:
//   diversify_plan.mjs <catalog.json> <lesson-plan.json> <out-plan.json>
import fs from "node:fs/promises";
import { usage } from "./runtime.mjs";
import { validateCatalog, validatePlan } from "./validate.mjs";
import { EQUIVALENT } from "./bridge.mjs";

const [catalogPath, planPath, outPath] = process.argv.slice(2);
if (!outPath) usage("diversify_plan.mjs", "<catalog.json> <lesson-plan.json> <out-plan.json>");
const catalog = validateCatalog(JSON.parse(await fs.readFile(catalogPath, "utf8")));
const plan = validatePlan(JSON.parse(await fs.readFile(planPath, "utf8")), catalog);

// slot name remaps between equivalent variants; slots not listed keep their names when they
// exist in the target, otherwise their text is appended to manualLayout.
const REMAP = {
  "numbered-list.3>cards.3": (s) => ({ item_1_title: "card_1_title", item_1_body: "card_1_body", item_2_title: "card_2_title", item_2_body: "card_2_body", item_3_title: "card_3_title", item_3_body: "card_3_body" })[s] ?? s,
  "numbered-list.4>cards.4.intro": (s) => s.replace(/^item_(\d)_/, "card_$1_"),
  "numbered-list.5>cards.5.intro": (s) => s.replace(/^item_(\d)_/, "card_$1_"),
  "numbered-list.6>cards.6": (s) => s.replace(/^item_(\d)_/, "card_$1_"),
  "intro.body.conclusion>text.key-idea": (s) => ({ intro: "body", case_body: "body", conclusion: "intro" })[s] ?? s,
  "text.example>thesis.example.illustration": (s) => ({ body: "explanation", example_body: "definition" })[s] ?? s,
  "compare.poor-good>compare.two.intro.short": (s) => ({ compare_left_body: "compare_top_body", compare_right_body: "compare_bottom_body" })[s] ?? s,
  "text.long.illustration>text.illustration": (s) => s,
  "problem.solution>intro.body.conclusion": (s) => ({ intro_body: "intro", problem_body: "case_body", solution_body: "conclusion" })[s] ?? s
};

function alternative(templateId, chars) {
  for (const [a, b] of EQUIVALENT) {
    if (a === templateId) {
      if (b === "thesis.example.illustration" && chars > 650) return null;
      if (b === "text.illustration" && chars > 450) return null;
      return b;
    }
  }
  return null;
}

function remapSlots(item, from, to) {
  const map = REMAP[`${from}>${to}`] ?? ((s) => s);
  const target = catalog.compositions[to].slots;
  const slots = {};
  const leftovers = [];
  for (const [slot, value] of Object.entries(item.slots)) {
    const name = map(slot);
    if (target[name] !== undefined && slots[name] === undefined) slots[name] = value;
    else if (target[name] !== undefined) slots[name] = `${slots[name]}\n${value}`;
    else if (value && !/_number$/.test(slot)) leftovers.push(typeof value === "string" ? value : JSON.stringify(value));
  }
  for (const name of Object.keys(target)) if (slots[name] === undefined) slots[name] = "";
  if (leftovers.length) item.manualLayout = [item.manualLayout, ...leftovers].filter(Boolean).join("\n");
  item.slots = slots;
}

let run = [];
let changed = 0;
function flush() {
  for (let k = 1; k < run.length; k += 2) {
    const item = run[k];
    const chars = (item.sourceText ?? "").length;
    const alt = alternative(item.composition, chars);
    if (!alt) continue;
    const from = item.composition;
    remapSlots(item, from, alt);
    item.composition = alt;
    item.selection = { ...(item.selection ?? {}), diversified: { from, reason: "тот же шаблон на соседнем слайде; равноценная замена" } };
    if (alt.startsWith("cards.") && !item.selection.cardsReason) {
      item.selection.cardsReason = { independence: "элементы были независимыми пунктами перечня в исходном плане", commonLevel: "элементы одного уровня, перенесены из нумерованного перечня без изменения состава" };
    }
    changed += 1;
  }
  run = [];
}
for (const item of plan.slides) {
  if (item.kind !== "content") { flush(); continue; }
  if (run.length && run[0].composition === item.composition) run.push(item); else { flush(); run = [item]; }
}
flush();
validatePlan(plan, catalog);
await fs.writeFile(outPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(`Diversified ${changed} slide(s).`);
