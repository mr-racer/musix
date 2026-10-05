# The home — the mock

Stage 1 of the web redesign (`design/code/roadmap.md`). **Not approved yet.**

Live: https://claude.ai/artifact/JuAU1yCKktTQ77Sa65kxPQ (private)

**Round 2 (2026-10-06)**, after the owner's reaction to the first three variants
(`design/code/preferences.md`, the block of that date). «А · Как в v1» is dropped. Two
variants remain, built from the same pieces:

| Variant | The idea |
|---|---|
| Афиша | a poster, no longer the player repeated: the vibe phrase as the headline, one object (the wave's glass ball), and the small print at the bottom (the week, albums as sleeves, playlists as plain names) |
| Полки | a launch pad in four rows of an even rhythm: who you are and search, start (the wave, its style, вайбики), one shelf of albums, your own (playlists, the week) |

The pieces:

- **The wave's ball**: glass, the taste's colours as a liquid inside. The highlight follows
  the pointer, the ball lifts and gives under a press, a ring leaves it on a click, and
  while the wave plays it breathes with the bass. The liquid's speed and colour show the
  wave's style.
- **The tuner**, on the screen instead of a menu: «что играть» one of four on a track with
  a springing thumb, the sound as two switches. The presets are the server's own.
- **Search with a switch**, «Библиотека / ИИ»: the library at once by default; the other
  mode hands the words to the assistant.
- **«Альбом целиком»**: a sleeve with its record, which slides out under the pointer; three
  reasons to offer an album (not played for long, not heard yet, a favourite).
- **Playlists without pictures of their own**: plain names (Афиша) or a mosaic of their
  tracks' covers (Полки).
- **The week**: the last seven days, a bar says its own day under the pointer, and a line of
  small readings with a new one, days in a row.

Gone from the home: «Продолжить», «Недавно добавлено», the discoveries.

In the mock the week's numbers are an example (the test database has almost no listening).
The server does not yet pick albums by the three reasons or count days in a row.

Build it: `python bake.py HOME.json DISCOVERIES.json COVERS_DIR data.json ALBUMS.tsv
PLAYLIST_COVERS.tsv PRESETS.json`, then `python build.py data.json out.html`. The data
(album art, listening) is not committed. The page has switches for the variant and for the
screen size (14″, 16″, 32″, the window); the headline is fitted to four lines, and a row of
albums or playlists shows exactly as many as fit whole.

Round 1 (2026-10-05), three variants: commit 71d2284e.
