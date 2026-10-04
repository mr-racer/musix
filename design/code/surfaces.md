# Surfaces

There are three, and most content uses none of them.

| Surface | Where | Look |
|---|---|---|
| **Glass** | the nav island; the pause icon on the cover. **Nowhere else.** | v1's `lg-island` recipe: backdrop blur 28 px with saturation 1.7, a light gradient, a hairline, inner highlights |
| **Float** | windows (assistant, queue), phone sheets, toasts | solid `--mx-float`, a 14 % hairline, shadow `0 24px 60px rgba(0,0,0,.5)`, radius 26 (toast: a pill) |
| **Plate** | the facts block; sample chips | `--mx-plate`, no border (chips: a 14 % hairline), radius 16 (chips 12) |

Rules:

- No panel around a column, no card around text. If a group needs separating, use space.
- Glass never covers animated content and never becomes a container for reading text.
- One window or sheet at a time. A click outside or Esc closes it. On the phone a scrim
  (black 42 %) sits under the sheet.
- A plate must stay small. The facts plate is one control row and at most three lines.

Radii in the player: cover 10, sample chip 12, plate 16, window and sheet 26, pills 999.
