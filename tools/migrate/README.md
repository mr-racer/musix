# tools/migrate — v1 snapshot → v2

`make migrate SNAP=<date> [DB=musix_mig] [COPY=1]` runs the whole gated migration:

1. `migrate.py run … --reset`: a fresh database at Alembic head, then the stages `accounts`,
   `library`, `vectors`, `knowledge`, `listening`, `misc`, `files` and `post`. Each stage
   truncates and reloads what it owns, so any one of them re-runs alone (`--stages knowledge`).
2. `api-snap` on that database (`MUSIX_SNAP_DB`), then the search gates 4.1–4.3
   (`tools/gates`, `--no-cache`) and the «Поток» gates 4.4 (`tools/recsys-eval`, the v2 engine).
3. `migrate.py run … --stages verify`: counts, checksums, spot checks and the two gate
   reports → `report/<snap>-<db>.md` (numbers only, accounts as roles). It exits green only
   when every delta is a named one.

It reads the snapshot and v1's media read-only. It writes the target database, the Qdrant
`tracks` points of the snapshot's accounts, and `/mnt/data/musix-v2-media`.

## Phase 6 (the cutover): what the run needs

- **Run it on the host, as root.** v1 wrote its uploads and transcodes as root, and
  `fs.protected_hardlinks=1` refuses a hardlink to another user's file. Root links them.
  A dev run passes `COPY=1` (`--copy-foreign`), which copies those files instead. A
  hardlink cannot cross a bind mount (EXDEV), which is why the tool does not run in a
  container.
- **The Yandex tokens:** `V1_YM_TOKEN_KEY` (or `V1_JWT_SECRET`, which v1 derives the key
  from) in the operator's env. Without it the import history migrates, the tokens are
  skipped, and the users re-link. The tool never reads v1's `.env` and never prints the key.
- **v2's secrets volume** must hold the Fernet key before `misc`: the tokens are
  re-encrypted with it.
- **The `post` jobs** (the «Поток» state per account plus one ranker train) are queued in the
  target database. The first v2 worker on that database runs them.
- **Not built by the migration:** the AAC `high`/`economy` renditions (`media:backfill` at
  idle time; the manifest falls back to `lossless` until they exist).
- **One Qdrant per migrated database.** The `tracks` points are keyed by media file id and
  filtered by owner. A second database migrated with the same accounts replaces the first
  one's points, so only the most recent migration's database answers vector search.
