# v2 · Sound engine — sound analysis at ingest

**Date:** 2026-10-24 · **Status:** draft for the owner's review
**Goal:** every song in the library, old and new, gets an analysis of its sound: the stems'
placement and space, which instruments are certain, tempo feel, sections, moments worth
hearing, three absolute ratings (spaciousness, technicality, unusualness) and a short
validated text. The engine stores it in Postgres for the later projects: the player,
«Поток», and sound search. It ports the research prototype (`/mnt/data/tmp/sound-stage/`,
v3 stack + demo 4–6) into prod without ever running heavy GPU and heavy CPU work together,
because that combination powered the host off three times on 2026-10-17.

**Exit criteria.**

- A song uploaded on prod gets a sound profile without anyone touching the stack. The
  GPU switches from `ml` to `ml-sound` and back on its own, and the text vectors of the
  new songs are indexed right after.
- On the 57 demo tracks the prod output matches the prototype (§14), and the owner has
  read the profiles and texts of ten songs he knows.
- The library backfill runs to the end with visible progress, and the host never powers off.
- The owner has the stems of 10 favourite songs to listen to (§6.6), and no stem is stored
  anywhere else.

---

## 1. What the owner decided (2026-10-18 … 2026-10-24)

1. **Separation is BS-Roformer SW at overlap 2.** The models run one after another, with
   one model in VRAM at a time (10-18).
2. **Existing prod services stay as they are**, CPU and GPU in parallel. Only the new
   sound models must load the CPU and the GPU together as little as possible, without
   losing much speed (10-18).
3. **The GPU switches on demand.** When songs arrive, `ml` is unloaded and `ml-sound` is
   loaded. `ml` comes back when the sound work is done and the text needs indexing. Online
   is small: nobody suffers if `ml` is down while someone asks the assistant (10-24).
4. **New uploads always get the analysis**, and the whole library is backfilled (10-24).
5. **No stems are saved, anywhere.** The one exception is a one-off export of 10 songs'
   stems for the owner to listen to (10-18, 10-24).
6. **The GPU power cap is not ours to control.** The owner keeps a permanent 290 W limit
   (10-24).
7. **Three layers are saved:** raw measurements, the product profile, and the LLM texts.
   A text is saved only after a second, validating pass (10-24).
8. **Product rulings that shape the data (10-18):**
   - The ratings are absolute, library-independent numbers on fixed formulas and bounds,
     read at a glance. Text only supplements them.
   - Instrument lanes (who plays when) stay in research and are not a prod output.
   - Vocal distance (near/far) is unreliable and is not shown. Echo is.
   - Raw features never reach the user. Only claims that pass the calibrated thresholds do.
   - No note or melody transcription.
   - No BPM numbers for the user, only tempo words.
   - Sections (verse/chorus) are reliable and ship.
9. **LLM text style** (memory `llm-text-style`, 10-18):
   - Human and varied, no AI patterns.
   - The song «изюминка» is about the sound only: no artist or sample names, no
     timecodes, never "the beat drops".
   - Album texts compare with the previous album by year.
   - Saying nothing beats a filler phrase.

## 2. Scope

**Goals.**

- `ml-sound`: a GPU+CPU service that measures one batch of songs at a time.
- The GPU lease between `ml` and `ml-sound`.
- A load guard that keeps heavy CPU and heavy GPU work apart.
- Three Postgres layers (migration 0029).
- A server-side `derive` step that turns measurements into the profile and can be re-run
  without the GPU.
- LLM texts with an editor pass.
- Library backfill.
- Read endpoints for track, album and artist.

**Non-goals (later projects that read this data).**

- Player UI: ratings, sections on the seek bar, moments, sound card, live stage.
- «Поток» features and the «Просторное / Экспериментальное / Инструментальное» presets.
- Sound filters in search and in the assistant.
- "Why I like it" aggregates per account.
- Qdrant payload copies of sound fields.

**Anti-goals: it fails, even if it works, when:**

- the host powers off;
- `ml` and `ml-sound` swap back and forth every few minutes;
- a song waits for the sound analysis before it can be played or searched. Sound never
  gates `ready`;
- an uncertain claim or an AI-flavoured text reaches the user;
- stems pile up on disk.

## 3. Where it sits in the ingest chain

```
register → media:process (transcode)            ┐  CPU work of an upload, as today
        → intel:start → lyrics → embed (CLAP+BM25) → indexed → song plays and is found
                                    │                └→ intel:embed_text (queue gpu, needs ml)
                                    └→ sound_analysis row: pending
sound:tick (every minute) ── sees pending, upload CPU work done ──→ lease ml → sound
   sound:batch → ml-sound: GPU phase (6 models, one at a time) → CPU phase → measures
              → derive (server) → sound_profiles
   queue empty → lease sound → ml → waiting embed_text jobs run now → sound texts (queue ai)
```

`intel:embed` inserts the `sound_analysis` row (`pending`, priority 100) when it succeeds,
in the same transaction that sets `indexed`. A file another account already owns has its row
already, so nothing is inserted twice.

`intel:embed_text` jobs that are already queued run before the swap if `ml` is still up.
Jobs that arrive during the lease wait (ml answers 503) and are rescheduled to *now* at the
swap back.

## 4. The GPU lease

**VRAM.** llama-server holds 15.3 GB, the desktop ~0.7 GB, and `ml`'s trio 5.8 GB. That
leaves ~2.4 GB, and SongFormer peaks at 4.8 GB. Once `ml` releases its models (its CUDA
context stays, ~0.5 GB), ~8 GB are free. That is enough for the largest sound stage plus
`ml-sound`'s own context.

**State.** A single row, `gpu_lease(holder 'ml'|'sound', changed_at, reason)`, holds the
state. Only `sound:tick` changes it: a periodic task in queue `default` that runs every
minute under a Postgres advisory lock.

| From | Condition | Action |
|---|---|---|
| ml → sound | there are pending rows whose file is `media_done` and `indexed`; there are no `doing` jobs in queues `media` and `ml` (the upload's CPU work is done); `ml-sound` is healthy | `POST ml /v1/gpu/release` (it waits for the op in flight), then holder=sound, then defer `sound:batch` |
| sound, a batch finished | upload items are still pending | next batch |
| sound, a batch finished | only backfill items are pending, and `gpu`-queue jobs are waiting | hand the GPU back to `ml` until queue `gpu` drains, then return. The batch length (~15–20 min) bounds the swap rate |
| sound → ml | nothing is pending, or `ml-sound` is down | holder=ml, then `POST ml /v1/gpu/acquire` (warm load), then reschedule waiting `gpu` jobs to now, then defer the sound texts that waited (§9) |

**Reconcile every tick.** `ml /health` reports `gpu: loaded | lent | empty`.

- If holder=sound and `ml` says loaded (it restarted and preloaded), the tick releases it
  again.
- If holder=ml and `ml` says lent (the tick crashed mid-swap), the tick acquires it.
- If holder=sound and a batch is active on `ml-sound` but no `sound:batch` job is doing,
  the tick re-attaches the batch by its id (`ml-sound` survives worker recreation).

**`ml` changes (small).**

- `release` runs on the executor thread. It drops the GPU models from the load cache,
  then runs `gc` and `torch.cuda.empty_cache()`.
- While `ml` is lent, GPU ops answer 503 (`gpu_lent`, `Retry-After`), so callers get
  `Unavailable` and degrade as they already do with `ml` stopped. The assistant runs
  without dense and the reranker, and lyrics search runs on BM25.
- `acquire` clears the flag and preloads in the background.
- `ml` also refuses to load a GPU model when NVML shows less free memory than the model
  needs. This safety net covers restarts.
- `ml-clap` is CPU-only and unaffected.

## 5. The load guard (power)

The crashes on 2026-10-17 happened only when the GPU lane (RoFormer at 290 W) and the CPU
lane ran together. The cap stays at 290 W (§1.6), so the only protection is to not overlap:

- **Inside `ml-sound`**, the phases never overlap: one batch does its GPU phase, then its
  CPU phase. It is one process with one batch at a time.
- **Against the rest of prod**, the guard checks before each item:
  - before a GPU item (one model × one track), host CPU busy over the last 5 s must be
    under 35% (read from `/proc/stat`, which shows the host);
  - before a CPU-phase track, GPU utilization over the last 5 s must be under 20% (NVML).
    Utilization is used, not watts: the GPU idles at 120–135 W while remote desktop is
    connected, while llama generating is busy.
- When the guard waits, it polls every 2 s, logs any wait over 30 s, and counts waits in a
  metric. An overlap is at most one item (≤ ~25 s on SW).
- These starting thresholds are the builder's to tune, from one measured run.
- **The CPU phase** runs on a process pool of cores−2 at `nice 19`. The owner's rule from
  10-18: use all cores when the GPU is idle.
- **Residual risk.** Load transients inside the GPU phase (stage changes) still happen at
  290 W. They happen with the CPU quiet, which matches the GPU-only runs that never
  crashed.

## 6. `ml-sound`

### 6.1 Package and image

- **Package.** A new package `sound/` (`musix-sound`, Python 3.11) with its own `uv.lock`.
  It cannot share `ml`'s environment:
  - `ml` pins numpy 1.26 (for laion-clap) and transformers 5.15;
  - the prototype runs on numpy 2 and transformers 4.46.3 (SongFormer's loader).
- **Pins taken from the prototype environment** (`/mnt/data/envs/musix-emb` +
  `--target` dirs), which ran the whole v3 stack:
  - torch 2.6.0+cu124;
  - audio-separator 0.47.0 with `rotary-embedding-torch<0.7` and `beartype<0.19` (newer
    versions give silent output);
  - beat_this 1.1.0;
  - transformers 4.46.3;
  - librosa 0.11;
  - SongFormer and EfficientAT code vendored from `/mnt/data/envs/v3-src`, with their
    licences.
- **Image.** `musix-v2-sound:prod` ships CPU torch, like `ml`. CUDA torch comes from the
  existing overlay `/mnt/data/musix-v2-prod/ml-cuda` (torch 2.6 cu124, py3.11) through the
  GPU compose override, with `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`.
- **Weights** live in `/mnt/data/musix-v2-prod/sound-models`, mounted read-only and copied
  from `/mnt/data/envs/{sep-models,songformer-hf,hf-cache}`:
  - SW, DrumSep and dereverb checkpoints;
  - beat_this;
  - EfficientAT mn10;
  - SongFormer with MuQ and MusicFM.

  The service runs with `HF_HUB_OFFLINE=1`.
- **Mounts:**
  - music and media read-only, with `ML_MEDIA_ROOTS` like `ml-clap`;
  - scratch `/mnt/data/musix-v2-prod/sound-scratch` read-write;
  - the owner's stem export `/mnt/data/musix-v2-prod/sound-export` read-write (§6.6).

### 6.2 API (one batch at a time)

- `GET /health` returns `{ok, gpu_free_mb, batch: id|null, stage}`.
- `POST /v1/batches {items: [{id, path, channels, duration_ms}]}` returns 202 `{batch_id}`.
  If a batch is already active, it returns 409 with that batch's id.
- `GET /v1/batches/{id}` returns `{state: gpu|cpu|done, stage, done: [{id, measures,
  stage_frames_b64, gpu_ms, cpu_ms}], failed: [{id, error, retryable}]}`. Items show up in
  `done` as soon as their CPU analysis ends.

`sound:batch` (server, queue `sound` on `worker`; it only waits on HTTP) picks the batch,
polls every 10 s, and upserts each finished item at once, so a recreated worker loses
nothing. The path the server sends is the `lossless_compat` rendition when one exists
(ALAC→FLAC, Dolby→AAC). Otherwise it is the original, the same file CLAP reads.

**Batch size: 16 (my call).** The model loads then cost ~5% of the batch. Scratch stays
around 2 GB, and a batch lasts ~15–20 min, which bounds how often the lease swaps.

### 6.3 GPU phase: stage by stage over the batch

Each stage loads its model once, runs every track of the batch, then unloads it (`del` +
`empty_cache`). Before each load it checks NVML free memory ≥ the stage peak + 512 MB. If
there isn't enough, the batch goes back as retryable and stays pending.

| Stage | Model | Per track (prod config, measured 10-18) | Peak VRAM |
|---|---|---|---|
| sep | BS-Roformer SW, 6 stems, overlap 2 | 21–26 s | 1.55 GB |
| drums | MDX23C DrumSep on the drums stem (kick, snare, toms, hh, ride, crash) | 9–10 s | 0.8 GB |
| dereverb | anvuew Mel-RoFormer on vocals (echo windows) | 7–9 s | 2.0 GB |
| beats | beat_this (beats, downbeats) | 1 s | 0.36 GB |
| tags | EfficientAT mn10, AudioSet 527, **10 s windows** (3 s windows give garbage), mix + stems | 7 s | 0.3 GB |
| struct | SongFormer fp16, 240 s windows; trim a tail sliver ≤1024 samples (it loops forever otherwise) | 4 s | 4.8 GB |

That makes ~55 s of GPU per track. Input is decoded once by ffmpeg into 44.1 kHz stereo WAV
in scratch.

### 6.4 CPU phase

This is the port of `analyse3.py` and the DSP it imports (`stage.py`, `scene.py`,
`scene2.py`). It works per stem and band:

- pan, M/S width, L/R correlation, tail after onsets, crest, rolloff;
- part lanes;
- tempo from DrumSep kick/snare;
- the live-stage frames: 6 stems × 10 fps × (level, pan), int8, gzip, 13–31 KB per track.

It takes ~30 s per track on one core and runs as a pool of cores−2 under the guard (§5).
The output is the `measures` document (§7). Lanes stay inside `measures` because derive
needs them for moments and sections. They are never an output on their own.

### 6.5 No stems

Stems, drum parts and dry vocals exist only in scratch during their batch. Scratch is wiped
at the start and the end of every batch. A batch starts only with ≥10 GB free on
`/mnt/data` (`musix-disk-guard` stops worker-media at 3 GB).

### 6.6 The owner's 10 songs (one-off)

A batch item can carry `keep_stems: true`. For such an item, `ml-sound` copies the 6 stems
and the drum parts as FLAC to `sound-export/<artist> — <title>/` before scratch is wiped.

`procrastinate defer sound:export_stems '{"media_file_ids": [...]}'` re-queues those files at
priority 100 with the flag. They go through the normal lease and guard, so no manual GPU work
runs beside a batch, and their measures are refreshed as a side effect.

- Default pick: his 10 most fully played tracks. He can swap any of them.
- It runs once. The export dir is the only place stems ever stay, and nothing about it goes
  into the DB.

## 7. Storage (Postgres, migration 0029)

All tables are keyed by content (`media_file_id`), like `axes` and `envelope`, so a file
owned by several accounts is analysed once. The migration is additive.

```sql
gpu_lease (                      -- one row
  id smallint PK CHECK (id = 1), holder text NOT NULL,   -- ml | sound
  changed_at timestamptz NOT NULL, reason text)

sound_analysis (                 -- layer 1: what only the GPU can give
  media_file_id uuid PK REFERENCES media_files ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending',   -- pending | running | done | failed | skipped
  priority smallint NOT NULL DEFAULT 0,    -- 100 = upload, 0..99 = backfill by plays
  attempts smallint NOT NULL DEFAULT 0, error text,
  extractor_ver smallint,                  -- bump = a new GPU pass (a deliberate backfill)
  measures jsonb,                          -- per stem/band numbers, lanes, beats, downbeats,
                                           -- SongFormer segments, drum parts, tag windows
                                           -- (top-k per 10 s window), tempo raw; ~10–40 KB
  stage_frames bytea,                      -- gzip(int8[frames][6][2]) at 10 fps
  gpu_ms int, cpu_ms int,
  queued_at timestamptz NOT NULL DEFAULT now(), analysed_at timestamptz)
  -- index (priority DESC, queued_at) WHERE state = 'pending'

sound_profiles (                 -- layer 2: what the product reads; derive writes it
  media_file_id uuid PK REFERENCES media_files ON DELETE CASCADE,
  derive_ver smallint NOT NULL,            -- bump = re-derive everything, no GPU
  space smallint, tech smallint, odd smallint,   -- 0–100, absolute; NULL = not measurable
  facets jsonb NOT NULL,   -- {"space":{"width","spread","echo"},
                           --  "tech":{"layers","sound_work","playing","development"},
                           --  "odd":{"sounds","mix_extremes","form","style"}}
  evidence jsonb NOT NULL, -- what moved odd/tech (rare names, extremes, Genius style tags,
                           -- credits, samples): input for texts and for debugging
  instruments text[] NOT NULL DEFAULT '{}',  -- certain claims only: guitar, strings, brass,
                                             -- piano, winds, 808, synth, …
  drums text,              -- live | machine | NULL (plain «барабаны»)
  vocals text,             -- male | female | mixed | none
  vocal_share real,        -- for «Инструментальное»
  pace text, felt_bpm real,      -- tempo word key; the number is never shown
  echo text, width text,         -- word keys
  stems jsonb NOT NULL,    -- per stem {name, side, width}: live-stage labels; no distance
  traits text[] NOT NULL DEFAULT '{}',   -- keys for filters, presets, "why I like it"
  feat real[] NOT NULL,    -- fixed-order vector (~30, absolute bounds), names = FEAT_NAMES
                           -- of derive_ver: the ranker's sound features later
  sections jsonb NOT NULL, -- [{start, end, kind, n}]: intro|verse|chorus|bridge|instrumental|outro
  moments jsonb NOT NULL,  -- [{t, kind, stem, side, section}], ≤ 8
  derived_at timestamptz NOT NULL)
  -- GIN (instruments), GIN (traits)

sound_texts (                    -- layer 3: validated LLM texts
  subject_kind text NOT NULL,    -- media_file | album | artist
  subject_id uuid NOT NULL, kind text NOT NULL,   -- signature | album_sound | timeline
  lang text NOT NULL,            -- ru for now
  state text NOT NULL,           -- ok | none (no strong fact) | rejected (editor/check)
  text text,                     -- only when state = ok
  facts jsonb NOT NULL, facts_hash text NOT NULL, model text,
  generated_at timestamptz NOT NULL,
  PRIMARY KEY (subject_kind, subject_id, kind, lang))
```

- **Words are stored as keys.** The phrase is built at read time from templates in the
  request's language. Wording fixes and English then need no re-derive (my call).
- **Total size** for ~8k files is ~0.5 GB.

## 8. Derive (server, CPU, no GPU)

`server/src/musix/contexts/sound/derive.py` is a pure function: `measures` + Genius data +
canonical track meta → a `sound_profiles` row. Thresholds change in a server deploy, without
rebuilding `ml-sound`. It ports:

- **from `demo4/features5.py`:**
  - the three scales with facets;
  - technicality = 0.7·mean(top-2 facets) + 0.3·mean(the other two);
  - unusualness with the non-music AudioSet p90 signal and the Genius «стиль» facet;
  - moments: first entry of a rare part only (again after 45+ s away), a beat drop ≥6 s
    after ≥15 s of beat, ≤8 per song;
  - traits, and the tempo feel (pace = felt×1.5 when there are ≥2 drum hits per beat);
- **from `v3/report3.py`:** placement, echo and width words, and the section tidying (a
  voiceless verse or chorus becomes «проигрыш», an intro only at the start, everything
  after the outro is outro);
- **from `calib2.py` / `claim_thr.json`:** instrument claims at precision ≥90%, as constants
  with their provenance:
  - guitar 0.205, strings 0.065, brass 0.392, piano 0.255;
  - woodwind is never claimed alone (it becomes «духовые» only with brass);
  - drums are live at ≥0.069 and machine at ≤−0.065; anything between is plain «барабаны»;
  - bass isn't named when the bass stem share is under 1%.

**Genius inputs** (in prod since 10-18), through `tracks.song_id`:
- `song_tags` (source genius) for the style facet;
- `song_credits` for technicality and the instrument evidence;
- `song_relations` (sample, verified) for the vocal-samples flag.

**Triggers:**
- right after the measures are written;
- after `knowledge:genius_page` writes for a song: re-derive its media files that have
  measures;
- `sound:derive_backfill` on a `derive_ver` bump.

Derive takes milliseconds per track and runs on `worker`.

## 9. LLM texts (queue `ai`, worker-ai)

Every text goes through the same path:
1. Code builds the facts.
2. The LLM writes a draft.
3. A second LLM pass edits the draft against the facts. This is the port of
   `demo4/textpass.py`: drop anything not in the facts and any invented links between
   facts, fix grammar and non-words, strip stock phrases, keep harmless imagery.
4. Code applies only the owner's explicit lines.

The text is saved only when all four steps pass. Otherwise the row gets `rejected` or
`none` and no text, and it is regenerated only when `facts_hash` changes. Generation goes
through `infra/llm.Llm`, with 2–4 tone samples and the openings already used (memory
`llm-text-style`).

- **Song «изюминка»** (`signature`, port of `signature6.py`):
  - code ranks ≤4 facts and the LLM writes one phrase;
  - it is about the sound only: no artist or sample names, no timecodes or «в начале / в
    середине», never "the beat drops / a part stops";
  - the trick is what is rare for the genre;
  - no strong fact means no phrase (17 of 57 demo tracks had none).
- **Album** (`album_sound`, port of `album6.py`):
  - only albums with ≥3 analysed recordings;
  - the facts are pooled mean/min/max of the scales and the trait shares;
  - code picks the opening angle from the album's most distinctive trait, and the LLM
    writes only the hook;
  - it compares with the artist's previous album by year, never «его другие работы»;
  - «заметно» only for big shifts;
  - a trait "came/went" only when it flips ≥2/3 vs ≤1/5;
  - no «Послушай…» tips.
- **Artist timeline** (`timeline`): artists with ≥2 pooled albums. It tells the
  album-to-album shifts in sound words, never «оценки».

**When.** Texts are deferred only while holder=ml. Profiles derived during a lease get their
texts at the swap back (§4). This keeps the LLM's GPU load away from the sound CPU phase.

## 10. Read API (`/api/v2`, usual auth, contracts + codegen updated)

- **`GET /tracks/{id}/sound`** returns:
  - ratings with facets;
  - instruments, drums, vocals, tempo, echo and width, as labels in the request language;
  - sections and moments with labels;
  - the per-stem placement;
  - `signature` when `ok`;
  - `has_stage` and `ver`.

  It answers 404 `{state: pending|failed|skipped}` before the analysis exists. The ETag is
  built from (`etag.REV`, derive_ver, derived_at, text generated_at).
- **`GET /tracks/{id}/sound/stage`** returns the frames, `Content-Encoding: gzip`. A header
  carries fps and stem order. Cached as immutable by `analysed_at`.
- **`GET /albums/{id}/sound`** returns the pooled ratings (mean, min/max with their tracks),
  trait shares and the album text. The pool covers every analysed recording of the album,
  which is shared data like facts (my call).
- **`GET /artists/{id}/sound`** returns the timeline text and the per-album pools by year.
- **`GET /admin/sound/status`** (owner) returns:
  - lease holder and the current batch with its stage;
  - pending upload/backfill counts, done, failed;
  - the ETA.

## 11. Backfill and order

- **Starting it.** `sound:backfill` inserts pending rows for every `indexed` media file
  without one. Backfill priority is 0–99, by plays over the last 180 days across accounts.
  Uploads get 100, so they always go first.
- **Cost.** About 60–65 s per track: ~55 s GPU, ~3–4 s effective CPU, plus model loads. For
  ~7–8k files that is **about 5 days** of continuous work, during which `ml` is mostly lent.
- **Visibility.** Progress shows in `/admin/sound/status` and in one log line per batch.
- **Start.** The backfill starts on the owner's word, and the 57 demo tracks go first
  (priority 99). The run pauses after them (`sound:backfill` with `only`) for the fidelity
  check (§14.1) and the owner's read. The rest of the library follows his go.

## 12. Failures and edge cases

- **Retryable** (`Unavailable`: VRAM short, disk short, `ml-sound` down): the row stays
  pending.
- **A broken or undecodable file** fails once, with `error` set.
- **Repeated crashes on one item** (an OOM, say): three attempts, then failed.
- **Mono files:** `space` is NULL (pan and width are undefined). Everything else is derived.
- **Under 30 s or over 20 min:** skipped, with a reason (my call).
- **The same content uploaded again** (same sha256): already done, no work.

## 13. Ops and rollout

- **Compose:**
  - `ml-sound` goes in `compose.prod.yml` (CPU by default) and `compose.prod.gpu.yml`
    (device reservation, overlay `PYTHONPATH`, alloc conf);
  - `mem_limit` is measured by the builder (~12 GB expected);
  - queue `sound` is added to `worker`.
- **Disk.** A cold image build needs ~4 GB on `/`. Check `df -h /` first, then remove the
  old image and run `docker builder prune` after.
- **Deploy order:**
  1. migration 0029;
  2. `ml` with release/acquire;
  3. server (tasks, derive, texts, API);
  4. `ml-sound`;
  5. a three-song upload test (§14);
  6. the backfill.

  Every prod step needs the owner's word in the same turn.
- **Rollback:** stop `ml-sound`, set `gpu_lease.holder = ml`, then `acquire`. The tables
  stay, since the migration is additive. The server keeps working without `ml-sound`
  (pending rows just wait).
- **Metrics:** batches; items ok/failed; stage seconds and VRAM peak per stage; guard
  waits; lease swaps.

## 14. Checks ("done when")

1. **Fidelity.** On the 57 demo tracks (`night/tracks.json` + extras), the prod
   measures → derive output is compared with `demo4/feat5` / `signature6`:
   - scales within ±2;
   - the same instruments, drums, traits and section kinds;
   - moments of the same kind within ±1 s.

   Every difference is listed with its cause. The owner reads 10 profiles and texts.
2. **Upload.** Three uploaded songs on prod:
   - the lease goes ml → sound → ml;
   - the profiles appear;
   - the waiting `embed_text` jobs finish within a minute of the swap back;
   - the assistant answers during and after;
   - the guard log shows no overlap over one item.
3. **Backfill.** It runs with a falling ETA and no power-off. Failures are under 1% and each
   has an error.
4. **Stems.** The owner has the 10 songs' stems. Scratch is empty after every batch.

**Tests:** about 10 in total, per the working style:
- derive on 3 fixture measures;
- the lease transition table (a pure function);
- the guard decision;
- that the migration applies;
- the shape of the track sound endpoint (404/200);
- that the final text check rejects names and timecodes.

## 15. Calls made in this spec (not the owner's)

- A separate `sound/` package with its own lock, instead of growing `ml`.
- Batches of 16; an async batch API with incremental results.
- Guard thresholds: CPU 35% / GPU utilization 20%. They are starting values.
- During backfill, hand the GPU back to `ml` between batches only when `gpu`-queue jobs
  wait.
- Sound texts run only while `ml` holds the GPU.
- Words are stored as keys and rendered at read time; LLM texts are ru-only.
- Album pools cover every analysed recording of the album (shared data).
- Mono gets `space` NULL. Under 30 s and over 20 min is skipped.
- Backfill order: uploads, then plays over 180 days.
- Default stem export: the owner's 10 most fully played songs.

## 16. Source map

| Prototype (`/mnt/data/tmp/sound-stage/`) | New home |
|---|---|
| `v3/gpu3.py` (stages), `tag3.py`, `tagall.py` | `sound/src/musix_sound/stages.py` |
| `stage.py`, `scene.py`, `scene2.py`, `v3/analyse3.py` | `sound/src/musix_sound/measure.py` |
| `v3/run_gpu3.sh` (one model per stage, fsynced logs) | `sound/src/musix_sound/batch.py` + the guard |
| `demo4/features5.py`, `v3/report3.py`, `demo4/calib2.py`, `claim_thr.json`, `calib.json` | `server/src/musix/contexts/sound/derive.py` |
| `demo4/signature6.py`, `album6.py`, `textpass.py` | `server/src/musix/contexts/sound/texts.py` |
| `demo4/export6.py`, review pages | stay research |
