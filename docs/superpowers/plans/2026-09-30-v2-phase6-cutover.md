# Phase 6 — Cutover: plan

> Native execution, blocks in order, each ending with its check and a commit (Russian
> subject). Tests only for clear functionality: 1 for this phase (the reverse export).
> **Every step that touches prod is a separate stop: I ask the owner right then, and act
> only on a yes given for that step.** The VPS counts as prod, and so do v1's containers,
> its SQLite, the tunnel, `downloads/`, and anything the friends receive.

**Spec:** `docs/superpowers/specs/2026-09-29-v2-phase6-cutover-design.md`.
**Owner's answer (2026-09-30):** no second VPS. v2 staging for the week of daily use runs
on the same VPS, and the desktop (v1 at `musixai.ru/`) must keep working.

## Global constraints

- **v1 keeps running untouched until the real run.** Allowed before then: read-only
  snapshots, a second tunnel beside v1's, and VPS `location`s that v1 does not use
  (`/api/v2/`, `/m/`, `/i/`). v1 only has `/api/v1/*` and its SPA catch-all.
- **The switch = the loopback port.** The VPS tunnel forwards to home `localhost:8000`. At
  T+29 v1 stops and v2's nginx takes `127.0.0.1:8000`. Nothing on the VPS changes for the
  switch; rollback is the reverse.
- **GPU:** v1 holds it until T+29. Before then v2 `ml` runs on the CPU (slow lyrics rerank)
  and the LLM is prod's llama-server.
- **Resources:** RAM is 31 GB and the swap is nearly full. The dev stack stops while the
  staging stack runs (staging doubles as phase 7's backend).
- **Secrets:** fresh v2 secrets in the prod volume. The Yandex token key comes only from
  the operator's env at the real run. Nothing is printed.
- **Friends are not touched before the owner says so:** no APK in `downloads/` and no
  announcement.

---

## Block 1 — The v2 prod stack (no prod impact)

- **What:**
  - `deploy/compose.prod.yml`, compose project `musix-v2`:
    - postgres, qdrant, ml (CPU by default; `gpu` profile), api (4 workers), worker,
      worker-ai (prod llama-server), searxng (its own), nginx;
    - bind-mounted state under `/mnt/data/musix-v2-prod/{pg,qdrant,media,secrets}`;
    - the edge on `127.0.0.1:${MUSIX_EDGE_PORT:-18090}`;
    - `public_base_url=https://musixai.ru`.
  - `deploy/nginx/v2-prod.conf`:
    - api, media, the web (`web.conf`), uploads (16 MB chunks);
    - `426 Upgrade Required` with a JSON download link on `/api/v1/*`;
    - `/download/` from the repo's `downloads/` (read-only);
    - no `/docs`.
  - `make prod-up|prod-down|prod-migrate` (the migrator's target media dir = the prod
    one).
- **Done when:** the stack starts empty on :18090 with health green and the web shell
  served.

## Block 2 — Staging for the owner's week (VPS: the owner's go per step)

- **What:**
  1. Snapshot #2 (read-only against prod; `make snapshot`).
  2. `make prod-migrate SNAP=<new>` into the prod stack; the gates must be green. This also
     gives the entry gate's second consecutive green snapshot.
  3. A second reverse tunnel, VPS `127.0.0.1:8001` → home `localhost:18090`, as a
     `systemd --user` unit. v1's `musix-tunnel.service` is not touched.
  4. VPS nginx: `location ^~ /api/v2/`, `/m/`, `/i/` → `127.0.0.1:8001` in the
     `musixai.ru` block, then `nginx -t` and reload. `/` stays v1.
  5. The v2 release APK (server `https://musixai.ru`) for the owner's phone only. It is
     not placed in `downloads/`.
- **Done when:** the owner's phone plays through `musixai.ru/api/v2` while
  `musixai.ru/` is still v1 (checked from outside: v1 login page + v2 `/api/v2/health`).

## Block 3 — Media backlog + reverse export

- **What:**
  - On staging: `media:backfill` (probe + loudness for the 7273 migrated files, then the
    `high` renditions, the top 2000 by plays first). Time it: that is the T−1 d step.
  - `tools/migrate/reverse.py SINCE → v1 SQLite`: v2's new listen events, signals,
    playlist edits and new invites/accounts since the switch, written into a **copy** of
    v1's `metadata.db`, idempotent (client event ids). Uploads stay on disk for a v1
    rescan.
- **Done when:** the backlog numbers are known. **Test (1):** a reverse export of a v2 DB
  after a few listens/edits → the rows exist in the v1 copy, and a re-run adds nothing.

## Block 4 — Rehearsals (×2, scratch database in the prod stack)

- **What:** `tools/cutover/run.sh --rehearsal`, the §3 runbook on a fresh snapshot into
  `musix_rehearsal`:
  - each step timed;
  - the gates;
  - a login per account through a rehearsal-only token tool;
  - play, react, edit a playlist;
  - then the rollback: reverse-export into the v1 copy (`tools/v1copy`, :18800) and check
    it shows the rehearsal's events.
- **Done when:** two rehearsals pass with downtime ≤ 30 min, recorded in
  `tools/cutover/README.md`.

## Block 5 — The real run (the owner sets T; each step asked)

- **What:**
  - the announcement text for the friends (the owner sends it);
  - T−1 d renditions;
  - T−0: v1 read-only (VPS: 503 on writes);
  - the final snapshot → migrate → gate;
  - stop v1 → v2 on :8000 with GPU `ml`;
  - publish the v2 APK to `downloads/musix.apk` (1.0.0 kept as `musix-1.0.0.apk`) and set
    `/app/android/latest`;
  - watch for 30 min.
- **Later, as the spec says:** day 7, archive v1; day 14, move `v2/` to the root.
- **Done when:** everyone is on v2, or the rollback is executed and verified.

## Review focus (end of phase)

1. v1 keeps working through Blocks 1–4 (checked after every VPS change).
2. No v2 secret or user data leaves the box; `/docs` and admin endpoints are not open on
   the VPS beyond what v1 exposes.
3. The rollback restores v1 with v2's new rows (tested, not assumed).
4. Old 1.0.0 apps get the 426 + download link, not a crash loop.
5. The GPU is never held by both v1 and v2 `ml`.
