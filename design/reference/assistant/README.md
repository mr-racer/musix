# Assistant page — the mock

Stage 5 of the web redesign (`design/code/roadmap.md`). The owner's brief: `design/code/preferences.md`
(2026-10-23). Live: https://claude.ai/artifact/MgnE4xLcdBZtur4M7uZPku

Data: the frozen v1 snapshot `/mnt/data/musix-snapshots/2026-10-01/metadata.db` (read-only) + v1's
image tree, for the listening account; six real turns run on the prod assistant 2026-10-23 (the
runner is a throwaway script: create `assistant_turns` rows for the member account, defer
`assistant:turn`, poll, dump JSON). Build:
`python bake.py OUT [turns.json] && python build.py OUT` (working copy `/mnt/data/.cache/musix-assistant-mock/out`).

- `orb.js` — the WebGL orb: «Хрусталь» (uMat 0) and «Лампа» (uMat 1); the page paints the room behind
  the ball into a 2D canvas every frame and the shader refracts it.
- `logic.js` — layout, the orbit, the room, the sky; `flow.js` — the turn (server stage words,
  timings), the five answers, the carousel, stickers; `boot.js` — the frame loop, events, the switcher;
  `edit_block.js` — example texts the server does not write yet.

Lesson: never leave a finished `fill: "forwards"` animation on an element whose inline style is
driven later — Chrome kept it in effect after `getAnimations()` stopped listing it (echo stuck at
translateX(-50%), chips stuck at opacity 0). Set the final inline style first, animate with
`fill: "backwards"`. Headless Chrome with the Vulkan flags has no WebGL here: shoot WebGL with
`--use-angle=swiftshader --enable-unsafe-swiftshader`.
