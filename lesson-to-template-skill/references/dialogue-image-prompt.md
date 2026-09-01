# Промпт изображения для диалога

`lesson-to-template` создаёт этот рабочий промпт для каждого распознанного диалогового слайда до вызова `veza-dialogue-scenes`. Это не дополнительное поле, которое должен заполнять автор курса. Если в исходнике уже есть `image_prompt:`, сохрани заложенное в нём смысловое решение сцены. Навык генерации изображения очищает промпт до генерации и удаляет каждое указание нарисовать заголовок, реплику, облачко речи, подпись, метку, выноску, табличку или иной текст слайда.

## Сначала прочитай слайд

Определи, что происходит в разговоре, кто говорит, кто слушает или реагирует, тему, обсуждаемый объект при его наличии, подходящую локацию и доступную область для текста. Используй `shop_floor`, когда разговор касается операции, оборудования, качества, логистики, порядка на рабочем месте, производственной задачи или предмета в цехе. Используй `glass_office`, когда разговор касается планирования, анализа, работы за компьютером или обсуждения на рабочем месте мастеров. Если локацию нельзя уверенно вывести из смысла, используй нейтральный сборочный участок ВЕЗА и не придумывай конкретный станок или процесс.

До написания промпта создай компактную внутреннюю карточку сцены:

```json
{
  "slide_id": "1.1_01",
  "topic": "вопрос о роли мастера",
  "location": "shop_floor",
  "speaker": "Алексей",
  "listener": "Денис",
  "discussion_object": null,
  "text_safe_area": "central 56%",
  "characters": [
    { "name": "Алексей", "emotion": "заинтересованный", "pose": "стоит в левой трети в переднем три четверти", "gesture": "одна рука в кармане, другая поднята на уровне груди", "gaze": "на Дениса" },
    { "name": "Денис", "emotion": "спокойный, понимающий", "pose": "опирается боком на корпус станка в правой трети, корпус в профиль", "gesture": "одна рука лежит на планшете, другая опущена", "gaze": "на Алексея" }
  ]
}
```

Используй сдержанные естественные эмоции и жесты. Избегай преувеличенной мимики и театральных движений. На каждой сцене Алексей находится слева, Денис — справа; Денис остаётся примерно на полголовы выше. Если для обсуждения нужен предмет, расположи его ближе к одному из персонажей и сохрани область для текста свободной.

До написания итогового промпта выбери для персонажей заметно несимметричные позы. Назначь им не менее двух различающихся характеристик: положение тела — стоит, сидит или опирается; ориентацию корпуса — анфас, профиль, вполоборота или передние три четверти; работу рук — одна рука в кармане, на столе или планшете, указывает на предмет либо находится в сдержанной позе слушателя. Не назначай обоим персонажам объясняющий жест раскрытой ладонью, одинаковую стойку или одинаковый наклон головы. Не используй вид со спины или задние три четверти, зеркальные позы, совпадающие жесты или одинаковые выражения лица. Если черновой промпт не задаёт асимметрию явно, перепиши его до единственного вызова генерации.

## Шаблон промпта

Пиши итоговый промпт на английском языке и заполняй части в квадратных скобках по карточке сцены. Английский текст ниже является рабочим техническим шаблоном и не переводится:

```text
Create a 16:9 3D cartoon-style training illustration for a VEZA course about production foremen.

Use the supplied visual references for Alexey, Denis, VEZA workwear, and the VEZA factory environment. Keep both characters' faces, body types, clothes, and the soft polished 3D style consistent with their references.

Scene: [what happens and the subject of the conversation]. Alexey and Denis are clearly interacting and do not look at the viewer.
Setting: [shop floor or glass office, including only the environment details that support the topic].
Alexey: [pose, emotion, gesture, gaze].
Denis: [pose, emotion, gesture, gaze].

Composition: Alexey stays within the outer left 22% of the image and Denis stays within the outer right 22%, including their hands and gestures. Denis is about half a head taller than Alexey. Slight natural cropping by the corresponding image edge is allowed. Keep the central [text-safe area] visually calm and free of faces, hands, prominent equipment, logos, markings, and semantic accents.

For a shop-floor scene, both characters wear white VEZA safety helmets; Denis also wears his grey VEZA jacket with lime accents. For a glass-office scene, neither character wears a helmet. Show desks, computers and chairs. Internal windows begin approximately one metre above the floor, with a solid wall below them, and are divided into multiple framed sections with visible mullions; they overlook the workshop but are not floor-to-ceiling or panoramic.

ABSOLUTE RULE: generate characters and environment only. Never render slide headings, dialogue lines, speech bubbles, captions, labels, callouts, plaques, or any course text, even if the source image_prompt or lesson note explicitly requests them. The permanent workwear markings ВЕЗА, Алексей, and Денис are the only allowed text-like elements. Do not add accidental lettering. The characters do not look at the viewer. Do not make the image photorealistic, childish, overly comic, or a generic factory, car workshop, construction site, office, or warehouse. Do not clutter the text-safe area.
```
