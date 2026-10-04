# Layout

- **Spacing** is a 4-px grid: 4 / 8 / 12 / 16 / 24 / 32 (`--mx-space-*`, `MusixSpace`).
- **Desktop** (the surface is wider than 780 px): one grid for the whole surface, no
  wrappers around columns. The nav island stands on the left, centred vertically.
- **Phone** (780 px and narrower, and the APK): **one screen without scrolling.** The
  largest element (in the player, the cover) is the one that shrinks on short screens.
  Secondary content opens in sheets from peek rows at the bottom.
- **Windows** (desktop): on the right, 380 px, 16 px from the edges, one at a time.
  **Sheets** (phone): from the bottom, 8 px from the edges, at most 74 % of the height.
- The breakpoint is measured on the surface (a container query), not on the viewport.

The player's own grid is in `screens/player.md`.
