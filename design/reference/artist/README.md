# Artist page — the mock

Stage 3 of the web redesign (`design/code/roadmap.md`). The owner's brief: `design/code/preferences.md`
(2026-10-14). Live: https://claude.ai/artifact/QnFQWiKA3J18pmMbHF7VTe

Round 1 (2026-10-14). Data: the frozen v1 snapshot `/mnt/data/musix-snapshots/2026-10-01/metadata.db`
(read-only, `immutable=1`) + v1's image tree, for the listening account; Apple Music images for
variant В fetched 2026-10-14 by `am_fetch.sh` (music.apple.com page → serialized-server-data →
`sections[0].items[0]`: `artwork` square up to 4906 px, `wideArtwork` 4320×2160, `artistLogo`,
`bgColor`). Build: `python bake.py OUT && python bake2.py OUT DL && python bake3.py OUT && python bake4.py OUT && python build.py OUT`.

Switcher at the top: variant, artist (8 faces), albums as «Лента» (timeline) or «Полка» (grid),
the window or a 14/16/32″ screen, «Идеи» on/off.

- **А · Сцена** — v1's atlas refined: the name left, the cut-out standing on the hero's floor at the
  right. No rays, sparks or pedestal. The cut-out is placed by its real opaque box (bbox) so every
  figure stands at the same scale; edges the source photo cut (top of the head, shoulders) and the
  feet dissolve; it is lit by the scene (light wrap: the backdrop soft-lit through the PNG mask; a
  rim from above in the photo's colour; a still backlight behind the head). No cut-out: the photo
  melts into its own light.
- **Б · Обложка** — magazine depth: the name huge, uppercase, fit to the measure, behind the figure;
  on scroll the name and the figure part (parallax). No cut-out: the name is filled with the photo.
- **В · Кадр** — photo-first on Apple Music's wide editorial frame (or its square at the right with
  a mask), the artist's logo instead of the typed name where Apple has one; a light photo is tamed
  (Weeknd). Kanye's Apple and Deezer profiles are a black square → detected (stddev < 6) → the old
  photo.

Body (all variants): «Коротко» (AI bio clamped to 6 lines, opens in place) + dossier credits; the
Grammy case (gold count with a foil sheen that follows the pointer, statuettes placed on a glass
shelf one by one, hollow ones for nominations without a win, the rank among the library's 101
laureates, «За что?» → assistant); the discography by year (timeline with alternating lanes, stems to
the real year, the history on the line: formed, ✝; or a grid with the year over each sleeve); the
vinyl slides out on hover; heard/total per album; most played songs; «А ты знал» facts; «Рядом в
библиотеке» (collaborators). Ideas: AI tagline, eras on the timeline, missing albums as empty
sleeves (MusicBrainz → Yandex), fan level sticker with progress, «Поток артиста», assistant
questions, artist quiz.

Hand edits in `EDIT` (logic.js): original release years for reissues (College Dropout 2004, Thriller
1982, Eminem Show 2002), Russian place names, translated songfacts facts, example AI texts.

Round 2 (2026-10-15, version 2): «Кадр» only, refined after his fixes (preferences.md, 2026-10-15).
`edit_block.js` holds COUNTRY/EDIT (concatenated before `logic.js` by `build.py`). Round-1 sources:
`round1/`.

Round 4 (2026-10-16, version 4; working copy built in `/mnt/data/.cache/musix-artist-mock/out`):
`bake4.py` adds `story` (first song, plays per week, the day each level was reached by replaying the
plays) and `heardAll`. Square photos continue their own left edge (`extend()` in logic.js, a 1×96 canvas
of the edge's rows); the Grammys are a laurel in the facts line with a glass case on hover (`gbadge`,
`gpopHTML`, `laurel`); «Ты и» has four designs (`youHTML`, switch `S.you`: col / scale / story / rec);
the facts card replaced «Рядом в библиотеке».

Round 5 (2026-10-16, version 5): «Коллекция» only (the other three designs in `round4/`); levels renamed
(На разогреве / Танцпол / Первый ряд / Бэкстейдж / Легенда); `freq()` replaces the rank with radio
tiers + an on-air meter; the quiz stack knows its count (`n1`/`n2`); square photos: short ramp, no
progressive blur, graded edge continuation in `extend()`.
