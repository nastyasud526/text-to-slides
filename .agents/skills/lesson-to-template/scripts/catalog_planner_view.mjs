// Emit the part of catalog.json the planner needs: groups and compositions without the physical
// slide registry, plus the bridge families and nearest competitors. Usage:
//   catalog_planner_view.mjs <catalog.json> <planner-catalog.json>
import fs from "node:fs/promises";
import { usage } from "./runtime.mjs";
import { BRIDGE, NEAREST, familyOf, slotCount } from "./bridge.mjs";

const [catalogPath, outPath] = process.argv.slice(2);
if (!outPath) usage("catalog_planner_view.mjs", "<catalog.json> <planner-catalog.json>");
const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
const compositions = {};
for (const [id, spec] of Object.entries(catalog.compositions)) {
  compositions[id] = {
    templateId: spec.templateId,
    family: familyOf(id),
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
const out = { version: catalog.version, bridge: BRIDGE, families: Object.keys(BRIDGE), compositions };
await fs.writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
const size = (await fs.stat(outPath)).size;
console.log(`Planner catalog: ${Object.keys(compositions).length} compositions, ${Math.round(size / 1024)} KB (full catalog ${Math.round((await fs.stat(catalogPath)).size / 1024)} KB).`);
