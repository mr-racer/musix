# v2 · «Поток» — presets, genre fatigue, no same-day repeats, «почему этот трек»

**Date:** 2026-09-29 · **Program:** `2026-09-29-musix-v2-program-design.md`
**Builds on:** phase 2 (the behaviour-identical port of «Поток» onto incremental state,
`2026-09-29-v2-phase2-intelligence-design.md` §6). This spec changes behaviour. It lands
**after** the port has passed its gates, so every change here is measured against a known
baseline.
**Status:** design approved by the owner 2026-09-29; the written spec awaits review.

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
| **Genre** variety | **the top genre fills 69% of a 10-track window**, 3.1 genres per window, against 10 genres spread across the library (rock 27%, pop 23%, hip-hop 18%, electronic 13%, …) |
| Pools served | fresh 71%, band 25%, familiar 4%, explore 0% |
| The slider in use | the owner and one friend are **pinned at 0.0**, where the familiar pool is forbidden outright |
| The slider's resolution | `fresh_quota = round(3 × (1 − s))` with banker's rounding on a 3-track chunk, so only **4 positions** exist, and **0.5 means 2 of 3 fresh**, not half and half |
| Same-day repeats | 10 of 880 stream plays within 24 h; **7 within 30 min**, which v1's anti-repeat floor forbids. The server never knew the earlier play: the event was lost or late (web background freezes, `event_fail`) |
| Stale «fresh» labels | 10 of 623 «fresh» tracks had been played in the previous 30 days (the same cause) |
| The unplayed library | the owner played 2784 of 5961 tracks (47%) |
| Exploration acceptance | `band` completion 58% vs `fresh` 62%. Exploration is accepted almost as well as the near field |

## 2. Presets replace the slider

Two rows of chips, **visually separate** (the owner's requirement): how familiar the music
is (by play history) versus how it sounds.

**Familiarity** (exactly one; the default is «Микс»):

| Preset | Pools and target shares over the session window |
|---|---|
| **Микс** | familiar (favorites + neighbours of the session's positive clusters) ~50%, unplayed ~30%, rediscover ~20% |
| **Любимое** | favorites and most-completed ~80%, rediscover ~20% |
| **Давно не слушал** | rediscover 100%: played before with positive engagement (completed, or fire), not in the last **60 days** |
| **Незнакомое** | unplayed 100% (hard: a short chunk rather than a heard track) |

**Sound** (optional, at most one):

| Preset | Definition |
|---|---|
| **Спокойное** | target on the sonic axes: energy low, experimental low (stable), acousticness/spacious up. Plus a text anchor ("calm, soft, relaxed") |
| **Бодрое** | energy high, brightness high. Plus a text anchor ("energetic, upbeat, bright") |

- A sound preset adds a **target term** to the score (distance to the preset point, in
  listener-calibrated percentiles), plus a **band filter** (e.g. «Спокойное» = energy ≤ the
  library's p40). The filter relaxes only if the pool runs dry.
- The set is data (`stream_presets`), so a new preset such as «Для работы» is a row, not
  code.
- **The shares are held over a rolling window of the last ~12 served tracks, not per
  chunk.** Each chunk fills the deficit of the window, so "50%" means 50% and the 3-slot
  quantization and rounding artefacts disappear.
- All initial shares and thresholds above are **starting values**. The replay harness
  tunes them (§7).
- The v1 `stream_liked_share` setting is mapped once at migration: 0.0 → «Незнакомое»,
  ≥ 0.8 → «Любимое», anything else → «Микс».

## 3. Automatic genre travel — the fatigue model

**Regions:**
- sonic clusters of each library: k-means over the audio embeddings, k ≈ √(n/20), clipped
  to 8–24;
- recomputed with `taste_profile`;
- each labelled by its dominant genre, with a secondary genre when it is mixed. This is
  steadier than raw genre tags (which include "other").

**Session state per region** (added to `stream_sessions`):
- `dwell`: tracks served in a row from the current region;
- `engagement`: an EWMA of per-listen outcomes, **relative to the listener's own baseline**
  (`listener_baseline`: their normal skip and completion rates);
- `held`: set by an огонёк in the region, decaying over the session.

**Fatigue score:**

```
fatigue = sigmoid( a · (dwell / tolerance) − b · engagement_z − c · held + d · water_recent )
```

- **`tolerance` is personal:** it is learned from history as the median run length inside
  one region before the listener's skip rate rises above their baseline. The default is 6
  until there is enough history.
- **Signals push it up:** a streak of early skips in the region, a вода, or shortening
  listens.
- **Signals pull it down:** full listens, огонёк.

**Transition when fatigue > θ:**
1. Pick a **target region**:
   - adjacent to the current one (centroid cosine above the library's p70);
   - weighted by long-term affinity (`taste_profile`);
   - penalized if visited in the last 30 min, so there is no ping-pong.
2. Serve **1–2 bridge tracks**: tracks with high calibrated similarity to **both** centroids,
   `min(sim_current, sim_target)` maximal.
3. Continue in the target region, with `dwell` reset.

**Guardrail:** a soft cap of ~60% of one region per 10-track window, unless `held`. This
directly addresses the measured 69%.

**Presets interact:**
- «Незнакомое» and «Давно не слушал» restrict the pools, not the travel;
- a sound preset restricts which regions are eligible targets (a calm wave travels between
  calm regions).

**Logging:** every decision records `(fatigue components, θ, from, to, bridges)` in
`stream_decisions`. This is the replay and debugging trail, and it is also the dataset for
a learned policy later (a contextual bandit), when there is enough history.

## 4. No same-day repeats

- **The server remembers what it served, not only what it heard.** `stream_sessions` keeps
  the ids issued in this session. `served_today` (account, date → set) covers every session
  that day. Neither depends on client events arriving.
- **Rule:** a track heard or issued today is not issued again today. The exception is
  «Любимое»: allowed after an 8 h cooldown, the v1 `LIKED_COOLDOWN_H`.
- **Listen events are reliable in v2:** the client outbox plus the batched idempotent upload
  (phase 1 §9). A lost event can no longer relabel a heard track as «fresh».
- Target metric: **0 same-day repeats** outside «Любимое» in the replay and online.

## 5. «Почему этот трек» — a chip plus details

- Every served track carries `reason: {kind, refs, text, details}`, built by **code from the
  actual winning scoring component**. It is never generated by an LLM, so it is always true
  and costs nothing.

  | `kind` | Example chip |
  |---|---|
  | `similar_to` | «Похоже на Creep — ты дослушал его 5 раз» |
  | `favorite` | «Из любимого» |
  | `rediscover` | «Давно не слушал — последний раз в июле» |
  | `new_for_you` | «Новое для тебя» |
  | `bridge` | «Мост: из рока в электронику» |
  | `preset_match` | «Под „Спокойное“: энергия ниже 80% библиотеки» |
  | `explore` | «Исследуем: соседняя область вкуса» |

- The chip shows on the track in the player and in the queue. **Tapping it** opens a detail
  sheet with:
  - the top contributing components, in plain language;
  - «Больше такого», which is an огонёк on the track;
  - «Меньше такого», which is a **session-level region down-weight** that does not penalize
    the track itself.
- Texts are localized (ru/en) and templated in the backend, next to the v1 `humanize`
  captions.

## 6. API surface (v2)

- `PUT /stream/settings` `{familiarity: "mix|favorites|rediscover|unfamiliar", sound: null|"calm"|"energetic"}`. Synced via `account_settings`.
- `GET /stream/next` tracks gain `reason`. Chunk metadata gains `{region, fatigue}` (debug
  builds only).
- `POST /stream/feedback` `{trackId, kind: "less_like_this"}` for the session region
  down-weight. «Больше такого» is the existing signal endpoint.
- `GET /stream/presets` returns the preset catalogue (labels, icons, which row), so the
  clients render the rows from data.

## 7. Evaluation

Extends the phase 0 «Поток» replay (§4.4 there). Same snapshot, frozen clocks, v2-port
baseline vs this design:

| Metric | Target |
|---|---|
| Top-region share per 10-track window | ≤ 0.60 (baseline 0.69) |
| Distinct genres per 10 | ↑ (baseline 3.1) |
| Skip rate in the 3 tracks after a transition | ≤ the listener's baseline + 5 pp |
| Tracks from a fatigue onset (skip streak / вода) to leaving the region | ≤ 2 |
| Same-day repeats outside «Любимое» | 0 |
| Preset share accuracy (served vs target over the window) | ± 1 track per 12 |
| Next-listen hit rate, completion rate | not worse than baseline − 2 pp |
| Hard invariants (phase 0 §4.4) | 0 violations |

Online, the admin ops page shows skip and completion by preset and by `reason.kind`.

## 8. What v1 does that this must not

| v1 | v2 «Поток» |
|---|---|
| One slider mixing two questions, quantized to 4 steps by a 3-track chunk | Two preset rows; shares over a session window |
| Anti-repeat = the last 10 tracks / 30 min, and trusts client events for it | The server remembers served and heard tracks per day |
| Staying in a genre is unchecked | Personal fatigue model + bridges + a soft cap |
| No explanation | A deterministic reason on every track, with detail and feedback |

## 9. Work breakdown

1. The presets catalogue + settings API + migration of `stream_liked_share`.
2. Window-based share assembly (replacing per-chunk quotas), with replay tests.
3. Regions (clustering job), per-region session state, the fatigue model, bridge selection,
   `stream_decisions`.
4. `served_today` + the same-day rule.
5. Reasons: component attribution in scoring, templates, the detail sheet data, and
   `less_like_this`.
6. Replay evaluation against §7; tuning of shares, θ, the tolerance default and the cap.
7. Clients: the preset rows, the chip, the detail sheet (Android first, then web and
   Windows, as their phases land).

## 10. Next, deliberately out of scope here

- **Blind A/B on the owner:** several engine variants switched per session without saying
  which, compared by the metrics above. The owner asked for this **after** the one updated
  engine ships. It gets its own spec (per-session randomization or interleaving, and the
  decision rule).
- **Replacing CLAP** as the audio representation, and a more accurate calm/energetic
  classification. That research starts now (a separate spec) and feeds §2's sound presets
  and §3's regions once it is measured better.
