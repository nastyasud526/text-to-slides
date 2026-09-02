import fs from 'node:fs';

const [catalogPath, guidePath] = process.argv.slice(2);
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8').replace(/^\uFEFF/, ''));
let guide = fs.readFileSync(guidePath, 'utf8').replace(/^\uFEFF/, '');
let replacements = 0;

for (const [templateId, composition] of Object.entries(catalog.compositions)) {
  if (!Array.isArray(composition.alternatives) || composition.alternatives.length === 0) continue;

  const startMarker = `### ${templateId}\n`;
  const start = guide.indexOf(startMarker);
  if (start < 0) throw new Error(`Guide section not found: ${templateId}`);
  const next = guide.indexOf('\n### ', start + startMarker.length);
  const end = next < 0 ? guide.length : next;
  const section = guide.slice(start, end);
  const badLine = '**Почти-дубликаты:** `[object Object]`. Выбор между ними зависит от числа блоков или объёма текста.';
  if (!section.includes(badLine)) throw new Error(`Broken alternative line not found in section: ${templateId}`);

  const details = composition.alternatives
    .map(({ templateId: alternativeId, difference }) => `\`${alternativeId}\` — ${difference}`)
    .join('; ');
  const label = composition.alternatives.length === 1 ? '**Почти-дубликат:**' : '**Почти-дубликаты:**';
  const corrected = section.replace(badLine, `${label} ${details}`);
  guide = `${guide.slice(0, start)}${corrected}${guide.slice(end)}`;
  replacements += 1;
}

fs.writeFileSync(guidePath, guide, 'utf8');
console.log(JSON.stringify({ replacements }, null, 2));
