# MusiX v2 — the rewrite program

**Date:** 2026-09-29
**Status:** program approved by the owner. Each phase gets its own spec + plan before any code.
All phase specs were written 2026-09-29 and await the owner's review:
[phase 0](2026-09-29-v2-phase0-foundation-design.md) ·
[1](2026-09-29-v2-phase1-core-design.md) ·
[2](2026-09-29-v2-phase2-intelligence-design.md) ·
[3](2026-09-29-v2-phase3-data-migration-design.md) ·
[4](2026-09-29-v2-phase4-android-design.md) ·
[5](2026-09-29-v2-phase5-web-design.md) ·
[6](2026-09-29-v2-phase6-cutover-design.md) ·
[7](2026-09-29-v2-phase7-windows-design.md) ·
[8](2026-09-29-v2-phase8-ecosystem-design.md) ·
[«Поток» engine and product](2026-09-29-v2-stream-product-design.md)
**Branch:** `feature/musix-v2` (from `genius-addition`, the prod branch)
**Scope:** everything — backend, data stores, media delivery, Android, Windows, web.
This document fixes the goals, the decisions and the order of work; it does not
design any single phase in detail.

---

## 1. Why

MusiX works, and the product ideas (the «Поток» wave, огонёк/вода, facts, sound and
lyric search, the guru assistant) are the differentiator. What holds it back is
the build, not the ideas:

- the web UI is one 23k-line file shipped as one bundle;
- the backend is one process that serves HTTP, runs the GPU models and computes
  recommendations, and stalls everyone when any of it is slow;
- audio goes out untranscoded over a home uplink;
- the Android app is a WebView around that same web UI. Only its audio is native
  (2026-09-29).

The goal is an app on the level of Yandex Music / Spotify — Android first, then a
native Windows client — on a backend built for it.

## 2. Goals (the owner's answers, 2026-09-29)

| Question | Answer |
|---|---|
| Audience | A **self-hosted product**. The owner's own instance runs as a service for friends. |
| Scale of the owner's instance | **≤ 20 users** in a year, on **one home server** (GPU + music disks) behind the VPS proxy. |
| Client platforms | **Android** first, then **Windows**. No iOS, macOS or Linux for now. |
| «Quality like Yandex/Spotify» means | **Smooth, fast UI**; **stream quality vs data** (quality tiers); the **ecosystem** (Android Auto, widgets, the watch incl. the queue, handing playback between devices). Offline downloads were not asked for. |
| Why desktop must not be web | UI speed; **local music** on the PC's disk; a real app (window, installer, updates). |
| Client stack | **Native per platform:** Kotlin + Jetpack Compose on Android, **C# + WinUI 3** on Windows. |
| Web | **Stays:** listening from a computer without the app, plus the admin. |
| Desktop and local files | Play local files directly **and** upload them to the server, where they get recs, facts and sound search. |
| Backend language | **All Python** — ML is Python anyway. The fix is architecture, not language. |
| Data stores | **Postgres + Qdrant.** Postgres is the source of truth and the task queue; Qdrant keeps only vectors and hybrid search. |
| Rewrite strategy | **Clean v2 + one cutover.** The v2 backend exposes only the new API. Android and web are rebuilt on it before the switch. |
| Current prod meanwhile | **Frozen.** No fixes to the old stack; all effort goes to v2. |
| Data | **Migrate everything:** accounts, history, taste, reactions, playlists, facts, library indexes. |
| Stream quality | Tiers: **экономия** (AAC 128), **высокое = AAC 320**, **без потерь** (the original). |
| Design | **Must not suffer:** the native clients reproduce today's look. A redesign may come later, as its own project. |

Non-goals of this program: iOS/macOS/Linux clients, SaaS-scale multi-tenancy (sharding,
billing), offline downloads (it can be added later — the media cache makes it cheap),
a visual redesign.

## 3. Where we start — measured 2026-09-29

**Frontend (web + the WebView in the Android app)**

- `frontend/src/main.jsx` is 23k lines, with 405 `useState` and 176 `useEffect`. Every section
  stays mounted.
- The build is one **877 KB JS chunk** (260 KB gzip) plus 189 KB of CSS, parsed on every cold
  start, with no code splitting.
- There are no frontend tests; the Playwright suite lives in a scratchpad, not in the repo.

**Backend**

- 127 routes. **14 `async` handlers do synchronous SQLite/Qdrant work on the event loop**,
  among them `POST /playback/events` and the reaction endpoints.
- **One uvicorn worker by design**, because the process also holds ~3.6 GB of GPU models,
  CLAP, the recommender and the ffmpeg transcodes. Any slow request delays every
  request, including every listener's audio.
- `metadata_db.py` is 6k lines and 217 methods in one class. The schema "migrates" by
  replaying `CREATE`/`ALTER` and swallowing "duplicate column" errors.
- Track metadata is duplicated between Qdrant payloads and SQLite `track_metadata`.

**Data**

- SQLite is 146 MB in 36 tables: ~60k fact rows, 7.9k songs, 7.3k tracks, 5.6k playback
  events, 2.7k artists.
- Qdrant holds 5 library collections (5961 + 665 + 418 + 188 + 50 points) plus `facts` (1820).

**Media**

- Library FLAC averages **~1980 kbps**. That is ~15 MB per minute on mobile data, sent from
  the home uplink through the SSH tunnel, with no quality choice.
- The ALAC → FLAC transcode cache is 19 GB. The disk under `/mnt/music` is 95% full.
- Audio is sent by Python (`FileResponse`) through the single worker.

**Android (MusiX 1.0.0, 2026-09-29)**

- The native Media3 service already works: notification with огонёк/вода, lock screen,
  background playback, watch controls and artwork, whole-track disk cache.
- The UI is the web bundle in a WebView. The watch's Up Next list is empty
  (spec 2026-09-29-android-native-player-design §11).

## 4. Target architecture

```
                      clients: Android (Compose) · Windows (WinUI 3) · web (TS/React)
                                           │  HTTPS (VPS nginx → reverse SSH tunnel)
┌──────────────────────────────── home server ─────────────────────────────────┐
│ nginx ── /api/v2/* → api          media: X-Accel-Redirect → originals and     │
│   │                                transcode cache, sendfile, Range, no Python │
│   ├── api      FastAPI, N workers, strictly async, NO models in-process        │
│   ├── worker   Postgres-backed task queue: indexing, AI enrichment, facts,     │
│   │            transcoding (incl. ahead of playback), Yandex import            │
│   ├── ml       the ONLY owner of the GPU: text embedder, sparse, reranker,     │
│   │            CLAP — internal HTTP (grown from the 2026-08-28 serving layer)  │
│   ├── Postgres source of truth + migrations (Alembic) + queue + LISTEN/NOTIFY  │
│   └── Qdrant   vectors + hybrid search only (ids and filter fields in payload) │
└───────────────────────────────────────────────────────────────────────────────┘
```

Principles the phase specs must follow:

1. **Nothing slow runs on the request path.**
   - Blocking work goes to a worker or a thread pool.
   - The event loop never waits on SQLite-style synchronous calls.
   - Audio bytes never pass through Python.
2. **One owner per concern.**
   - The GPU belongs to `ml`.
   - Track metadata lives in Postgres, and Qdrant carries only ids plus filter fields.
   - The queue lives in Postgres, so there is no Redis.
   - The playback queue on a device belongs to that device's player (the rule proven in
     the Android spec §3).
3. **The API is a typed contract.**
   - OpenAPI 3.1 is generated from Pydantic v2 models.
   - Kotlin, C# and TypeScript clients are generated from it, and a contract test runs in CI.
   - Versioned under `/api/v2`, with cursor pagination and ETags.
4. **Clients open instantly.**
   - `/sync` returns deltas of library, playlists and reactions since a cursor.
   - Clients keep a local store (Room on Android, SQLite on Windows, IndexedDB on the web)
     and render from it first.
5. **Real time is one channel:** a WebSocket for job progress, device presence, and
   playback handoff between devices («продолжить на другом устройстве»).
6. **Auth is per device.**
   - Short access tokens plus refresh tokens, with a device list and revocation.
   - Media URLs are signed and short-lived, and nginx verifies them.
7. **Measurable.** Every request carries its timing, the server exposes `/metrics`, and logs
   are structured.

### 4.0 What v1 does that v2 must not (owner, 2026-09-29: "no inefficient solutions carried over — do it the way big-tech production does")

Every phase spec carries its own version of this table and must not reintroduce a row.

| v1 pattern (measured / read in code) | Why it is inefficient | v2 replacement |
|---|---|---|
| «Поток» is **stateless**: every `/stream/next` rebuilds the baseline, session profile and pools from all events + Qdrant | The work per request grows with history; latency and load grow with it | Incremental per-listener state: aggregates updated on each event, session state kept, profile/regions/co-listen recomputed off the request path. Online = candidate sources + ranker + policy |
| «Поток» **scores by hand-tuned CLAP similarity** to the session | Measured on the prod snapshot: it ranks completed vs skipped tracks at chance (GAUC 0.49); a learned ranker over behaviour features gets 0.74 | Candidate sources → LightGBM ranker (nightly, versioned) → policy (presets, diversity, fatigue, served-today) → reason; decisions logged for training and A/B (stream spec) |
| **Whole-collection scrolls** (`light_points` 90 s cache, `library_catalog` memo, BM25F built in Python) | O(library) per cache miss, duplicated in every process | Indexed Postgres queries (FTS + trigram) and ANN with filters; no whole-library caches in processes |
| **Heavy Qdrant payloads**: lyrics, `clap_chunks` (per-chunk vectors), full metadata | Payload transfer dominates reads; metadata duplicated with SQLite | Payload = ids + filter fields. CLAP chunks = a Qdrant **multivector**. Text and metadata live in Postgres only |
| **Per-account indexing**: the same file in two libraries is embedded twice, in two collections | GPU time and storage scale with accounts, not with content | Content-addressed media (sha256); embeddings and derived audio **once per file**; libraries reference them |
| **On-the-fly transcoding** in the request (ALAC→FLAC, Dolby→AAC), cached lazily | First play waits; Python holds the connection | Tiers encoded **at ingest** by workers (big-tech pre-encoding); requests only pick a ready file |
| **Python serves audio bytes** (`FileResponse` via the single worker) | Streaming competes with API work | nginx `sendfile` with **signed media URLs** (expiring HMAC); Python only issues the URL |
| **Stream tokens in `?st=` + 30-day HS256 login JWT** | Long-lived bearer in URLs and logs | Short access tokens + rotating refresh tokens per device; media URLs signed per file with expiry |
| **Polling**: LLM status every 60 s per client, job progress every 2–3 s | Load grows with open clients | One WebSocket channel with push events (fanned out via Postgres LISTEN/NOTIFY) |
| **N requests per screen** (the home screen fans out into many `/library/*`, `/recommend/*` calls) | Latency adds up, especially over LTE | Screen-level BFF endpoints (`/home`, `/player/context/{id}`, `/artists/{id}/page`), batch reads (`?ids=`), ETags |
| **Cover color via canvas on the client**, thumbnails generated lazily per request | Work repeated on every device and every view | At ingest: WebP variants (96/256/512/1024), dominant palette and a blurhash, all served immutable by nginx |
| **In-process asyncio "jobs"** (`ai_indexing_service`, `JobTracker`) | Lost on restart, no retries, invisible to other processes | A durable Postgres-backed queue: retries, idempotency keys, priorities, per-source rate limits |
| **Schema by replaying `ALTER` and swallowing errors**; a 6k-line `MetadataDB` god class | Undetectable drift, untestable coupling | Alembic migrations; one repository per bounded context |
| **`fact_visibility` table** maintained on every index | Duplicated state that can disagree with the library | Visibility derived by join (the account owns a track of that song/artist) |
| **Events posted one by one**, lost on failure (`event_fail`) | Chatty and lossy on mobile | Batched idempotent event upload from a durable client outbox |
| **Web: one 877 KB bundle, every section mounted** | Cold start parses everything; memory stays high | Route-level code splitting, TanStack Query cache, mount on demand |
| **No loudness information** | Volume jumps between tracks | EBU R128 loudness measured at ingest; track/album gain applied by the players (the norm at Spotify/YouTube) |

### 4.1 Media delivery and quality

| Tier | Format | Use |
|---|---|---|
| экономия | AAC-LC 128 kbps (m4a) | mobile data, saver |
| **высокое** | **AAC-LC 320 kbps** (m4a) | default |
| без потерь | the original (FLAC/ALAC/…) | Wi-Fi, audiophiles |

- AAC plays natively everywhere we ship: ExoPlayer, Windows Media Foundation and browsers.
- **Every tier is encoded at ingest** by workers at idle priority, once per content hash.
  No request ever waits on an encoder. This is how big streaming services do it.
- For the current library (7282 files, 465 hours, 237 GB of originals) both AAC tiers
  take **~94 GB**: 67 GB at 320 plus 27 GB at 128. The phase 1 spec sets a storage budget. If the budget is exceeded, only
  экономия falls back to an on-demand + LRU policy.
- Browser-incompatible lossless (ALAC etc.) gets a FLAC rendition at ingest too. The
  existing 19 GB cache is migrated, not rebuilt.
- The client picks a tier per network type; the defaults are decided in the phase 1 spec.

### 4.2 Clients

- **Android: Kotlin + Jetpack Compose.**
  - The Media3 core from 2026-09-29 moves over, re-pointed at v2: the service, the
    notification buttons, the watch, the disk cache.
  - Screens are rebuilt natively, with the offline-first local store (Room) fed by `/sync`.
  - Android Auto (browse tree), Glance widgets and the watch come in phase 8.
- **Windows: C# + WinUI 3.**
  - Audio uses `Windows.Media.Playback` (`MediaPlaybackList` for gapless). FLAC, ALAC and
    AAC work natively, and SMTC gives media keys and the overlay for free.
  - Local files are indexed on the PC: they play at once and can be uploaded to the server.
  - Installer + auto-update (MSIX or equivalent; decided in its spec).
- **Web: TypeScript + React, lean.**
  - Listening from a browser and the admin (setup, members, AI policy).
  - Split per route. Budget: the player route ≤ 250 KB gzip of JS.
- **The design does not suffer.**
  - The current look (colors, typography, spacing, the player, covers, the wave UI) is
    reproduced in all three clients.
  - Phase 0 extracts it into **design tokens + component specs** (from
    `frontend/packages/musix-ui`), which Compose, WinUI and the web all consume.
  - A redesign later only changes the tokens and specs, not three codebases by hand.

### 4.3 Removed from v2 — not rebuilt (owner, 2026-09-29)

| v1 feature | Why | What goes | Instead |
|---|---|---|---|
| The «Рекомендации» tab | The owner: useless in practice | The wish → AI playlist entry, quick mixes, the axis radar and knobs, the vibe album rail. Routes: `/recommend/profile`, `/profile/ai-enrich`, `/axis-playlist`, `/similar`, `/sonic-sibling`, `/vibes/album-suggestions`, `/ai-playlist*` | Playlists by request stay in the assistant's playlist branch. The «Поток» presets cover the mixes |
| Taste islands and the AI taste portrait | v1's long-term taste model; the new «Поток» engine does not use it | The islands; `profile_enrich` LLM texts | — (вайбики stay) |
| Lyric gems (самоцветы) | The owner | The namedrop / songref pipeline, `track_gems`, `gem_resolution_cache`, `/metadata/tracks/{id}/gems`, `/library/gems/tracks` | — |
| The player's «похожие / контраст» rail | The owner. Similarity is not a relevance signal (stream spec §2) | The `top-pairs` cache and route | — |
| The playback diagnostics journal | Built for the v1 web background-playback bug; the native player and the client event outbox remove its cause | `POST /playback/diagnostics`, `cache/diagnostics/` | Debug builds may keep a local log |
| A separate autoplay recommender | A second engine next to «Поток», with its own rules | `/recommend/autoplay-queue` | The end of a queue and a tap on a вайбик start «Поток» seeded with those tracks (stream spec §3.4) |
| Hearts (`track_reactions`) and their dislike filter | The UI was already removed in v1; 0 rows | The table, the filter | огонёк / вода |
| Legacy assistant modules | Not called since the unified assistant | `router.py`, `intent_llm.py`, `facts_executor.py` | — |

**Kept** (the owner, 2026-09-29):
- вайбики with their AI names, and the hero's vibe phrase;
- the quiz;
- the stats tab;
- the assistant;
- producers and samples;
- the per-track vibe line;
- facts and bios;
- the sound and year filters;
- the models API for external RAG.

## 5. Quality gates — v2 must be provably not worse

Built in phase 0, run on every phase after:

- **Search quality.**
  - Lyric-line search and sound search are evaluated on fixed query sets with expected
    hits (start from `tests/data/facts_gold.json` and prod playback).
  - Metrics: recall@10 / MRR. Qdrant stays, so these should hold exactly.
- **«Поток».** `tools/recsys-eval` on the prod snapshot (stream spec §10):
  - ranking GAUC, candidate recall, sound AUC against the owner's labels;
  - a whole-session simulation for variety, presets and repeats;
  - the hard invariants: no same-day repeat, no locked track, no foreign track.

  The baseline is the logged v1 sessions.
- **Facts / bio.** The existing eval scripts (`scripts/eval_facts_prompts.py`,
  `eval_bio_prompt.py`).
- **Performance budgets on the home box.** Proposed here; confirmed in the phase 1 spec.

| Budget | Target |
|---|---|
| API p95, catalog/sync reads | < 150 ms |
| Stream start, AAC 320 | < 1 s on Wi-Fi, < 2 s on LTE |
| Android cold start to interactive | < 1.5 s |
| Library of 6k tracks | scrolls at 60 fps |
| Web player route | < 250 KB gzip of JS |

- **Migration.** Row counts and checksums per entity between the SQLite/Qdrant snapshot and
  v2; per-account spot checks (history, reactions, playlists).

## 6. Phases

Each phase ends with its exit criteria met on a copy of prod data. The owner requests each
phase spec in turn.

| # | Phase | Deliverables | Exit criteria |
|---|---|---|---|
| 0 | **Foundation** | Monorepo layout `server/ clients/{android,windows,web} contracts/ design/`; dev compose (Postgres, Qdrant, nginx); prod-snapshot tooling; quality gates (§5); perf baselines of v1; design tokens + component specs from musix-ui; the Playwright suite moved into the repo | Gates run in CI against v1 and produce the baseline numbers |
| 1 | **Core v2** | Postgres schema + Alembic; accounts, devices, auth; library and catalog; media pipeline + tiers + nginx delivery; playback events; reactions (огонёк/вода); playlists; `/sync`; realtime channel; OpenAPI + generated clients | Budgets met; contract tests green |
| 2 | **Intelligence** | Indexing pipeline on workers + the `ml` service; lyric/sound/hybrid search; «Поток» and вайбики; facts, bios, relations; the assistant; the quiz; Yandex import | Search and «Поток» gates equal to or better than v1 |
| 3 | **Data migration** | A repeatable SQLite + Qdrant → v2 migrator; dry runs on prod snapshots | Migration gate green on the latest snapshot |
| 4 | **Android on v2** | The Compose app: login/server, library, player, «Поток», search, playlists, artist, огонёк/вода, settings incl. quality; the Media3 core on v2 | Covers everything friends use daily; budgets met on a Pixel |
| 5 | **Web on v2** | The lean TS client: player + admin | Covers browser listening and the admin |
| 6 | **Cutover** | Rehearsal on a snapshot, the switch, a rollback plan (the old stack kept restorable for N days), a new APK and friends' re-login | Everyone on v2; the old stack retired |
| 7 | **Windows** | The WinUI 3 client: v2 features + local files + upload; installer and updates | Daily use on the owner's PC |
| 8 | **Ecosystem** | Playback handoff between devices; Android Auto browse; widgets; the watch's Up Next (via `dumpsys media_session` evidence, Android spec §11) | Each item works end to end on real devices |

The sizes are uneven. Phases 1–2 are the bulk, and phases 4 and 7 are full apps.
No dates are promised here; each phase spec estimates its own.

## 7. Cutover and the frozen prod

- The old stack keeps running untouched until phase 6. Friends keep MusiX 1.0.0, the
  Capacitor app on v1, and the current web.
  **No improvements reach them before the cutover.** That is the price of this strategy,
  accepted on 2026-09-29.
- The cutover gate is v2 backend + migration + Android + web. Windows comes after.
- Rollback:
  - v2 and v1 run on different ports and data stores.
  - Until the old stack is retired, switching back is a proxy change plus a re-login.
    Events recorded on v2 meanwhile are exported back only if we roll back, and that tool
    is written in phase 6.
- The new APK has the same package id and signing key (`/mnt/data/android/keys`), so it
  installs over 1.0.0.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Months without releases for friends | Accepted. Phase order keeps the cutover as early as the gate allows; Windows is after it. |
| Behaviour drift in search and recs during the port | The §5 gates, built BEFORE the port, compared on the same snapshot. |
| Three clients reproducing one design by hand drift apart | Design tokens + component specs are the single source (phase 0). |
| Migration of a 36-table legacy schema loses meaning, not just rows | Per-entity mapping in the phase 3 spec, with checksums and per-account spot checks, rehearsed repeatedly. |
| The home disk is 95% full (`/`, where `/mnt/music` lives) | The phase 1 spec sizes the transcode cache budget. The owner watches disk space. |
| WinUI 3 + C# is a second native stack to maintain | Generated clients and shared design specs keep it thin; Windows is the last client. |
| Home uplink as the ceiling for concurrent listeners | AAC 320 is ~6× lighter than today's FLAC; the phase 1 spec measures the uplink and sets defaults. |

## 9. Open questions (for the phase specs)

1. ~~The default quality tier per network.~~ Proposed in the phase 1 spec §5.4: Wi-Fi = без
   потерь, cellular = высокое, экономия opt-in.
2. ~~MSIX or a classic installer.~~ Proposed in the phase 7 spec §5: Velopack (unsigned
   installs, delta updates from the instance), with Authenticode signing optional later.
3. How far the lean web client goes beyond listening and admin (phase 5).
4. Whether offline downloads come back as a goal. The media cache and `/sync` make it cheap
   later.
