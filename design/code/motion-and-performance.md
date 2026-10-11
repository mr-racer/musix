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
