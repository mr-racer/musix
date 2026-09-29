# v1 Playwright e2e (moved in from the 2026-09-29 staging copy)

`./run.sh` — one command, fully isolated from prod:

- a throwaway Qdrant `musix-e2e-qdrant` on `127.0.0.1:6399`;
- a fresh SQLite, three generated 150 s tones and a v1 bundle, all under `.run/`
  (gitignored);
- v1 served on `:8011` from the repo, **imported, never edited**, with a fault-injecting
  wrapper on the stream endpoint (`serve.py`).

Four scenarios in `test_playback_e2e.py`:
- a mid-stream network cut;
- an expired stream token;
- a service-worker update deferred until nothing plays;
- the playback diagnostics journal.

`smoke.mjs` is a headless check that the bundle boots, over CDP.

Environments:
- `seed.py` / `serve.py` run on `/home/ivan/miniconda3/bin/python`, which has v1's
  requirements;
- pytest + Playwright run in `/mnt/data/envs/musix-e2e` with the system Chrome.

Both are set in `env.sh`. The v1 bundle is built from `frontend/` into `.run/dist`, so
v1's own `frontend/dist` is never touched.
