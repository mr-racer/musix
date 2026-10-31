# The album gatefold

The album opened over the page from its card (home picks, library, search). Variant
«Разворот» of `design/reference/gatefold/`, chosen 2026-10-10, with the owner's fixes of that
day (`preferences.md`). Built in `web/src/ui/Gatefold.tsx`; the server side is
`/albums/{id}`'s `trackPlays`, `lastPlayedAt`, `producers`, `label`.

## Motion

- **Opening** (v1's, kept): the sleeve flies out of the card (700 ms) and turns 180°
  (850 ms). Its back is the same sharp cover: nothing is blurred before the album opens.
- At 620 ms the right page swings out from behind the left one on the hinge (rotateY 90° → 0,
  440 ms, a light spring; only its last 90° can be seen) while the spread slides to the
  middle and the light on the page comes up. The bands, the notes, the poster and the rows
  rise with it (rows 24 ms apart). About 1.1 s from the click to rest.
- **Closing**: the text goes (160 ms), the page swings back (260 ms), then the sleeve turns
  and flies home (480 ms) while the scrim fades.
- **Another album** («Ещё у артиста»): the spread stays open. The cover travels from its
  thumbnail onto the left page (a canvas of the large cover, preloaded under the pointer,
  560 ms); the text gives way; the right page's colour crossfades (700 ms); the new text
  rises. Closing after it flies to that album's card if the page has one, else shrinks away.

## Layout

Уточнение 2026-10-31: размеры пересчитываются при resize, смене ориентации и изменении
высоты мини-плеера, без повторного открытия книги. На низком телефонном landscape
используется одна прокручиваемая страница. Фокус и позиция списка сохраняются.

При открытии фокус переходит в книгу; Tab обходит её контролы и доступный мини-плеер.
Фоновая страница становится `inert`. Обычное закрытие возвращает фокус на карточку,
переход на другой маршрут его не перехватывает. Enter на кнопке очереди выполняет
только её действие. Ранний Escape начинает закрытие из текущего положения разворота.

Two square pages of side L = min(0.94 × (height − mini player − 48), (width − 240) / 2, 720;
900 from 1300 px of height), in the middle of the room above the mini player.

- **Left page**: the cover, sharp. Under the liner notes (top: producers as links, the
  label, «Ещё у артиста» as a cover stack whose width is reserved, so spreading never
  reflows) and the poster (bottom: the title 700, the artist as a link with the sliding
  chevron, the facts in mono, «Слушать» as a light pill, the plays and the last listen) lie
  bands of the server's backdrop of the cover, masked to follow the text's height and
  darkened towards the edges.
- **Right page**: the colour field (the backdrop drawn into a 36 px canvas and stretched),
  «Треки» with the count and the length, the list. Rows: number (a play glyph under the
  pointer, EQ bars when it plays), title with feats, огонёк on the most played track, time,
  «Играть следующим» at the end.
- **Phone** (≤ 768 px): one full-screen page, the poster above the list, the same opening.

## The queue

«Играть следующим» puts the track after the current one and after what was picked this way
before (`player.enqueue`; picks play in the order picked). The title flies in an arc into the
mini player's next button, which bumps; «Далее» pops above it for 2.6 s. The row keeps its
place in the queue as a number; a second click takes it out. The mini player stands above
the scrim while an album is open.

## Readability

Text on both pages: #f6f6f9, secondary 88 %, labels and numbers 76 %, a soft shadow.
Checked against the brightest 3 % behind each text on 12 covers, white ones included: main
text ≥ 8.4 : 1, secondary ≥ 5.5 : 1 (`design/code/color-and-backdrop.md` asks 7 and 4.5).

## Единый вход в альбом — 2026-10-29

Решение владельца: отдельного старого альбомного интерфейса больше нет. Общая поверхность —
`AlbumGatefold` в `web/src/ui/Gatefold.tsx`:

- Карточки главной, библиотеки и артиста открывают книжку поверх текущего экрана.
  Enter в быстром поиске делает то же самое, без перехода на отдельную страницу.
- `/album/$id` сохранён для прямых ссылок, плеера и новых вкладок, но показывает ту же книжку.
  Закрытие возвращает назад внутри приложения; при прямом входе — в библиотеку.
  Вход по защищённой ссылке заменяет запись страницы авторизации в истории, чтобы закрытие
  не возвращало пользователя в цикл «вход → альбом».
- «Ещё у артиста» на прямом маршруте заменяет текущий URL без нового шага истории,
  пересоздания книжки и второй анимации страницы. Перезагрузка открывает выбранный альбом.
- Завершение анимации закрытия после ухода со страницы не отменяет переход к артисту.
- Загрузка данных запускается при намерении открыть ссылку, но не блокирует отрисовку:
  книжка показывает «Загружаем альбом…» и статичные строки-заготовки. Ошибка загрузки даёт
  повторить запрос; 403/404 объясняют недоступность; пустой альбом показывает сообщение.
- У списка есть 32 px снизу: последняя строка при прокрутке выходит выше 26 px затухания
  края. Само затухание и принятые анимации сохранены.

### Проверки текущего этапа

- `make web-check`: TypeScript без ошибок; Vitest — `2 passed`.
- `MUSIX_WEB_URL=http://127.0.0.1:5180 npm run e2e -- albums.spec.ts`: проверки карточек,
  новой вкладки, перезагрузки, поиска с клавиатуры, смены альбома, перехода к артисту,
  ошибки/повтора, входа по ссылке, плеера, очереди, Back/Forward — `6 passed (47.4s)`.
- `npm run build`: успешная сборка. Ruff: `No Python files found under the given path(s)` —
  Python в этом этапе не изменялся; это не проверка TypeScript.
- Проверены 1280×720, 1512×982, 1920×1080, 2560×1440 и 390×844: нет горизонтального
  переполнения, кнопка закрытия в пределах экрана. Проверены пустое состояние и reduced motion.
- Headless Chrome, аппаратный композитинг RTX 3090/Vulkan, 1512×982: при открытии из кеша
  108 кадров за ~1,8 s, p95 16,7 ms, максимум 16,8 ms, кадров длиннее 33,4 ms — 0.
  Прокрутка самого длинного альбома снимка (49 треков): p95 16,7 ms, максимум 16,8 ms.
  Это измерение данного стенда, не гарантия для всех устройств и частот обновления.
- При искусственной задержке API 2500 ms: раньше Enter в поиске не показывал ожидание,
  заголовок появлялся через 2602 ms; теперь состояние ожидания видно через 814 ms,
  заголовок — через 2883 ms. Улучшен отклик на действие, ускорение получения данных не заявляется.
  Два открытия подряд — один запрос альбома. Прямой вход: один запрос альбома (12 605 B),
  один страницы артиста (39 936 B), восемь изображений (84 932 B), повторяющихся путей изображений нет.
- Дополнительный прогон с ограничением сети Chrome: 400 ms задержки, 64 KiB/s загрузка,
  32 KiB/s отправка, HTTP-кеш отключён. Заголовок виден через 1339 ms, изображения книжки
  загружены через 4340 ms. При прокрутке 49 треков последний ряд после исправления находится
  на 31,5 px выше края на desktop и на 32,4 px на узком экране, вне зоны затухания.
- Сырые замеры и снимки текущего dev-прогона: `/tmp/opencode/musix-albums/`.
  Автоматические проверки используют отдельную базу-снимок; медиа восстановлены частично
  (альбом Graduation и связанные обложки), это не полный актуальный каталог production.
  Реальный телефон, Safari,
  Firefox и экран 165 Hz не проверялись. После отчёта владелец разрешил production
  (2026-10-29: «Давай в прод выкатим»).

### Production — 2026-10-29

- Выложен `cafdc8e031f839c9d4153c907dbf2b10fb189ee2` в 23:59 МСК. `design-refresh`
  обновлена fast-forward из `v2`; использована уже проверенная сборка из
  `/mnt/data/v2-branch/web/dist`. Production раздаёт `/home/ivan/musix-design/web/dist`.
- Ресурсы добавлены перед атомарной заменой `index.html`, затем `sw.js`. Предыдущие
  хешированные файлы сохранены для открытых вкладок; контейнеры не перезапускались.
- Первая попытка остановилась до переключения на различиях путей в source map;
  полное восстановление предыдущей сборки проверено. При повторной выкладке сохранены
  40 прежних map-файлов: их парные JS-файлы побайтово совпадают, во всех map различается
  исключительно поле `sources`. Остальные различия хешированных ресурсов запрещены проверкой.
- Проверки после выкладки: все 510 ресурсов из текущего и предыдущего manifest отвечают 200;
  публичные HTML, service worker, основной JS, маршрут альбома и Gatefold побайтово совпадают
  со сборкой; `/api/v2/ready` — `ok` (Postgres и Qdrant — `ok`). В Chrome прямая ссылка
  гостя сохраняет альбом в `next` при переходе на вход; ошибок JavaScript и ресурсов нет.
- Копия для отката: `/mnt/data/musix-v2-prod/web-dist-20261029-cafdc8e-pre`.
  Квитанция с хешами и временем: `/mnt/data/musix-v2-prod/release/web-cafdc8e.json`.
- NOT VERIFIED: авторизованные сценарии на production — сеанс пользователя не использовался.
  Шесть E2E-сценариев альбомов проверены ранее на отдельном dev-снимке.


### Предзагрузка при закрытии — 2026-10-31

При явном закрытии прямого входа без предыдущего маршрута загрузка библиотеки начинается
сразу, параллельно сворачиванию разворота. Сам переход остаётся после анимации. Закрытие
overlay, возврат по истории и переход к артисту не получают лишней загрузки библиотеки.
Это проверено отдельными E2E вместе с прежними сценариями фокуса, Back/Forward и resize.
Замеры сети и ограничения — `../motion-and-performance.md`, продолжение desktop-прохода.
