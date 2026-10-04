# Player «Кино» — the approved probe (reference for the port)

The owner approved this design on 2026-10-04 after six iterations. The live page is the
private artifact https://claude.ai/artifact/SiF7jcX1wM6E4UxrpEjASt (version 6). The player
is ported **as it is there**; take ready CSS, markup and behaviour from these files where
they fit. Spec: `docs/superpowers/specs/2026-10-04-design-refresh-player-design.md`.

| File | What it is |
|---|---|
| `styles.css` | All styles. The approved look is the rules under `data-dir="k3"` plus the phone block (`@container stage (max-width:780px)`). Rules without `data-dir` are the earlier «Эфир» layout the page grew from: the shared components (cover, rows, windows, links, sample chips) live there too. |
| `markup.html` | The page markup: the stage, the windows (assistant, queue), the phone sheets and peeks. |
| `logic.js` | Behaviour: track change (vinyl), shared-element flight of a cover, flip, tilt, windows and sheets, the spectrum canvas, credits with links and samples. |
| `bake_assets.py` | Bakes `covers.json` from local cover files. Holds the backdrop recipe (blur, saturation, tamed highlights). |
| `build.py` | Assembles `player-kino.html` for a local look. |

## What is a stand-in in the probe

- **Icons:** Material Symbols from Google Fonts. The app keeps its own icon set (`web/src/ui/icons.tsx`, `MusixIcons`).
- **Spectrum:** simulated bands (`specStep`). The app feeds the same curve from the server's envelope.
- **Producers, samples, facts:** written by hand. The app reads `/tracks/{id}/knowledge`.
- **Lyrics on the back of the cover:** placeholder lines.
- **Links:** show a toast. The app navigates.
- **Covers and backdrops:** baked data URIs. The app uses image variants from the server.

## Rebuild locally

```bash
python bake_assets.py sia=… lorde=… tame=… lana=… kanye=… daft=…   # six cover files
python build.py && xdg-open player-kino.html
```
