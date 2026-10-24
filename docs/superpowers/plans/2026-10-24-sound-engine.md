# Sound engine — plan

Spec: `docs/superpowers/specs/2026-10-24-sound-engine-design.md`. Branch `sound-engine`
(worktree `/mnt/data/sound-engine`, from `v2` 10eed15). Prod steps need the owner's word.

Fidelity rule for every port: the prototype (`/mnt/data/tmp/sound-stage/`) is the oracle.
A ported piece is done when it gives the prototype's numbers on the prototype's inputs.

## Block 1 — `sound/` CPU measure (no GPU)

- **Do:** package `sound/` (`musix_sound`, py3.11, own `pyproject`/`uv.lock`). Vendor the
  DSP the CPU phase needs (`stage`, `scene`, `scene2`, `report`, `report2`, `structure`,
  `v3/analyse3`) under `musix_sound/proto/` with the sys.path hacks and fixed paths replaced
  by arguments. `measure.py` = analyse3 + the audio-reading parts of `features5`
  (stem shares, attack rates, per-stem dB curves at 2 fps, spectral fill) → one
  `measures` dict + stage frames.
- **Subtle:** `features5` reads stems and the mix; derive must not. Every audio read in it
  becomes a number in `measures`. LRC sections are only a fallback when SongFormer failed.
- **Done when:** `measure` on 5 tracks of `v3/work` reproduces `v3/out/<k>.json` (same
  numbers to rounding) and the features5 audio values for the demo4 tracks.

## Block 2 — `sound/` GPU stages, batch runner, guard, API

- **Do:** `stages.py` (port of `gpu3.py` + `tag3` + `tagall`: sep ov2 / drums / dereverb /
  beats / tags incl. the full 527 on the mix / struct), `guard.py` (`/proc/stat` CPU,
  NVML util), `batch.py` (GPU phase stage by stage, then CPU pool cores−2 nice 19, scratch
  wiped at start and end, `keep_stems` export), FastAPI app (`/health`, `/v1/batches`).
- **Subtle:** NVML free check before each stage load; SongFormer tail sliver; struct only
  fits when `ml` is lent (test it after ml release exists, or on one track at a quiet time).
- **Done when:** one track runs end to end on the host GPU (stages that fit beside `ml`),
  output equals block 1 on the same stems; guard unit test.

## Block 3 — server: migration 0029, tables, derive

- **Do:** `0029_sound.py` (`gpu_lease`, `sound_analysis`, `sound_profiles`, `sound_texts`),
  `contexts/sound/models.py`, `derive.py` (report3 words + features5 + calib constants,
  Genius from `song_tags` / `song_credits` / `song_relations`), words as keys.
- **Done when:** derive on the measures of block 1 matches `demo4/feat5` (scales ±2, same
  instruments / drums / traits / sections, moments ±1 s); migration applies in tests.

## Block 4 — server: lease, tick, batch task, ml release/acquire

- **Do:** `ml` `/v1/gpu/release|acquire`, 503 `gpu_lent`, `/health` gpu state, NVML
  refusal. Server `sound:tick` (pure transition function + advisory lock), `sound:batch`
  (poll, upsert per item, derive), `intel:embed` inserts the pending row, waiting `gpu`
  jobs rescheduled at swap back, `sound:backfill`, `sound:derive_backfill`, re-derive after
  `knowledge:genius_page`, `sound:export_stems`.
- **Done when:** transition-table test; integration test: embed → pending row; batch task
  against a fake ml-sound writes measures + profile.

## Block 5 — texts, read API, admin status

- **Do:** `texts.py` (signature / album_sound / timeline: facts → draft → editor pass →
  code check), deferred only while holder=ml; `/tracks/{id}/sound`, `/sound/stage`,
  `/albums/{id}/sound`, `/artists/{id}/sound`, `/admin/sound/status`; contract + codegen.
- **Done when:** endpoint shape test (404/200); check rejects names/timecodes.

## Block 6 — image, compose, rollout (owner's go per step)

- **Do:** `sound/Dockerfile`, `compose.prod.yml` / `.gpu.yml` service, weights copied to
  `/mnt/data/musix-v2-prod/sound-models`, queue `sound` on `worker`. Deploy order of spec
  §13, three-song upload test, 57 demo tracks first, fidelity report, then backfill.
- **Done when:** spec §14 checks.

## Status 2026-10-24 (evening): blocks 1–5 and block 6's code done, nothing deployed

- Built and checked: 57/57 derive fidelity; album facts = album6 (differences: the two keys of
  «струнные и медные духовые», tag ties in song order); live GPU batch of 3 tracks (190 s, all
  SAME as the prototype; real VRAM peaks in `stages.PEAK_MB`); the image on CPU end to end;
  `make lint`/`test` for server (131), ml (4), sound (5); C# and TS clients compile (Kotlin
  codegen was already broken on `main`'s contract: `OffsetDateTime` serializer, not ours).
- Measured, not as the spec guessed: 8 CPU workers peak at 21.6 GB → 4 workers (~11 GB),
  `mem_limit: 16g`; NVML was missing in the prototype env (the guard ran blind in the live test)
  → required on cuda now.

## Rollout runbook (each step on the owner's word, in /mnt/data/v2-branch after merging)

Never `make prod-up` (it builds web in the deployed checkout); compose per service:
`P="docker compose --env-file /mnt/data/musix-v2-prod/prod.env -f deploy/compose.prod.yml -f deploy/compose.prod.gpu.yml"`

0. Prep (no effect on prod): rollback tags `musix-v2-server:prod-MMDD-pre`, `musix-v2-ml:prod-MMDD-pre`;
   `mkdir -p /mnt/data/musix-v2-prod/{sound-models,sound-scratch,sound-export}` (owner uid 1000);
   models = `sep/` (BS-Roformer-SW, MDX23C-DrumSep, anvuew dereverb + their yaml +
   download_checks.json, from /mnt/data/envs/sep-models), `beat_this/beat_this-final0.ckpt`,
   `efficientat/` (/mnt/data/envs/v3-src/EfficientAT), `songformer/` (/mnt/data/envs/songformer-hf),
   `hf/hub/models--facebook--wav2vec2-conformer-rope-large-960h-ft` (one config);
   the 33 MB `sound-cuda` overlay (command in compose.prod.gpu.yml); `df -h /` ≥ 5 GB;
   `$P build ml-sound`, then `docker builder prune -f`.
1. Migration 0029: `$P run --rm migrate` (additive; rollback = leave the tables).
2. ml with release/acquire: `$P build ml && $P up -d ml` (~1 min without vectors).
3. Server: `$P build api && $P up -d api worker worker-media worker-ai`. With ml-sound absent the
   tick sees it down and leaves the card with ml.
4. ml-sound: `$P up -d ml-sound`; `/admin/sound/status` shows holder ml, nothing pending.
5. Three-song upload test (spec §14.2): lease ml → sound → ml, profiles, waiting embed_text jobs
   run after the swap, the assistant answers during and after, guard log, nvidia-smi ≤ 290 W.
6. The 57 demo tracks (`sound:backfill` with `only`, priority 99), fidelity report vs prototype,
   the owner reads 10 profiles and texts; the 10 songs' stems export.
7. The library backfill — on his word.

Rollback at any step: `$P stop ml-sound`; `update gpu_lease set holder='ml'`; `curl -X POST ml:8002/v1/gpu/acquire`
(from a container on the network); server/ml images back to the `-pre` tags.
