# Screen: the player «Кино»

Reference: `design/reference/player-kino/` and the live probe linked from its README.
The screen is ported as it is there.

## Desktop

One grid: nav island · cover · text column. The cover is 31 % of the stage's width, at most
46 % of the screen's height and 520 px; the text column is at most 760 px. The two form one
group. While the stage is narrow the group fills it edge to edge, as in the probe; on a
wide screen the room left over is split on both sides and the group stands in the middle of
the screen (the owner's 2560×1440, 2026-10-05). The cover's top edge is the group's top.

The cover alone decides the group's height: it stands at the same place for every song.
The text column runs down past the cover's bottom edge when a song has more to say, and
moves the group up only when it needs more than the room under the cover. The seek line and
the controls are at the bottom.

Text column, top to bottom:

1. Title (capitals start at the cover's top edge).
2. Artist, then album and year: links.
3. The vibe line (Noto Sans italic). In «Поток»: the reason line under it.
4. Credits: producers (links), genre, «Семплирует», «Её семплировали» (sample chips).
5. The facts plate.

Bottom: the spectrum over the seek line. Controls on the left: previous, next, огонёк,
вода, shuffle. On the right: lyrics, add to playlist, devices, volume (its icon; the slider
on hover), the Lossless badge. At the far right: «Далее» with the next track; it opens the
queue window.

«Спросить» in the facts plate opens the assistant window. So does a click on a lyric line
on the back of the cover: the window opens with the line quoted and explains it.

A track change: the neighbours' covers, backdrops and spectra are fetched ahead, so the
arrows change the picture and the curve at once. While the next track buffers the engine
reports "not playing" for a moment: that is not a pause, and the paused look must not flash.

## Phone

One screen, no scrolling, no wave.

- Top bar: collapse; the Lossless badge in the middle; add to playlist and the overflow
  menu on the right («Слушать на…» lives in the menu).
- The cover, with previous and next on its left and right edges.
- Title, artist and album (links), the vibe line, the reason line in «Поток».
- The seek line.
- Controls: огонёк, вода, shuffle on the left; lyrics and the assistant on the right.
- Peek rows: «О песне» (a sheet with the facts, the credits and the samples) and «Далее»
  (the queue sheet).

## States

Playing, paused (glass pause icon, the art dims), buffering, error, idle (nothing plays),
lyrics open (the cover's back), a window or a sheet open, «Поток» (the reason line; shuffle
is disabled), playing on another device.

## Data

`/tracks/{id}/context` (track, audio, lyrics), `/tracks/{id}/knowledge` (facts, vibe,
producers, samples, sampled by), the envelope (spectrum), image variants with the backdrop.
