# The home — the mock

Stage 1 of the web redesign (`design/code/roadmap.md`). **Not approved yet:** three variants,
shown to the owner on 2026-10-05; his reaction decides which one is taken further.

Live: https://claude.ai/artifact/JuAU1yCKktTQ77Sa65kxPQ (private)

| Variant | The idea |
|---|---|
| А · Как в v1 | v1's home, its composition untouched, brought to the design code |
| Б · Афиша | the player's language: the taste as a cover (a mosaic of the anchors), the vibe phrase as the title, credits and a plate under it |
| В · Полки | a launch pad: more of the library on the first screen, as shelves, without panels |

All three stand in the same frame: the nav island with its new sections (Главная, Плеер,
Библиотека, ИИ, Игра), the mini player as the player's own bottom line, and quick search
(the library at once, no AI; its last row hands the words to the assistant).

Build it: `python bake.py HOME.json DISCOVERIES.json COVERS_DIR data.json`, then
`python build.py data.json out.html`. The data (album art, listening) is not committed.
The page has switches for the variant and for the screen size (14″, 16″, 32″, the window).
