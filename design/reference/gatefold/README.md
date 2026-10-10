# The album gatefold — the mock

Stage 2 of the web redesign (`design/code/roadmap.md`): the album opened over the page from
its card. **Round 1 (2026-10-10): the owner chose «Б · Разворот»** and asked for it to be built
straight away with his fixes (`design/code/preferences.md`); the built screen differs from
this mock where those fixes say so (`design/code/screens/gatefold.md`).

Live: https://claude.ai/artifact/FGHLqZk6N2UdK34MrXL3S6 (private)

The owner's brief (2026-10-10, `preferences.md`): the opening stays as it is (the sleeve
flies out of the grid and turns over); the card itself is redesigned. It must keep the way to
the artist, playing the whole album and putting a chosen track into the queue. «Весь альбом
в плейлист» and «Вперемешку» go (the player has shuffle).

All three keep v1's fly-in and flip with its timings and the reverse on close. They differ in
what the back is:

- **А · Конверт**: the square sleeve as today, refined: the small sleeve with its record in
  the hero, the title, the artist as a link, the facts line, one «Слушать», the list open on
  the backdrop (no glass box), the credits and «Ещё у артиста» under the list.
- **Б · Разворот**: after the flip the sleeve opens like a real gatefold: the right leaf swings
  out on its hinge (a crease, the light on the leaf changes as it turns) and the spread
  slides to the centre. Left: a poster (big title, the artist, «Слушать») with the credits as
  liner notes; right: the whole tracklist.
- **В · Пластинка**: after the flip the record rolls out of the sleeve. It carries the album's
  tracks as bands (light gaps between songs, widths by duration); a row and its band light
  each other; a click on a band plays that song, on the label the album. While it plays the
  record turns up to speed and the tone arm stands on the playing band, creeping inwards.

In all three: «Слушать» is a light pill (the cover's own accent vanished on the cover-lit
back); the back is a deeper blur of the server backdrop (the plain `bg` let the shape of the
cover show through as a smudge: a proposed server variant); a track goes into the queue with
⤵ at the row's end, flies in an arc into the mini player's next button, «Далее» pops above
it and the row keeps its number in the queue (a second click takes it out; chosen tracks play
in the order chosen); the mini player stays above the scrim while an album is open; «Слушать»
no longer closes the gatefold; the most played track is marked «любимая»; the plays count and
the last listen; disc headers; producers and the label; «Ещё у артиста» as a cover stack, a
click turns the sleeve over to that album.

Build it: `psql … < q.sql > albums.json` (the listening account's albums: tracks, plays,
producers, labels, the artist's other albums), `python bake.py albums.json MEDIA_ROOT
data.json`, then `python build.py data.json out.html`. The data (album art) is not committed.
The page has switches for the variant and the screen size.

Server work the chosen variant needs: album producers and label aggregated from
`song_relations` (the mock cleans the web noise: the artist themself, «Kanye», «Youtuber»),
per-track plays in `/albums/{id}`, the deep backdrop variant, and an engine «в очередь» that
appends after the earlier picks instead of `playNext`'s insert-before.
