# The library — the mock

Stage 2 of the web redesign (`design/code/roadmap.md`). The owner's brief and his picks are
in `design/code/preferences.md` (2026-10-11): albums as tiles or rows, artists, playlists, a
library search behind an icon (no tracks tab), sorts «слушаю чаще / новые / А–Я / год /
жанр», genre by tags or by sound (the taste map's clusters), «Пластинка дня», «Не
распечатаны», and the mini player no longer covering the page. Statistics and achievements
are the next round.

Round 1 (2026-10-11): three variants on one stage.

- **А · Как в v1**: v1's composition refined: the title with the readout, tabs with a
  springing underline, «Пластинка дня» as a slim strip, quiet section headings.
- **Б · Ящик**: the top of the page is lit by the day's record (its server backdrop); the day's
  sleeve stands big beside the title with its record half out; the shelf is a record-store
  bin, a divider is a card with a tab, its name and a cover stack of the section.
- **В · Стена**: covers edge to edge, words come with the pointer; the day's record is a 2×2
  tile in the wall; one line on top (title, tabs, a sort menu, tools); dividers in big type.

Shared: the sticky bar (sorts, «Не распечатаны», tiles/rows, search) with a scroll-edge fade;
the veil under the mini player (the page dissolves under the spectrum); the shrink-wrap on
never-played sleeves, which tears on the first play; cards travel to their new places when
the sort changes (FLIP on what is on screen); search results told apart by shape and colour
(artist: round, lilac; album: square with a record edge, amber; song: small cover with a
note, teal).

Round 2 (2026-10-11, same URL): he chose «В · Стена». Round 1's sources are in `round1/`.
The stage is the window by default (no scaling). Covers and artist photos come in atlases of
8 × 8 tiles of 320 px (`img/a*.jpg`, `img/r*.jpg`, published next to the page); each tile
has its palette gradient and a 20 px sketch inline, and develops when its sheet arrives
(«Медленная сеть» delays the sheets). The film peel is a fold line travelling along the
diagonal: the film keeps the far side (clip-path), the flap is the near side reflected over
the fold (`peel()` in logic.js).

Build it: `docker exec -i musix-v2-postgres-1 psql -U musix -d musix -At < q.sql > library.json`
(read-only), `python bake.py library.json /mnt/data/musix-v2-prod/media OUT/` (data.json + img/), then
`python build.py OUT/data.json OUT/musix-library.html`. The data (album art) is not committed.

**Statistics (2026-10-11, version 6 of the same artifact):** `stats.css` + `stats.js` (a module that
uses `window.MX` from logic.js). Data: `q_stats.sql` (listen events in local time, read-only)
→ `python statsbake.py stats_src.json MEDIA_ROOT stats.json` (time, days, streaks, favourites,
genres/decades/countries, the ten achievements with value, target, earned day and context)
→ `python build.py OUT/data.json OUT/musix-library.html stats.json` (opens on the statistics
tab). Flags: `python bake.py … OUT/ FLAGS_DIR` with flag-icons 4x3 SVGs (MIT) per country.

