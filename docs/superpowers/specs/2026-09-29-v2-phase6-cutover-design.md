# v2 · Phase 6 — Cutover

**Date:** 2026-09-29 · **Program:** `2026-09-29-musix-v2-program-design.md` (§6 phase 6, §7)
**Status:** draft for the owner's review
**Goal:** move every user of the owner's instance from v1 to v2 in one planned switch.
There is a rehearsed runbook, a measured downtime and a rollback that works.

**Entry gate** (all must hold):

1. Phases 1–5 exit criteria met.
2. The migration gate is green on **two consecutive** snapshots (phase 3).
3. The Android v2 APK covers the cutover scope (phase 4 §6) and has been used daily by the
   owner on v2 for ≥ 1 week against a migrated snapshot.
4. The web v2 covers listening + admin (phase 5).
5. The v1 → v2 **reverse export** (§5) has been tested.

---

## 1. Topology before and after

```
before:  VPS nginx ─(tunnel)→ 127.0.0.1:8000  v1 musix  (+ qdrant, searxng)
after:   VPS nginx ─(tunnel)→ 127.0.0.1:18080 v2 nginx → api / worker / ml (+ postgres, qdrant v2)
```

- v1 and v2 run **side by side** on the home server: different ports, volumes and data
  stores. The switch is the VPS upstream plus the tunnel port. v1 is **stopped, not
  deleted**.
- **SearXNG** is shared: v2 uses the same instance.
- **GPU:** only one of v1 `musix` and v2 `ml` holds the models at a time. v1 is stopped
  before `ml` starts (the VRAM budget).

## 2. Rehearsal (≥ 2 times before the real run)

On a fresh snapshot, into a scratch v2 stack:

1. Time every step of §3. Record the downtime and the rendition backlog.
2. Run the gates on the result (phase 0): search, «Поток» replay, migration.
3. Log in with the v2 APK and the web as each account (test tokens), play, react and
   edit a playlist.
4. Run the rollback (§5) and verify that v1 comes back with the rehearsal's v2 events
   exported into it.

A rehearsal fails on any gate miss or on downtime above the target (30 min).

## 3. The runbook (real run)

`T` = the announced time, ideally a weekday morning, when the access logs show the fewest
listeners.

| Step | Action | Budget |
|---|---|---|
| T−7 d | Announce to friends: the date, "install the new app from the link when asked", what changes | — |
| T−1 d | Pre-build the `high` renditions for the most played tracks (top 2000 by `plays`) from the latest snapshot into the v2 volume | background |
| T−0 | v1 → **read-only**: nginx on the VPS answers `503 Retry-After` with a status page for writes; reads still work | 1 min |
| T+1 | Final snapshot (phase 0 tool) | 3 min (hashes cached) |
| T+4 | `tools/migrate` full run → v2 | < 20 min |
| T+24 | The migration gate (counts + checksums) | 5 min |
| T+29 | Stop v1 `musix`; start v2 `ml` (GPU), `api` and `worker`; smoke test (health, login, play) | 3 min |
| T+32 | Switch the VPS upstream to v2. Publish the v2 APK to `downloads/`, update `/app/android/latest` | 1 min |
| T+33 | Watch: error rate, p95 latency, queue depth, WS connections. The owner plays from both clients | 30 min |

After the switch:

- **Old 1.0.0 apps** keep calling `/api/v1/*`. v2's nginx answers those paths with `426
  Upgrade Required` and a JSON body naming `/download/musix.apk`. 1.0.0 shows the error;
  friends install v2 **over** it (same package, same key), which is why §0 had the
  announcement.
- The remaining renditions build in the background, and the manifest falls back to
  `lossless` until each is ready.

## 4. After the cutover

- **Day 0–3:** the owner watches `/metrics`, the queue backlog and the error logs.
  Friends' devices appear in `devices` as they log in.
- **Day 7:** if nothing forced a rollback, v1 containers and volumes are archived: the
  SQLite backup + the Qdrant snapshots go to `/mnt/data/musix-snapshots/final-v1/`, and the
  v1 volumes are deleted.
- **Day 14:** v1 code (`app/`, `frontend/`) is removed from the branch in one commit. The
  `genius-addition` prod branch gets the v2 merge.
- The optional VPS edge cache (phase 1 §5.3) is evaluated with real traffic and enabled if
  the VPS disk allows.

## 5. Rollback

- **Trigger:** a data-loss finding, an unrecoverable playback failure, or anything the owner
  calls.
- **Within 7 days:**
  1. Switch the VPS upstream back to v1.
  2. Restart v1 `musix`, which gets the GPU back.
  3. **Reverse-export** v2's new rows since the switch into v1's SQLite: listen events,
     signals, playlist edits, new invites/accounts.
     - The tool is `tools/migrate/reverse.py`, written and tested in the rehearsals.
     - New uploads stay on disk and get re-registered by a v1 rescan.
  4. Friends fall back to the 1.0.0 APK, still at `downloads/musix-1.0.0.apk`.
- **After 7 days** v1 is archived and a rollback means a restore; the runbook says so
  explicitly.

## 6. What v1 does that v2 must not — phase 6's share

| v1 habit | Cutover |
|---|---|
| Deploy = `docker compose up -d` over the running prod, with no rehearsal | A rehearsed runbook with budgets, gates and a tested rollback |
| Friends learn about changes when something breaks | Announced, with a 426 + download link for old apps and an in-app updater from then on |
