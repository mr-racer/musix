# The home — the mock

Stage 1 of the web redesign (`design/code/roadmap.md`). **Round 3 (2026-10-06), one
composition, awaiting the owner's go-ahead to build.**

Live: https://claude.ai/artifact/JuAU1yCKktTQ77Sa65kxPQ (private)

The owner chose v1's composition after two rounds of variants (`design/code/preferences.md`,
2026-10-06). This mock is that: round 1's «Как в v1», refined, with the pieces he picked.

- **v1's composition**: left the vibe phrase, the orb of «Поток» with its caption, the taste
  anchors, the вайбики; right the two paths, search and the library; the bottom line.
- **The orb as v1 had it**: four drops of the taste's colours drift under a glass cap, a
  blurred ring turns around it, a halo leaves it under the pointer, the drops lean to the
  pointer. New: the press. The orb gives and springs back, the liquid gulps, the halo bursts
  once, the ring hurries for a moment, the glyph pops. The drift and the ring run on WAAPI
  with playback rates, so changes of speed never jump (v1 switched animation-duration).
- **«Настроить волну»** opens in place under the caption (height animated), with round 2's
  tuner inside; the choice recolours the drops.
- **Вайбики** as piles, **the week** at the bottom right, **search** with the
  «Библиотека / ИИ» switch, **the mini player**: all from round 2.
- **«Поставить альбом»**: a plate at the bottom with v1's picks, which the owner asked to
  take as they were, not invented: v1's `GET /recommend/vibes/album-suggestions`
  (`stream_service.vibe_album_suggestions`): for every current вайбик, the album whose mean
  CLAP is closest to the vibe's centroid but which is not inside the vibe, ≤2 per vibe, ≤6
  in all, round-robin; v1's library rail labelled them «≈ {vibe name}», and that label is
  the reason here. The v2 server has no such endpoint yet; port it. The record comes out
  from behind the sleeve, up and to the left into the plate's own padding (checked against
  the header, the titles and the neighbours at three sizes); as many as fit whole.
- **Days in a row**: v1 counted it in `/library/rhythm` (`streak_current`, with a one-day
  grace); the v2 server already has it in `/screens/stats → rhythm.streak_current`
  (`contexts/screens/stats.py: streaks`). The home only needs it added to `/home`'s pulse.
- **The sky** (after his notes that v1's top half «мягко амбиент делала» and that the hours
  and the weather must differ for real): a canvas a tenth of the stage's size, stretched, so
  the light is soft and costs nothing. Three spots of sky in real colours for the hour and
  the weather (a clear morning bright and gold, the day blue or grey by the weather, the
  evening a sunset, the night deep blue with a small moon), the sun or the moon, and two
  quieter spots in the taste's colours (muted at night), which take the playing cover's
  colours while the wave plays. Rain and snow are drawn in front of the screen and know
  its edges: snow lies on the albums' plate, the search field and the island where each flake
  fell (a height field in 5-px cells, a little spilling onto the neighbours, so piles form)
  and melts when it stops; rain breaks into droplets on the headline's lines, the field, the
  plate and the island. The snow thins out towards the ends of a surface and its edge is
  feathered (three bands, the wider ones fainter), so nothing about it is hard. The page
  has switches for the hour and the weather.
- The screen ends 44 px above the mini player (`--spec-room`), so the spectrum never runs
  over the plates. Settings is a quiet glyph at the foot of the island's column, no plate.
  The taste anchors are gone from the home (their stack lives on in components.md).

In the mock the week's numbers are an example (the test database has almost no listening).
The server does not yet pick albums by the three reasons or count days in a row.

Build it: `python bake.py HOME.json DISCOVERIES.json COVERS_DIR data.json ALBUMS.tsv
PLAYLIST_COVERS.tsv PRESETS.json`, then `python build.py data.json out.html`. The data
(album art, listening) is not committed. The page has a switch for the screen size.

Earlier rounds: round 1 (three variants) at 71d2284e; round 2 («Афиша», «Полки», three
materials for the wave's button) at 145570ec.
