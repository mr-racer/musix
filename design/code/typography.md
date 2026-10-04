# Typography

## Families (`design/tokens/manual.json` → `--mx-font-*`, `MusixFonts`)

| Token | Family | Use |
|---|---|---|
| `sans` | Geist | UI, titles, labels, rows, buttons |
| `text` | Noto Sans | reading text: facts, the vibe line (italic), assistant answers, empty states |
| `mono` | JetBrains Mono | time, counters, pagers, the Lossless badge (`tabular-nums`) |
| `display`, `serifDisplay` | Playfair Display, Lora | **not in the player.** Other screens keep them until their mock decides. |

Emphasis inside a text is the italic or the weight of the same family, never another family.

## Scale (`--mx-type-*`, `MusixScale`)

| Token | Size | Use |
|---|---|---|
| `cap` | 11 | credits labels, tiny counters |
| `sm` | 13 | secondary lines, chips, control labels, the album line |
| `body` | 15 | body, facts, rows, the vibe line |
| `lead` | 18 | lead text, the artist line outside the player |
| `h` | 24 | screen and section titles |

The player title is its own size: `clamp(34px, 5.2cqw, 62px)`, weight 700, tracking
−0.035em, line height 0.98. A title longer than 15 characters uses
`clamp(28px, 3.9cqw, 46px)` and line height 1.02. Its capitals start at the cover's top edge.

## Labels

- Uppercase with tracking (11 px, 0.14em, the subtle colour) is for the labels of credits
  groups and the nav island only. It is not an eyebrow over every block.
- Everything else is sentence case.
- Titles get `text-wrap: balance`, paragraphs `text-wrap: pretty`.

## Links

Whatever navigates (artist, album, producer) is underlined: 1 px, offset 4 px, 42 % of the
text colour; on hover the line and the text go to full strength. The two primary links of a
screen (artist, album) also carry a small chevron that slides 3 px on hover.
