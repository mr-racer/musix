"""Throwaway spike: replay one library's history in time order and, for every
play, freeze what the engine could have known just before it (no leakage)."""
import math, numpy as np, pandas as pd
from collections import defaultdict, deque
from . import data as D

W_FULL, W_MOST, W_SKIP, W_FIRE = 0.4, 0.25, -0.6, 1.0
H_LONG_D = 30.0
LONG_TOP = 30


def outcome_weight(r):
    if r.skip: return W_SKIP
    if r.ratio >= 0.85: return W_FULL
    if r.ratio >= 0.65: return W_MOST
    return 0.0


def fire_time_factor(dh):
    if dh <= 0: return 1.0
    if dh >= 4.0: return 0.0
    return 0.5 * (1 + math.cos(math.pi * dh / 4.0))


def build(coll):
    """Returns (ev, feats, contexts). contexts[i] = dict with the session state."""
    ev = D.events(coll)
    lib = D.library(coll)
    sig = D.signals(coll)
    sig_list = sig.sort_values("at").to_dict("records") if len(sig) else []
    si = 0
    created = pd.to_datetime(lib["created_at"], errors="coerce")

    t_plays = defaultdict(int); t_full = defaultdict(int); t_skip = defaultdict(int)
    t_last = {}; t_fire = defaultdict(int); t_water = defaultdict(int); t_last_fire = {}
    a_plays = defaultdict(int); a_full = defaultdict(int); a_skip = defaultdict(int); a_last = {}
    g_plays = defaultdict(float)
    long_w = defaultdict(float); long_t = None   # decayed long-term positives
    tot_plays = 0; tot_full = 0; tot_skip = 0

    feats, ctxs = [], []
    cur_sess = None; sess = []            # list of dicts of the current listening session
    prev_sess = []; prev_end = None
    fires_sess = []                        # (track, at, n_tracks_at)

    def decay_long(to_t):
        nonlocal long_t
        if long_t is not None:
            f = 0.5 ** ((to_t - long_t).total_seconds() / 86400 / H_LONG_D)
            if f < 0.999:
                for k in list(long_w):
                    long_w[k] *= f
                    if long_w[k] < 1e-3: del long_w[k]
        long_t = to_t

    for i, r in enumerate(ev.itertuples()):
        t = r.at
        # reactions that happened before this play enter the state now
        while si < len(sig_list) and sig_list[si]["at"] < t:
            s = sig_list[si]; si += 1
            if s["kind"] == "fire":
                t_fire[s["track"]] += 1; t_last_fire[s["track"]] = s["at"]
                decay_long(s["at"]); long_w[s["track"]] += 0.35
                fires_sess.append((s["track"], s["at"], len(sess)))
            elif s["kind"] == "water":
                t_water[s["track"]] += 1
        if r.lsess != cur_sess:
            if sess:
                prev_sess, prev_end = sess, sess[-1]["at"]
            cur_sess = r.lsess; sess = []; fires_sess = [x for x in fires_sess if (t - x[1]).total_seconds() < 4 * 3600]
        decay_long(t)

        # ---- context snapshot (state strictly before this play) ----
        pos = defaultdict(float); neg = defaultdict(float); water = defaultdict(float)
        for k, e in enumerate(sess):
            w = e["w"]
            if w > 0: pos[e["track"]] += w
            elif w < 0: neg[e["track"]] += -w * (0.25 if e["src"] in ("band", "explore") else 1.0)
        for tr, fat, n_at in fires_sess:
            f = fire_time_factor((t - fat).total_seconds() / 3600)
            if f > 0: pos[tr] += W_FIRE * f
        for tr, n in t_water.items():
            pass
        n_own = sum(1 for e in sess if e["w"] != 0) + len(fires_sess)
        carry = 0.0
        if prev_sess and prev_end is not None and (t - prev_end).total_seconds() < 3 * 86400:
            carry = max(0.0, 0.4 * (1 - n_own / 8))
            if carry > 0:
                for e in prev_sess[-10:]:
                    if e["w"] > 0: pos[e["track"]] += e["w"] * carry
        w_long = max(0.15, 1 - n_own / 6)
        long_top = dict(sorted(long_w.items(), key=lambda kv: -kv[1])[:LONG_TOP])
        ctx = {"pos": dict(pos), "neg": dict(neg), "long": long_top, "w_long": w_long,
               "sess_tracks": [e["track"] for e in sess], "sess_out": [e["w"] for e in sess],
               "prev": sess[-1]["track"] if sess else None, "t": t,
               "recent": {e["track"] for e in sess} | {k for k, v in t_last.items() if (t - v).total_seconds() < 1800}}
        ctxs.append(ctx)

        tr = r.track; art = r.artist; gen = r.genre
        last = t_last.get(tr)
        sess_art = [e["artist"] for e in sess]; sess_gen = [e["genre"] for e in sess]
        run_gen = 0
        for g in reversed(sess_gen):
            if g == gen: run_gen += 1
            else: break
        gen_skips = sum(1 for e in sess[-6:] if e["genre"] == gen and e["w"] < 0)
        gen_full = sum(1 for e in sess[-6:] if e["genre"] == gen and e["w"] > 0)
        prior = (tot_full + 2) / (tot_plays + 4)
        ax_e = lib.at[tr, "ax_energy"]
        sess_e = [lib.at[e["track"], "ax_energy"] for e in sess[-5:]]
        f = {
            "t_plays": t_plays[tr], "t_full_rate": (t_full[tr] + 2 * prior) / (t_plays[tr] + 2),
            "t_skip_rate": (t_skip[tr] + 2 * (1 - prior) * 0.3) / (t_plays[tr] + 2),
            "t_days_since": (t - last).total_seconds() / 86400 if last is not None else 999.0,
            "t_fire": t_fire[tr], "t_water": t_water[tr],
            "t_days_in_lib": (t - created.get(tr)).total_seconds() / 86400 if pd.notna(created.get(tr)) else 999.0,
            "a_plays": a_plays[art], "a_full_rate": (a_full[art] + 3 * prior) / (a_plays[art] + 3),
            "a_skip_rate": (a_skip[art] + 1) / (a_plays[art] + 4),
            "a_days_since": (t - a_last[art]).total_seconds() / 86400 if art in a_last else 999.0,
            "a_in_sess": sess_art.count(art), "a_prev_same": int(bool(sess) and sess[-1]["artist"] == art),
            "album_cont": int(bool(sess) and sess[-1]["album"] == r.album),
            "g_long_share": g_plays[gen] / max(1.0, sum(g_plays.values())),
            "g_sess_share": sess_gen.count(gen) / max(1, len(sess_gen)), "g_run": run_gen,
            "g_sess_skips": gen_skips, "g_sess_full": gen_full,
            "s_pos": len(sess), "s_skip_rate": (sum(1 for e in sess if e["w"] < 0) + 1) / (len(sess) + 4),
            "s_prev_skip": int(bool(sess) and sess[-1]["w"] < 0), "s_prev2_skip": int(len(sess) > 1 and sess[-2]["w"] < 0),
            "hour": t.hour + t.minute / 60, "dow": t.dayofweek,
            "energy": ax_e, "energy_dev": abs(ax_e - np.nanmean(sess_e)) if sess_e else np.nan,
            "dur": r.dur if r.dur == r.dur else np.nan,
        }
        for k in ["vocal_lead", "spacious", "experimental", "brightness", "acousticness"]:
            f["ax_" + k] = lib.at[tr, "ax_" + k]
        feats.append(f)

        # ---- apply this play to the state ----
        w = outcome_weight(r)
        if r.fire: w = max(w, 0.0)  # a fired track is never a negative
        sess.append({"track": tr, "w": w, "at": t, "artist": art, "album": r.album, "genre": gen, "src": r.source})
        t_plays[tr] += 1; t_full[tr] += int(r.full); t_skip[tr] += int(r.skip); t_last[tr] = t
        a_plays[art] += 1; a_full[art] += int(r.full); a_skip[art] += int(r.skip); a_last[art] = t
        g_plays[gen] += 1
        tot_plays += 1; tot_full += int(r.full); tot_skip += int(r.skip)
        if r.full: long_w[tr] += 0.2

    return ev, pd.DataFrame(feats), ctxs
