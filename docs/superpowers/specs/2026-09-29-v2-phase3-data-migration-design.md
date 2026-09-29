# v2 · Phase 3 — Data migration

**Date:** 2026-09-29 · **Program:** `2026-09-29-musix-v2-program-design.md` (§6 phase 3, §7)
**Status:** draft for the owner's review
**Goal:** a repeatable tool that turns a v1 snapshot into a fully populated v2 (Postgres +
Qdrant + media layout) **losing nothing a user can see or the recommender uses**: accounts,
history, taste, reactions, playlists, facts, bios, gems, library indexes.

**Exit criteria.**

- The migration gate is green on the latest snapshot: counts, checksums, spot checks.
- The phase 0 search and «Поток» gates give the **same** numbers on migrated v2 data as on v1.
- A full run fits inside the cutover window (target < 45 min, with hashing pre-cached).

---

## 1. Inputs and outputs

- **In:** a phase 0 snapshot:
  - the SQLite backup (35 tables, 146 MB);
  - the Qdrant snapshots (`acct_*` ×5, `facts`);
  - the filesystem manifest with sha256: 7282 audio files / 237 GB, covers (619 MB),
    `cache/transcoded` (19 GB), `media/` uploads (11 GB).
- **Out:** a fresh v2 database (Alembic head), the Qdrant `tracks` + `facts` collections, and
  the media layout `media/<sha[:2]>/<sha>.<ext>`, `derived/`, `images/`.
- **Never touches v1:** it reads the snapshot and writes only v2 volumes.
- **Media is moved by hardlink,** not copied. `/music` by-reference files stay where they are.

## 2. Identity of things

| Entity | Rule |
|---|---|
| Accounts | **v1 ids kept.** Collections `acct_<id>` map to `account_id` |
| Tracks | **v1 track ids kept** (canonical dashed UUID, `canonical_track_id`). Listen events, playlists, signals and gems reference them, and the Android Media3 cache keys by them |
| Media files | New UUIDv7, unique by sha256. v1 had one Qdrant point per (account, file); v2 has one per content |
| Artists / songs / albums | New UUIDv7. `slug` is kept unique, so the v1 slug scheme (the three `_slugify`s) resolves through a `migr_slug_map` table |
| Facts | New ids. `migr_fact_map(v1_table, v1_id → fact_id)` lets refinements and the `facts` vectors follow |
| Devices | One synthetic device per account, `legacy-v1`. Old events belong to it, and real devices appear at first v2 login |

## 3. Table-by-table mapping

| v1 table (rows) | → v2 | Notes |
|---|---|---|
| `users` (6) | `accounts` | password hashes carried as-is (argon2id). `text_model_name` and `clap_enabled` dropped (one model; CLAP always) |
| `instance_config` (1), `instance_settings` (5) | `instance`, `instance_settings` | the LLM API key is re-encrypted at rest |
| `invites` (41) | `invites` | |
| `collection_settings` (5) | `account_settings` + `stream_sessions` defaults | `ai_enabled` and `stream_liked_share` (the slider) carried. `axis_norm_stats`, `clap_calibration` and `text_model` are **recomputed** (the `library_calibration` job) |
| `track_metadata` (7282) | `tracks`, `track_artists`, `albums`, `media_files` | `file_path` → `media_files` via the manifest's sha256. The artist split is re-run with the ported `artist_split` and **compared** with `track_artist_slugs` (8615); mismatches are reported, not guessed |
| `track_artist_slugs` (8615) | (verification only) | see above |
| `artists` (2689) | `artists` (+ `images` for the cutout/thumb) | AudioDB fields (bio, mood, country, label) kept as enrichment columns |
| `songs` (7897) | `songs` + `song_relations` | `producers`, `producers_genius`, `label` and `samples_json` become relation rows. `sonic_tags_json`, `sonic_class` and `audio_signature` are **recomputed** from the migrated CLAP vectors (the `sonic` task) |
| `artist_facts` (6706), `song_facts` (60473) | `facts` | `subject_kind` + the subject resolved through the slug map. Duplicates by (subject, lang, normalized text) collapse |
| `refined_fact_items` (60852) | `fact_refinements` | `origin_kind/origin_id` → `migr_fact_map` |
| `refined_facts` (537) | `fact_refinement_sets` (subject, lang, payload jsonb) | still read by v1 (the assistant, the artist page). Kept verbatim so the phase 2 port can consume it or retire it knowingly |
| `artist_bios` (1332) | `artist_bios` | per (artist, lang); if several collections hold one, the latest `generated_at` wins. The facet columns go to `facets` jsonb |
| `sample_links` (1225), `sample_link_verdicts` (1232) | `song_relations` (sample / sampled_by) + `verification_cache` | deduped across collections; the verdicts keep `verified`, `mbid`, `score` |
| `sonic_vibes` (4090) | `song_vibes` | per track → per song. Conflicting phrases: latest wins |
| `track_gems` (6811) | `lyric_gems` | per account + track, unchanged |
| `artist_aliases` (1737) | `artist_aliases` | |
| `fact_fetch_misses` (1555), `gem_resolution_cache` (1677) | `source_fetch_log`, `verification_cache` | the negative caches are kept, so no re-fetch storm after the cutover |
| `playback_events` (5648) | `listen_events` + a **recomputed** `account_track_stats` | `played_sec` → `played_ms`; `total_dur` → `duration_ms`. `end_reason` = `completed` if played ≥ 90%, else `skipped` if `skipped_early`, else `stopped`. `client_event_id` = uuid5(v1 id). `context_type` = `legacy` |
| `taste_signals` (227) | `taste_signals` | charge and lock are recomputed from timestamps, so the state is identical |
| `track_reactions` (0) | — | the legacy hearts are empty |
| `playlists` (7), `playlist_tracks` (98) | `playlists`, `playlist_items` | integer positions → fractional-index keys in the same order |
| `quiz_rounds` (71), `quiz_skill` (7), `quiz_streak` (0) | same | only answered rounds; expired, unanswered ones are dropped |
| `recsys_llm_texts` (13) | `llm_cache` | saves LLM calls after the cutover |
| `yandex_accounts` (4), `yandex_imports` (1801) | same | tokens are decrypted with the v1 key resolution and re-encrypted with the v2 key. The import history keeps dedup working |
| `ai_indexing_jobs` (95), `pending_uploads` (13), `fact_visibility` (12032) | — | transient, or derived in v2 (visibility is a join) |

## 4. Qdrant

- `acct_*` points (7282) → `tracks`, keyed by `media_files.id`:
  - the vectors `text` (1024), `bm25` (sparse) and `clap` are **copied, not recomputed**, so
    the search gates must match exactly;
  - the payload `clap_chunks` → the `clap_chunks` **multivector**;
  - the payload `lyrics` → the `lyrics` table (`source = 'legacy'`, kept only where no file
    tag carries lyrics);
  - the payload metadata is **compared** with `track_metadata` and then discarded;
  - `owners` comes from the accounts that hold the file.
- `facts` (1820) → `facts`, with ids through `migr_fact_map` and the vectors copied.
- New BM25 vectors in v2 use the same encoder as v1 (`Qdrant/bm25` via fastembed), so
  migrated and newly ingested points are comparable.

## 5. Files

| v1 | v2 |
|---|---|
| `media/<account>/audio/<sha>.<ext>` (uploads, 11 GB) | hardlink → `media/<sha[:2]>/<sha>.<ext>` (`storage = managed`) |
| `/music/...` (by reference) | untouched; `media_files.path` (`storage = reference`) |
| `frontend/covers/*` (619 MB) | `images` (id = sha256) + variants, palette and blurhash generated by the phase 1 image task (queued; covers stay servable from the original meanwhile) |
| `cache/transcoded/*` (19 GB, ALAC → FLAC) | `renditions (tier = lossless_compat)` when the source hash matches; otherwise dropped |
| `cache/cover_thumbs` | dropped (regenerated) |
| `downloads/musix.apk` | kept |
| AAC `high`/`economy` renditions | **not** part of the migration: queued after it, at idle priority. Until a track has one, the manifest falls back to `lossless`. The phase 6 runbook decides whether to pre-build `high` before switching (~67 GB, hours of CPU) |

## 6. The tool

- `tools/migrate/`: stages with checkpoints. Each stage truncates and reloads its targets,
  so a stage is **idempotent** and re-runnable alone:

  `accounts` → `catalog` (artists, songs, albums, slug map) → `media` (media_files from the
  manifest) → `library` (tracks, track_artists) → `knowledge` (facts, refinements, bios,
  relations, vibes, gems, caches) → `listening` (events, stats, signals, playlists) → `misc`
  (quiz, llm cache, yandex, instance) → `vectors` (Qdrant) → `files` (hardlinks, image and
  rendition queueing) → `verify`.

- Bulk writes use `COPY`, not row inserts. Parallel where the stages are independent.
- A dry-run mode writes only the verification report.
- Time budget: dominated by `vectors` (7.3k points + 1.8k facts: minutes) and `verify`.
  Hashing is already cached in the snapshot manifest.

## 7. Verification — the migration gate

1. **Counts per entity:** v1 row counts against v2, with the expected collapses listed
   explicitly (duplicate facts, per-collection bios). Any unexplained delta fails.
2. **Checksums per account:**
   - Σ `played_ms`, the listen count, the completes and skips;
   - fire/water per track (charge and lock recomputed);
   - playlist item sequences, by exact order;
   - the set of track ids;
   - the fact count per visible subject;
   - the gem count;
   - the bio presence.
3. **Spot checks:** for 5 random tracks per account, a side-by-side JSON of v1
   (`/api/v1/...`) and v2 (`/api/v2/...`) of the player context: metadata, lyrics, facts,
   credits, gems, vibe. They are diffed and must match on the fields that exist in both.
4. **The gates:** the phase 0 search gates (4.1–4.3) and the «Поток» replay (4.4) on the
   migrated v2 must equal v1 on the same snapshot. For search, the vectors are identical, so
   the numbers must be too.

## 8. What v1 does that v2 must not — phase 3's share

| v1 | v2 |
|---|---|
| "Migrations" by replaying `ALTER` at startup (`MetadataDB.init()`) | One offline, verified, repeatable tool plus Alembic from here on |
| Metadata in two places (Qdrant payload, SQLite) | Compared once, then one home (Postgres) |
| Re-index to change the storage layout | Vectors are copied, never recomputed |

## 9. Work breakdown

1. The mapping modules per stage, from the table above, with unit tests on a tiny
   synthetic v1 DB.
2. The Qdrant copier (multivector conversion, owners).
3. The file stage: hardlinks, image and rendition queueing.
4. The verification report (counts, checksums, spot checks) and the gate hook.
5. Dry runs on every new snapshot until two consecutive runs are green.
