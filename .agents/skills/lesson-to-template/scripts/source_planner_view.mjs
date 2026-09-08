// Emit the part of source.json the planner needs: slide text with its roles, without the
// extractor's service fields (style, bold, list_level, body_index, empty flags) and without the
// counters that stayed at zero. Scripts keep reading the full source.json; only the model reads
// this. Usage:
//   source_planner_view.mjs <source.json> <planner-source.json> [--lesson <id>]
import fs from "node:fs/promises";
import { usage } from "./runtime.mjs";

const argv = process.argv.slice(2);
let lessonFilter = null;
const positional = [];
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--lesson") {
    lessonFilter = argv[index + 1] ?? null;
    index += 1;
    continue;
  }
  positional.push(argv[index]);
}
const [sourcePath, outPath] = positional;
if (!sourcePath || !outPath) usage("source_planner_view.mjs", "<source.json> <planner-source.json> [--lesson <id>]");

const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));

function block(entry) {
  if (entry.kind !== "paragraph") return { kind: entry.kind, rows: entry.rows };
  const result = { text: entry.text, role: entry.role };
  if (entry.title) result.title = entry.title;
  if (entry.body) result.body = entry.body;
  if (entry.numbered) result.numbered = true;
  if (Array.isArray(entry.flags) && entry.flags.length) result.flags = entry.flags;
  return result;
}

function summary(value) {
  if (!value) return undefined;
  const result = {};
  // Zero counters and false hints carry no signal but are re-sent with every request.
  for (const [name, entry] of Object.entries(value)) {
    if (entry === 0 || entry === false || entry === null) continue;
    result[name] = entry;
  }
  return Object.keys(result).length ? result : undefined;
}

const slides = source.slides
  .filter((slide) => !lessonFilter || String(slide.lesson ?? "").includes(lessonFilter))
  .map((slide) => {
    const result = {
      sourceSlide: slide.sourceSlide,
      title: slide.title,
      blocks: (slide.blocks ?? []).map(block)
    };
    if (slide.lesson) result.lesson = slide.lesson;
    if (slide.authorType) result.authorType = slide.authorType;
    if (slide.interactive) result.interactive = true;
    const counters = summary(slide.summary);
    if (counters) result.summary = counters;
    return result;
  });

const out = { version: source.version, source: source.source, slides };
await fs.writeFile(outPath, `${JSON.stringify(out, null, 1)}\n`, "utf8");
const [fullSize, viewSize] = await Promise.all([fs.stat(sourcePath), fs.stat(outPath)]);
console.log(`Planner source: ${slides.length} slide(s), ${Math.round(viewSize.size / 1024)} KB (full source ${Math.round(fullSize.size / 1024)} KB).`);
