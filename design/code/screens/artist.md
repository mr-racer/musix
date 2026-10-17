# The artist page «Кадр» (approved 2026-10-17)

The mock: `design/reference/artist/` (live: https://claude.ai/artifact/QnFQWiKA3J18pmMbHF7VTe,
round 5). His words: `preferences.md`, 2026-10-14 to 2026-10-16. Code: `web/src/artist/*`.

## The frame (the hero) — still: nothing in it moves with the scroll
- Dark in both themes, a photo-lit surface like the player (the shell's dark scope covers `/artist/`).
- **The picture**: Apple Music's editorial photos (`artists.photo_id/wide_id/logo_id`, the page colour
  in `editorial.bg`), the AudioDB one only when Apple has none or an empty picture. A 2:1 wide frame
  is shifted so the subject sits at ~62 % (the left is the name's); under the name's corner a
  progressive blur in five steps (masked copies with `filter: blur` — rastered once, never
  `backdrop-filter`, which re-reads the page on every scroll frame) and a scrim.
- **A square photo** leaves the text ≈620 px and continues to the left edge: its own leftmost
  column, row by row (canvas), sharp at the photo, blurring 0.6 px per px away from it, darker
  towards the name; the photo melts into it along an eased 8 % ramp. Never a linear ramp (a seam on
  32″), never a wide one (it washed out whoever stands at the edge, Maroon 5), no progressive blur.
- A light page colour (lum > .55) tames the photo (brightness .72).
- The name big (Apple's transparent logo instead when there is one), words arriving in turn; «?»
  when the bio knows where the name came from (a glass pop-up from it).
- **The facts line**: flag + country (required) + city, the genre, the years (from the founding, or
  the first album when «active from» is later), **the Grammy laurel** — the count between two gold
  branches that grow with the wins (a full wreath from 12), hollow with the nominations for zero
  wins. Its case (gold count, «№N из M лауреатов твоей библиотеки», the statuettes placed one by
  one) grows out of it on hover, focus or click in liquid glass v2 **above it, in the name's zone,
  never over the photo**.
- «N альбомов · M песен в библиотеке» and «Биография ›» (the window grows out of the link; the AI
  text and where the name came from).
- Слушать (every song, the most played first) · Вперемешку · Поток артиста (`POST /stream/artist`:
  the artist's songs in a weighted shuffle, two at a time with one of the library's songs that sound
  like them).
- «Артисты» — a glass pill, 15 px. No source caption anywhere.
- Once the frame has scrolled away a glass head arrives at the top (photo, name, ▶) — an observer,
  no scroll handler.

## The body
- **The discography first**, right under the frame: sleeves over and under the axis, a stem to the
  real year (MusicBrainz's first release when the tags carry a reissue's), the record slides out on
  hover, heard/total; the history on the line (formed — «группа собралась» for a band — and ✝);
  gaps over six years fold into a break «N лет». Albums of three songs or more when the artist has
  any. Too narrow (a phone): the line keeps its width and scrolls sideways.
- **«Ты и …» = «Коллекция»**: the level in its metal and five pips; «N/M песен услышано»; how often
  the artist is on the air (radio tiers with a five-bar meter: «Не сходит с эфира» / «Тяжёлая
  ротация» top 2 % / «В ротации» 10 % / «Частый гость эфира» 30 % / «Иногда в эфире» 60 % / «Редко
  в эфире»; never «№4 из 311»); the covers coloured in as far as heard, a water line, a metal check on
  a finished album; what is under the pointer is said in the caption line (no pop-ups); the line to
  the next level at 15.5 px.
- **Levels**: На разогреве (0) → Танцпол (10 plays) → Первый ряд (50) → Бэкстейдж (150 + half of the
  albums heard through) → Легенда (300 + every album); slate, bronze, silver, gold, platinum.
- Beside it the **quiz card** (a stack of blurred covers; one cover stands straight and only hops up)
  → a ten-round window: three seconds of one of the artist's songs (`artist_snippet`), four of the
  artist's songs to pick from; and **«А ты знал»** — one fact at a time in a box of stable height.
- «Слушаешь чаще всего»: two columns, eight songs; «Все N песен» unfolds every song from the mirror.

## Not here (his rulings)
- No assistant block (LLM cost), no «Рядом в библиотеке», no label, no rays, no cut-out figure.
- Ideas not taken yet: missing albums as empty sleeves, eras on the line, the AI tagline (the
  layout keeps its place: `.tagline`).
