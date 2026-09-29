# Surface: Artist atlas

v1 source: `ArtistAtlasSection` (l. 19661), `AtlasHero` (l. 18662).
Golden: `design/golden/*/artist-*`.

**Anatomy.**
- The hero: the artist cutout on its field, a photo blurred by contour, and the name in
  `font.serifDisplay` (Noto Serif Display, italic).
- Facts grouped by class.
- The bio.
- The discography: albums and tracks from the listener's own library only.

**States:**
- no cutout (photo fallback);
- no bio yet;
- a track of this artist is playing (`playingHere`).
