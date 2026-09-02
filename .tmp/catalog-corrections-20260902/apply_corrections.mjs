import fs from 'node:fs';

const [catalogPath, guidePath] = process.argv.slice(2);
if (!catalogPath || !guidePath) throw new Error('Expected catalog and guide paths.');

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8').replace(/^\uFEFF/, ''));

const corrections = {
  'text.example': [
    '`title` — заголовок слайда в верхней части.',
    '`body` — исходный тезис или объяснение в верхней плашке.',
    '`example_body` — конкретный пример в нижней части.',
    'Метка «ПРИМЕР С УЧАСТКА» уже находится в шаблоне и не заполняется из плана.',
  ],
  'term.context.explanation.example': [
    '`title` — заголовок слайда в верхней части.',
    '`definition` — основная формулировка понятия слева сверху.',
    '`context` — связанный контекст слева снизу.',
    '`explanation` — пояснение или пример справа.',
    'Метка «ПРИМЕР» уже находится в шаблоне и не заполняется из плана.',
  ],
};

for (const [id, placement] of Object.entries(corrections)) {
  const composition = catalog.compositions[id];
  if (!composition) throw new Error(`Missing composition ${id}`);
  if (composition.slots.title !== 'EXAMPLE_LABEL') {
    throw new Error(`${id}.slots.title has unexpected value ${composition.slots.title}`);
  }
  composition.slots.title = 'TITLE';
  composition.content_placement = placement;
  delete composition.note;
}

const chartNote = 'Диаграмма намеренно не заполняется автоматически. При необходимости человек корректирует её вручную; если диаграмма не нужна для конкретного материала, она может остаться декоративной частью шаблона.';
for (const id of ['statistics.3', 'statistics.4']) {
  if (!catalog.compositions[id]) throw new Error(`Missing composition ${id}`);
  catalog.compositions[id].note = chartNote;
}

fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

let guide = fs.readFileSync(guidePath, 'utf8').replace(/^\uFEFF/, '');
guide = guide.replace(
  'Миниатюры нужны для знакомства с библиотекой, редких спорных случаев и отладки. При обычной сборке презентации достаточно текстовых описаний в этом файле; открывать все изображения заново не требуется.',
  'Миниатюры хранятся отдельно от справочника. При обычной сборке презентации достаточно текстовых описаний. Если описания конкретного шаблона оказалось недостаточно, его миниатюру можно открыть по ссылке.',
);
guide = guide.replace(
  /!\[Миниатюра шаблона ([^\]]+)\]\((template-thumbnails\/[^)]+\.png)\)/g,
  '[Открыть миниатюру шаблона $1]($2)',
);
guide = guide.replace(
  '- `definition` — основная формулировка понятия слева сверху.\n- `context` — связанный контекст слева снизу.\n- `explanation` — пояснение или пример справа.\n- `title` по текущей карте полей связан с маленькой меткой `EXAMPLE_LABEL`, а основной объект `TITLE` не используется сборщиком.',
  '- `title` — заголовок слайда в верхней части.\n- `definition` — основная формулировка понятия слева сверху.\n- `context` — связанный контекст слева снизу.\n- `explanation` — пояснение или пример справа.\n- Метка «ПРИМЕР» уже находится в шаблоне и не заполняется из плана.',
);
guide = guide.replace(
  '- `body` — исходный тезис или объяснение в верхней плашке.\n- `example_body` — конкретный пример в нижней части.\n- `title` по текущей карте полей связан с меткой `EXAMPLE_LABEL`, а основной объект `TITLE` не используется сборщиком.',
  '- `title` — заголовок слайда в верхней части.\n- `body` — исходный тезис или объяснение в верхней плашке.\n- `example_body` — конкретный пример в нижней части.\n- Метка «ПРИМЕР С УЧАСТКА» уже находится в шаблоне и не заполняется из плана.',
);
guide = guide.replaceAll(
  '\n**Техническое замечание:** В текущем catalog.json поле `title` связано с `EXAMPLE_LABEL`, хотя на физическом слайде есть отдельный объект `TITLE`. Это техническое несоответствие нужно исправлять отдельной правкой библиотеки.\n',
  '\n',
);
guide = guide.replaceAll(
  '**Техническое замечание:** Диаграмма является отдельным объектом PowerPoint и сейчас не связана с полями catalog.json. Сборщик заменяет текст показателей, но не данные диаграммы.',
  `**Работа с диаграммой:** ${chartNote}`,
);

fs.writeFileSync(guidePath, guide, 'utf8');
console.log('Updated catalog mappings, guide links, and chart guidance.');
