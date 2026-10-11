# The library (approved 2026-10-11)

The mock: `design/reference/library/` (live: https://claude.ai/artifact/NvAFXxZZfVbKZfTVDb87S8).
The owner's words, round by round: `preferences.md`, 2026-10-11.

## The wall
- One sticky bar: «Библиотека», the tabs (Альбомы · Артисты · Плейлисты · Статистика, a
  springing underline that never re-renders), then the tools: the sort pill with its menu,
  «Не распечатаны» (albums with album plays = 0), tiles/rows, the search button. Soft pills;
  the search button is glass.
- Albums and artists: covers edge to edge (gap 5, radius 4, min tile 190–244 px by width), the
  words come with the pointer (artists keep their name on). Rows: 56 px cover, 16 px titles,
  13.5 px headers; no song count.
- Every sort is grouped: listening bands by quintiles (14+, 7–13, 3–6, 1–2, never), letters,
  months, decades, genre by tags or by sound (taste-map clusters), artists also by country with
  real SVG flags. The group heading is big type in the flow; once it is under the bar a glass
  plate holds its name (click: the glass list of groups); a rail at the right edge (bold, the
  open group in the playing song's accent, flags for countries) glides there on click, scrubs
  on drag; far jumps are a soft cut, the heading answers on arrival.
- «Пластинка дня»: its own cover-lit band above the groups (never inside one), the cover bigger
  than a tile with its record peeking; label 18 px.
- The film on never-heard albums: haze, light under the pointer, gathered corners, seam, the
  sticker «не слушал». Opening unwraps it (one canvas: the fold travels the diagonal, the flap
  carries light and shadow, what is left evaporates; a quiet crinkle prepared at the first
  touch). Left unheard, it is wrapped again. Played, it stays open.
- Playlists: plates tinted by their first cover, the mosaic with gaps, the name under it; the
  grid fills the page (cards up to 1.45:1).
- Covers load as colour → 20 px sketch → develop, a wave from the top left; cached ones appear
  at once. The page dissolves under the mini player (a gradient, no blur).
- Search: the button grows into a glass field that covers every tool; the answers are glass
  (deeper tint), artist round + lilac, album square with a record edge + amber, song cover with
  a note + teal; ↑↓ Enter Esc, `/` opens it.

## The statistics (tab 4)
- Accent = the favourite song's cover colour (`--fav`).
- Time huge + a comparison (21, several with a wink; a button turns them, two lines reserved);
  under it the portrait (built from data). Right: days (calendar in `--fav` shades, streak) and
  facts (per day, finished share, hours chart 88 px).
- Favourites: a stack of the top three per kind that turns (arrows, dots, a click on the one
  peeking); the texts stacked in one cell, the leaving one fast, the arriving one after.
- Years as a smooth landscape, the peak labelled, under the pointer a line, a dot on the curve
  and the year above it; genres and countries as bars. Every chart grows in when first seen
  and answers the pointer as the home's week: the bar stretches and brightens and the value is
  said in place. **No tooltips repeating information.**
- Achievements: ten die-cut stickers (earned stuck on at an angle; the rest as dashed outlines
  with a progress ring in `--fav`). A new one: a glass card at the top right, the sticker
  slapped on, a quiet synthesized «бульк».
