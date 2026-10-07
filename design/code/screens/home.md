# The home

Approved as one composition on 2026-10-06 after three rounds (`preferences.md`, that date;
the mock in `design/reference/home/`, built with `bake.py` + `build.py`). Implemented in
`web/src/routes/_app/index.tsx` with `ui/Sky.tsx`, `ui/Orb.tsx`, `ui/QuickSearch.tsx` and
the mini player in `player/MiniPlayer.tsx`; the server side in
`server/src/musix/contexts/screens/{picks,weather}.py` and the pulse in `stats.py`.

## Composition

v1's home, refined. The page is exactly the screen above the mini player and its
spectrum (`--player-h` + `--spec-room`): it never scrolls on a desktop.

- **Top line**: the wordmark at the left; the settings cog a quiet glyph in the top right
  corner, no plate (a hairline ring under the pointer, the cog turns).
- **Left, the hero**: the eyebrow «Твой вайб»; the phrase (600, 26–46 px, four lines at
  most, the Latin names in it are links to their artists when the library knows them);
  the orb of «Поток» with its caption and the «Настроить волну» pill; the вайбики as piles.
- **Right, two paths**: «Найти в библиотеке» with the search field, and «Фонотека», a row
  with the counts (they tick up once) and a fan of the three newest covers that spreads
  under the pointer.
- **Bottom**: the plate «Поставить альбом» at the left, the week at the right.

Gone from v1's home: the taste anchors (their stack is a component now, `components.md`),
«Продолжить», «Недавно добавлено», the discoveries.

## The pieces

- **The sky** (`ui/Sky.tsx`): v1's top half «мягко амбиент делала». A canvas a tenth of
  the viewport, stretched, under a grain and the shade. Three spots of sky in real colours
  for the hour (morning, day, evening, night by the clock) and the weather (clear, cloudy,
  rain, snow from `/home.weather` for the listener's city: chosen at the first run or in
  the settings; nothing chosen means Istanbul, the instance's `MUSIX_WEATHER_LATLON`), the
  sun or the moon, and two quieter spots in the taste's colours (muted at night: no acid
  colours) which take the playing cover's colours while music plays. Rain and snow fall on
  a second canvas in front of the page and know the edges marked `data-sky-edge`: the
  headline's lines (rain only), the search field, the albums' plate and the island. A drop
  breaks into four droplets; a flake stays where it fell and the snow there grows as a
  height field in 5-px cells (a little spills onto the neighbours), thinning out towards
  the ends of a surface, with a feathered edge, and the band's underside follows the
  height too, so a bare surface shows nothing; it melts when the snow stops.
  `localStorage.mx-sky = clear|cloudy|rain|snow` shows any weather.
- **The orb** (`ui/Orb.tsx`): v1's `.fy-hybrid` kept: four drops of the taste's colours
  drift under a glass cap, a blurred ring turns, a halo leaves it under the pointer, the
  drops lean to the pointer. The drift and the turn run on WAAPI with playback rates (at
  rest 1, under the pointer 2, playing 2.2; the sound setting ×0.7 calm, ×1.5 energetic),
  so a change of pace never jumps. The press: the orb gives and springs back, the liquid
  gulps, the halo bursts once, the ring hurries for 0.7 s, the glyph pops.
- **«Настроить волну»**: opens in place under the caption (height animated), the rows
  below slide down. Inside: what to play, one of four on a track with a springing thumb
  (the groove clips its overshoot, so from one end to the other it bumps the wall, never
  leaves the groove; the same for the search switch);
  the sound, two switches. Saved to the server and remembered on the device.
- **Вайбики**: piles of three covers; the pile spreads under the pointer. A click plays
  the vibe; its top cover flies into the mini player's cover.
- **Search** (`ui/QuickSearch.tsx`): the switch «Библиотека / ИИ» in the field; the
  library side searches the device's mirror at once (artists, albums, tracks, with the
  match marked) and ends with «Спросить ассистента»; the AI side glows in the accent,
  offers three example questions and hands the words to the assistant (today the search
  page's lyrics mode). «/» focuses it. The thumb springs like the island's blob.
- **«Поставить альбом»**: v1's library rail, ported one to one (`picks.py`): for every
  current вайбик, the album whose mean CLAP is closest to the vibe's centroid but which
  is not inside the vibe, ≤2 per vibe, ≤6 in all, round-robin; the вайбик's name is the
  reason («≈ Меланхоличный поп»). A sleeve with the record behind it: under the pointer
  the record comes out up and to the left, into the plate's padding, never towards the
  text; the header line says the album's length. As many as fit whole in one row.
- **The week**: the last seven local days, today last (`pulse.last7_ms`), one number,
  seven bars that grow in, a bar under the pointer says its own day; the readings: days in
  a row (`pulse.streak_current`, v1's streak with the one-day grace), tracks heard for the
  first time, the genre heard most.
- **The mini player**: the player's own bottom line on every other screen: the seek line
  with the spectrum (46 px) rising above it, then the cover and the title (they open the
  player), the transport, the time and the Lossless badge. Pages end 44 px above it.

## Sizes

Checked at 1280×720, 1512×982, 1728×1117 and 2560×1440: nothing overlaps or scrolls. Under
820 px of height the phrase takes three lines, the plate loses the reasons and the week its
readings. The content is capped at 1640 px and centred on a 32″ screen.

## Cost

Measured in headless Chrome at 1728×1117 (software compositing, so an upper bound): the
main thread 6.6 % at rest (the sky), 11–12 % under snow or rain, 7 % with the wave
started; 56–58 frames a second with no frame over 34 ms. The library page, for
comparison: 0.4 %.
