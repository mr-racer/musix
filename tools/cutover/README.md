# tools/cutover — the v1 → v2 switch (phase 6)

`run.sh <step>` runs one step of the runbook and appends its time to
`/mnt/data/musix-v2-prod/cutover.log`. Steps that touch v1 prod or what users receive
refuse to run without `--yes`, and are run only on the owner's go for that step.

## Before T

- **The staging stack** = the v2 prod stack on a fresh snapshot (`make prod-up`,
  `make prod-migrate SNAP=…`, `make prod-gates SNAP=…`), reached from the VPS through a second
  tunnel for the owner's week (`deploy/vps/v2-staging.md`).
- **T−7 d:** the friends get the announcement (the date, the new app, what changes).
- **T−1 d, evening:** `run.sh prebuild`. The renditions land in the prod media dir, which is
  content-addressed. The final migration's database finds them on disk and registers them
  instead of re-encoding (`media:process`). Measured: 38 files/min with 8 slots; the top 2000
  in about 1 h, all 7273 in about 3.2 h.

## The run (downtime = stop-v1 … smoke; target ≤ 30 min)

| # | Step | Measured / budget |
|---|---|---|
| 1 | `run.sh stop-v1 --yes`: v1 `musix` stops; its Qdrant and SearXNG stay up | ~10 s |
| 2 | `run.sh carry-week <staging start> --yes`: the owner's week on staging → v1's SQLite (a backup is kept) | < 30 s |
| 3 | `run.sh snapshot`: the final snapshot of the stopped v1 (consistent) | 248 s (2026-09-30) |
| 4 | `run.sh migrate <date>`, as root with hardlinks (else `COPY=1`). For the Yandex tokens, `V1_JWT_SECRET` comes from the stopped v1 container's env (`docker inspect musix`), never printed; v1's `.env` parse differed from its container (2026-10-01) | 894 s with COPY=1, first fill; less as root and with the media dir already filled |
| 5 | `run.sh gate <date>`: counts, checksums, spot checks, search (on the baseline's fixtures), «Поток» | 301 s + 19 s |
| 6 | `run.sh switch --yes`: v2's edge takes `127.0.0.1:8000` (the existing tunnel), `ml` on the GPU, the AI worker on, the staging tunnel follows the edge | ~2 min (estimate) |
| 7 | `run.sh smoke`: ready, web shell, the 426 for 1.0.0 | 5 s |
| 8 | `run.sh publish-apk <apk> --yes`: `/download/musix.apk` = v2, 1.0.0 kept as `musix-1.0.0.apk`, `manifest.json` for the in-app updater | 5 s |
| 9 | Watch for 30 min: `make prod-logs`, `/admin/ops`, the owner plays from the phone and the web | 30 min |

Estimated downtime: 1–7 ≈ 22–27 min.

## Rollback (within 7 days)

`run.sh rollback <switch time> --yes`:

1. v2's edge goes back to :18090 and `ml` off the GPU.
2. v2's rows since the switch are reverse-exported into v1's SQLite (a backup is kept):
   listens, signals, playlist edits, new accounts and invites.
3. v1 `musix` starts on :8000.

New uploads come back with a v1 rescan. Friends use `/download/musix-1.0.0.apk`.

## After

- **Day 0–3:** `/admin/ops`, the queue backlog, the error logs.
- **Day 7:** v1 is archived into `/mnt/data/musix-snapshots/final-v1/` (SQLite + the
  Qdrant snapshots), and its volumes are deleted.
- **Day 14:** `v2/` moves to the repo root in one commit.
