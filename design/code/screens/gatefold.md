# The album gatefold

The album opened over the page from its card (home picks, library, search). Variant
«Разворот» of `design/reference/gatefold/`, chosen 2026-10-10, with the owner's fixes of that
day (`preferences.md`). Built in `web/src/ui/Gatefold.tsx`; the server side is
`/albums/{id}`'s `trackPlays`, `lastPlayedAt`, `producers`, `label`.

## Motion

- **Opening** (v1's, kept): the sleeve flies out of the card (700 ms) and turns 180°
  (850 ms). Its back is the same sharp cover: nothing is blurred before the album opens.
- At 620 ms the right page swings out from behind the left one on the hinge (rotateY 90° → 0,
  440 ms, a light spring; only its last 90° can be seen) while the spread slides to the
  middle and the light on the page comes up. The bands, the notes, the poster and the rows
  rise with it (rows 24 ms apart). About 1.1 s from the click to rest.
- **Closing**: the text goes (160 ms), the page swings back (260 ms), then the sleeve turns
  and flies home (480 ms) while the scrim fades.
- **Another album** («Ещё у артиста»): the spread stays open. The cover travels from its
  thumbnail onto the left page (a canvas of the large cover, preloaded under the pointer,
  560 ms); the text gives way; the right page's colour crossfades (700 ms); the new text
  rises. Closing after it flies to that album's card if the page has one, else shrinks away.

## Layout

Two square pages of side L = min(0.94 × (height − mini player − 48), (width − 240) / 2, 720;
900 from 1300 px of height), in the middle of the room above the mini player.

- **Left page**: the cover, sharp. Under the liner notes (top: producers as links, the
  label, «Ещё у артиста» as a cover stack whose width is reserved, so spreading never
  reflows) and the poster (bottom: the title 700, the artist as a link with the sliding
  chevron, the facts in mono, «Слушать» as a light pill, the plays and the last listen) lie
  bands of the server's backdrop of the cover, masked to follow the text's height and
  darkened towards the edges.
- **Right page**: the colour field (the backdrop drawn into a 36 px canvas and stretched),
  «Треки» with the count and the length, the list. Rows: number (a play glyph under the
  pointer, EQ bars when it plays), title with feats, огонёк on the most played track, time,
  «Играть следующим» at the end.
- **Phone** (≤ 768 px): one full-screen page, the poster above the list, the same opening.

## The queue

«Играть следующим» puts the track after the current one and after what was picked this way
before (`player.enqueue`; picks play in the order picked). The title flies in an arc into the
mini player's next button, which bumps; «Далее» pops above it for 2.6 s. The row keeps its
place in the queue as a number; a second click takes it out. The mini player stands above
the scrim while an album is open.

## Readability

Text on both pages: #f6f6f9, secondary 88 %, labels and numbers 76 %, a soft shadow.
Checked against the brightest 3 % behind each text on 12 covers, white ones included: main
text ≥ 8.4 : 1, secondary ≥ 5.5 : 1 (`design/code/color-and-backdrop.md` asks 7 and 4.5).
