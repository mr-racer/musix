# v2 · Phase 0 — Foundation

**Date:** 2026-09-29 · **Program:** `2026-09-29-musix-v2-program-design.md` (§6, phase 0)
**Status:** draft for the owner's review
**Goal:** everything the rewrite stands on, built before any v2 feature:

- the repository layout;
- the dev environment;
- a reproducible snapshot of prod;
- the **quality gates** that prove v2 is not worse than v1;
- performance baselines of v1;
- the design tokens that let three clients look like today's MusiX.

**Exit criteria** (all on the latest prod snapshot):

1. `make gates` runs end to end against **v1** and writes a baseline report (§4).
2. `make bench` records the v1 performance baselines (§5).
3. `design/` holds the tokens and component specs, and generates CSS, Compose and XAML
   from one source (§6).
4. `compose.dev.yml` brings up an empty v2 skeleton (health endpoints only) next to v1.
   Nothing touches v1 prod.

---

## 1. Repository layout (monorepo)

```
server/                  v2 backend — Python package `musix`
  pyproject.toml         uv-managed; ruff + mypy --strict + pytest
  src/musix/
    api/                 FastAPI app, routers per bounded context, deps
    contexts/            one package per bounded context (identity, library, media,
                         playback, taste, playlists, sync, realtime, knowledge,
                         search, stream, assistant, quiz, imports, admin)
    infra/               db (SQLAlchemy 2 async + asyncpg), qdrant, queue, ml client,
                         storage, signing, telemetry
    workers/             queue task entry points
  migrations/            Alembic
  tests/                 unit · integration (testcontainers) · contract
clients/
  android/               Kotlin + Compose (phase 4; the Media3 core moves here)
  windows/               C# + WinUI 3 (phase 7)
  web/                   TypeScript + React (phase 5)
contracts/
  openapi.json           GENERATED from server, committed; the diff is reviewed in PRs
  codegen/               generator configs for Kotlin, C#, TypeScript
design/
  tokens/*.json          W3C Design Tokens (DTCG) format
  components/*.md        anatomy, states, measurements, golden screenshots
  gen/                   token → CSS vars / Compose theme / XAML ResourceDictionary
deploy/
  compose.dev.yml        postgres, qdrant, nginx, api, worker, ml (+ v1 untouched)
  compose.prod.yml       phase 6
  nginx/                 media signing, caching, rate limits
tools/
  snapshot/              prod snapshot + restore (§3)
  gates/                 quality gates (§4)
  bench/                 performance baselines and budgets (§5)
  e2e-v1/                the 2026-09-29 Playwright suite, moved in from its staging copy
                         at /mnt/data/musix-v2-staging/e2e-v1/ (README there)
```

Rules:

- **v1 stays where it is** (`app/`, `frontend/`) and is **not edited** (the prod freeze).
  It is deleted in phase 6.
- **Nothing in `server/` imports from `app/`.** Pure algorithms that are proven (the stream
  signal math, artist split, text normalize, lyric sanitizer) are **copied with their
  tests** into their v2 context, then owned there.
- `docs/` stays gitignored except `docs/superpowers/specs/` (`git add -f`, specs only).

## 2. Dev environment

`deploy/compose.dev.yml`:

- **Postgres 18**, which has a native `uuidv7()`, with `pg_trgm` and `unaccent`;
- **Qdrant**, the same version as prod, on its own volume, not prod's;
- **nginx** with the media-signing config (phase 1 fills it in);
- `api`, `worker` and `ml`, each one image with a different `command`. `ml` falls back to
  the CPU when no GPU is requested, so the stack runs on a laptop.

Ports sit in `18xxx`, never clashing with v1 (`8000`, `6333`).

- `make dev` brings up the stack.
- `make snapshot-restore SNAP=<date>` loads a snapshot into the dev Postgres/Qdrant, once
  phase 3's migrator exists; until then it loads the gates' fixtures.
- **GitHub Actions** runs ruff, mypy, unit and contract tests. **Gates and benches run
  locally** on the home box (`make gates`, `make bench`), because they need the GPU and the
  snapshot, which must not leave the machine.

## 3. Prod snapshot

`tools/snapshot/take.py` produces `/mnt/data/musix-snapshots/<YYYY-MM-DD>/`:

| Part | How | Size today |
|---|---|---|
| SQLite | `sqlite3.backup()` online copy (WAL-safe), read-only against prod | 146 MB |
| Qdrant | the snapshot API per collection (`acct_*`, `facts`) | ~0.5 GB |
| Filesystem manifest | path, size, mtime and **sha256** of every media file and cover. Hashes computed once and cached by (path, size, mtime) | 7282 files / 237 GB read ≈ 25 min the first time |
| Derived-media manifest | `cache/transcoded` (19 GB), `frontend/covers` (619 MB) | manifest only |

- Media is **referenced, not copied**: v2 dev reads the originals read-only through the same
  `/music` + `media/` mounts.
- The snapshot is the single input of the gates, the benches and the phase 3 migrator.
- It never leaves the home server, and `snapshots/` is gitignored.

## 4. Quality gates

One command, one report (`tools/gates/report/<date>-<target>.md` plus JSON), and two targets:
`--target v1` (drives v1 code in-process against the snapshot) and `--target v2` (HTTP against
the dev stack). The same fixtures and the same metrics are used, so the numbers are comparable.

### 4.1 Lyric-line search

Fixture: **300 tracks** sampled from the snapshot's libraries, stratified by language (ru/en)
and genre. For each, 4 queries derived from its stored lyrics:

- **exact:** a random 8–12-word line;
- **partial:** 4–6 words from the middle of a line;
- **noisy:** the exact line with 1–2 typos and dropped punctuation;
- **translit:** a Russian line typed in Latin.

Metrics per query kind: **recall@1, recall@10, MRR**. Gate: v2 ≥ v1 − 0.01 on every kind.

### 4.2 Sound search (CLAP text → audio)

There is no ground truth for "sounds like". The gate measures **consistency**:

- **80 prompts** built from the library's own `sonic_tags` and genres ("calm acoustic
  guitar", "aggressive drum and bass").
- Metrics: **precision@10 of the matching tag or genre** and **overlap@10 with v1's result
  lists** (Jaccard).
- Gate: precision ≥ v1 − 0.02, overlap ≥ 0.8, since the vectors are migrated rather than
  recomputed (phase 3).

### 4.3 Catalog search (title / artist / album)

Fixture: **300 queries** of the kinds exact, prefix, typo, feat-stripped, Cyrillic↔Latin
(«канье» → Kanye West) and album name.

- Metric: recall@1, recall@5.
- Gate: v2 ≥ v1. This search moves from a Python BM25F to Postgres FTS + trigram (phase 2),
  so this gate is the one that actually tests a new implementation.

### 4.4 «Поток» — `tools/recsys-eval`

The harness from the stream spec (`2026-09-29-v2-stream-product-design.md` §2 and §10),
rebuilt properly from the throwaway spike in `/mnt/data/musix-v2-staging/recsys-spike/`.

- **Input:** the snapshot's `playback_events` + `taste_signals`, replayed in time order with
  a frozen clock per event. Features see only what was known before each play.
- **Suites:**
  - **E1 ranking:** session-grouped AUC of completed vs skipped plays, over rolling time
    folds, with a session-bootstrap CI;
  - **E2 retrieval:** recall of the merged candidate set, for self-chosen and never-played
    targets;
  - **E3 sound:** the owner's 150 blind labels (`mood_labels`, exported from the labelling
    page), AUC calm ↔ energetic;
  - **E4 simulation:** policies serve 30-track sessions from real session starts against a
    response model; list metrics (top genre, genres and artists per 10, preset share
    accuracy, same-day repeats).
- **Hard invariants,** zero tolerance:
  1. no track issued twice in a day;
  2. a «вода»-locked track is never served;
  3. never a track outside the listener's own library;
  4. the preset share over any 12-track window = target ± 1 track while the pool has
     candidates.
- **Baseline:** the logged v1 sessions measured by the same suites. v1's engine is not
  ported, so the comparison is against what v1 actually served.
- **Gates:** the table in the stream spec §10.

### 4.5 Facts, bios, assistant routing

These evaluate the existing prompts and pipelines. Their numbers are the baseline v2
inherits, not something the port may move.

- `scripts/eval_facts_prompts.py` on `tests/data/facts_gold.json` (55 labelled facts):
  отбраковка / сохранность / класс.
- `scripts/eval_bio_prompt.py` on `tests/data/bio_passages.json` (10 artists).
- `tests/docker/test_assistant_routing.py` fixtures: routing accuracy (LLM and
  GLiNER-only rungs).

### 4.6 Migration gate (scaffold now, filled in phase 3)

The report format, plus the per-entity count and checksum harness. Phase 3 adds the mappings.

## 5. Performance baselines of v1 (`make bench`)

Measured against a **copy** of v1 running on the snapshot, never against prod.

| Measure | How |
|---|---|
| Endpoint latency p50/p95/p99 for the 25 most used v1 endpoints | `tools/bench/http.py`: an async load at 1 / 5 / 20 concurrent users, 5 min each, with request mixes replayed from real prod access patterns |
| Home screen: request count and bytes to first render | Playwright with the HAR recorder at phone size |
| Stream start (tap → first audio) | Playwright `audio.playing` timestamp: FLAC over LAN and under an LTE profile (Chrome network emulation: 12 Mbit/s, 70 ms RTT) |
| Web cold start (JS parse + first render) | Lighthouse / Playwright tracing |
| Android (MusiX 1.0.0) | cold start and frame timing on the owner's Pixel via `adb shell am start -W` and `dumpsys gfxinfo`, when the phone is on the LAN; otherwise deferred to phase 4 |
| Process footprint | RSS/VRAM of `musix` under the load run |

The report fixes the **v1 numbers**. The program's budgets (§5 there) become the v2 targets
in the phase 1 spec.

## 6. Design tokens and component specs — "the design must not suffer"

Source of truth today: `frontend/packages/musix-ui` (`useColors` dark/light palettes, 25
components with docs), `frontend/src/index.css` (the `.ske-*`, `.brushed-*`, `.ob-*` classes)
and the inline styles in `main.jsx`.

1. **Tokens (`design/tokens/`, DTCG JSON):**
   - color (both themes, including the cover-derived accent rules the player uses);
   - typography (Geist, Noto Sans, Playfair Display, JetBrains Mono, Noto Serif Display:
     sizes, weights, tracking);
   - spacing, radius, elevation/glass (blur, saturation, border alpha);
   - motion (durations and easing curves: the vinyl transition 320 + 600 ms, the toast
     220 ms, …).
   - Extraction is scripted where possible (parse `useColors`, the CSS custom properties),
     reviewed by hand where not.
2. **Generators (`design/gen/`):**
   - `tokens.css` (CSS custom properties) for web;
   - `MusixTheme.kt` (a Compose `CompositionLocal` theme, not Material defaults) for Android;
   - `MusixTheme.xaml` (a `ResourceDictionary`) for Windows.
   - CI fails if a generated file differs from the tokens.
3. **Component specs (`design/components/<Name>.md`):** one per musix-ui component plus the
   composite surfaces that carry the identity:
   - the player (cover, vinyl transition, spectrum/ambient, огонёк/вода combustion, facts
     rail, producer/sample badges, queue);
   - home (For-You hero, the wave orb, вайбики);
   - library (album grid, stats tabs);
   - artist atlas;
   - quiz;
   - login/onboarding.

   Each spec holds anatomy, states, measurements and behaviour notes.
4. **Golden screenshots:** Playwright captures every surface at **phone (412×915)** and
   **desktop (1440×900)**, in both themes, from v1 on the snapshot, into
   `design/golden/`. The phase 4/5/7 clients are reviewed against these. A pixel match is
   not the bar; "reads as the same app" is.

## 7. What v1 does that v2 must not — phase 0's share

| v1 | v2 foundation |
|---|---|
| Quality judged by using the app | The gates (§4) run before and after every phase |
| The Playwright suite in a scratchpad | `tools/e2e-v1/`, versioned |
| The design lives in inline styles of one 23k-line file | Tokens + specs + generators, one source for three clients |
| Tests hit prod data by hand | Snapshots, restored into an isolated stack |

## 8. Work breakdown

1. Repository layout, `pyproject` (uv), ruff/mypy/pytest config, pre-commit, the GitHub Actions workflow.
2. `compose.dev.yml` + an empty `api`/`worker`/`ml` skeleton with `/health`, and a Postgres + Qdrant bring-up.
3. `tools/snapshot` (take + manifest + hashing cache) + restore of the gate fixtures.
4. Gates: fixture builders (4.1–4.4), the v1 in-process driver, the report writer. Then the
   facts/bio/routing wrappers (4.5).
5. Benches (§5) against a v1 copy on the snapshot.
6. Design: token extraction, the three generators, component specs, golden screenshots.
7. The baseline report committed: `docs/superpowers/specs/…-v2-baseline-report.md`, with
   numbers and no raw data.

## 9. Risks

- **The v1 in-process driver drags v1's import cost into the gates.** It runs in its own
  venv/container. v1's own test stubs show what can be imported without the GPU.
- **Self-retrieval fixtures flatter lyric search.** The partial, noisy and translit kinds
  exist for exactly that. Real user queries are added from the assistant's lyrics-branch
  logs where available.
- **Token extraction from inline styles misses values.** The golden screenshots catch what
  the tokens miss.
