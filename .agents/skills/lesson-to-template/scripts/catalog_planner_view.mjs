// Emit the part of catalog.json the planner needs: groups and compositions without the physical
// slide registry, plus the bridge families and nearest competitors. Usage:
//   catalog_planner_view.mjs <catalog.json> <planner-catalog.json> [--source <source.json>]
//
// With --source, and only when every ordinary slide of the lesson already carries an accepted
// author mark, the view keeps just the families those marks name. The planner then chooses a
// variant inside the marked family instead of reading the whole library on every request. Partial
// markup keeps the full view, because the unmarked slides still need the complete menu.
import fs from "node:fs/promises";
import { usage } from "./runtime.mjs";
import { BRIDGE, NEAREST, familyOf, slotCount } from "./bridge.mjs";

const argv = process.argv.slice(2);
let sourcePath = null;
const positional = [];
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--source") {
    sourcePath = argv[index + 1] ?? null;
    index += 1;
    continue;
  }
  positional.push(argv[index]);
}
const [catalogPath, outPath] = positional;
if (!catalogPath || !outPath) usage("catalog_planner_view.mjs", "<catalog.json> <planner-catalog.json> [--source <source.json>]");

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));

function stagingSpec(spec) {
  const kinds = spec.kinds ?? (spec.kind ? [spec.kind] : []);
  return kinds.includes("dialogue") || kinds.includes("interactive-staging");
}

// An author mark is either a family name from the bridge or a concrete templateId.
function familyOfMark(mark) {
  if (!mark) return null;
  if (BRIDGE[mark]) return mark;
  return familyOf(mark);
}

async function markedFamilies() {
  if (!sourcePath) return null;
  const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  const families = new Set();
  for (const slide of source.slides ?? []) {
    if (slide.interactive === true) continue;
    const family = familyOfMark(slide.authorType);
    // One unmarked or unrecognised ordinary slide is enough to need the whole library.
    if (!family) return null;
    families.add(family);
  }
  return families.size ? families : null;
}

const families = await markedFamilies();
const compositions = {};
for (const [id, spec] of Object.entries(catalog.compositions)) {
  const family = familyOf(id);
  // staging.* serves dialogue and interaction slides, and text.plain is the documented last
  // resort, so both stay available whatever the marks say.
  const required = stagingSpec(spec) || id === "text.plain";
  if (families && !required && !families.has(family)) continue;
  compositions[id] = {
    templateId: spec.templateId,
    family,
    description: spec.description,
    example: spec.example,
    capacity: spec.selection?.capacity,
    repeatedSlots: slotCount(spec),
    slots: Object.keys(spec.slots),
    content_placement: spec.content_placement ?? [],
    when_to_choose: spec.when_to_choose ?? null,
    not_when: spec.not_when ?? null,
    nearest: NEAREST[id] ?? null,
    alternatives: spec.alternatives ?? []
  };
}

const bridge = Object.fromEntries(Object.entries(BRIDGE)
  .filter(([family]) => !families || families.has(family))
  .map(([family, ids]) => [family, ids.filter((id) => compositions[id])]));

const out = {
  version: catalog.version,
  markedFamiliesOnly: Boolean(families),
  bridge,
  families: Object.keys(bridge),
  compositions
};
await fs.writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
const size = (await fs.stat(outPath)).size;
const scope = families ? `families ${[...families].sort().join(", ")}` : "all families";
console.log(`Planner catalog: ${Object.keys(compositions).length} composition(s), ${scope}, ${Math.round(size / 1024)} KB (full catalog ${Math.round((await fs.stat(catalogPath)).size / 1024)} KB).`);
