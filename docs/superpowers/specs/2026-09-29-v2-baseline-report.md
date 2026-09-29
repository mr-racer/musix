# MusiX v2 — baseline report (v1 on snapshot 2026-09-29)

**Phase 0 exit criteria 1–2.** These are the v1 numbers every later phase is compared with
(phase 0 spec §4–§5). They come from a v1 copy on the snapshot, never from prod. The
report holds numbers only: no rows, titles or lyrics.

## Search gates (4.1–4.3)

Lyric-line search (the queries are derived from each track's own stored lyrics):

| kind | n | recall@1 | recall@10 | MRR |
|---|---|---|---|---|
| exact | 300 | 0.475 | 0.893 | 0.644 |
| noisy | 300 | 0.382 | 0.802 | 0.535 |
| partial | 300 | 0.263 | 0.603 | 0.378 |
| translit | 114 | 0.298 | 0.693 | 0.467 |

Sound search: 80 prompts (genres, decades, sonic-axis poles), precision@10 **0.490**. v2's overlap@10 is measured against these lists.

Catalog search:

| kind | n | recall@1 | recall@5 |
|---|---|---|---|
| album | 50 | 0.880 | 1.000 |
| all | 300 | 0.770 | 0.940 |
| exact | 50 | 0.880 | 1.000 |
| feat | 50 | 0.840 | 1.000 |
| prefix | 50 | 0.780 | 1.000 |
| translit | 50 | 0.680 | 0.840 |
| typo | 50 | 0.560 | 0.800 |

## Prompt evals (4.5)

```
{
 "facts": {
  "отбраковка": 0.9285714285714286,
  "сохранность": 0.8717948717948718,
  "класс": 0.8717948717948718,
  "off-scope": 0.5
 },
 "llm_model": "qwen3.8-27b-ud-iq3_s",
 "bio": {
  "n": 10,
  "empty": 0,
  "wrong_lang": 1,
  "median_chars": 774
 },
 "routing": {
  "exit": 0,
  "lines": [
   "11 passed in 42.28s"
  ]
 }
}
```

## «Поток» (4.4, stream spec §2 / §10)

- E1, session GAUC (completed vs skipped): the v1 score gets **0.492** (0.463–0.518) on the owner; the reference ranker gets **0.738** (0.711–0.765), and 0.764 on «Поток» plays.
- E2, the merged candidate set contains the self-chosen next track 21.0% of the time (random 500: 8.4%) and a never-played next track 14.3% of the time (random: 10.3%).
- E3, CLAP energy axis vs the owner's 150 blind labels: AUC calm ↔ energetic **0.990**, Spearman 0.702; a linear probe on CLAP (CV) gets 0.755.

| E4, per 10 tracks | real v1 (logged) | reference engine (simulated) |
|---|---|---|
| артистов/10 | 7.924 | 8.533 |
| жанров/10 | 2.864 | 3.320 |
| топ-жанр/10 | 0.747 | 0.443 |
| непрослушанных | 0.650 | 0.303 |
| повторы за день | 0.000 | 0.000 |

The listener model's calibration on real v1 plays: it predicted 0.858 not-skipped, and 0.793 happened. Invariants of the reference engine: {'same_day_repeat': 0, 'locked_served': 0, 'outside_library': 0, 'preset_window': 0} (owner), {'same_day_repeat': 0, 'locked_served': 0, 'outside_library': 0, 'preset_window': 0} (friend).

Gates: PASS E1 ranker GAUC ≥ 0.70 (owner, all), PASS E3 CLAP axis AUC ≥ 0.95, PASS E4 top genre / 10 ≤ 0.50, PASS E4 genres / 10 ≥ 3.0, PASS E4 artists / 10 ≥ 8.0, PASS invariants: 0 violations

## Performance (§5, v1 copy, CPU)

| users | requests | errors | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|---|
| 1 | 10819 | 0 | 1 | 62 | 125 |
| 5 | 15603 | 0 | 5 | 251 | 714 |
| 20 | 9772 | 0 | 7 | 530 | 5383 |

- Home screen: 18 requests, 1.26 MB to network idle.
- Cold start: DOMContentLoaded 489 ms, FCP 560 ms.
- Stream start (FLAC): 76 ms on the LAN, 3741 ms under the LTE profile.
- Footprint: RSS max 5478.4 MiB; VRAM 0 (FORCE_CPU=1). Android: deferred to phase 4 (phone not on the LAN).

Notes:

- the v1 copy runs FORCE_CPU=1: model-bound routes (search) are CPU, not comparable to prod
- the transcode cache is cold (empty); prod's is warm
- request mix from the prod access log since 2026-09-29T07:59:50.992456149Z

## Findings that shape v2

- **v1 search is not thread-safe.** Concurrent `/search/` requests race in `qdrant_client`'s
  BM25 embedder (`dictionary changed size during iteration` → HTTP 500), and afterwards the
  process silently returns wrong lyric results until it restarts (exact R@1 0.47 → 0.10).
  v2 never shares non-thread-safe encoders across request threads; the `ml` service owns them.
- **Lyric gate tolerance.** Queried sequentially on a fresh copy, three v1 runs agree within
  0.003, and ranks are tie-aware (RRF scores tie often). The v2 gate is v2 ≥ v1 − max(0.01,
  v1's run-to-run range).
- **LLM evals move between runs** (facts отбраковка 1.00 vs 0.93 on two runs of the same
  prompt): they are a reference, and a port may not change the prompts, not a hard gate.
- **v1 hot spots under load** (5 users, p50 / p95): `/recommend/stream/next` 647 / 952 ms (the
  stateless recompute the program replaces), `/recommend/taste-vibe` 458 / 757,
  `/recommend/profile` 390 / 491, `/library/albums` 535 / 885. p99 at 20 users is 5.4 s.
- **Stream start under LTE is 3.7 s** for FLAC; phase 1's tiers (AAC 320 on cellular) and
  the signed-manifest prefetch target < 2 s.
