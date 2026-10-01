# MusiX v2

MusiX is a self-hosted music service for your own library: a Python server (FastAPI,
Postgres, Qdrant, an `ml` model host), the web client, Android and Windows. Since the cutover
on 2026-10-01 this is prod at musixai.ru. v1 lives only in the old branches' history.

- **The program:** `docs/superpowers/specs/2026-09-29-musix-v2-program-design.md`, with the
  phase specs next to it.
- **The plans:** `docs/superpowers/plans/`. Each plan ends with its status and rulings.
- **Prod:** `deploy/compose.prod.yml`, project `musix-v2`, with state under
  `/mnt/data/musix-v2-prod/`. It runs with `-f deploy/compose.prod.gpu.yml --profile ai
  --profile staging` and `MUSIX_EDGE_PORT=8000`; the VPS tunnel forwards musixai.ru to that
  edge.

| Path | What |
|---|---|
| `server/` | Python 3.13 backend (`musix`): FastAPI api, Procrastinate worker, `ml`, Alembic migrations |
| `contracts/openapi.json` | generated from the server (`make openapi`); a test fails on drift |
| `deploy/compose.dev.yml` | the dev stack: Postgres 18, Qdrant 1.18.2, nginx, api / worker / ml on `127.0.0.1:18xxx` |
| `design/` | tokens (DTCG) → CSS / Compose / XAML, component and surface specs, golden screenshots |
| `tools/snapshot/` | read-only prod snapshot → `/mnt/data/musix-snapshots/<date>/` (never in git) |
| `tools/v1copy/` | a throwaway v1 copy on a snapshot (`127.0.0.1:18800`), the gates' and benches' v1 baseline; it needs the v1 image, archived on day 7 |
| `tools/gates/` | search gates 4.1–4.3, prompt evals 4.5, migration scaffold 4.6 |
| `tools/recsys-eval/` | the «Поток» harness (E1–E4 + invariants), stream spec §10 |
| `tools/bench/` | performance benches (v1 baselines, v2 load) |
| `tools/migrate/`, `tools/cutover/` | the v1 → v2 migrator and the cutover runbook (rollback until 2026-10-08) |
| `android/`, `web/`, `windows/` | the clients |

```bash
make check                       # ruff + mypy --strict + pytest (unit, contract, testcontainers)
make dev [GPU=1]                 # the dev stack; `make down` stops it
make snapshot                    # take a v1 snapshot (history: v1 is stopped since the cutover)
make snapshot-restore SNAP=D     # load it into the dev Qdrant + a working DB copy
make gates SNAP=D [TARGET=v1]    # gates + the «Поток» harness on a v1 copy
make bench SNAP=D [MIN=5]        # v1 performance baselines
make design / design-check       # regenerate tokens → themes / fail on drift
```

**Rules:**
- prod (the stack above) changes only on the owner's go for that step;
- snapshots, fixtures, raw results, mood labels and real-library screenshots stay under
  `/mnt/data/musix-snapshots/`;
- anything that loads models runs on the CPU or is memory-capped, because the GPU belongs
  to prod and llama-server.
