# v2 · «Поток» — engine and product

**Date:** 2026-09-29 · **Program:** `2026-09-29-musix-v2-program-design.md`
**Replaces:** the v1 stream scoring (`app/services/stream/*`). v2 does **not** port it (§2
shows why). Phase 2 builds this engine directly on the maintained state from its §6.
**Status:** the product part (§4–§8) was approved by the owner 2026-09-29. The engine part
(§2, §3) comes from an offline study on the prod snapshot the same day. The whole document
awaits review.

---

## 1. Why — the owner's goals and the production evidence

Goals (owner, 2026-09-29): **more discovery** and **understanding + control**, within the
listener's **own library only** (nobody sees other users' tracks).

The complaints were:
- not enough variety;
- the «новое / любимое» slider behaves strangely;
- the same song comes back the same day.

Measured on the prod snapshot (events since 2026-09-06, when the provenance `source` started
to be recorded):

| Finding | Number |
|---|---|
| Artist variety in «Поток» | 8.3 distinct artists per 10 tracks; the same artist back-to-back 4.5%. **Fine** |
| **Genre** variety | **the top genre fills 69% of a 10-track window** (75% after 2026-09-10). That is 3.1 genres per window, against 10 genres spread across the library (rock 30%, pop 21%, hip-hop 19%, electronic 12%, …) |
| Pools served | fresh 71%, band 25%, familiar 4%, explore 0% |
| The slider in use | the owner and one friend are **pinned at 0.0**, where the familiar pool is forbidden outright |
| The slider's resolution | `fresh_quota = round(3 × (1 − s))` with banker's rounding on a 3-track chunk, so only **4 positions** exist, and **0.5 means 2 of 3 fresh**, not half and half |
| Same-day repeats | 10 of 880 stream plays within 24 h; **7 within 30 min**, which v1's anti-repeat floor forbids. The server never knew the earlier play: the event was lost or late (web background freezes, `event_fail`) |
| Stale «fresh» labels | 10 of 623 «fresh» tracks had been played in the previous 30 days (the same cause) |
| The unplayed library | the owner played 2784 of 5961 tracks (47%) |

## 2. The offline study — what predicts a good next track

Throwaway harness (kept for reference in `/mnt/data/musix-v2-staging/recsys-spike/`; phase 0
rebuilds it properly, §10).

- **Data:**
  - the owner: 4662 plays, 2026-07-11 → 09-29, 5961 tracks;
  - the most active friend: 663 plays, 665 tracks;
  - the other accounts are too small to measure.
- **Replay:** every play is replayed in time order. The features see only what the engine
  could have known just before that play.
- **Outcomes:**
  - *skipped* = < 30 s (< 25% on tracks under 2 min);
  - *completed* = ≥ 85% listened.
- **Listening sessions** split at 30 min of silence.
- **Learned models** are trained with rolling-origin time folds: train on everything before
  a window, test on the window. The windows are 07-28, 08-12, 08-27, 09-10 and 10-01.
- **Intervals** are 90% session-bootstrap intervals.

### 2.1 Ranking: does the score put completed tracks above skipped ones?

Session-grouped AUC (GAUC, 0.5 = random): pairs of a completed and a skipped track in the
same listening session. Only **candidate-varying** features are used. A feature that is
constant at the decision moment, such as the hour or "the user is skipping right now",
cannot re-order candidates; letting it in inflated the AUC in an earlier cut.

| Scorer | Owner, all plays | Owner, «Поток» plays | Friend, all plays |
|---|---|---|---|
| **v1 score** (CLAP affinity − repulsion + novelty − recency, v1 weights) | **0.49** (0.46–0.52) | 0.49 | 0.45 |
| CLAP similarity to the session's positives alone | 0.51 | 0.52 | 0.58 |
| The artist's own completion rate alone | 0.59 | 0.63 | 0.53 |
| **Learned ranker, behaviour features** | **0.74** (0.71–0.77) | **0.74** (0.67–0.79) | **0.77** (0.70–0.81) |
| … + the CLAP sonic axes | 0.74 | 0.77 | 0.77 |
| … + audio similarity: CLAP / MuQ-MuLan / MuQ / MERT | 0.74 / 0.73 / 0.74 / 0.73 | 0.75 / 0.76 / 0.75 / 0.74 | 0.77 / 0.77 / 0.77 / 0.75 |
| Learned ranker on **tracks never played before** | 0.70 | — | 0.69 |
| … on audio features alone, same tracks | 0.49–0.50 | — | 0.46–0.56 |

- **Most important features** (share of gain):
  - days since the artist was last heard, 30%;
  - days since the track was added, 9%;
  - the artist's completion rate, 9%;
  - the track's completion rate, 8%;
  - duration, 6%;
  - same artist as the previous track, 5%;
  - the genre's long-term share, 5%.
- **The same result holds** without duration, without album continuation, and with
  "not skipped" as the label (0.73).
- **What the marginals say, and the design follows them:**

| Situation | Completion |
|---|---|
| The track was heard in the last 24 h | **67%** (7–30 days ago: 85%, never: 80%) |
| The artist was heard < 30 min ago | 77% (1 day ago: 83%) |
| The same artist as the previous track | 77.5% (another artist: 81%) |
| The 6th+ track of one genre in a row | **76%** (1–5 in a row: 80–82%) |

### 2.2 Retrieval: does a source find the track the listener went on to choose?

Recall@200 over the whole library, excluding what was heard in the last 30 min. The targets
are the next completed tracks that were not an album continuation. "Chosen" targets are
the plays the listener picked by hand (`source = manual`), which v1 did not select.

| Source | Owner, chosen (143) | Owner, never played (716) | Friend, never played (93) |
|---|---|---|---|
| Random | 4.9% | 4.3% | 23% |
| The listener's own most-played | 32% | 0% | 1% |
| Artists liked in this session | 15% | 16% | 46% |
| Artist affinity (plays × completion × recency) | 9% | 12% | 40% |
| **CLAP** neighbours of the session | 8% | **11%** | **66%** |
| MuQ-MuLan / MuQ / MERT neighbours | 8% / 7% / 8% | 8% / 6% / 5% | 60% / 60% / 53% |
| Text (lyrics/metadata) vectors | 4% | 6% | 33% |
| Co-listen (PPMI over sessions, SVD-64) | 16% | 0% (no history) | 5% |
| CLAP with the artist direction removed | 6% | — | — |

- 40% of the owner's completed next tracks are by an artist already enjoyed in that session.
  Removing the artist from CLAP ("debiasing") makes retrieval worse.
- **The merged candidate set** of §3.1 (~450 ids) contains:
  - the chosen next track 21% of the time, against 8.4% for 500 random tracks;
  - a never-played next track 14.5% of the time, against 10.3% for random.
- **Retrieval of never-played tracks is the weakest link.** Discovery quality there comes
  from the ranker, the unplayed pool sampler and the exploration slot, not from the audio
  neighbours alone. This is the first thing to improve when the logs grow (§13).

### 2.3 Calm / energetic vs the owner's ears

The owner labelled 150 clips blind (20 s, no titles; stratified over the library):
30 calm, 61 mid, 59 energetic.

| Model | Spearman with the label | AUC calm ↔ energetic | Balanced acc., 3 classes |
|---|---|---|---|
| **v1 CLAP energy axis** (text prompts, zero-shot) | 0.70 | **0.99** | 0.60 |
| MuQ-MuLan zero-shot prompts | 0.61 | 0.97 | 0.64 |
| Linear probe on CLAP (5-fold CV) | **0.76** | **1.00** | 0.67 |
| Linear probe on MuQ-MuLan / MuQ / MERT | 0.73 / 0.73 / 0.64 | 0.99 / 0.98 / 0.96 | 0.67 / 0.71 / 0.61 |

The extremes are solved already. The "mid" boundary is fuzzy for the listener too (the
median decision took 4.5 s).

### 2.4 Whole-session simulation

The simulated listener is a LightGBM response model trained on the whole history
(behaviour + session context + CLAP features). Each policy serves 30 tracks from 30 real
owner session starts and 12 friend session starts after 2026-09-10; the simulated listener's
skips feed back into the policy's session state. The listener model is optimistic: on real v1
«Поток» plays it predicted 86% not-skipped where 79.5% happened. So the completion column
is directional, and the list properties are the result.

| Owner, 30 sessions × 30 tracks | Est. not skipped | Artists / 10 | Genres / 10 | Top genre / 10 | Unplayed | Same-day repeats |
|---|---|---|---|---|---|---|
| **Real v1 «Поток»** (logged, after 09-10) | 79.5% (actual) | 7.9 | 2.8 | **0.75** | 64% | 10 of 880 within 24 h (§1) |
| Learned ranker, no re-ranking | 96% | 7.9 | 2.8 | 0.65 | 24% | 0.3% |
| Ranker + presets + artist rules + fatigue by **CLAP region** | 96% | 8.5 | 2.8 | 0.63 | 30% | 0 |
| **Ranker + presets + artist rules + fatigue by genre, cap 5/10** | 95% | 8.5 | **3.4** | **0.44** | 30% | **0** |
| … cap 4/10 | 95% | 8.8 | 3.6 | 0.39 | 30% | 0 |

The friend's library: the top genre per 10 falls from 0.80 to 0.44, and genres per 10 rise
from 2.7 to 4.3, with no completion loss.

Every preset hit its target share over the 12-track window:
- «Микс»: 47 / 30 / 23 served against a target of 50 / 30 / 20;
- «Любимое»: 77 / 23;
- «Незнакомое»: 100% unplayed;
- «Давно не слушал»: 95% rediscover. The friend's small library runs this pool dry at 36%,
  so the fallback shows in the UI (§4).

The sound presets moved the served energy to the library's 27th percentile («Спокойное») and
80th percentile («Бодрое»).

### 2.5 Conclusions

1. **Similarity to what was just liked is not a relevance signal here.** v1 makes it the core
   of the score, and the score ranks no better than chance. The candidate is judged by the
   listener's relationship with the **artist** and the **track**, together with fatigue and
   freshness. A learned ranker over those features gets GAUC 0.74.
2. **Audio embeddings stay, in a different job.** They are used for:
   - candidate generation for never-played tracks, where CLAP is the best audio source;
   - sound presets;
   - regions and bridges;
   - explanations.
3. **Do not replace CLAP.** MuQ-MuLan, MuQ and MERT are equal or worse on every measure here.
   Their weights are also CC-BY-NC-4.0, where the LAION-CLAP music checkpoint v1 uses
   (`music_audioset_epoch_15_esc_90.14.pt`) is CC0. The v1 CLAP energy axis already
   separates calm from energetic at AUC 0.99.
4. **Diversity has to be imposed by the policy.** The ranker alone is accurate and repetitive
   (top genre 0.65). Keyed on **genre**, which is what the listener perceives and complained
   about, the fatigue rule plus a 5/10 cap costs nothing measurable. Keyed on CLAP regions
   it does nothing: the regions do not line up with genres.
5. **Same-day repeats are also a quality problem, not only a trust one:** 67% completion.

## 3. The engine: candidates → ranker → policy → reason

```
state (phase 2 §6.1, incremental)            per request (p95 < 150 ms)
────────────────────────────────             ───────────────────────────────────────────────
account_track_stats  ─┐                      1. candidate sources  → ~500 ids
account_artist_stats ─┤                      2. features from state (one query over the ids)
account_genre_stats  ─┼─►  stream_sessions ─►3. ranker.predict      → p(not skipped)
taste_profile        ─┤   (served ring,      4. policy: served_today, presets window, artist
regions (k-means)    ─┘    pools log,           rules, genre fatigue/cap, sound, exploration
                           genre run, …)     5. reason = source + top feature contributions
                                             6. log the decision (stream_decisions)
```

### 3.1 Candidate sources (retrieval)

| Source | Budget | Why (§2.2) |
|---|---|---|
| Tracks of artists enjoyed in this session | ≤ 100 (by artist affinity) | 40% of completed next tracks |
| Artist affinity (plays × smoothed completion × recency) | 100 | finds never-played tracks by known artists (12% owner, 40% friend) |
| CLAP neighbours of the session's positives and the long-term profile | 150 | the best audio source; the best of all on the friend's never-played tracks (66%) |
| Co-listen neighbours (PPMI-SVD over the listener's own sessions) | 100 | the best source among played tracks |
| Pool samplers: unplayed / rediscover / favorites | 80 each | so every preset always has candidates |

- One Qdrant batch plus a few indexed SQL reads. Everything is filtered by `owners`, so a
  listener only ever sees their own library.
- Co-listen vectors are a nightly job per account, and use only that account's sessions.
- Duplicates are merged, and each candidate keeps **all** the sources that proposed it, for
  the reason (§7).

### 3.2 The ranker

- **Model:** LightGBM binary classifier. **Label:** not skipped. The completed-vs-skipped
  GAUC is the metric; «огонёк» plays get sample weight 2, «вода» plays are negatives with
  weight 2.
- **Size:** ~400 trees of 15 leaves, about 1 MB, ~2–5 ms for 500 candidates on the CPU.
- **Features:** candidate-varying only.
  - Track: plays, smoothed completion and skip rates, days since last played, fires, waters,
    days since added, duration.
  - Artist: plays, smoothed completion and skip rates, days since last heard, plays in this
    session, same as the previous track.
  - Album: continuation of the previous track's album.
  - Genre: long-term share, share in this session, current run length, skips and completes
    of this genre in the last 6.
  - Sound: the CLAP sonic axes, and the energy distance from the last 5 tracks.

  No track, artist or user ids: the model learns *how* people listen, not *what*. That is
  why one model can be trained on every account's events without any listener seeing
  another's tracks.
- **Training:** a nightly worker job on all accounts, with a time-split validation on the
  last 14 days.
  - The new model is promoted only if its validation GAUC ≥ 0.70 **and** ≥ the current
    model's − 0.01. Otherwise the current one stays.
  - Models are stored versioned (`ranker_models`: version, trained_at, metrics, blob). The
    version is logged with every decision.
- **Cold start:** an account with < 50 plays uses the same global model; its features are
  simply sparse. With 0 plays the policy leans on the pool samplers and the exploration
  slot (§3.3) until the first positives arrive.

### 3.3 The policy (re-ranking and assembly)

Applied in this order to the ranked candidates; each step picks one track, and the chunk
repeats it.

1. **Hard filters:**
   - served or heard today (§6);
   - «вода»-locked tracks;
   - the sound-preset band (§4), relaxed only when fewer than 5 candidates remain.
2. **Pool choice:** the preset's pool with the largest deficit over the last 12 served tracks.
   The pool is recorded when a track is served, not recomputed later.
3. **Artist rules:** not an artist from the last 3 tracks, and at most 2 per 10.
4. **Genre fatigue and cap** (§5).
5. **Exploration:** 1 slot in 10 is sampled from the top 30 by a softmax over the ranker's
   score (temperature 0.5) instead of the argmax. Its propensity is logged, which keeps the
   training data from collapsing onto the ranker's own choices and makes off-policy
   evaluation possible (§9).
6. Pick the highest-ranked candidate that passes.

## 4. Presets replace the slider

Two rows of chips, **visually separate** (the owner's requirement): how familiar the music
is (by play history) versus how it sounds.

**Familiarity** (exactly one; the default is «Микс»):

| Preset | Pools and target shares over the last 12 served tracks |
|---|---|
| **Микс** | familiar ~50%, unplayed ~30%, rediscover ~20% |
| **Любимое** | familiar (most completed, fired) ~80%, rediscover ~20% |
| **Давно не слушал** | rediscover 100%: played before with positive engagement (completed or fired), not in the last **60 days**. Tracks last heard 7–30 days ago complete best (85%), so the threshold is a starting value for §10's tuning |
| **Незнакомое** | unplayed 100% |

- **The pools:**
  - *familiar* = positive engagement within 60 days;
  - *unplayed* = never played;
  - *rediscover* = as defined in the table.
- When a pool runs dry, the next-largest deficit is used, and the chip shows «мало треков
  для „Давно не слушал“ — добавляем знакомое».

**Sound** (optional, at most one):

| Preset | Definition |
|---|---|
| **Спокойное** | CLAP energy axis ≤ the library's p40 |
| **Бодрое** | CLAP energy axis ≥ the library's p60 |

- The energy axis is the v1 CLAP text-prompt axis (§2.3, AUC 0.99 against the owner's
  labels).
- Later option: a per-listener calibration of the band edges from «Меньше такого» on a
  sound-preset track. It is not built now.
- The set is data (`stream_presets`), so a new preset such as «Для работы» is a row, not
  code.
- The v1 `stream_liked_share` setting is mapped once at migration: 0.0 → «Незнакомое»,
  ≥ 0.8 → «Любимое», anything else → «Микс».

## 5. Automatic genre travel

The listener perceives, and complained about, **genre**. So fatigue is counted in genres.
The CLAP **regions** (k-means over the library, k = √(n/20) clipped to 8–24, recomputed
with `taste_profile`) are only used to choose where to go and how to get there.

- **Session state** (in `stream_sessions`), per genre: the current run length, and skips and
  completes among the last 6 tracks. An «огонёк» in the genre sets `held` for the next 10
  tracks.
- **Leave the genre when** the run reaches the listener's tolerance **or** 2 of the last 3
  tracks in it were skipped, unless `held`.
  - The tolerance defaults to **6**, the point where completion drops (§2.1).
  - The nightly job personalizes it from the listener's own history: the run length after
    which their skip rate rises 5 pp above their baseline, once there are ≥ 20 runs of 6+.
- **Where to go:**
  - the target genre is adjacent to the current one (genre centroids in CLAP, cosine above
    the library's p70);
  - it is weighted by the ranker's mean score for its candidates;
  - it must not have been visited in the last 4 transitions.
- **How to get there:** the next track leaves the current genre, and a candidate that sounds
  like both genres (high `min(sim_current, sim_target)`) gets a small boost as a bridge.
- **Guardrail:** at most **5 tracks of one genre per 10** (§2.4: top genre per 10 falls
  from 0.75 to 0.44 at no measured cost), unless `held`.
- **Presets interact:**
  - «Незнакомое» and «Давно не слушал» restrict the pools, not the travel;
  - a sound preset restricts the candidates, so a calm wave travels between calm tracks of
    different genres.
- **The ranker learns the rest:** its genre-run and genre-skip features already carry the
  personal response. The rule above is the product's variety guarantee on top of it.

## 6. No same-day repeats

- **The server remembers what it served, not only what it heard.** `stream_sessions` keeps
  the ids issued in this session. `served_today` (account, date → set) covers every session
  that day. Neither depends on client events arriving.
- **Rule:** a track heard or issued today is not issued again today. This includes
  «Любимое». The data says a same-day repeat completes at 67%, so the v1 8 h liked cooldown
  goes.
- **Listen events are reliable in v2:** the client outbox plus the batched idempotent upload
  (phase 1 §9). A lost event can no longer relabel a heard track as «fresh».
- Target metric: **0 same-day repeats**, offline and online.

## 7. «Почему этот трек» — a chip plus details

- Every served track carries `reason: {kind, refs, text, details}`. Code builds it from:
  - the **sources** that proposed the track (§3.1);
  - the ranker's top **feature contributions** (LightGBM `pred_contrib`, computed for the
    chosen track only).

  It is never generated by an LLM, so it is always true and costs nothing.

  | `kind` | When | Example chip |
  |---|---|---|
  | `artist_now` | source: session artists; top contribution: artist recency / completion | «Ещё Radiohead — ты дослушал 3 подряд» |
  | `artist_love` | top contribution: the artist's completion rate | «Ты почти всегда дослушиваешь Muse» |
  | `similar_to` | source: CLAP neighbours, with that similarity among the top contributions | «Похоже по звучанию на Creep» |
  | `colisten` | source: co-listen | «Ты часто слушаешь это рядом с Karma Police» |
  | `rediscover` | pool rediscover | «Давно не слушал — последний раз в июле» |
  | `new_for_you` | pool unplayed | «Новое для тебя» |
  | `bridge` | a genre transition | «Мост: из рока в электронику» |
  | `preset_match` | a sound preset | «Под „Спокойное“: энергия ниже 60% библиотеки» |
  | `explore` | the exploration slot | «Пробуем: вне твоего обычного» |

  - A `similar_to` chip is never shown unless the audio source actually proposed the track.
    v1's «похоже на» could claim a similarity that did not drive the choice.
- The chip shows on the track in the player and in the queue. **Tapping it** opens a detail
  sheet with:
  - the top contributing features, in plain language;
  - «Больше такого», which is an огонёк on the track;
  - «Меньше такого», which is a **session-level down-weight** of the reason's artist or
    genre and does not penalize the track itself.
- Texts are localized (ru/en) and templated in the backend.

## 8. API surface (v2)

- `PUT /stream/settings` `{familiarity: "mix|favorites|rediscover|unfamiliar", sound: null|"calm"|"energetic"}`. Synced via `account_settings`.
- `GET /stream/next` tracks gain `reason`. Chunk metadata gains
  `{genre_run, fatigue_trigger, model_version}` (debug builds only).
- `POST /stream/feedback` `{trackId, kind: "less_like_this"}` for the session down-weight.
  «Больше такого» is the existing signal endpoint.
- `GET /stream/presets` returns the preset catalogue (labels, icons, which row), so the
  clients render the rows from data.

## 9. Decision logging — for training and for the A/B later

`stream_decisions` (append-only, partitioned by month), one row per served track:
- the session;
- the served track, its pool, its sources and its ranker score;
- the top 30 candidates with their scores;
- whether it was the exploration slot, and its propensity;
- the fatigue trigger, if any;
- `model_version` and `policy_version`.

Joined to the listen event, this is:
- the ranker's training set;
- the dataset for **off-policy evaluation** (IPS / doubly-robust estimates of a new policy
  from logged ones);
- the dataset for **interleaving**, the blind A/B the owner asked for (§12).

## 10. Evaluation — the harness phase 0 builds

`tools/recsys-eval`, run on the snapshot and on every PR that touches «Поток». It
formalizes §2:

| Suite | Metric | Gate |
|---|---|---|
| E1 ranking | session GAUC (completed vs skipped), rolling time folds, 90% bootstrap CI | ≥ 0.70 on the owner; never below the v1 baseline (0.49) CI |
| E2 retrieval | recall of the merged candidate set, for chosen and never-played targets | ≥ the spike's values on the owner (21% / 14.5%) |
| E3 sound | the labelled set (150 clips, `mood_labels`): AUC calm ↔ energetic | ≥ 0.95 |
| E4 simulation | top genre per 10; genres per 10; artists per 10; preset share accuracy; same-day repeats; est. not-skipped | ≤ 0.50; ≥ 3.0; ≥ 8.0; ± 1 track per 12; 0; not worse than the ranker without re-ranking − 2 pp |
| Invariants | a «вода»-locked track served; another account's track served; a same-day repeat | 0 |

- The v1 baseline is **the logged v1 sessions themselves**, measured the same way (§2.4
  first row). No port of the v1 engine is needed to have a baseline.
- Online, the admin ops page shows skip and completion by preset, by `reason.kind` and by
  `model_version`.

## 11. What v1 does that this must not

| v1 | v2 «Поток» |
|---|---|
| Hand-tuned score whose core term is CLAP similarity to the session; it ranks at chance (GAUC 0.49) | Learned ranker over behaviour features (0.74); audio used for retrieval, presets, regions and reasons |
| One slider mixing two questions, quantized to 4 steps by a 3-track chunk | Two preset rows; shares over a 12-track window, with the pool recorded at serve time |
| Anti-repeat = the last 10 tracks / 30 min, trusting client events; liked tracks allowed again after 8 h | The server remembers served and heard tracks per day; no same-day repeats at all |
| Staying in a genre is unchecked (top genre 75% of a window) | Genre fatigue + a 5/10 cap, with CLAP regions for where to go and bridges for how |
| Exploration by a fixed share, not logged | A logged, propensity-scored exploration slot |
| No explanation | A reason built from the actual source and feature contributions |
| Per-collection CLAP percentile calibration on the scoring path | Not needed: raw cosine top-k for retrieval, and the ranker decides |

## 12. Work breakdown

1. **State tables** (phase 2 §6.1):
   - `account_artist_stats`, `account_genre_stats`;
   - the `stream_sessions` fields (served ring, pools log, genre run, held);
   - `served_today`.
2. **Candidate sources** with the per-source budgets. Nightly co-listen vectors and regions.
3. **Ranker:**
   - feature assembly shared by training and serving (one function, tested for parity);
   - the nightly training job;
   - `ranker_models` with the promotion rule.
4. **Policy:** filters, preset windows, artist rules, genre fatigue/cap/travel, the
   exploration slot.
5. **Reasons:** templates, the detail sheet data, `less_like_this`.
6. `stream_decisions` logging.
7. `tools/recsys-eval` (E1–E4 + invariants) and its gates.
8. **Clients:** the preset rows, the chip, the detail sheet (Android first, then web and
   Windows, as their phases land).

## 13. Next, deliberately out of scope here

- **Blind A/B on the owner:**
  - several engine variants, compared without the listener knowing which is which;
  - team-draft interleaving of two policies inside one «Поток» is the most sample-efficient
    design for a single listener, with off-policy estimates from §9 as a cross-check;
  - it gets its own spec after this engine ships (the owner's order).
- **Replacing CLAP:** closed by §2. Reopen only if a candidate beats CLAP on E2
  (never-played targets) and E3, with open weights.
- **Later, when the logs grow:**
  - better retrieval of never-played tracks (§2.2): an audio projection fine-tuned on
    co-listen pairs, so "sounds alike" means "listened alike";
  - a sequence model (next-track transformer over sessions);
  - a contextual bandit for the exploration slot;
  - a personal sound head trained on «Меньше такого» feedback.
