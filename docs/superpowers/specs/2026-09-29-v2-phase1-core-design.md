# v2 · Phase 1 — Core

**Date:** 2026-09-29 · **Program:** `2026-09-29-musix-v2-program-design.md` (§4, §6 phase 1)
**Status:** draft for the owner's review
**Goal:** the backend every client talks to:

- processes;
- the Postgres schema of the core domain;
- identity and devices;
- library registration;
- the media pipeline with quality tiers and loudness;
- playback events;
- огонёк/вода;
- playlists;
- `/sync`;
- the realtime channel;
- the typed contract and the generated clients.

Intelligence (embeddings, search, «Поток», facts, the assistant) is phase 2.

**Exit criteria.**

- The §10 budgets are met under `tools/bench` on the snapshot-sized dataset.
- Contract tests are green.
- Generated Kotlin/C#/TS clients compile.
- A library can be registered (folder by reference, or uploads) and played end to end
  in every tier, with loudness data.

---

## 1. Processes

| Service | What | Scale on the home box |
|---|---|---|
| `nginx` | TLS is terminated at the VPS. Serves `/api/v2` → `api`, `/m/*` media and `/i/*` images **from disk with sendfile**, verifying signed URLs; gzip/brotli for JSON; `limit_req` on auth | 1 |
| `api` | FastAPI on uvicorn workers. Strictly async; **no models, no ffmpeg, no filesystem scans in-process** | 4 workers (`2 × cores` capped, tuned by bench) |
| `worker` | Procrastinate (a Postgres-backed task queue) workers on the queues `ingest`, `media`, `ai`, `default`. Retries with backoff, idempotency locks, priorities, periodic tasks | `media` 2 (ffmpeg is CPU), `ingest` 2, `ai` 1, `default` 2 |
| `ml` | The 2026-08-28 model-serving layer, step 2: its own container, sole owner of the GPU (phase 2 uses it) | 1 |
| `postgres` | 18 (native `uuidv7()`), `pg_trgm`, `unaccent`, `pg_stat_statements` | 1 |
| `qdrant` | vectors (phase 2) | 1 |

The data path is designed so that **no request ever waits on ffmpeg, the GPU, a network
fetch or a directory walk**. Those are queue tasks, and the client is told about progress
over the realtime channel (§8).

## 2. Code structure

- **Bounded contexts** (`musix/contexts/<name>/`), each with:
  - `models.py` (SQLAlchemy tables);
  - `repo.py` (queries; no ORM lazy loading, explicit selects);
  - `service.py` (use cases, transactions);
  - `schemas.py` (Pydantic v2, camelCase aliases);
  - `router.py`;
  - `tasks.py` (queue tasks).
- **A context never touches another's tables.** It calls the other's service. No god class;
  the 217-method `MetadataDB` is not reproduced in any form.
- **Async all the way down:** SQLAlchemy 2 async + asyncpg, httpx for outbound calls. CPU work
  (image decode, hashing) goes to a process pool inside workers, never inside `api`.
- **Config:** pydantic-settings with an env prefix `MUSIX_`, and one `Settings` object
  injected via dependencies.
- **Errors:** a small domain exception hierarchy mapped once to RFC 9457 `application/problem+json`.

## 3. Schema (core; phase 2 adds knowledge, search and stream tables)

Conventions:

- **UUIDv7** primary keys (time-ordered, index-friendly). **v1 ids are preserved** on
  migration (phase 3).
- Timestamps are `timestamptz`.
- **Soft delete** (`deleted_at`) on everything clients sync.
- Every synced mutation writes a `change_log` row **in the same transaction** (§7).
- **Keys:**
  - `uuid DEFAULT uuidv7()` for anything exposed to clients;
  - `bigint GENERATED ALWAYS AS IDENTITY` for internal, append-only tables
    (`listen_events`, `change_log`);
  - no random UUIDv4 keys on new rows.
- **Types:** `text` rather than `varchar(n)`, and enums as `text` + `CHECK` constraints,
  which can be changed without a type migration. `timestamptz` only.
- **Every foreign-key column is indexed.** Composite indexes follow the query shapes in
  each context's repo, verified with `EXPLAIN` in the benches.
- **Ingest writes are idempotent upserts** (`INSERT … ON CONFLICT`), never
  select-then-insert.
- **Transactions stay short.** No network or ffmpeg work inside a transaction.
- **Connections:**
  - per-process asyncpg pools: `api` 5 per worker, `worker` 5 per process;
  - `max_connections` = 100;
  - `idle_in_transaction_session_timeout` 30 s;
  - `statement_timeout` 5 s for `api` roles, 5 min for the workers.
  - **No PgBouncer**: asyncpg's prepared statements conflict with transaction-mode pooling,
    and at this scale direct pools are enough.

**Identity**
- `accounts` (id, email `citext` unique, password_hash (argon2id), role `owner|member`,
  display_name, created_at, last_login_at, index_root, premium).
- `devices` (id, account_id, name, platform `android|windows|web`, app_version,
  last_seen_at, created_at, revoked_at).
- `refresh_tokens` (id, device_id, family_id, token_hash sha256, issued_at, expires_at,
  rotated_at, revoked_at).
- `invites` (code, created_by, created_at, expires_at, consumed_by, consumed_at).
- `instance` (singleton: mode `personal|shared`, created_at) and `instance_settings` (key,
  value jsonb, updated_at), holding the LLM endpoint etc. The API key is encrypted at rest.
- `account_settings` (account_id, value jsonb: quality per network, normalization,
  language, …). Synced.

**Content, shared by content hash across accounts**
- `media_files`:
  - id, sha256 unique, storage `managed|reference`, path, size_bytes;
  - container, codec, sample_rate, bit_depth, channels, bitrate_kbps, duration_ms;
  - loudness: `lufs_integrated`, `true_peak_dbtp`, `loudness_range`;
  - `probe_state`, created_at.
- `renditions` (media_file_id, tier `economy|high|lossless_compat`, path, codec, bitrate,
  size_bytes, created_at; unique (media_file_id, tier)).
- `images`:
  - id = sha256 of the original, kind `cover|artist|artist_cutout`, width, height;
  - `variants` jsonb {96, 256, 512, 1024 → path};
  - `palette` jsonb (dominant, vibrant, muted, and the accent the player derives), `blurhash`.
- `lyrics` (media_file_id, text, source `tag|lrclib|ovh|genius|…`, language, `synced_lrc`,
  sanitized_at).

**Catalog, global and canonical**
- `artists` (id, slug unique, name, sort_name, mbid, image_id, cutout_id, …; phase 2 adds
  bio facets).
- `songs` (id, slug unique, title, primary_artist_id, mbid). This is the canonical song that
  knowledge (facts, relations) hangs on, the v1 `songs` slug scheme.
- `albums` (id, title, album_artist_id, year, cover_image_id; unique on (album_artist_id,
  normalized title, year)).

**Library, per account**
- `tracks` — one row per library item:
  - id, account_id, media_file_id, song_id, album_id;
  - title, title_display, disc_no, track_no, year, genre, duration_ms, cover_image_id;
  - added_at, updated_at, deleted_at.
  - Tag-derived metadata lives here and only here. There is no second copy in Qdrant.
- `track_artists` (track_id, artist_id, role `main|feat`, position).

**Listening**
- `listen_events`:
  - id bigint identity, client_event_id uuid unique, account_id, device_id, session_id;
  - track_id, started_at, played_ms, duration_ms;
  - end_reason `completed|skipped|stopped|error`, skipped_early, interacted, influence;
  - source (pool label or `manual`), context_type (`stream|album|playlist|search|artist|queue`),
    context_id.
  - Append-only, BRIN on started_at.
- `account_track_stats`:
  - account_id, track_id, plays, completes, skips, total_played_ms, first_played_at,
    last_played_at.
  - **Maintained in the same transaction as the event insert**, so no read path ever scans
    events.
- `taste_signals` (id, client_event_id unique, account_id, session_id, track_id, kind
  `fire|water`, created_at). Charge and lock (1-day half-life, lock above 50%) are computed
  server-side as in v1.
- `playlists` (id, account_id, name, description, cover_image_id, created_at, updated_at,
  deleted_at) and `playlist_items` (playlist_id, item_id, track_id, position text
  **fractional index**, added_at, deleted_at). Reordering touches one row.
- `change_log` (account_id, seq bigint identity, entity, entity_id, op `upsert|delete`,
  at). An index on (account_id, seq).
- `uploads` (id, account_id, sha256, size, offset, state, filename, created_at): resumable
  uploads (§5.2).

## 4. Identity, devices, tokens

- **Login** (`POST /auth/login`, with a device descriptor):
  - The access token is a JWT signed **EdDSA (Ed25519)** and lives **15 min**. Its claims:
    `sub`, `dev`, `role`, `scope`.
  - The refresh token is opaque 256-bit random, stored as sha256, lives **60 days, sliding**,
    and **rotates on every use**.
  - **Reuse of a rotated refresh token revokes its whole family**, i.e. stolen-token detection.
- **Devices:** `GET /devices` and `DELETE /devices/{id}` ("sign out that phone"). The web gets
  a device too, named by user agent.
- **Invites, instance modes, the owner/member split** keep v1 semantics.
- **Rate limits:** nginx `limit_req` on `/auth/*` (5 r/min per IP, with a burst), and argon2id
  with tuned parameters.
- **No bearer tokens in URLs anywhere.** Media and images use signed URLs (§5.3).

## 5. Library registration and the media pipeline

### 5.1 Registration (phase 1 part of ingest)

Two entry points, the same pipeline:

- **By reference:** the owner-granted folder (v1 `index_root` semantics). A scan task walks
  it, compares (path, size, mtime) against `media_files`, and enqueues only new or changed
  files. This is the v1 `library_scan_service` idea, made the only path.
- **Upload:** resumable chunked uploads (§5.2) from Windows, phones and the web.

A per-file task chain, each step idempotent (keyed by sha256) and resumable:

`hash` → `probe` (ffprobe: codec, rates, duration) → `tags` (mutagen; artist split with the v1
curated rules) → `register` (`songs`/`albums`/`artists` upsert, `tracks` row, `change_log`) →
`cover` (extract → image variants, palette, blurhash) → `loudness` (ffmpeg `ebur128`,
integrated LUFS + true peak) → `renditions` (§5.4).

- The track becomes **playable as soon as it is registered**, in `lossless` or `high` if that
  rendition exists.
- **Dedup:** a file whose sha256 is already known skips everything but `register`.
  Two friends uploading the same album cost one encode.

### 5.2 Uploads

- `POST /uploads` {sha256, size, filename} returns either `{exists: true}` or an upload id.
  "Already on the server" skips the transfer, like Dropbox/Spotify-local.
- `PATCH /uploads/{id}` with `Upload-Offset` continues a chunked, resumable upload
  (tus-style semantics without the dependency).
- Completion verifies the sha256, moves the file to `media/<sha[:2]>/<sha>.<ext>` and enqueues
  the chain.
- MIME sniffing and quarantine semantics come from v1's `uploads_service`.

### 5.3 Delivery — playback manifests and signed URLs

- `POST /playback/manifest` {trackIds[], network `wifi|cellular`} returns, per track:
  - `{url, expiresAt, tier, codec, bitrateKbps, durationMs, gain: {trackDb, albumDb}, sizeBytes}`;
  - the fallback tiers.
- **One call covers the current track and the next N in the queue.** This is how the
  clients prefetch.
- **URLs are signed**, like CDN signed URLs: `https://…/m/<sha>/<tier>.m4a?e=<exp>&s=<sig>`.
  - `sig` = HMAC-SHA256(secret, path + exp).
  - nginx verifies it with the njs module and serves the file with `sendfile`, `Range` and
    `Cache-Control: private, max-age` up to expiry.
  - Expiry is 6 h. A client that gets `403` re-requests the manifest; the Media3 core
    already has the hook (the `ResolvingDataSource`).
- **Python never reads audio bytes.** Covers and artist images work the same way under `/i/`,
  signed with a long expiry and immutable caching, because they are content-addressed.
- **Optional edge cache on the VPS:** nginx `proxy_cache` for `/m/` and `/i/`, keyed by path
  **without** the signature, with a disk budget. A friend's repeat plays then never touch the
  home uplink. Off by default; enabled in phase 6 after measuring the VPS disk.

### 5.4 Quality tiers and loudness

| Tier | Encoding | When built |
|---|---|---|
| `economy` | AAC-LC 128 kbps, 44.1/48 kHz stereo, `+faststart` | at ingest, idle priority |
| `high` | **AAC-LC 320 kbps**, same | at ingest, **before** economy |
| `lossless` | the original, when every client decodes it natively (FLAC, MP3, AAC, ALAC on Android/Windows) | nothing to build |
| `lossless_compat` | FLAC for ALAC (web), or AAC for Dolby/DTS (as v1 decided 2026-09-28) | at ingest, only where needed |

- Encoder: ffmpeg's native AAC encoder. It is transparent at 320. Replacing it with Opus is a
  later option, not a phase 1 decision.
- **Budget:** 94 GB for both AAC tiers of today's library. `MEDIA_RENDITION_BUDGET_GB` (default
  150) caps it. Over the budget, `economy` renditions become on-demand + LRU; `high` is always
  kept.
- **Defaults** (the program's open question 1): Wi-Fi = `lossless`, cellular = `high`, and
  `economy` is opt-in ("экономия трафика"). The user can change all three in settings; they
  are synced.
- **Loudness normalization**, the Spotify/YouTube practice:
  - Target −14 LUFS.
  - The server supplies `trackDb`/`albumDb` gains. The clients apply attenuation freely and
    positive gain only up to the true-peak headroom (no clipping).
  - It is a user setting, default on.
- The v1 lazy caches (19 GB of `cache/transcoded`) are migrated as `lossless_compat`
  renditions where their source hash matches (phase 3), not rebuilt.

### 5.5 Images

At ingest (task `cover`):

- decode with pyvips (fast, low memory);
- WebP at 96/256/512/1024;
- palette (k-means in Lab over a 64 px thumbnail): the dominant color and the **player
  accent** by the same clamping rules v1 applies in the browser (`accentColor` in
  `PlayerSection`, see the design tokens);
- a **blurhash** for instant placeholders.

Clients never compute colors from pixels again.

### 5.6 App distribution

- `GET /download/{file}` is served by nginx straight from `downloads/`: the APK and the
  Windows installer + Velopack delta feed.
- `GET /app/{android|windows}/latest` returns `{versionCode, versionName, url, sha256,
  notes}`, read from a small manifest in `downloads/`.
- The in-app updaters (phase 4 §7, phase 7 §5) use these. Publishing a release means
  copying the files and the manifest.

## 6. API v2 conventions

- `/api/v2`; OpenAPI 3.1 generated from the Pydantic models and **committed**
  (`contracts/openapi.json`).
- JSON **camelCase**, RFC 3339 times, durations in ms.
- **Pagination:** an opaque keyset cursor (`?cursor=&limit=`), never offsets.
- **Caching:**
  - **ETags** on every personalized GET (`If-None-Match` returns `304`), and
    `Cache-Control: private, no-cache`;
  - media and images are immutable (§5.3).
- **Batch reads:** `GET /tracks?ids=` (≤ 200), `GET /albums?ids=`, `GET /artists?ids=`.
- **Screen-level endpoints (BFF):** each returns everything its screen needs in one
  round trip, composed server-side with concurrent queries. Phase 1 owns the library shapes;
  phase 2 fills the intelligence sections.

  | Endpoint | Covers |
  |---|---|
  | `GET /home` | the whole home screen |
  | `GET /library/summary` | library counts and summary |
  | `GET /albums/{id}` | album + tracks |
  | `GET /artists/{id}/page` | the artist page |
  | `GET /player/context/{trackId}` | lyrics + credits + facts + badges |

- **Idempotency:** every mutating POST accepts `Idempotency-Key`. Event batches carry
  per-item `clientEventId`.
- **Compatibility:** additive changes only inside v2. A breaking change is `v3` of that
  resource.
- **Generated clients** (`contracts/codegen/`):
  - Kotlin: openapi-generator `kotlin` + kotlinx.serialization + OkHttp;
  - C#: Kiota;
  - TypeScript: openapi-typescript + openapi-fetch.
  - CI regenerates them and fails on drift.

## 7. `/sync` — offline-first clients

- `GET /sync?cursor=` returns `{changes: [{entity, id, op, data?}], cursor, hasMore}` for the
  entities `track`, `album`, `artist` (those referenced by the account), `playlist`,
  `playlistItem`, `signalState`, `settings`. Pages hold ≤ 1000 changes.
- The first call (no cursor) streams the full library as upserts. Today's largest library
  (5961 tracks) is ≈ 2.5 MB raw / ≈ 350 KB brotli.
- Deletes arrive as tombstones.
- **Clients render from their local store first** (Room / SQLite / IndexedDB) and apply
  deltas.
- A `sync.changed {cursor}` push on the realtime channel (§8) replaces polling.
- **Client mutations are commands:**
  - playlist edits carry client-generated ids and fractional positions;
  - signals are append-only;
  - the server is authoritative and echoes the resulting changes through `/sync`.
- Conflicts: the last writer wins per field, which is enough for one person's own
  playlists.

## 8. Realtime channel

- `GET /api/v2/ws`, a WebSocket. Auth is the first message (`{type: "auth", token}`), with a
  resume by `lastSeq`.
- **Server → client:**
  - `sync.changed`;
  - `job.progress` / `job.done` (ingest, AI tasks, imports);
  - `instance.status`: LLM availability, which replaces v1's per-client 60 s probe; the
    server probes once and pushes the changes;
  - `device.presence`;
  - `playback.*` (phase 8).
- **Fan-out:** producers `NOTIFY musix_account_<id>`, and each `api` worker `LISTEN`s for the
  accounts connected to it. No Redis.
- Heartbeat every 25 s. Clients reconnect with backoff and a resume. Mobile clients keep the
  socket only while in the foreground; in the background, sync runs through WorkManager (§4).

## 9. Playback events and signals

- `POST /events/listens:batch` [≤ 100 items], idempotent per `clientEventId`.
  - The clients keep a **durable outbox** (the Android `EventOutbox` pattern) and flush it
    on track change, on app backgrounding and periodically.
  - The server inserts the events and updates `account_track_stats` in one transaction. The
    stream state update (phase 2) consumes the same insert via `NOTIFY` and never blocks the
    request.
- The v1 semantics are kept exactly:
  - `played_ms` is time actually heard (the accumulator rules);
  - `skipped_early`, `interacted`, `influence`, `source`.
- `POST /tracks/{id}/signals` {kind, clientEventId}; `GET /signals/state?trackIds=`.
- The playback path has **no synchronous work beyond the insert**. v1's 14 blocking async
  handlers are not reproduced: the linter rule in §11 forbids sync I/O in async code.

## 10. Performance budgets — phase 1 exit gates

On the home box, dataset = snapshot size, 20 concurrent synthetic users (`tools/bench`):

| Path | Budget |
|---|---|
| `GET /home`, `/albums/{id}`, `/player/context` | p95 < 150 ms |
| `GET /sync` delta (≤ 100 changes) | p95 < 50 ms |
| `POST /events/listens:batch` | p95 < 30 ms |
| `POST /playback/manifest` (5 tracks) | p95 < 40 ms |
| Stream start, `high`, LTE profile (12 Mbit/s, 70 ms) | < 2 s to first audio |
| Stream start, `high`, Wi-Fi | < 1 s |
| Initial `/sync`, 6k tracks | < 3 s end to end |
| `api` RSS per worker | < 250 MB |

## 11. Observability and hygiene

- **OpenTelemetry** traces across api → queue → worker → ml, exported via OTLP (a local
  collector is optional).
- **Prometheus** `/metrics`: request histograms per route, queue depth and age per queue,
  task durations, rendition backlog, WS connections.
- **structlog** JSON logs with `trace_id`, `account_id` and `device_id`.
- `pg_stat_statements` review in every phase's bench.
- **Lint:** ruff, mypy `--strict`, and a custom check that flags blocking calls (`open`,
  `time.sleep`, sync DB drivers, `requests`) inside `async def`.

## 12. What v1 does that v2 must not — phase 1's share

| v1 | v2 |
|---|---|
| One process: API, GPU, ffmpeg, recsys | `api` / `worker` / `ml` / `nginx` (§1) |
| Python streams audio; `?st=` tokens | Signed URLs + nginx sendfile; playback manifests (§5.3) |
| Transcode on the first request | Renditions at ingest; the request only picks one (§5.4) |
| Covers resized per request; colors computed in the browser | Variants, palette and blurhash at ingest (§5.5) |
| 30-day HS256 JWT | 15-min EdDSA access + rotating refresh + devices (§4) |
| Polling (LLM status, job progress) | WebSocket push (§8) |
| A screen = many requests | BFF endpoints + batch + ETags (§6) |
| Events one by one, lost on failure | A batched, idempotent outbox (§9) |
| Metadata in Qdrant payload and SQLite | Postgres only (§3) |
| Schema by replayed `ALTER` | Alembic (§2) |
| Per-account copies of the same file | Content-addressed `media_files`, one encode (§5.1) |

## 13. Testing

- **Unit** per context.
- **Integration** with testcontainers: real Postgres and Qdrant, and nginx for signed media.
- **Contract:** schemathesis against `openapi.json`, plus the generated clients' smoke tests.
- **Load:** `tools/bench` scenarios for §10.
- **Media:** golden files for probe/tags/loudness/renditions (the fixture set from
  `tests/fixtures/audio/`, extended with ALAC, E-AC-3, 24-bit FLAC and a multichannel file).

## 14. Work breakdown

1. Skeleton: settings, DB session, Alembic base, error model, telemetry, the linter rule.
2. Identity: accounts, devices, tokens, invites, instance, settings, and a rate-limited nginx.
3. Library: schema, scan-by-reference, uploads, the task chain up to `register`, `change_log`.
4. Media: probe, loudness, renditions, images, signed delivery (njs), manifests.
5. Listening: events + stats, signals, playlists (fractional index).
6. `/sync` + the realtime channel (LISTEN/NOTIFY fan-out).
7. BFF shapes for the library surfaces; batch reads; ETags.
8. OpenAPI commit + codegen for three languages + contract tests.
9. Bench to the budgets; `pg_stat_statements` review; fixes.

## 15. Open questions

1. `MEDIA_RENDITION_BUDGET_GB` default: 150 against the 176 GB free on `/mnt/data`. The
   owner decides where renditions live.
2. Whether the web's lossless tier ships FLAC to browsers. It does, universally, today; ALAC
   via `lossless_compat`.
