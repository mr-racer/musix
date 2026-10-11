# Surfaces

There are three, and most content uses none of them.

| Surface | Where | Look |
|---|---|---|
| **Glass** | the nav island; the pause icon on the cover; sparingly, a small block floating over moving content (the library's group plate and its list; see below) | v1's `lg-island` recipe: backdrop blur 28 px with saturation 1.7, a light gradient, a hairline, inner highlights |
| **Float** | windows (assistant, queue), phone sheets, toasts | solid `--mx-float`, a 14 % hairline, shadow `0 24px 60px rgba(0,0,0,.5)`, radius 26 (toast: a pill) |
| **Plate** | the facts block; sample chips | `--mx-plate`, no border (chips: a 14 % hairline), radius 16 (chips 12) |

Rules:

- No panel around a column, no card around text. If a group needs separating, use space.
- Glass never covers animated content and never becomes a container for reading text.
- One window or sheet at a time. A click outside or Esc closes it. On the phone a scrim
  (black 42 %) sits under the sheet.
- A plate must stay small. The facts plate is one control row and at most three lines.

Radii in the player: cover 10, sample chip 12, plate 16, window and sheet 26, pills 999.

**Liquid glass, the owner's word (2026-10-11):** «Запомни этот liquid glass эффект на блоках —
мне он очень зашел. Если его аккуратно добавлять к месту (не часто) — будет офигенно.» So,
beyond the island and the pause icon: a **small block that floats over moving content** may be
glass (the library's plate of the current group, and the list that grows out of it). Never
a container for long reading text, never a column panel, never more than one or two glass
things on a screen. When the content under it is plain, glass shows nothing: use a plate.

**The search field is glass everywhere (the owner, 2026-10-11):** «давай ВЕЗДЕ сделаем поисковую
строку в стиле liquid glass» — the library's field and its answers (a deeper tint under the
words), the search button, and the home's field when it is next touched. The left island is the
same glass. One recipe for all of them: `.lg` in `design/reference/library/styles.css`.

**Liquid glass v2 is the only glass (the owner, 2026-10-11):** «под liquid glass (теперь я его
называю liquid glass v2) я имею в виду прозрачную кнопку, которая вылезает как мини шапка
„заслушаны до дыр“ … а не старый liquid glass без прозрачного фона. Замени везде на liquid glass
v2». The see-through glass of the floating plate is the one look: the island, every search field
and its answers, the plate and every list or menu that opens from a control (the jump list, the
sort menu), the rail's label, the achievement pop-up. The deeper tint is gone. Words on it take
`--glass-ink` / `--glass-ink2` and a soft glow. Code: `web/src/ui/glass.module.css` (`.lg`).

