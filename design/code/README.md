# MusiX v2 — the design code

Read this before any UI work on any client. These files state the rules the owner set on
2026-10-04, when the player «Кино» was designed
(`docs/superpowers/specs/2026-10-04-design-refresh-player-design.md`).

## What wins on a conflict

1. The owner's words in the conversation.
2. The approved mock of the screen (`design/reference/<screen>/`).
3. These files.
4. The older surface docs in `design/components/surfaces/`: a v1 inventory, valid only for
   screens that have no approved mock yet.

## The mock-first rule

No global screen is implemented or restyled before the owner has seen a preliminary mock of
it in this style and said yes. The approved mock is saved under `design/reference/<screen>/`
with its sources, and the screen is ported from it as it is: ready CSS, markup and behaviour
are taken from the mock where they fit the client's stack.

## Files

| File | It answers |
|---|---|
| `principles.md` | What the design is after and what it refuses. |
| `typography.md` | Which family where, the type scale, labels, links. |
| `color-and-backdrop.md` | Tokens, cover-lit backgrounds, the contrast floor. |
| `surfaces.md` | Where glass is allowed, what windows, sheets and plates look like. |
| `motion-and-performance.md` | The signature animations, what may move, the budgets. |
| `layout.md` | The desktop grid, the phone rule, windows. |
| `components.md` | The shared pieces and their measurements. |
| `screens/player.md` | The player surface. |

Tokens live in `design/tokens/*.json`; `make design` regenerates `design/gen/` for the web
(`--mx-*` custom properties), Android (`MusixTheme.kt`) and Windows.

## Approved screens

| Screen | Reference | Approved |
|---|---|---|
| Player «Кино» | `design/reference/player-kino/` | 2026-10-04 |
