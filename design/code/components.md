# Components

Measurements are the approved probe's (`design/reference/player-kino/styles.css`).

| Component | What it is |
|---|---|
| **Link** | text with the 1-px underline (see `typography.md`); primary links add a chevron |
| **Credits group** | a label (11 px, uppercase, 0.14em, subtle) over a value (15 px); groups flow in a row with 32 px between them and wrap |
| **Sample chip** | 36 px cover with a play mark, title 14 / 500, artist and year 12 muted; plate with a hairline, radius 12. Not in the library: a dashed outline, a "нет в фонотеке" note, no play mark. In a group, those in the library come first; more than two fold behind «Ещё N» (a quiet pill with a chevron that turns). Opening, the hidden chips rise in one after another while the row grows; closing, they fade and the row draws in: what lies below slides, it never jumps |
| **Facts plate** | a plate (radius 16, padding 6 10 12 14). Row 1 (one line, never wraps): Песня / Артист (small segmented), the category in the accent colour, «Спросить», the pager. Row 2: the text, 15 / 1.5 Noto Sans, clamped to 3 lines, opens on click. The plate is as tall as the track's tallest fact (all of them lie in one cell, one visible), so paging moves nothing. Empty: an italic line saying the facts are being collected |
| **Seek line** | 4 px line, the played part in the accent; time on both sides in mono 12 |
| **Spectrum** | above the seek line, 104 px tall (less only when what lies above leaves no room; under 24 px it hides): a filled curve with a crest line in the accent, lows on the left, highs on the right, starting and ending on the line. Drawn at the screen's frame rate; attack 18 ms, fall 150 ms; every band is measured against its own loud level, so the highs move as much as the lows. Fed by the server's 16 bands at 30 frames a second |
| **Window / sheet** | float surface; a header with the title and a close button; see `surfaces.md` |
| **Assistant window** | header, the conversation (the user's line as a quiet bubble, the answer as plain text, suggested tracks as rows), question templates as chips, the input with a send button. A question about a lyric line shows the line itself as a quote: a 2-px accent bar, the label «Строчка из текста», the line in italic Noto Sans |
| **Title question** | a small raised question mark in the accent, hung off the title's last word (half the title's size, its top on the title's cap line, no plate). It hops under the pointer. A click opens the assistant with the question «Что означает название этой песни?»; the model is sent a longer one that asks for a short answer about the name itself, from the facts and the lyrics, in one plain paragraph. Outside the text flow: it never changes how the title wraps |
| **Lyric line** | on the back of the cover. A click asks the assistant about it (the window opens with the line quoted). Under the pointer the line brightens and a spark shows at its end; the line that was asked about stays in the accent with its spark. Synced lyrics: the line being sung is brighter and 4 % larger, and a small play mark in the left margin, under the pointer only, starts the song from that line |
| **Volume** | its icon alone. The slider (92 px) slides out to the left of the icon on hover or keyboard focus and stays while dragged; a click on the icon mutes (a slash across it) |
| **«В плейлист» menu** | a float surface, 300 px, radius 20, above or under its button. A cap label; rows of a 32 px playlist cover (or a tile with the list icon), the name, the count in mono; under a hairline, the new playlist's name and «Создать». It grows out of its button on a spring and goes back into it; the rows rise in 28 ms apart; the plus of its button turns into a cross. Choosing a playlist in the player: the cover's copy lifts, shrinks and flies an arc into that row's thumbnail, which swells to take it; the count gives way to a check that pops in; the menu leaves. A click outside or Escape closes it |
| **Toast** | a float pill at the bottom centre, 220 ms in and out |
| **Peek row** (phone) | 52 px row with a hairline above: an icon or a cover, a small label, one line of content, a chevron. Opens a sheet |
| **Segmented** | a pill group in an inset groove; the small size is 12 px text with 5 × 10 padding |
| **Icon button** | 40 px circle, the project's icons at 22 px; hover: white 8 %; press: scale 0.9 on a spring. Switched on: the accent (огонёк orange, вода blue), a filled glyph for the reactions, and the icon bounce (motion-and-performance.md) |
| **Badge** | mono 12 in a hairline box, radius 7 (Lossless) |
