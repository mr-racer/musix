# Surface: Player

v1 source: `frontend/src/main.jsx` — `PlayerSection` (l. 16801, ~1800 lines), `FactsRail`
(l. 1585), `MiniPlayerBar` (l. 20699). Golden: `design/golden/*/player-*`.

**Anatomy.**
- Cover / vinyl stage: swipe = the vinyl transition, `motion.vinylIn` 320 ms +
  `motion.vinylOut` 600 ms, easing `standard`.
- Title and artist (artist refs are links to the artist atlas).
- Controls: prev, play/pause, next, shuffle, a scrubber, огонёк / вода.
- The ambient field: a radial glow driven by the cover palette (the **server palette** in
  v2).
- The spectrum wave: in v2 it is drawn from the ingest-time energy envelope.
- The lyrics panel: synced LRC highlighting.
- `FactsRail`: facts carousel (the `variant` prop: landing / player).
- Producer and sample badges.
- The queue: reorder, remove, play next.
- The AI chat drawer and lyric explain.

**States.**
- playing / paused / buffering / error-recovering;
- the stream wave active (the «Поток» label) vs a plain queue;
- lyrics open / closed;
- the chat drawer open.

On mobile (< 768 px) the full-screen player is reached from `MiniPlayerBar`, a strip above
the tab bar with the cover, the title and prev/play/next.

**Measurements.**
- The mini player: 7×10 px padding, 6 px gap, a progress hairline on top.
- The accent is `color.accent`, and cover-derived tints override it in the player.

**Behaviour.**
- огонёк / вода play the combustion animation (styles.css `combustion`, l. 3487).
- A reaction is sent at once, and the queue tail is re-planned by the server.

**Removed in v2** (program §4.3): the «похожие / контраст» rail and lyric gems.
