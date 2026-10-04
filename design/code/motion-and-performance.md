# Motion and performance

## The signature animations (keep all of them)

| Move | Where | Timing |
|---|---|---|
| Pause on the cover | click the cover; the glass pause icon springs in, the art blurs and dims | 300 ms fade, 500 ms spring |
| Flip to lyrics | the cover turns to its back | 720 ms, `cubic-bezier(.34,1.3,.5,1)` |
| Vinyl track change | the old cover swings away like a door, the new one lands with a bounce | 420 ms out, 600 ms in (`spring`) |
| Cover flight | a thumbnail (queue row, sample chip) grows into the cover: the clone sits at the cover's final size and starts scaled onto the thumbnail, so the corners never round on the way | 560 ms, `emphasized` |
| Tilt | the cover follows the cursor, at most 8°; the glare is 12 % | 250 ms |
| Огонёк / вода | v1's `CoverCombustion`: particles around the cover, one shot | about 2 s |
| Nav island | the blob springs between tabs; a sheen crosses the glass on hover | 550 ms |
| Text on a track change | the title block rises | 480 ms |
| Backdrop | two static layers cross-fade | 900 ms |

Easings and durations are tokens (`--mx-ease-*`, `MusixMotion`).

## What may move at rest

- The spectrum above the seek line: one small canvas, at most 30 frames a second, only
  while the music plays. Not on the phone.
- The EQ bars of the current row, when the queue is visible.
- The seek line (a transform, updated 4 times a second).

Nothing else. In particular: no pulsing or flashing with the beat, no drifting backgrounds.

## Rules

- Animate `transform` and `opacity` only.
- Backgrounds are static between track changes. The blur is baked into the image.
- No per-frame style writes on large layers; no `mix-blend-mode` on large layers; no
  `backdrop-filter` over anything that animates.
- Everything stops when the music is paused, the tab is hidden or the surface is off screen.
- Honour reduced motion: no loops, instant state changes, a static spectrum.

## Budgets

- Web player, headless Chrome with software GL, 1280×900, 8 s: at most **10 % of one core**
  playing, **0 %** paused. (The approved probe: 8 % and 0 %. The first probe: 120–228 %.)
- No layout shift when a fact is paged or a window opens.
- Android: the phase 4 frame budgets.
