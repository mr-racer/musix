# Colour and the backdrop

## Text and lines (dark)

| Role | Value |
|---|---|
| text | `--mx-text` `#eeeef3` |
| muted | 66 % of text |
| subtle | 46 % of text (v1's 28 % was too faint for small labels) |
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

## Readability

- Main text is at least **7:1** against the brightest 3 % behind its column; secondary text
  at least 4.5:1.
- Text over the picture carries `text-shadow: 0 1px 14px rgba(8,8,11,.4)`.
- Never fix contrast with a grey veil over the whole picture. Tame the picture.

## Themes

The player is a dark, cover-lit surface in both app themes until a light mock is approved.
