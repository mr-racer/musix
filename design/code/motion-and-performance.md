# Motion and performance

## The signature animations (keep all of them)

| Move | Where | Timing |
|---|---|---|
| Pause on the cover | click the cover; the glass pause icon springs in, the art blurs and dims | 300 ms fade, 500 ms spring |
| Flip to lyrics | the cover turns to its back | 720 ms, `cubic-bezier(.34,1.3,.5,1)` |
| Vinyl track change | the old cover swings away like a door, the new one lands with a bounce | 420 ms out, 600 ms in (`spring`) |
| Cover flight | a thumbnail (queue row, sample chip) grows into the cover: the clone sits at the cover's final size and starts scaled onto the thumbnail, so the corners never round on the way | 560 ms, `emphasized` |
| Tilt | the cover follows the cursor, at most 8°; the glare is 12 % and follows it too; a press gives to 0.96 | 250 ms |
| Огонёк / вода | v1's `CoverCombustion`: particles around the cover, one shot | about 2 s |
| Nav island | the blob springs between tabs; a sheen crosses the glass on hover | 550 ms |
| Text on a track change | the title block rises 10 px; a fact rises 6 px when it is paged | 480 ms after 120 ms; 320 ms |
| Icon bounce | the glyph of a button that was just switched on (огонёк, вода, shuffle) swells to 1.45, leans 8° and springs back; the glyph of a reaction that is on is filled | 520 ms, `spring` |
| Menu | grows out of its button from 0.8 with a fade; its rows rise 9 px, 28 ms apart; leaving, it shrinks to 0.88 and fades | 360 ms, `spring`; out 190 ms |
| Cover into a playlist | the cover's copy lifts 14 px and swells to 1.04, then shrinks along an arc into the playlist's thumbnail (across and down are eased differently); the thumbnail swells to 1.3 and springs back as the copy shrinks into it and fades; the cover on the stage gives to 0.965 | 640 ms flight, 180 ms in, 480 ms `spring` |
| Samples spoiler | the hidden chips rise 10 px and fade in, 60 ms apart; the row's height eases (380 ms, `swift`); folding: the chips fade in 160 ms, then the row draws in | 440 ms, `spring` |
| Title question | the question mark hops under the pointer: up a third of its height with a 12° lean, lands, a small second hop | 620 ms |
| Press | every control gives under the finger and springs back: icon buttons 0.9, island tabs 0.94, chips and segments 0.96, rows 0.99 | 250 ms, `spring` |
| Backdrop | two static layers cross-fade | 900 ms |
| Sound ring | arcs and number tween from their current values to the new song's (critically damped); under the pointer the arcs part along their middles, the focused arc thickens, the number rolls (old lifts away, new rises), the caption cross-fades to the scale's name | 900 ms; roll 120 + 260 ms |
| Sound window | slides in from the right edge (as the assistant's window) while the ring gives; its rows rise 60 ms apart, the bars grow from zero; closing slides it back out and fades | 600 ms `swift`; out 500 ms ease-in |
| «Звучат» chip | lifts 2 px, the glyph hops; the name grows out of the chip on glass from .72 | 420 ms `spring` |
| Section name | glides to its block's start when the song gets there or the pointer points at another block; the word blurs in | 550 ms, critically damped |
| Moment dot | swells twice, a few seconds before its moment; grows 1.7× when its instrument is under the pointer | 1 s × 2 |
| Sound stage | the floor unfolds from the front edge as the window opens; light follows the parts' loudness (attack 45 ms, release 260 ms), place 420 ms; hits send rings across the floor; the pointer turns the camera (240 ms) | canvas, only while open and playing |

Easings and durations are tokens (`--mx-ease-*`, `MusixMotion`).

## Page changes (the owner, 2026-10-11, two rounds)

View transitions around every router commit (`web/src/lib/pageMotion.ts`, `styles/pages.css`),
and around a wall filter that is not a route (`morph()`). Round 1 slid pages and grew the player
as a sheet out of the mini player; the owner: «прямоугольник фона, наезжающий на экран — плохо …
не высокотехнологичный дизайн». So **nothing slides across the screen**:
- **what leaves goes out of focus** — fades, blurs (8 px), drifts a little the other way, in
  0.2 s, ease-in; **what arrives comes into focus** a beat later (70 ms) from a short way off in
  its direction — fade 0.26 s, blur off 0.38 s, travel 0.56 s, critically damped, no overshoot.
  Between them the page dips into its own background, never two sharp pages at once;
- directions: **sections are a column** (the island's order, 34 px), **the library's tabs are
  a row** (30 px), **a new grouping or the «Не распечатаны» filter settles in place** (16 px up,
  the old one shrinks to 0.985), **a page that is not a section comes forward** (from 1.03),
  back to a section steps back (from 0.975);
- **the player is not a page that slides in**: the page behind goes out of focus and darkens
  where it stands (blur 18 px, brightness 0.5); the player materialises over it — out of a deep
  blur, from 1.06, fading in; the **cover, the title, the artist and the seek line fly** between
  the mini player and their places (the small picture gives way to the large one early); the
  player's controls rise into their row last; the rest of the mini player sinks away. Closing is
  the same road back: the player dissolves nearer and out of focus, the page comes back into
  focus and light, the parts fly home, the mini player's rest returns after them;
- **the shell never moves**: the island, the logo, the gear and the mini player carry their own
  names; the island's lens travels with its overshoot spring under its items (the items are
  pictures of their own above it, so the lens never hides an icon on its way).
Shell UI that must be photographed in the old state reads the router's `resolvedLocation`. A
screen reads its data before the change (the library's mirror and summary in its loader), so the
picture of the new page is the finished page.

Measured (headless Chrome with hardware compositing, RTX 3090, 1600×1000, capped at 60 Hz): every
transition holds 16.7 ms frames through its animation; switching to the home loses 2–4 frames to
the home's own live sky with or without the blur. Headless Chrome composites in software unless
started with `--enable-gpu --use-angle=vulkan --enable-features=Vulkan,DefaultANGLEVulkan,
VulkanFromANGLE --ignore-gpu-blocklist --enable-gpu-rasterization` — measure with those.

**Smooth from the first frame (the owner liked round 2, 2026-10-11: «немного статтерит в самом
начале … не в ущерб визуалу»).** The change's own motion (transform, opacity, filter of the
snapshots) runs on the compositor and does not wait for the main thread — a 400 ms block in the
middle of a change stalls only the live content inside the new page. What made the start
stutter was work inside the change: the room under the mini player (`--player-h`, a registered
property with a 0.6 s transition) re-laid out the whole page on every frame of the player's
opening and closing; the wall rendered at a guessed width and was laid out again on the first
frame; the library read six thousand rows again on every visit; the spectrum redrew every frame;
fresh data was fetched and parsed in the first frames. Rules now: inside `html[data-nav]` nothing
eases the layout (`transition: none`); a screen measures itself in a layout effect, before the
picture; data a screen already has is shown at once and refreshed after the change (700 ms);
closed windows and the spectrum mount a frame later (`lib/afterPaint.ts`); canvases hold still
during a change; a page fully covered by the player is let go (opacity 0) so the GPU stops
blurring it.

## What may move at rest

- The spectrum above the seek line: one small canvas, at the screen's frame rate (the owner
  asked for 60 at least, 2026-10-05), only
  while the music plays. Not on the phone.
- The EQ bars of the current row, when the queue is visible.
- The seek line (a transform, updated 4 times a second, with no transition: a transition
  would keep the compositor animating 60 frames a second for a pixel of travel).

Nothing else. In particular: no pulsing or flashing with the beat, no drifting backgrounds.

## Rules

- Animate `transform` and `opacity` only.
- One-shot moves are Web Animations on the element (`el.animate`), not a remount: a remount
  reloads the picture and replays every child's entry.
- A picture that travels or leaves (the cover flight, the leaving cover of a track change)
  is a canvas painted from the pixels already on screen, never a new `<img>` with the same
  address: a new element has to load again, and until it has there is nothing to show (the
  cover vanished for three frames on every arrow press).
- What follows the pointer is a CSS variable written at most once a frame, and only while the
  pointer is over the element. Never React state.
- A screen does not re-render with the playhead: only the seek line and the lyrics subscribe
  to the position.
- Backgrounds are static between track changes. The blur is baked into the image.
- No per-frame style writes on large layers; no `mix-blend-mode` on large layers; no
  `backdrop-filter` over anything that animates.
- Everything stops when the music is paused, the tab is hidden or the surface is off screen.
- Honour reduced motion: no loops, instant state changes, a static spectrum.

## Budgets

Since 2026-10-05 these are a watch, not a limit (principles.md, rule 6): a number above
them is reported with what it buys, and the owner decides. Every animation is checked for
its frame rate first: 60 a second at least.

- Web player, headless Chrome with software GL, 1280×900, 8 s: about **10 % of one core**
  playing, and nothing above the app's own idle when paused. Measured 2026-10-05 with the
  spectrum at 60 frames a second and 104 px: 9.5 % playing (3.8 % of it is the app and the
  audio on any page), 3 % paused (the library page idles at the same 3 %). The approved
  probe, which has no audio and no app around it: 8 % and 0 %. The first probe: 120–228 %.
- No layout shift when a fact is paged or a window opens, and the cover stands at the same
  place for every song (a track change must not move it).
- Android: the phase 4 frame budgets.

## Измерения и исправления web — 2026-10-31

Ветка `design-refresh`, dev `:5181`. Сравнение выполнено на двух отдельных production-сборках:
stage3 на локальном preview `:5182`, stage4 на `:5183`. Production не изменялся.
Chrome headless, аппаратный GPU compositing/Vulkan включён и проверен через CDP; размеры
1440×900, 1280×720 и эмуляция 390×844. Запуски выполнялись последовательно.
Метрики TaskDuration — время работы основного потока за сценарий, не длительность клика.
Числа относятся к этому стенду и одному сравнительному проходу, не ко всем устройствам.

| Сценарий | До | После |
|---|---:|---:|
| Поиск `the`, 20 ArrowDown: TaskDuration за окно 2,4 с | 166 мс | 35 мс |
| Тот же сценарий: все вызовы String.toLowerCase в странице | 279 528 | 1 209 |
| Скрытый мобильный спектр: RAF за 3 с воспроизведения | 180 | 0 |
| Пауза полного плеера: пересчёты стиля за 3 с | 180 | 3 |
| Пауза мобильного плеера: пересчёты стиля за 2,4 с | 144 | 0 |
| Очередь из 1000 треков, строки до первого открытия | 1000 | 0 |
| Та же очередь, смонтированные строки при открытии | 1000 | 14 |
| Открытие очереди: TaskDuration за окно 0,7 с | 157 мс | 32 мс |
| Неудачная предзагрузка: POST manifest за 6 с | 23 | 3 |
| 20 вызовов sync во время удержанного запроса | 20 проходов по прежнему алгоритму | 2 прохода, 1 уведомление |
| 500-я песня артиста: задержка появления | 8,838 с | 0,216 с |
| Статический entry graph JS, до сжатия | 622 320 B | 472 259 B |
| Начальная главная вместе с Shell, JS | 671 557 B | 587 470 B |
| Начальная главная вместе с Shell, CSS | 218 462 B | 148 551 B |

Новая регрессия поиска отдельно подтверждает отсутствие полного повторного scan при
20 ArrowDown: оставшиеся вызовы нормализации относятся к отображению/обработке событий.
Для синхронизации использован unit-сценарий с управляемым fetch; сравнение размера кода
получено обходом manifest, это не фактический сетевой transfer.

Очередь из 1000 строк и артист из 500 песен — fixtures. Для очереди сохранены выбор,
удаление, перетаскивание, Tab/стрелки/Home/End, положение после закрытия и адаптация
на 1440/840/390 px. Сокращение DOM не означает устранение всей работы при открытии плеера:
в сценарии через большой альбом суммарный TaskDuration входа изменился с 1598 до 1468 мс.

Ограниченная сеть: 300 мс задержки, 128 KiB/s вниз, 64 KiB/s вверх, HTTP-кеш отключён,
service worker заблокирован. При прямом входе в альбом DOMContentLoaded: 3,54 → 2,31 с;
готовый заголовок: 4,84 → 4,61 с. Закрытие прямой ссылки с загрузкой библиотеки остаётся
около 3,3 с. Ошибок JavaScript в этих проходах не было. Эта проверка не моделирует
установку service worker или ограничение CPU физического телефона.

В sampled RAF-интервалах p95 составил 16,7–16,8 мс. Первый переход главная → библиотека
сохранил long task 51–52 мс и два интервала дольше 33,5 мс. Остальные перечисленные
сценарии нового прохода не дали long tasks. Это не гарантия FPS аппаратного дисплея;
стоимость прокрутки/обычного mini в одном проходе колебалась, её ускорение не заявляется.

Живые Sky/Orb сохраняются согласно принятой главной, в том числе на паузе. Service worker
сохраняет полный офлайн-кеш: около 5,6 MB, 492 assets в новой сборке. Разделение маршрутов
уменьшает первичное исполнение кода, но не отменяет фоновую офлайн-загрузку всех assets.
Длительная сессия, физические телефоны, Safari/Firefox и высокая частота дисплея не проверены.

Артефакты и воспроизводимые сценарии: `/mnt/data/.cache/musix-design-stage4/`.
В этой же папке находятся сырые JSON до/после, снимки очереди, графы сборки и журналы проверок.


## Продолжение desktop-прохода — 2026-10-31

По пожеланию владельца приоритет перенесён на desktop web. Мобильный web проверяется
базово в затронутых компонентах; основной клиент телефона — Android.

При явном закрытии прямой ссылки альбома библиотека теперь начинает загружаться
параллельно анимации закрытия. Переход выполняется после прежней анимации; возвращение
по истории и закрытие overlay сохраняют своё поведение. Переход к артисту не запускает
предзагрузку библиотеки. Запросы summary/stats не дублируются, предзагрузка статистики
при входе в библиотеку сохранена.

Финальное сравнение отдельных сборок stage4/stage5, Chrome 1280×720: latency 300 мс,
128 KiB/s вниз, 64 KiB/s вверх, HTTP-кеш отключён, service worker заблокирован.
Время закрытия измерено MutationObserver до удаления dialog. Прежний таймер ожидания
Playwright мог добавлять до 500 мс из-за интервала опроса; его значения не смешиваются
с новыми.

| Сценарий | До | После |
|---|---:|---:|
| Начало загрузки библиотеки после Escape, раннее закрытие | 731 мс | 6 мс |
| Закрытие сразу после появления заголовка альбома | 2851 мс | 2854 мс |
| Закрытие после дополнительных 5 с ожидания ресурсов альбома | 1723 мс | 1311 мс |

Ускорение последнего сценария составляет около 0,4 с в этом проходе. При раннем закрытии
его нет: предварительная загрузка конкурирует с ещё незавершёнными ресурсами альбома.
Это один итоговый сравнительный проход, не универсальная оценка всех сетей и устройств.
Ошибок JavaScript не было. Два новых E2E проверяют начало предзагрузки по намерению закрыть
и отсутствие запросов библиотеки при переходе к артисту. Всего целевых E2E: 12 passed;
TypeScript, финальная сборка и diff-check проходят.

Пауза первого открытия библиотеки остаётся: три исходных профиля дали long task
50/54/51 мс. В первом профиле 27,8 мс пришлись на принудительные style/layout внутри
View Transition. Эксперимент с порядком измерения стены не дал устойчивого улучшения
и полностью откатан: случаи без long task объяснялись отдельным приходом данных после
600-мс timeout loader. Исходная композиция и анимации сохранены. Подготовка звуков на
первом pointerdown отдельно заняла 31,6 мс wall / 3,1 мс CPU; она не менялась.

Артефакты: `/mnt/data/.cache/musix-design-stage5/README.md`; финальная сборка:
`/mnt/data/.cache/musix-design-stage5-dist`. Production не изменялся.
