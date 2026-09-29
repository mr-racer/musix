# MusiX v2

The rewrite lives in this folder. The old code (v1, the running prod) stays at the
repository root untouched, and at the cutover (phase 6) the root is replaced by this folder's
content. Specs: `docs/superpowers/specs/2026-09-29-musix-v2-program-design.md` and the
phase specs next to it.

| Path | What |
|---|---|
| `server/` | Python 3.13 backend (`musix`): FastAPI api, Procrastinate worker, `ml`, Alembic migrations |
| `contracts/openapi.json` | generated from the server (`make openapi`); a test fails on drift |
| `deploy/compose.dev.yml` | dev stack next to v1: Postgres 18, Qdrant 1.18.2, nginx, api / worker / ml on `127.0.0.1:18xxx` |
| `design/` | tokens (DTCG) → CSS / Compose / XAML, component and surface specs, golden screenshots |
| `tools/snapshot/` | read-only prod snapshot → `/mnt/data/musix-snapshots/<date>/` (never in git) |
| `tools/v1copy/` | a throwaway v1 copy on a snapshot (`127.0.0.1:18800`), for gates, benches and screenshots |
| `tools/gates/` | search gates 4.1–4.3, prompt evals 4.5, migration scaffold 4.6 |
| `tools/recsys-eval/` | the «Поток» harness (E1–E4 + invariants), stream spec §10 |
| `tools/bench/` | v1 performance baselines |
| `tools/e2e-v1/` | the v1 Playwright suite (`run.sh`; `run.sh --golden` for the fixture screenshots) |

```bash
make check                       # ruff + mypy --strict + pytest (unit, contract, testcontainers)
make dev [GPU=1]                 # the dev stack; `make down` stops it (v1 keeps running)
make snapshot                    # take today's prod snapshot (read-only against prod)
make snapshot-restore SNAP=D     # load it into the dev Qdrant + a working DB copy
make gates SNAP=D [TARGET=v1]    # gates + the «Поток» harness on a v1 copy
make bench SNAP=D [MIN=5]        # v1 performance baselines
make design / design-check       # regenerate tokens → themes / fail on drift
```

**Rules:**
- prod is read-only;
- snapshots, fixtures, raw results, mood labels and real-library screenshots stay under
  `/mnt/data/musix-snapshots/`;
- anything that loads models runs on the CPU or is memory-capped, because the GPU belongs
  to prod and llama-server.
