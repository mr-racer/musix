# Phase 3 — Data migration: plan

> Native execution, tasks in order, each ending with its check and a commit (Russian
> subject). Tests only for clear functionality: about 4 for this phase (the project budget
> is ~100; 64 are spent).

**Spec:** `docs/superpowers/specs/2026-09-29-v2-phase3-data-migration-design.md`.
**Starting point:** phase 2's early slice — `v2/tools/migrate/load_snapshot.py` (accounts,
library, lyrics, vectors, listens, signals, playlists) and `load_knowledge.py` (knowledge).
**Goal:** one repeatable tool, snapshot → v2, losing nothing a user sees or the recommender
uses; the migration gate green; the search and «Поток» gates equal to v1 on migrated data;
a full run < 45 min.

## Global constraints

- Reads the snapshot and v1's media read-only; writes only v2 (DB, Qdrant, media dir).
  Media is hardlinked (same filesystem, so the tool runs on the host, not in a container:
  a bind mount is a different mount point and `link(2)` returns EXDEV across them).
- Identity (spec §2): **v1 account ids and v1 track ids are kept**; media files, artists,
  songs, albums and facts get new ids; one synthetic device `legacy-v1` per account; the
  `migr_*` maps stay (the gates and tools translate through them).
- Secrets: the v1 Yandex token key comes only from the operator's env
  (`V1_YM_TOKEN_KEY` / `V1_JWT_SECRET`), is never printed, and dev dry runs go without it
  (history migrated, tokens skipped and reported).
- Image work needs libvips, which the host lacks: covers and artist images are queued to
  the worker (`media` queue), and `verify` waits for them.
- Removed features are not migrated (program §4.3): gems, hearts, islands/portrait texts.

---

## Task 1 — The migrator: stages, identity, dry run

- `v2/tools/migrate/migrate.py run <snap> [--db] [--stages a,b] [--dry-run]`, stages
  with truncate-and-reload semantics and a `migr_runs` log (stage, seconds, counts):
  `accounts` → `library` (catalog, media_files from the manifest, tracks with v1 ids,
  track_artists, the artist-split comparison against `track_artist_slugs`) → `vectors`
  (copy text/bm25/clap, `clap_chunks` multivector, owners, lyrics) → `knowledge`
  (load_knowledge folded in) → `listening` (events through the listening service, so the
  stats are v2's own; signals; playlists with fractional keys) → `misc` → `files` →
  `verify`.
- `accounts`: v1 ids, argon2id hashes as-is, `legacy-v1` device, invites, instance
  (mode kept as phase 2 loaded it), instance settings (LLM base URL/model), account
  settings (`ai_enabled`; `stream_liked_share` → the familiarity preset, stream spec §4).
- **Tests (2):** the mapping rules on a tiny synthetic v1 DB (end_reason, uuid5 event ids,
  playlist order, v1 ids kept); a stage re-run is idempotent (same counts).

## Task 2 — Misc and files

- `misc`: answered quiz rounds + skill; Yandex imports (history) and tokens (re-encrypted
  when the v1 key is given); `recsys_llm_texts` not carried (v2's texts are keyed by their
  prompts — recomputed by `stream:ai_texts`).
- `files`: managed uploads hardlinked to `media/<sha[:2]>/<sha><ext>`; the `lossless`
  symlink per media file; v1 `cache/transcoded` → `renditions (lossless_compat)` for the
  matching media file (hardlink); track covers and artist images → one worker job per
  batch (images + `cover_image_id` / `image_id`); the APK kept. AAC tiers are NOT built
  here (spec §5): `media:backfill` is left for idle time.
- Post-steps queued: the stream state jobs (profile, genres, co-listen, taste map) and the
  ranker train, so «Поток» is warm after the run.

## Task 3 — Verify: the migration gate

- Counts per entity with the expected collapses named (facts duplicates, per-collection
  bios, gems/hearts dropped, orphans).
- Checksums per account: Σ played_ms, listens, completes, skips; fire/water per track;
  playlist item sequences; the set of track ids; facts per visible subject; bio presence.
- Spot checks: 5 random tracks per account, v2's player context (API) against v1's read
  rules on the snapshot SQLite (metadata, lyrics, facts, producers/samples, vibe line).
- The gates: search 4.1–4.3 (`tools/gates`) and «Поток» 4.4 (`tools/recsys-eval`) on the
  migrated DB must equal v1.
- Report `v2/tools/migrate/report/<date>.md` (numbers only).
- **Tests (2):** verify flags an unexplained count delta; verify flags a changed playlist
  order.

## Task 4 — Dry runs and timing

- Two consecutive green full runs on the 2026-09-29 snapshot into a fresh `musix_mig`;
  wall-clock per stage; < 45 min.
- `make migrate SNAP=… DB=…` and the phase 6 runbook notes (what the cutover passes in).

## Review focus (end of phase)

1. No write to the snapshot or v1's media (hardlinks only, source untouched).
2. v1 ids survive: a v1 client-cached track id resolves in v2.
3. Stats are v2's own computation over the migrated events, not copies of v1 counters.
4. No secret in a log, the report or git (the Yandex key, the LLM key).
5. Re-running any stage alone leaves the same state.
