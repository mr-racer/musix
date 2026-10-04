# v2 · Design refresh — the design code and the player «Кино»

**Date:** 2026-10-04 · **Status:** approved by the owner 2026-10-04 (decisions in §10)
**Goal:** standardize v2's design code for the web and the APK and polish the UX without a
global redo. v1's signature moves stay. The player gets the «Кино» design the owner approved
in the probe; every other screen follows the same language, one approved mock at a time.

**Exit criteria.**

- The design code (§3) is in the repo and the tokens regenerate from it.
- The web player matches the probe at 1280×900 and at phone width, signed off by the owner.
- The Android player matches the probe's phone layout, signed off by the owner.
- Every feature of today's players (§4.3) still works, and the budgets in §8 are met.

---

## 1. What the owner decided (2026-10-04)

1. **«Кино 3» is the player.** Big cover on the left, the song's text column to its right,
   the seek line and the controls at the bottom.
2. **An open, spatial layout.** Content lies on the background, like v1's home and player.
   No panels around columns ("не хочется блоковость развивать").
3. **Glass only in key places.** The nav island and the pause icon on the cover. Windows
   and sheets are solid.
4. **Efficiency is a requirement, also on desktop.** The first probe heated his computer.
   No beat-synced flashing of the background; the cursor glare is barely visible.
5. **The wave is back, above the seek line, and it shows the spectrum (АЧХ).** No wave on
   mobile at all.
6. **Text stays readable over light covers** without ruining the look.
7. **Facts and the vibe line are set in Noto Sans.** No serif there ("без лютого пафоса").
8. **Artist, album and producers look like links** and lead to their pages.
9. **Samples are shown both ways** (what the song samples, who sampled it) and play at once
   when the track is in the library. Song authors are dropped; producers stay ("общий
   продюсер — это часто схожий звук").
10. **Facts sit in a compact plate**, set apart from ordinary text, and must not overload
    the screen. The song title starts exactly at the cover's top edge.
11. **Mobile: one screen without scrolling.** New functionality goes into sheets. Previous
    and next sit on the cover's edges, as in v1.
12. **The огонёк / вода cover effect exists on every client.** v2 web lacks it today.
13. **The assistant is not on screen all the time.** It opens in its own window with
    question templates, like v1's chat window by the player.
14. **Process:** the player is ported exactly as in the probe; a shared set of design-code
    files is written; **every other global screen gets a preliminary mock in this style
    before it is implemented.**

## 2. The reference and the porting rule

- **Live probe:** https://claude.ai/artifact/SiF7jcX1wM6E4UxrpEjASt (version 6, private).
- **Its sources:** `design/reference/player-kino/` (`styles.css`, `markup.html`, `logic.js`,
  `bake_assets.py`; the README there says which rules are the approved look).

**Rule:** the player is ported as it is in the probe. Take the ready CSS, markup structure
and behaviour from the reference where they fit the client's stack; don't redesign on the
way. Where the probe uses a stand-in, the app uses the real thing:

| Probe | App |
|---|---|
| Material Symbols icons | the project's own icon set (`web/src/ui/icons.tsx`, `MusixIcons`) |
| simulated spectrum | the server's envelope (§6.2) |
| hand-written producers, samples, facts | `GET /tracks/{id}/knowledge` |
| placeholder lyrics on the cover's back | the real lyrics, as today |
| a toast on a link | navigation |
| baked covers and backdrops | image variants from the server (§6.1) |

## 3. Block A — the design code

A shared set of instruction files, read before any UI work on any client. They record the
rules of §1 once, so screens stop inventing their own.

```
design/code/
  README.md                 how to use the set, what wins on a conflict, the file list
  principles.md             open space, one accent from the cover, when a plate is allowed
  typography.md             families, the type scale, labels, the link style
  color-and-backdrop.md     tokens, cover-lit backgrounds, the contrast floor
  surfaces.md               glass (two places), solid windows and sheets, plates
  motion-and-performance.md the signature animations, what may move, the budgets
  layout.md                 the desktop grid, the phone rule (one screen + sheets)
  components.md             link, credits group, sample chip, facts plate, seek line with
                            spectrum, window / sheet, toast, peek row, segmented control
  screens/player.md         the player surface (replaces components/surfaces/player.md)
```

Tokens gain what they lack today (`design/tokens` has colour, motion, shape only):

- **Type scale:** 11 / 13 / 15 / 18 / 24, plus the player title
  `clamp(34px, 5.2cqw, 62px)` (titles over 15 characters: `clamp(28px, 3.9cqw, 46px)`).
- **Families:** Geist for UI and titles; **Noto Sans for reading text** (facts, the vibe
  line in italic, assistant answers); JetBrains Mono for time, counters and badges.
  Playfair and Lora leave the player. Other screens decide at their mock.
- **Spacing:** a 4-px grid, steps 4 / 8 / 12 / 16 / 24 / 32.
- **Surfaces:** `glass` (the v1 island recipe), `float` (solid `#16161c`, hairline, shadow)
  and `plate` (`rgba(255,255,255,.075)`, radius 16).

`design/gen/build.py` regenerates `tokens.css` and `MusixTheme.kt` from them. The v2 branch
has no root `CLAUDE.md`; one is added with a pointer to `design/code/README.md` and to the
mock-first rule (§7), so every later session follows them.

## 4. Block B — the player on the web

### 4.1 Layout (container wider than 780 px)

One grid, no wrappers around columns: nav island · cover (`clamp(300px, 31cqw, 380px)`) ·
text column. The cover and the text column are centred vertically as one group; the seek
line and the controls stay at the bottom.

Text column, top to bottom:

1. **Title.** Its capitals start at the cover's top edge (`text-box: trim-start cap
   alphabetic`, a negative margin where that is unsupported).
2. **Artist** and **album, year** as links (underline, a small chevron).
3. **Vibe line**, Noto Sans italic. In «Поток» the reason line (`✦ …`) follows it.
4. **Credits row:** producers (each a link), genre, «Семплирует», «Её семплировали».
   A sample that is in the library is a chip with the cover and a play mark; the cover flies
   into the player when it is pressed. One that is not is a dashed chip.
5. **Facts plate:** one control row (Песня / Артист, the category, «Спросить», the pager)
   and the text, clamped to three lines, opening on click. The "из открытых источников"
   mark of an unconfirmed fact stays, in the control row.

Bottom: the seek line with the spectrum right above it; controls on the left (previous,
next, огонёк, вода, shuffle) and on the right (lyrics, add to playlist, devices, volume,
the Lossless badge); at the far right «Далее» with the next track, which opens the queue.

### 4.2 Background and readability

- The backdrop is the server's pre-blurred variant (§6.1) stretched over the stage. No CSS
  blur, no blend modes. A track change cross-fades two static layers in 900 ms.
- Above it: a faint tint from the palette pair, grain at 6 %, two shade gradients.
- Text over the picture carries `text-shadow: 0 1px 14px rgba(8,8,11,.4)`.
- **Contrast floor:** main text is at least 7:1 against the brightest 3 % behind the text
  column. The probe's recipe gives 7.0–9.1 on six covers (it was 2.1–6.4 before).

### 4.3 Everything today's player does keeps a place

| Today (`web/src/routes/_app/player.tsx`) | In «Кино» |
|---|---|
| click the cover to pause, glass pause icon, tilt, flip to lyrics, vinyl swap | unchanged; the glare drops to 12 % |
| previous / next beside the cover | in the control row (on the cover's edges at phone width) |
| artist link, album · year | both are links |
| vibe line with wings, reason in «Поток» | vibe without wings; the reason under it |
| `Wave` in the scrubber | a plain seek line; the spectrum above it |
| огонёк, вода (with the lock) | same buttons, **plus v1's `CoverCombustion` effect**, ported |
| add to playlist, `DevicePicker`, `Volume` | right control group |
| `ElsewhereBar` (playing on another device) | a line under the control row |
| Lossless mark with the codec tooltip | the Lossless badge, same tooltip |
| tabs Песня / Артист, facts with labels and pager | the facts plate |
| credit chips (producer, sample, sampled by) | the credits row: links and sample chips |
| queue in the right column (drag, remove) | the queue window, opened from «Далее» |
| error line, buffering state, the idle screen | unchanged |
| — | the assistant window (§4.4), new on the web player |

### 4.4 Windows

The assistant and the queue open as solid windows on the right (380 px), one at a time; a
click outside or Esc closes them. «Спросить» in the facts plate opens the assistant; «Далее»
opens the queue. The assistant window has the question templates, the
input, the streamed answer and suggested tracks; it reuses the assistant's own message
rendering, so the player and the assistant page show one surface.

### 4.5 Motion

Kept: pause on the cover, flip, tilt, the vinyl swap, the EQ bars of the current queue row,
the rise of the text on a track change. New: the shared-element flight of a cover from the
queue or a sample chip (the clone sits at the cover's final size and starts scaled onto the
thumbnail, so the corners never round on the way). Restored: the огонёк / вода combustion.

## 5. Block C — the player on Android (and the web at phone width)

One screen, **no scrolling**; the cover is the element that shrinks on short screens.

- Top bar: collapse on the left; the Lossless badge in the middle; add to playlist and the
  overflow menu on the right («Слушать на…» is in the menu).
- Cover, with previous / next on its edges. No wave anywhere (the scrubber becomes a plain
  line; today it draws the envelope).
- Title, artist and album as links, the vibe line, the reason line in «Поток».
- Seek line; controls: огонёк, вода, shuffle on the left, lyrics and the assistant on the
  right.
- Two peek rows at the bottom: **«О песне»** (opens a sheet with the facts plate, the
  credits and the samples) and **«Далее»** (opens the queue sheet, today's `QueueDrawer`).
- The assistant opens as a sheet with templates and replaces the inline `TrackChat`.
- Sheets are solid. Glass stays on the pause icon. The combustion effect is already ported.

## 6. Block D — server and data

1. **Backdrop variant.** `media/images.py` gains a `bg` WebP: 192 px, Gaussian blur 4.6 px,
   saturation ×1.4, then highlights tamed (luma above 0.30 grows 0.18× as fast, hue kept).
   The recipe is executable in `design/reference/player-kino/bake_assets.py`.
   `media:regen_images` backfills it. Clients stretch it and blur nothing.
2. **Spectrum data.** The envelope today is 4 bands at 10 fps up to 6 kHz: too coarse for a
   frequency curve. A second version carries **16 log-spaced bands, 40 Hz – 12 kHz, 10 fps**
   (decoded at 24 kHz instead of 12; measured on real tracks: 33–52 KB per track compressed
   and about 0.5 s of work, so roughly 0.3 GB for the whole library); clients ease between
   frames at up to 30 fps. The
   4-band endpoint stays for installed apps. Live analysis on the client stays rejected,
   for the reasons of the phase 4 spec (§4).
3. **Relations** (producers, samples, sampled by, with `trackId` and `artistId`) are already
   in `GET /tracks/{id}/knowledge`. **Genre** is not in the track context yet; it is added
   from the track's tags.
4. **Producer page.** A producer who is an artist in the library links to the artist page.
   Otherwise the link opens a list of the library's tracks with that producer: a small new
   endpoint and a small new screen, which gets its own mock first (§7).

## 7. Block E — every other screen: mock first

Before any global screen is implemented, the owner sees a preliminary mock (an artifact) in
this style and says yes. The screens: home, assistant and search, library, artist, album,
playlist, quiz, settings, login and onboarding, import and upload, the producer list.
Proposed order: home → assistant and search → library → artist and album → the rest.
Each approved mock is saved under `design/reference/<screen>/` like the player's.

## 8. Budgets and checks

- **At rest (playing):** nothing repaints per frame except the spectrum canvas (≤ 30 fps,
  one small canvas). The script wakes 4 times a second for the clock and the seek line.
- **Paused, hidden or off screen:** nothing animates.
- **The headless check** (Chrome, software GL, 1280×900, 8 s): at most 10 % of one core
  playing, 0 % paused. The probe measures 8 % and 0 %; the first probe measured 120–228 %.
- **No layout shift** when a fact is paged or a window opens.
- **Android:** the phase 4 frame budgets hold; the screen fits 360×740 dp without scrolling.

## 9. Work breakdown

| Block | What | Subtleties | Done when |
|---|---|---|---|
| A | The design code files, the new tokens, the root `CLAUDE.md` | The files state rules, not history. `components/surfaces/player.md` is replaced, not kept beside. | The set is in the repo; `design/gen` output is regenerated and both clients build. |
| D | Backdrop variant, envelope v2, genre, the producer tracks endpoint | Backfills run on prod: they need the owner's go and free disk. A changed response shape bumps `etag.REV`. | The contract tests pass; the backfills have finished. |
| B | The web player | Reuse the reference CSS; keep the project's icons; every row of §4.3 works. | Side by side with the probe at 1280×900 and 400×860, signed off; §8 budgets met. |
| C | The Android player | The cover shrinks, nothing scrolls; sheets replace the inline chat. | Emulator shots against the probe's phone layout, signed off. |
| E | The other screens | One mock, one yes, one port at a time. | Each screen's mock is approved before its code starts. |

Order: A → D and B together → C → E.

## 10. Decisions (the owner, 2026-10-04)

1. **Placements the probe does not show.** Web: add to playlist, devices and volume in the
   right control group. Phone: **Lossless stays in sight** (the top bar), add to playlist in
   the top bar, «Слушать на…» is tucked into the overflow menu.
2. **Spectrum data:** the envelope is recomputed in 16 bands over the whole library, so the
   curve is smooth.
3. **The producer page** is a small new screen with its own mock first.
4. **The light theme:** the player stays a dark, cover-lit surface in both app themes until
   a light mock is approved.
5. **Order:** the web first, then Android.
6. **How it is built:** straight from this spec, without TDD and without a separate plan
   document. The rest of the design is redone later, on the owner's word.

## 11. Out of scope

The Windows client. The recommendation engine. Implementing any other screen before its
mock is approved. A light-theme player (see §10.4).
