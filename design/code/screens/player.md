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
4. Credits: «Звучат» (instrument glyphs, see «Sound»), producers (links), genre, «Семплирует»,
   «Её семплировали» (sample chips).
5. The facts plate.

The title shares its row with the sound ring, whose right edge is the facts plate's (640 px).

Bottom: the spectrum over the seek line. Controls on the left: previous, next, огонёк,
вода, shuffle. On the right: lyrics, add to playlist, devices, volume (its icon; the slider
on hover), the Lossless badge. At the far right: «Далее» with the next track; it opens the
queue window.

«Спросить» in the facts plate opens the assistant window. So does a click on a lyric line
on the back of the cover: the window opens with the line quoted and explains it.

A track change: the neighbours' covers, backdrops and spectra are fetched ahead, so the
arrows change the picture and the curve at once. While the next track buffers the engine
reports "not playing" for a moment: that is not a pause, and the paused look must not flash.

## Sound (desktop, 2026-10-25)

From the sound engine's profile (`/tracks/{id}/sound`, live frames `/tracks/{id}/sound/stage`).
A song without a profile shows none of it: the line stays plain, the ring and «Звучат» are
absent. Code: `web/src/player/{sound.ts,SoundRing,Instruments,Timeline,SoundWindow,StageScene}`.

- **The ring** by the title, a score by a title as in a review. Three arcs clockwise from the
  top in three fixed hues (`--mx-sound-tech/space/odd`): техничность, простор, необычность. The
  number in the middle only, centred by the grid; its caption «звук» under the ring, outside it.
  Under the pointer the arcs part, the arc pointed at thickens, the others step back, the
  number rolls to that scale and the caption names it in its hue. A click grows the window out
  of the ring. A new song moves the arcs and the number from where they are (never from zero).
- **Display scales.** The stored scales are absolute; the ring maps them through fixed bounds
  (техничность 25→70, простор 10→90, необычность 0→70), constants, never the library's
  percentiles. The number: 0.5 × the strongest + 0.3 × the middle + 0.2 × the weakest.
- **«Звучат»**: a credits group of glyph chips (`glyphs.tsx`), rare instruments first, then the
  bass, the drums, the voice when the profile names it. The name grows out of a chip on liquid
  glass v2 under the pointer; the row never reflows. A chip with a moment carries an accent dot:
  hovering lights its mark on the seek line, a click plays from two seconds before it.
- **The seek line** shows the song's form: its sections as blocks with a 3 px gap, choruses a
  shade brighter, the played part filling block by block and keeping the gaps. The current
  section's name hangs under the line from a tick at its block's start and glides to the next
  block; under the pointer it names the block pointed at. Moments are dots over the line
  («бит / бас возвращается», the bass coming in and a nameless «новая партия» are left out);
  a dot swells twice a few seconds before its moment and says what it is on glass.
- **The sound window**: liquid glass v2, grown out of the ring and taken back into it. The ring
  and the three scales as bars in their hues (a bar and its arc answer each other); the song's
  pulse and room in two plain sentences, key words lit (no pills); the изюминка when there is
  one; the stage. A scale under the pointer puts its plain meaning («для тех, кто не
  разбирается в музыке») in the place of the sentences: the window never changes height.
- **The stage**: a floor seen from the listener's seat, the band in rows (voice in front, drums
  at the back: a stage plot, the profile cannot tell near from far), each part a strip of light
  whose middle is where it sits now (live frames, 10 a second) and whose length is its stereo
  width. The room is the echo: dry, the back wall right behind the drums; «как в зале», a long
  floor into haze. A louder part glows brighter; a hit sends a ring across the floor; the
  pointer turns the camera a little; paused, the loop stops.
- Not here (his word): instrument names in text, «Что послушать» (the line has it), «Так же
  звучат», explanations for their own sake.

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
