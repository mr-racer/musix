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
| Samples spoiler | the hidden chips rise 10 px and fade in, 60 ms apart; the row's height eases (380 ms, `swift`); folding: the chips fade in 160 ms, then the row draws in | 440 ms, `spring` |
| Title question | the question mark hops under the pointer: up a third of its height with a 12° lean, lands, a small second hop | 620 ms |
| Press | every control gives under the finger and springs back: icon buttons 0.9, island tabs 0.94, chips and segments 0.96, rows 0.99 | 250 ms, `spring` |
| Backdrop | two static layers cross-fade | 900 ms |

Easings and durations are tokens (`--mx-ease-*`, `MusixMotion`).

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

- Web player, headless Chrome with software GL, 1280×900, 8 s: at most **10 % of one core**
  playing, and nothing above the app's own idle when paused. Measured 2026-10-05 with the
  spectrum at 60 frames a second and 104 px: 9.5 % playing (3.8 % of it is the app and the
  audio on any page), 3 % paused (the library page idles at the same 3 %). The approved
  probe, which has no audio and no app around it: 8 % and 0 %. The first probe: 120–228 %.
- No layout shift when a fact is paged or a window opens, and the cover stands at the same
  place for every song (a track change must not move it).
- Android: the phase 4 frame budgets.
