# Colour and the backdrop

## Text and lines (dark)

| Role | Value |
|---|---|
| text | `--mx-text` `#eeeef3` |
| muted | `--mx-text-muted`, 74 % of text |
| subtle | `--mx-text-subtle`, 64 % of text |
| hairline | white 8 %, stronger white 14 % |

## The accent pair

A cover-lit surface uses two colours from the server palette of the cover (the client never
computes colours from pixels): the accent (seek line, spectrum, active marks, the current
row) and a second one for a faint tint in the backdrop's corners. On a track change they
ease over 600 ms.

## The backdrop

The background of a cover-lit surface is the server's backdrop variant of the cover,
stretched over the surface:

- 192 px, Gaussian blur 4.6 px, saturation ×1.4;
- then **highlights are tamed**: luma above 0.30 grows 0.18× as fast, the hue is kept.

Light covers become mid-tone colour fields instead of white glare, and nothing has to be
laid over them. The recipe is executable in `design/reference/player-kino/bake_assets.py`.
The client applies no blur and no blend mode. Above the picture: a faint tint from the
accent pair, grain at 6 % (plain alpha, monochrome), two shade gradients (top and bottom,
and towards the side that carries text).

## The sound triad

The sound ring and its bars (`screens/player.md`, «Sound») use three fixed hues, one per scale,
at one lightness so none weighs more: `--mx-sound-tech` (gold), `--mx-sound-space` (sky),
`--mx-sound-odd` (orchid). They are semantic, like the activity rings: the same scale has the
same hue on every cover. The owner (2026-10-25): with one colour the three scales were «тяжко»
to tell apart. The stage's light is the cover's accent lifted halfway to white.

## Readability

- Main text is at least **7:1** against the brightest 3 % behind its column; secondary text
  at least 4.5:1.
- Text over the picture carries `text-shadow: 0 1px 14px rgba(8,8,11,.4)`.
- Never fix contrast with a grey veil over the whole picture. Tame the picture.

## Themes

С 2026-10-31 в `design-refresh` реализованы обе темы по просьбе владельца; визуальная приёмка
в dev ещё впереди. Главная, плеер, ассистент и основное содержимое артиста следуют общей теме.
На светлом плеере готовый фон обложки становится бледным цветовым полем (16 % непрозрачности
на `--mx-bg`); цвет обложки сохраняется, дополнительного динамического blur нет.

- Текст: `--mx-text`, вторичный 74 %, подписи 66 % в светлой теме.
- `--mx-text-inverse` — символы на кнопках с фоном `--mx-text`; `--mx-on-image` — белый
  поверх намеренно затемнённых фотографий. Фото артиста и левая обложка альбомного разворота
  сохраняют свою фотографическую подсветку, остальные поверхности адаптируются.
- Акценты обложек выбираются по теме; для светлого мелкого текста светлота ограничена
  значением OKLCH 0.46. Три шкалы звука сохраняют оттенки, но получают более глубокие тона.
- Источник общих цветов — `design/tokens/manual.json`. `--mx-ink-rgb` генерируется из текста;
  файлы `design/gen/` не правятся вручную.
- Переключение темы обновляет canvas спектра, сцены инструментов и комнату ассистента,
  включая остановленное воспроизведение. Погодная симуляция сохраняет состояние.
