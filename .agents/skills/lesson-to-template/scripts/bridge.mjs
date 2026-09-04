// Bridge between the reading questionnaire (phase 1) and catalog families (phase 2).
// Shared by review_plan.mjs, diversify_plan.mjs and catalog_planner_view.mjs.

export const PRIMARY_TYPES = ["chain", "poor-good", "two-sides", "research", "steps", "items", "definition", "example", "text", "checklist", "statistics"];

// Which compositions may serve each primary relation. The first entry is the default.
export const BRIDGE = {
  "chain": ["process.situation-outcome.4", "process.4.stages"],
  "poor-good": ["compare.poor-good"],
  "two-sides": ["compare.two.intro.short", "compare.two.intro.detailed", "compare.two.no-intro", "situation.action.a", "situation.action.b"],
  "research": ["problem.solution", "intro.body.conclusion"],
  "steps": ["process.3.detailed", "process.4", "process.4.detailed", "process.4.stages", "process.6", "process.cards.4", "numbered-list.5", "timeline.5", "numbered-list.3", "numbered-list.4", "numbered-list.6"],
  "items": ["cards.3", "cards.4", "cards.4.intro", "cards.5.intro", "cards.6", "cards.6.columns", "list.6.center-message", "numbered-list.3", "numbered-list.4", "numbered-list.5", "numbered-list.6", "numbered-list.4.illustration", "classification.3", "classification.4"],
  "definition": ["term.explanation", "context.definition.explanation", "term.context.explanation.example", "thesis.example.illustration"],
  "example": ["text.example", "example.full", "thesis.example.illustration", "text.character-comment"],
  "text": ["text.illustration", "text.long.illustration", "text.plain", "text.key-idea", "intro.body.conclusion", "key-idea.quote", "text.character-comment"],
  "checklist": ["checklist.6"],
  "statistics": ["statistics.3", "statistics.4"]
};

// Variants that fit the same content equally well; used by diversify_plan.mjs.
export const EQUIVALENT = [
  ["numbered-list.3", "cards.3"],
  ["numbered-list.4", "cards.4.intro"],
  ["numbered-list.5", "cards.5.intro"],
  ["numbered-list.6", "cards.6"],
  ["intro.body.conclusion", "text.key-idea"],
  ["text.example", "thesis.example.illustration"],
  ["compare.poor-good", "compare.two.intro.short"],
  ["text.long.illustration", "text.illustration"],
  ["problem.solution", "intro.body.conclusion"]
];

// Pairs the model confuses most often; a selection must name one of them as the rejected competitor
// when it picks either side.
export const NEAREST = {
  "process.situation-outcome.4": "intro.body.conclusion",
  "intro.body.conclusion": "process.situation-outcome.4",
  "compare.poor-good": "compare.two.intro.short",
  "compare.two.intro.short": "compare.poor-good",
  "compare.two.no-intro": "compare.poor-good",
  "cards.4.intro": "process.4",
  "process.4": "cards.4.intro",
  "problem.solution": "text.long.illustration",
  "text.long.illustration": "text.key-idea",
  "text.example": "example.full",
  "example.full": "process.situation-outcome.4",
  "text.key-idea": "text.plain",
  "text.plain": "text.key-idea"
};

export function familyOf(templateId) {
  for (const [primary, ids] of Object.entries(BRIDGE)) if (ids.includes(templateId)) return primary;
  return null;
}

// Count of repeated content slots (cards, items, steps ...) a template offers.
export function slotCount(spec) {
  const names = Object.keys(spec.slots ?? {});
  const groups = new Set();
  for (const n of names) {
    const m = n.match(/^(card|item|step|node|metric|event|check|stage|left|right)_(\d+)/);
    if (m) groups.add(m[1] + m[2]);
  }
  return groups.size;
}

// Derive the primary relation from questionnaire answers (same priority as the SKILL text).
export function primaryFromAnswers(a) {
  if (a.chain?.answer) return "chain";
  if (a.sides?.answer) return a.sides.kind === "poor-good" ? "poor-good" : "two-sides";
  if (a.research?.answer) return "research";
  if (a.list?.answer) return a.list.ordered ? "steps" : "items";
  if (a.definition?.answer) return "definition";
  if (a.example?.answer) return "example";
  return "text";
}

export function allNo(a) {
  return ["chain", "sides", "research", "list", "definition", "example", "conclusion"].every((k) => !a[k]?.answer);
}
