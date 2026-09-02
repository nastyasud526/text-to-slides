import fs from 'node:fs';
import path from 'node:path';

const [catalogPath, metadataPath, outputDir] = process.argv.slice(2);
if (!catalogPath || !metadataPath || !outputDir) {
  throw new Error('Usage: node build_catalog.mjs <catalog.json> <metadata.json> <output-dir>');
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8').replace(/^\uFEFF/, ''));
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8').replace(/^\uFEFF/, ''));
const entries = Object.entries(metadata.templates);

if (entries.length !== 50) throw new Error(`Expected 50 templates, got ${entries.length}`);
for (const [id] of entries) {
  if (!catalog.compositions[id]) throw new Error(`Unknown template in metadata: ${id}`);
}
for (const id of Object.keys(catalog.compositions)) {
  if (!metadata.templates[id]) throw new Error(`Missing metadata for template: ${id}`);
}

const mergeDescription = (composition, meta, id) => {
  const updated = {
    ...composition,
    groups: meta.groups,
    selection: {
      family: meta.family,
      capacity: meta.capacity,
      blocks: meta.blocks,
      visual_role: meta.visual_role,
    },
    thumbnail: `template-thumbnails/${id}.png`,
    description: meta.summary,
    visual_description: meta.visual_description,
    content_placement: meta.placement,
  };
  if (meta.alternatives?.length) updated.alternatives = meta.alternatives;
  else delete updated.alternatives;
  if (meta.note) updated.note = meta.note;
  else delete updated.note;
  return updated;
};

catalog.groups = Object.fromEntries(metadata.groups.map((group) => [
  group.id,
  {
    description: group.description,
    templates: entries
      .filter(([, meta]) => meta.groups.includes(group.id))
      .map(([id]) => id),
  },
]));
catalog.groupOrder = metadata.groups.map((group) => group.id);
catalog.selectionGuide = 'template-catalog.md';
catalog.thumbnailDirectory = 'template-thumbnails';
for (const [id, meta] of entries) {
  catalog.compositions[id] = mergeDescription(catalog.compositions[id], meta, id);
}
if (catalog.titleTemplate?.templateId && metadata.templates[catalog.titleTemplate.templateId]) {
  catalog.titleTemplate = mergeDescription(
    catalog.titleTemplate,
    metadata.templates[catalog.titleTemplate.templateId],
    catalog.titleTemplate.templateId,
  );
}

const groupById = Object.fromEntries(metadata.groups.map((group) => [group.id, group]));
const lines = [
  '# Каталог шаблонов слайдов',
  '',
  'Этот справочник помогает подобрать готовый слайд под смысл и структуру материала. В начале перечислены все группы, чтобы быстро увидеть возможности библиотеки. Затем идут подробные описания каждого шаблона. Группы служат ориентиром: если материал можно показать несколькими способами, сравни шаблоны из разных разделов и выбери тот, который яснее передаёт текст.',
  '',
  'Миниатюры нужны для знакомства с библиотекой, редких спорных случаев и отладки. При обычной сборке презентации достаточно текстовых описаний в этом файле; открывать все изображения заново не требуется.',
  '',
  '## Группы шаблонов',
  '',
];

for (const group of metadata.groups) {
  const count = entries.filter(([, meta]) => meta.family === group.id).length;
  lines.push(`- **${group.name}** (${count}): ${group.description}`);
}

lines.push(
  '',
  '## Как читать характеристики',
  '',
  '- `family` показывает основное смысловое семейство шаблона.',
  '- `capacity` ориентирует по объёму текста: короткий, средний или большой.',
  '- `blocks` показывает количество самостоятельных смысловых блоков. Значение может быть диапазоном.',
  '- `visual_role` описывает основной способ подачи: текст, карточки, схема, изображение с текстом или специальная композиция.',
  '- `alternatives` указывается только для настоящих почти-дубликатов, которые решают одну задачу и отличаются числом блоков либо вместимостью.',
  '',
);

for (const group of metadata.groups) {
  lines.push(`## ${group.name}`, '', group.description, '');
  const groupEntries = entries.filter(([, meta]) => meta.family === group.id);
  for (const [id, meta] of groupEntries) {
    const source = catalog.compositions[id];
    lines.push(
      `### ${id}`,
      '',
      `![Миниатюра шаблона ${id}](template-thumbnails/${id}.png)`,
      '',
      meta.summary,
      '',
      `**Как выглядит.** ${meta.visual_description}`,
      '',
      '**Что размещать в блоках:**',
      '',
      ...meta.placement.map((item) => `- ${item}`),
      '',
      `**Характеристики:** family — \`${meta.family}\`; capacity — \`${meta.capacity}\`; blocks — \`${meta.blocks}\`; visual_role — \`${meta.visual_role}\`; группы — ${meta.groups.map((x) => `\`${x}\``).join(', ')}.`,
    );
    if (source.example) lines.push('', `**Пример материала:** ${source.example}`);
    if (meta.alternatives?.length) {
      lines.push('', `**Почти-дубликаты:** ${meta.alternatives.map((x) => `\`${x}\``).join(', ')}. Выбор между ними зависит от числа блоков или объёма текста.`);
    }
    if (meta.note) lines.push('', `**Техническое замечание:** ${meta.note}`);
    lines.push('');
  }
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(outputDir, 'template-catalog.md'), `${lines.join('\n')}\n`, 'utf8');

console.log(JSON.stringify({
  groups: metadata.groups.length,
  templates: entries.length,
  markdownLines: lines.length,
  outputDir,
}, null, 2));
