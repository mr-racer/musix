# Phase 2 — Intelligence: plan

> Native execution, tasks in order. Each task ends with a "done when" check and a commit
> (Russian subject). Tests only for clear functionality: about 30 for this phase (the whole
> project budget is ~100, 42 are spent).

**Spec:** `docs/superpowers/specs/2026-09-29-v2-phase2-intelligence-design.md`, and for the
«Поток» engine `2026-09-29-v2-stream-product-design.md` §3–§10.
**Everything lives under `v2/`.** The v1 code is read and copied from, never edited.
**Goal:** the spec's exit criteria:
- gates: search ≥ v1, «Поток» E1–E4 + invariants, facts/bio/routing equal;
- budgets §9.

## Global constraints

- Phase 0/1 constraints hold:
  - prod is read-only;
  - the dev stack runs on `127.0.0.1:18xxx`;
  - prod data stays out of git.
- **The GPU belongs to prod and llama-server.** Dev `ml` runs on the CPU, with a
  `mem_limit` and lazy per-model loading. Weights come from v1's `lyrics-search_hf-cache`
  volume and `weights/`, both mounted **read-only**, with `HF_HUB_OFFLINE=1`. Nothing is
  downloaded twice.
- **Model versions = v1's**, so the vectors copied from the snapshot stay valid:
  - text: Octen-Embedding-0.6B (1024);
  - sparse: MILCO-650m;
  - reranker: bge-reranker-v2-m3;
  - CLAP: `music_audioset_epoch_15_esc_90.14.pt`;
  - GLiNER2;
  - BM25: `Qdrant/bm25`.
- The removed features (program §4.3) are not ported: the Рекомендации tab, the portrait and
  islands, lyric gems, similar/contrast, the diagnostics journal, hearts, the legacy assistant
  modules.
- **v1 tests:** port only the ones guarding the logic most likely to break in the port
  (sanitizer and text-normalize cases, the facts_v2 classifier, quiz invariants, autoplay).
  The owner's test budget beats "port every test" in spec §10.

---

## Task 1 — `ml` service (step 2) + `ml_client`

- **Do:**
  - `musix.ml`: a model host with one executor per device and a **priority queue**
    (`interactive` before `bulk`). Endpoints:
    - `/embed/text`, `/embed/sparse`, `/rerank`;
    - `/clap/text`, `/clap/audio` (chunked: the chunk vectors plus a pooled vector);
    - `/gliner`.
  - Models load lazily. `/health` reports which models are loaded.
  - `infra/ml_client.py`:
    - httpx pooled, with timeouts;
    - a circuit breaker per model;
    - the error taxonomy of the serving spec, mapped to problem+json by `errors.py`.
  - The `models_public` API for external RAG: `/api/v2/models/embed`, with a static
    `MUSIX_MODELS_TOKEN`.
  - Image: a `ml` build target with the `ml` dependency group (torch CPU in dev, CUDA via a
    build arg), plus librosa, laion-clap, sentence-transformers<6, gliner2.
- **Subtleties:**
  - The heavy imports stay inside functions (v1 invariant 1).
  - Audio decode for CLAP happens in `ml`: the worker sends a path, `ml` reads the mounted
    media read-only.
- **Tests (2):**
  - the priority queue runs interactive before bulk;
  - the breaker opens and recovers.
- **Done when:** on the dev stack, `/embed/text` and `/clap/audio` answer on a subset
  file, and the vectors match v1's for the same input (cosine > 0.999).

## Task 2 — Ingest intelligence + the `tracks` collection

- **Do:**
  - Tasks after `media:process`, keyed by sha256 (idempotent; a second account costs
    nothing):
    - `intel:lyrics`: embedded tag → lrclib (synced) → lyrics.ovh → syncedlyrics, v1's
      chain, then the sanitizer;
    - `intel:embed_text`, `intel:embed_audio` (queue `ml`, `bulk`);
    - `intel:sonic`: the axes and tags from CLAP (v1 `clap_features`/`sonic_descriptor`
      ported), plus the energy envelope (RMS 10 Hz × 4 bands, zstd-packed on `media_files`);
    - `intel:index`: a Qdrant upsert.
  - Qdrant `tracks` (spec §3):
    - vectors `text`, `bm25`, `clap`, `clap_chunks` (multivector, MaxSim);
    - the payload holds filters only;
    - `owners` is a keyword index.
  - Registering an existing file in a new account = `set_payload` on `owners`.
  - One `job.progress` per user action, aggregated over the chain.
- **Subtleties:**
  - `bm25` is computed in the worker (fastembed `Qdrant/bm25`, CPU, tiny), not in `ml`.
  - The lyrics sources go through a **token bucket + circuit breaker** helper in
    `infra/ratelimit.py` (Postgres-backed buckets, so every worker shares them). Block 6
    reuses it.
- **Tests (3):**
  - a second account's registration only adds an owner;
  - the lyrics chain falls through in order (stubbed sources);
  - the envelope shape.
- **Done when:** the 30-track dev subset is fully processed; Qdrant holds 30 points with all
  four vectors.

## Task 3 — Snapshot loader (an early slice of the phase 3 migrator)

- **Do:** `tools/migrate/` (phase 3 grows it) loads a prod snapshot into a dev v2 DB:
  - accounts;
  - tracks, albums, artists and media_files, by the manifest's sha256 (no media processing);
  - lyrics;
  - listen events and signals, with v1 → v2 semantics;
  - the Qdrant points copied into `tracks`: `clap_chunks` payload → multivector, `owners`
    from the accounts that own each file.
- **Subtleties:**
  - It runs into a **separate dev database** (`musix_snap`), so the synthetic bench data and
    the snapshot never mix.
  - The api can be pointed at either database.
- **Done when:** the owner's 5961 tracks, 4.6k plays and all vectors are in; the counts
  match the snapshot.

## Task 4 — Search

- **Do:**
  - **Catalog in Postgres:**
    - a weighted `tsvector` (title A, artist B, album C);
    - `pg_trgm`;
    - a generated translit column (`text_normalize` ported);
    - GIN indexes;
    - exact/prefix bonuses and the capped history boost.
  - **Lyrics:** a Qdrant Query API prefetch (dense + bm25) with RRF and an `owners` filter.
  - **Sound:** CLAP text → `clap_chunks` MaxSim.
  - `GET /search?q=` returns the sections, run concurrently.
  - `V2Driver` in `tools/gates`.
- **Done when:** gates 4.1–4.3 on the snapshot are ≥ v1 (within v1's own run-to-run range).

## Task 5 — Stream state

- **Do:**
  - `account_artist_stats` and `account_genre_stats`, maintained **inside the listen CTE**
    (same transaction);
  - `signal_state`;
  - `stream_sessions`: the served ring, pools log, genre runs, held, the preset window;
  - `served_today`;
  - `taste_profile`: debounced job — long-term positives, favorites, genre tolerance;
  - nightly `stream_regions` (CLAP k-means, genre centroids) and `colisten_vectors`
    (PPMI-SVD-64).
  - A `stream` worker consumes the listens NOTIFY for the session state.
- **Tests (2):**
  - **replay equivalence**: random event sequences, then the incremental state equals a
    from-scratch recompute;
  - a listen reaches the next chunk's state in < 1 s.

## Task 6 — The «Поток» engine + the other rec surfaces

- **Do:**
  - `musix.recsys`:
    - `features` (ONE function over a state view, used by serving, training and
      `recsys-eval`);
    - `candidates` (the 5 sources and budgets, one Qdrant batch);
    - `ranker` (LightGBM, the nightly train job, `ranker_models`, the promotion rule,
      version cache in process);
    - `policy` (hard filters, pool deficit over 12, artist rules, genre fatigue/cap/travel
      and bridges, the exploration slot with its propensity);
    - `reasons` (templates ru/en from sources + `pred_contrib`);
    - `stream_decisions`, monthly partitions.
  - API:
    - `GET /stream/next`;
    - `PUT /stream/settings`;
    - `GET /stream/presets` (the `stream_presets` rows);
    - `POST /stream/feedback`.
  - **The autoplay queue**: the v1 logic, one Qdrant query.
  - **вайбики** (job + cached AI names), the hero vibe phrase.
  - The taste map job.
  - Stats, rhythm, pulse and engagement as aggregate SQL.
  - `recsys-eval` switches from the spike code to `musix.recsys` for E1/E4. E2/E3 use the
    same candidates and energy axis.
- **Tests (5):**
  - feature parity (the replay view vs the DB view at the same moment);
  - policy:
    - windows;
    - artist rules;
    - fatigue/cap;
    - served-today;
  - autoplay (ported v1 cases).
- **Done when:**
  - gate 4.4: E1 ≥ 0.70, E2 ≥ 21%/14.5%, E3 ≥ 0.95, E4 per the table, invariants 0;
  - `/stream/next` works on the snapshot DB.

## Task 7 — Knowledge base

- **Do:**
  - The tables of spec §5.
  - Ported as queue tasks, their logic copied:
    - songfacts + Genius fetchers;
    - facts_v2 (classify → rewrite);
    - the sample-link cleaner + the MusicBrainz verify lane (1 req/s bucket);
    - fact_relations (producers, GLiNER2 via `ml`);
    - bio_v2 (Wikipedia first);
    - AudioDB/Deezer artist images → the phase 1 image pipeline;
    - the sonic vibe line.
  - The LLM client (OpenAI-compatible; settings: instance row > env; key Fernet-encrypted;
    `public_view`) on the `ai` queue: concurrency 1, interactive > bulk, `llm_cache` by
    input hash.
  - Visibility by join.
  - The snapshot loader gains facts, bios, relations and vibes.
  - API: `GET /tracks/{id}/facts`, `/artists/{id}/bio`, relations. The player context's
    `extra` fills in.
- **Tests (4):**
  - the facts_v2 classifier cases;
  - visibility by join;
  - the token bucket;
  - the `llm_cache` hit.
- **Done when:** gate 4.5 equal on the snapshot.

## Task 8 — Assistant, track chat, AI playlists

- **Do:**
  - Port `services/assistant` (planner, branches, prompts, config, stages; the legacy
    modules dropped), `retrieval`, `playlist_agent`, and the AI playlist pieces of
    `recsys_ai_service`.
  - Adapters:
    - MetadataDB → repos;
    - per-account Qdrant → `tracks` + `owners`;
    - `EventSink` → WS events (`assistant.stage/delta/done`).
  - `POST /assistant/turns` → 202 `{turnId}`.
  - `web_pages` with a 7-day TTL.
  - SearXNG behind a bucket.
- **Tests (3):**
  - planner routing (ported cases);
  - `library_catalog` never returns another account's titles;
  - a turn streams stages then done over the WS.
- **Done when:** the assistant routing gate is equal on the snapshot.

## Task 9 — Quiz + Yandex import

- **Do:**
  - The quiz: pure functions + modes (explicit import list + a test of every key),
    `quiz_rounds`, `quiz_skill`, `quiz_streak`. I-1/I-2: no listens or signals.
  - Yandex: device-flow auth, a Fernet token store, and a download job into the phase 1
    upload pipeline, with dedup by sha.
- **Tests (3):**
  - every quiz mode is registered;
  - a quiz round writes no listens;
  - Yandex dedup.

## Task 10 — Bench to the budgets

- Spec §9 on the snapshot DB + the synthetic accounts:
  - `/stream/next` p95 < 150;
  - autoplay < 100;
  - `/search` < 250;
  - listen → chunk < 1 s;
  - ingest wall-clock vs v1 (measured on the subset and extrapolated, since the GPU is prod's).
- `pg_stat_statements` top 10.
- Report `v2/tools/bench/report/<date>-v2-phase2.md`.

## Review focus (end of phase)

1. The `owners` filter is on every Qdrant query; no path returns another account's track or
   knowledge it has no track for.
2. Training/serving feature parity; no leakage of future events into features.
3. Every outbound source goes through a bucket + breaker; no ad-hoc sleeps.
4. The LLM key never reaches logs or responses (`public_view`).
5. Heavy imports stay out of `api` and the worker's import path.
