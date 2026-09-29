# v2 · Phase 2 — Intelligence

**Date:** 2026-09-29 · **Program:** `2026-09-29-musix-v2-program-design.md` (§6 phase 2)
**Status:** draft for the owner's review
**Goal:** port everything that makes MusiX MusiX onto the phase 1 core, on efficient
infrastructure:

- ingest intelligence (lyrics, embeddings, sonic axes);
- search (lyrics, sound, catalog);
- «Поток» and the other recommendation surfaces;
- the knowledge base (facts, bios, relations, vibes);
- the assistant, the quiz, the Yandex import.

**Behaviour is ported, not redesigned**, with one exception: **«Поток»**.
- An offline study on the prod snapshot (`2026-09-29-v2-stream-product-design.md` §2) showed
  that v1's stream score ranks completed against skipped tracks at chance (GAUC 0.49).
- Porting it would carry an ineffective v1 pattern into v2. Phase 2 builds the engine from
  that spec instead, on the state below.
- The v1 baseline is the logged v1 sessions, measured by the same harness.

**Exit criteria.**

- The phase 0 gates:
  - search ≥ v1;
  - «Поток»: the `tools/recsys-eval` gates (stream spec §10), invariants at zero;
  - facts/bio/routing equal.
- The budgets in §9.

---

## 1. The `ml` service

This is the 2026-08-28 model-serving layer, **step 2 as written there**: same image, its
own container, the only process with the GPU.

- It hosts:
  - the text embedder (Octen 1024);
  - MILCO sparse;
  - the bge cross-encoder;
  - **CLAP**, moved from the CPU in `musix` onto the GPU, which is what makes batch ingest fast;
  - **GLiNER2**, one resident copy instead of lazy per-process loads.
- It keeps the existing single-executor **batcher** and adds a **priority** field:
  `interactive` (a user is waiting: search, the assistant) always runs before `bulk`
  (ingest, enrichment).
- The VRAM budget, measured in its own spec: 3.6 GB today + CLAP fp16 (~0.5 GB) + GLiNER2.
  The LLM runs elsewhere (LM Studio or remote), as now.
- Clients: `infra/ml_client.py` (httpx, pooled connections, timeouts, circuit breaker; the
  error taxonomy from the serving spec).

## 2. Ingest intelligence — once per content hash

This continues the phase 1 task chain after `register`. Every step is a queue task,
idempotent, keyed by `media_files.sha256`, so **two accounts with the same file cost one
pass**:

`lyrics`:
- embedded tag, else lrclib (synced), else lyrics.ovh, else syncedlyrics — the v1 chain;
- then `lyrics_sanitizer` (ported with its tests);
- stored in `lyrics`.

`embed_text` → `embed_audio`:
- CLAP over audio chunks. The chunk vectors become a Qdrant **multivector**, and a pooled
  vector is kept for ANN;
- the batches go to `ml` at `bulk` priority.

`sonic`:
- the sonic axes and tags from the CLAP vectors (v1 `clap_features`, `sonic_descriptor`);
- stored on `media_files` (axes jsonb) and in the Qdrant payload for filters;
- an **energy envelope** (RMS at 10 Hz in 4 bands, a few KB per track), stored as a small
  compressed array on `media_files`. The clients draw the spectrum wave from it in sync with
  the playhead. This replaces the web's `AnalyserNode` and avoids Android's
  RECORD_AUDIO-gated `Visualizer` (phase 4 §4, phase 5 §3).

`index`:
- a Qdrant upsert (§3);
- then the knowledge fan-out (§5): artist/song enrichment, **rate-limited per source**.

The overlap of the network and GPU lanes (v1 `IndexPipeline`) happens naturally: the tasks
are on different queues with their own concurrency.

**Progress:** one `job.progress` stream per user action ("indexing 1 204 / 6 000"). It is
aggregated from the task chain, replacing `JobTracker` + SSE.

## 3. Qdrant layout

| Collection | Point id | Vectors | Payload (filters only) |
|---|---|---|---|
| `tracks` | `media_files.id` | `text` (dense 1024), `bm25` (sparse, IDF), `clap` (512, pooled), `clap_chunks` (512 **multivector**, MaxSim) | `owners` (account ids; keyword index), `artist_ids`, `album_id`, `year`, `genre`, `duration_ms`, the sonic axes |
| `facts` | `facts.id` | `text` (dense) | `subject_kind`, `subject_id`, `lang` |

- **One collection for all accounts**, filtered by `owners` (filtered HNSW), instead of
  per-account collections.
- **No text, no metadata, no lyrics in the payload.** Hits come back as ids, and the
  metadata comes from Postgres in one batched query.
- Adding or removing a track in a library is a `set_payload` on `owners`, not a re-index.
- **The filter fields are media-level canonical values** (from the first registration of the
  file). Where an account's own tags differ (rare: a re-tagged copy of the same bytes),
  ANN runs on the canonical values and the account's values are applied as a post-filter
  in Postgres. The source of truth for what an account sees stays `tracks`.

## 4. Search

| Kind | v1 | v2 |
|---|---|---|
| Catalog (title / artist / album) | BM25F in Python over a full-collection scroll, cached 90 s per process | **Postgres:** weighted `tsvector` (title A, artist B, album C) + `pg_trgm` similarity + a generated **transliteration column** (Cyrillic ↔ Latin, from `text_normalize`), with GIN indexes; exact/prefix bonuses and the capped history boost from `account_track_stats` |
| Lyrics | Qdrant dense + BM25, RRF | The same **Qdrant Query API** prefetch + RRF fusion, `owners` filter; the query's dense vector from `ml` (interactive) |
| Sound | CLAP text → audio | CLAP text vector from `ml` → Qdrant on `clap_chunks` (MaxSim) with the `owners` filter |

`GET /search?q=` returns sections (tracks, artists, albums, lyrics hits, sound hits) in one
response. The sections run concurrently server-side.

## 5. The knowledge base

**Global** (keyed by song/artist, shared by everyone, as in v1). **Visibility is derived**:
an account sees knowledge about songs and artists it owns tracks of, by a join. There is no
`fact_visibility` table.

| Table | From v1 |
|---|---|
| `facts` (id, subject_kind, subject_id, lang, text, category, source, source_url, created_at) | `artist_facts` + `song_facts` |
| `fact_refinements` (fact_id, lang, labels jsonb, text, confirmed, model, generated_at) | `refined_fact_items` / `refined_facts` |
| `artist_bios` (artist_id, lang, text, facets jsonb, sources jsonb, generated_at) | `artist_bios` |
| `song_relations` (song_id, kind `producer\|label\|sample\|sampled_by`, target_song_id?, target_artist_id?, target_text, evidence, confidence, verified, source) | `songs.producers*`, `label`, `sample_links`, `sample_link_verdicts` |
| `song_vibes` (song_id, lang, phrase) | `sonic_vibes` (per track → per song) |
| `artist_aliases`, `source_fetch_log` (source, key, status, fetched_at: the negative cache), `verification_cache` | `artist_aliases`, `fact_fetch_misses`, `sample_link_verdicts` |

Pipelines ported as queue tasks, their logic copied with tests:

- songfacts and Genius fetchers;
- facts_v2 (classify → rewrite);
- the sample-link cleaner plus the MusicBrainz verify lane, which keeps its 1 req/s budget as
  a queue rate limit;
- fact_relations (the producers leg);
- bio_v2 (Wikipedia first);
- AudioDB/Deezer artist images, going through the phase 1 `images` pipeline;
- the sonic vibe line.

Every outbound source has a **token-bucket rate limit and a circuit breaker** in the queue,
not ad-hoc sleeps.

**LLM work** runs on the `ai` queue:
- concurrency matches the one local LLM (default 1);
- the priority is `interactive` (the assistant, lyric explain, track chat) over `bulk`
  (enrichment);
- results are cached by input hash (`llm_cache`, the `recsys_llm_texts` idea generalized).

## 6. Recommendations — «Поток» on incremental state

v1 rebuilds everything per request: up to 6000 events, all reactions, all signals, a full
metadata scroll, the calibration and the CLAP vectors (`stream_service.next_chunk`). v2 uses
**maintained state** and a **cheap online step**, the standard shape of production
recommenders: features maintained off the request path, then retrieval, then a learned
ranker, then policy/assembly.

The engine itself (candidate sources, ranker, policy, reasons, decision log) is specified in
`2026-09-29-v2-stream-product-design.md` §3–§9. This section covers the state and the online
path it runs on.

### 6.1 State, maintained off the request path

| State | Updated when | Holds |
|---|---|---|
| `account_track_stats` | every listen (phase 1, in-transaction) | plays, completes, skips, last played |
| `account_artist_stats` | every listen (in-transaction) | plays, completes, skips, last heard per artist |
| `account_genre_stats` | every listen (in-transaction) | plays, completes, skips per genre |
| `signal_state` (account, track) | every signal | fire/water charge and lock |
| `stream_sessions` (session) | every listen/signal in the session, O(session) | the session's positives (for retrieval), the served ring, the pool log, the genre run and `held`, the preset window |
| `served_today` (account, date) | every issued chunk | the ids issued today (stream spec §6) |
| `taste_profile` (account) | a debounced job after N new events or daily | the long-term positives, favorites, vibes, the personal genre tolerance |
| `stream_regions` / `colisten_vectors` (account) | nightly | CLAP k-means regions + genre centroids; PPMI-SVD co-listen vectors |
| `ranker_models` (instance) | nightly training job, promotion rule | the versioned LightGBM ranker (stream spec §3.2) |

Updates are consumed from the event insert (`NOTIFY`) by a `stream` worker, so the event API
stays at < 30 ms.

### 6.2 Online `GET /stream/next` (target p95 < 150 ms)

1. Load `stream_sessions` + `taste_profile` + `served_today` + the account settings: a few
   indexed rows. The ranker model is held in process memory by version.
2. **Candidates** (stream spec §3.1), ~500 ids:
   - one Qdrant `query_points` batch (CLAP neighbours of the session and long-term positives,
     `owners` filter);
   - SQL for the session artists, artist affinity and the pool samplers;
   - co-listen neighbours from `colisten_vectors`.
3. **Features:** one query joins the ids with `account_track_stats`, `account_artist_stats`,
   `account_genre_stats` and `signal_state`. The feature function is shared with training.
4. **Rank** with the current `ranker_models` version (~2–5 ms), then **the policy** (stream
   spec §3.3):
   - served-today and lock filters, the sound band;
   - preset windows, artist rules, genre fatigue and cap;
   - the exploration slot.
5. **Record and return:**
   - record the chunk in `stream_sessions` and `served_today`;
   - write `stream_decisions`;
   - return the tracks with `source`, `pool` and `reason`.

The same state serves the other surfaces, which now become SQL or single ANN calls:

- вайбики (the short-term mood clusters of recent positive plays, as a `taste_profile`
  job) with their AI names, and the hero's vibe phrase;
- the taste map (PCA/k-means as a job, cached);
- discoveries;
- listening stats, rhythm, weekly pulse, engagement (all aggregate SQL).

A tap on a вайбик and the end of a user-built queue start «Поток» seeded with those tracks
(stream spec §3.4). The v1 autoplay queue, similar tracks, sonic sibling, axis playlists,
islands, the taste portrait and top pairs are not rebuilt (program §4.3).

## 7. The assistant, chat, AI playlists, the quiz, imports

- **The assistant** (the deterministic agent) is ported module by module. The
  planner/branches/prompts/config code is copied with its tests.
  - A turn is `POST /assistant/turns` → `202 {turnId}`. The progress stages and the answer
    stream over the WebSocket (`assistant.stage`, `assistant.delta`, `assistant.done`) with
    the v1 `humanize` captions. There is no NDJSON over a long-held HTTP request.
  - The page store becomes the table `web_pages` (canonical url, markdown, fetched_at,
    7-day TTL), shared across users because the web is public. The pacing of SearXNG
    becomes a queue rate limit.
  - `local_pack` reads the knowledge tables of §5.
- **Track chat and lyric explain:** the same turn mechanism, the `interactive` priority.
- **AI playlists by request** (`recsys_ai_service`, `playlist_agent`, the assistant's
  playlist branch) and **the вайбик names / vibe phrase:**
  jobs, cached by the hash of their inputs.
- **The quiz:** pure functions ported with their tests, and the tables `quiz_rounds`,
  `quiz_skill`, `quiz_streak`. Invariant I-1/I-2 is kept: the quiz writes no listens or
  signals.
- **The Yandex import:** the device-flow auth plus an encrypted token store (the Fernet key
  resolution kept), then a download job that feeds the phase 1 upload pipeline, with dedup
  by sha256.

## 8. What v1 does that v2 must not — phase 2's share

| v1 | v2 |
|---|---|
| «Поток» recomputes everything per request (6000 events, a full scroll) | Maintained state + a cheap online step (§6) |
| «Поток» scores by hand-tuned CLAP similarity, which ranks at chance | A learned ranker over behaviour features + a policy layer (stream spec §2–§3) |
| One Qdrant collection per account, re-embedding the same file | One `tracks` collection keyed by content, an `owners` filter (§3) |
| Lyrics, metadata and CLAP chunks in payloads | Payload = filters; chunks as a multivector (§3) |
| Catalog search in Python over a full scroll | Postgres FTS + trigram + a translit column (§4) |
| CLAP on the CPU inside the API process; GLiNER loaded lazily per process | Both in `ml`, one copy, batched, prioritized (§1) |
| `fact_visibility` kept in sync by hand | Derived by join (§5) |
| In-process AI jobs, sleeps as rate limits | Queue tasks, token buckets, circuit breakers (§5) |
| The assistant streams NDJSON over a held HTTP request | Turn = job + WS events (§7) |
| The page store in process memory | A shared `web_pages` table with a TTL (§7) |

## 9. Budgets (on the home box, snapshot data, 20 users)

| Path | Budget |
|---|---|
| `GET /stream/next` | p95 < 150 ms |
| `GET /search` (all sections) | p95 < 250 ms (a dense query encode is ~20 ms on GPU) |
| Ingest of a 6k-track library (all intelligence, excluding the LLM enrichment) | ≤ v1 wall-clock, with a GPU CLAP expected well under it |
| A listen → the next chunk reflects it | < 1 s (the state update is async) |

## 10. Testing

- **Ported unit tests** travel with the ported code: artist split, text normalize,
  sanitizer, facts_v2, quiz modes, assistant stages.
- «Поток» is new code with its own tests:
  - the feature-parity test (training and serving produce identical features for the same
    moment);
  - policy unit tests (windows, artist rules, fatigue, served-today);
  - the `tools/recsys-eval` gates.
- **Gates** (phase 0 §4) on every PR that touches search or «Поток».
- **Replay property tests** on the incremental state: after any event sequence, the state
  equals the state recomputed from scratch. This is what makes "incremental" safe.

## 11. Work breakdown

1. The `ml` service to step 2, with the priorities; CLAP and GLiNER2 inside it.
2. The ingest intelligence tasks and the Qdrant `tracks` collection.
3. Search: catalog in Postgres, lyrics/sound in Qdrant. Gates 4.1–4.3.
4. Stream state tables and consumers, with the recompute-equivalence tests.
5. The «Поток» engine per the stream spec §12: sources, ranker + training job, policy,
   reasons, decision log. Then the online `/stream/next` and the other rec surfaces.
   Gate 4.4 (`tools/recsys-eval`).
6. Knowledge tables and pipelines (facts, refinements, bios, relations, vibes).
   Gate 4.5.
7. Assistant, chat, AI playlists (jobs + WS).
8. Quiz, Yandex import.
9. Bench to the budgets.
