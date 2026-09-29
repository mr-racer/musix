"""Throwaway spike: E4 — whole-session simulation of engine policies.

The "listener" is a LightGBM response model trained on the whole history
(behaviour + session context + CLAP features). Each policy serves 30 tracks
from real session starts after SPLIT; the listener's sampled skips feed back
into the policy's session state. Engine rankers only see data before SPLIT.
"""
import sys, math, numpy as np, pandas as pd, lightgbm as lgb
from collections import defaultdict
from sklearn.cluster import KMeans
from . import data as D, space as S
from ._rank2 import feats, A, EK
from .e1 import BC
from .e2 import colisten

SPLIT = pd.Timestamp("2026-09-10")
CTX = ["s_pos", "s_skip_rate", "s_prev_skip", "s_prev2_skip", "hour", "dow"]
ECL = [f"clap.{k}" for k in EK]
SIM_F = BC + CTX + A + ECL
RANK_F = BC + A
STEPS = 30
WATER_LOCK_DAYS = 2.0
AX = ["vocal_lead", "spacious", "experimental", "brightness", "acousticness"]


def train(cols, until=None, label="not-skipped"):
    Xs, ys = [], []
    for c in [D.OWNER, D.FRIEND]:
        ev, X = feats(c)
        y = np.where(ev["skip"], 0, 1)
        m = np.ones(len(ev), bool) if until is None else (ev["at"] < until).values
        Xs.append(X.loc[m, cols].values); ys.append(y[m])
    return lgb.LGBMClassifier(n_estimators=400, learning_rate=0.03, num_leaves=15, min_child_samples=30, subsample=0.8,
                              subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, verbose=-1).fit(np.vstack(Xs), np.concatenate(ys))


class World:
    """Library-wide arrays + history state at a moment, and per-session state."""

    def __init__(self, coll):
        self.coll = coll
        self.lib = lib = D.library(coll)
        self.ev = D.events(coll)
        self.ids = list(lib.index); self.n = len(self.ids)
        self.pos = {t: i for i, t in enumerate(self.ids)}
        self.art = lib["artist_key"].values; self.alb = lib["album_key"].values; self.gen = lib["genre"].values
        self.dur = lib["duration"].fillna(200).values.astype(float)
        self.energy = lib["ax_energy"].values.astype(float)
        self.axes = {k: lib["ax_" + k].values.astype(float) for k in AX}
        self.created = pd.to_datetime(lib["created_at"], errors="coerce")
        self.space = S.Space(coll, "clap")
        self.X = np.zeros((self.n, self.space.M.shape[1]), np.float32)
        for j, t in enumerate(self.ids):
            if t in self.space.idx: self.X[j] = self.space.M[self.space.idx[t]]
        k = int(np.clip(round(math.sqrt(self.n / 20)), 8, 24))
        self.km = KMeans(k, n_init=4, random_state=0).fit(self.X)
        self.region = self.km.labels_
        C = self.km.cluster_centers_ / np.linalg.norm(self.km.cluster_centers_, axis=1, keepdims=True)
        self.C = C; cc = C @ C.T
        self.adj_thr = np.quantile(cc[np.triu_indices(k, 1)], 0.7)
        self.e_p40, self.e_p60 = np.nanquantile(self.energy, [0.4, 0.6])
        self.a_codes, self.a_inv = np.unique(self.art, return_inverse=True)
        self.g_codes, self.g_inv = np.unique(self.gen, return_inverse=True)
        gC = np.stack([self.X[self.g_inv == g].mean(0) for g in range(len(self.g_codes))])
        self.gC = gC / np.maximum(np.linalg.norm(gC, axis=1, keepdims=True), 1e-8)
        gcc = self.gC @ self.gC.T
        self.g_adj_thr = np.quantile(gcc[np.triu_indices(len(gC), 1)], 0.7)

    def history(self, t0):
        """Per-track / per-artist / per-genre stats from real events before t0."""
        h = self.ev[self.ev["at"] < t0]
        tp = np.zeros(self.n); tf = np.zeros(self.n); ts = np.zeros(self.n); tl = np.full(self.n, np.nan)
        idx = h["track"].map(self.pos).values
        np.add.at(tp, idx, 1); np.add.at(tf, idx, h["full"].values); np.add.at(ts, idx, h["skip"].values)
        last = h.groupby("track")["at"].max()
        for t, v in last.items(): tl[self.pos[t]] = (t0 - v).total_seconds() / 86400
        sig = D.signals(self.coll)
        fire = np.zeros(self.n); water = np.zeros(self.n); long_w = defaultdict(float); water_days = np.full(self.n, np.inf)
        if len(sig):
            s = sig[sig["at"] < t0]
            for r in s.itertuples():
                if r.track in self.pos:
                    j = self.pos[r.track]
                    if r.kind == "fire": fire[j] += 1; long_w[r.track] += 0.35 * 0.5 ** ((t0 - r.at).total_seconds() / 86400 / 30)
                    else:
                        water[j] += 1; water_days[j] = min(water_days[j], (t0 - r.at).total_seconds() / 86400)
        for r in h[h["full"]].itertuples():
            long_w[r.track] += 0.2 * 0.5 ** ((t0 - r.at).total_seconds() / 86400 / 30)
        st = {"tp": tp, "tf": tf, "ts": ts, "tl": tl, "fire": fire, "water": water, "water_days": water_days,
              "long": dict(sorted(long_w.items(), key=lambda kv: -kv[1])[:30]),
              "tot": [len(h), int(h["full"].sum())]}
        na = len(self.a_codes); ng = len(self.g_codes)
        ap = np.zeros(na); af = np.zeros(na); ask = np.zeros(na); al = np.full(na, np.nan)
        np.add.at(ap, self.a_inv[idx], 1); np.add.at(af, self.a_inv[idx], h["full"].values); np.add.at(ask, self.a_inv[idx], h["skip"].values)
        ai = pd.Series(h["at"].values, index=self.a_inv[idx]).groupby(level=0).max()
        for a, v in ai.items(): al[a] = (t0 - v).total_seconds() / 86400
        gp = np.zeros(ng); np.add.at(gp, self.g_inv[idx], 1)
        st.update(ap=ap, af=af, ask=ask, al=al, gp=gp)
        created = self.created.reindex(self.ids).values
        st["in_lib"] = np.array([(t0 - pd.Timestamp(c)).total_seconds() / 86400 if pd.notna(c) else 999 for c in created])
        return st


class Session:
    def __init__(self, W, st, t0):
        self.W, self.st, self.t = W, st, t0
        self.served = []    # (j, skipped)
        self.pool_log = []  # pool each served track was drawn from, frozen at serve time
        self.today = set(np.where(st["tl"] < (t0 - t0.normalize()).total_seconds() / 86400)[0])  # heard today already

    def add(self, j, skipped):
        W, st = self.W, self.st
        self.served.append((j, skipped))
        self.today.add(j)
        dt = (15 if skipped else W.dur[j] * 0.95) / 86400
        self.t += pd.Timedelta(days=dt)
        for key in ("tl", "al"): st[key] = st[key] + dt
        st["tp"][j] += 1; st["tf"][j] += (not skipped); st["ts"][j] += skipped; st["tl"][j] = 0.0
        a = W.a_inv[j]; st["ap"][a] += 1; st["af"][a] += (not skipped); st["ask"][a] += skipped; st["al"][a] = 0.0
        st["gp"][W.g_inv[j]] += 1; st["in_lib"] = st["in_lib"] + dt
        st["tot"][0] += 1; st["tot"][1] += (not skipped)

    def ctx(self):
        pos, neg = {}, {}
        for j, sk in self.served:
            t = self.W.ids[j]
            if sk: neg[t] = neg.get(t, 0) + 0.6
            else: pos[t] = pos.get(t, 0) + 0.4
        n_own = len(self.served)
        prev = self.W.ids[self.served[-1][0]] if self.served else None
        return {"pos": pos, "neg": neg, "long": self.st["long"], "w_long": max(0.15, 1 - n_own / 6), "prev": prev}

    def features(self, J):
        """Feature matrix (DataFrame) for candidate rows J at this moment."""
        W, st = self.W, self.st
        J = np.asarray(J)
        a = W.a_inv[J]; g = W.g_inv[J]
        prior = (st["tot"][1] + 2) / (st["tot"][0] + 4)
        sa = [W.a_inv[j] for j, _ in self.served]; sg = [W.g_inv[j] for j, _ in self.served]
        last = self.served[-1][0] if self.served else None
        run = np.zeros(len(J))
        for k, gg in enumerate(g):
            r = 0
            for x in reversed(sg):
                if x == gg: r += 1
                else: break
            run[k] = r
        recent6 = self.served[-6:]
        gsk = np.array([sum(1 for j, sk in recent6 if W.g_inv[j] == gg and sk) for gg in g])
        gfu = np.array([sum(1 for j, sk in recent6 if W.g_inv[j] == gg and not sk) for gg in g])
        f = {
            "t_plays": st["tp"][J], "t_full_rate": (st["tf"][J] + 2 * prior) / (st["tp"][J] + 2),
            "t_skip_rate": (st["ts"][J] + 2 * (1 - prior) * 0.3) / (st["tp"][J] + 2),
            "t_days_since": np.nan_to_num(st["tl"][J], nan=999.0), "t_fire": st["fire"][J], "t_water": st["water"][J],
            "t_days_in_lib": st["in_lib"][J],
            "a_plays": st["ap"][a], "a_full_rate": (st["af"][a] + 3 * prior) / (st["ap"][a] + 3),
            "a_skip_rate": (st["ask"][a] + 1) / (st["ap"][a] + 4), "a_days_since": np.nan_to_num(st["al"][a], nan=999.0),
            "a_in_sess": np.array([sa.count(x) for x in a]), "a_prev_same": (a == W.a_inv[last]).astype(int) if last is not None else np.zeros(len(J)),
            "album_cont": (W.alb[J] == W.alb[last]).astype(int) if last is not None else np.zeros(len(J)),
            "g_long_share": st["gp"][g] / max(1, st["gp"].sum()),
            "g_sess_share": np.array([sg.count(x) for x in g]) / max(1, len(sg)), "g_run": run,
            "g_sess_skips": gsk, "g_sess_full": gfu, "dur": W.dur[J],
            "s_pos": np.full(len(J), len(self.served)),
            "s_skip_rate": np.full(len(J), (sum(sk for _, sk in self.served) + 1) / (len(self.served) + 4)),
            "s_prev_skip": np.full(len(J), int(bool(self.served) and self.served[-1][1])),
            "s_prev2_skip": np.full(len(J), int(len(self.served) > 1 and self.served[-2][1])),
            "hour": np.full(len(J), self.t.hour + self.t.minute / 60), "dow": np.full(len(J), self.t.dayofweek),
            "energy": W.energy[J],
        }
        se = [W.energy[j] for j, _ in self.served[-5:]]
        f["energy_dev"] = np.abs(W.energy[J] - np.nanmean(se)) if se else np.full(len(J), np.nan)
        for k in AX: f["ax_" + k] = W.axes[k][J]
        fe = W.space.ctx_features(W.X[J], self.ctx())
        for k in EK: f["clap." + k] = fe[k]
        return pd.DataFrame(f)


# ---------------------------------------------------------------- policies
def pools(sess):
    st = sess.st
    positive = (st["tf"] > 0) | (st["fire"] > 0)
    unplayed = st["tp"] == 0
    rediscover = positive & (np.nan_to_num(st["tl"], nan=999) > 60)
    familiar = positive & ~rediscover
    return {"familiar": familiar, "unplayed": unplayed, "rediscover": rediscover}


PRESETS = {"mix": {"familiar": 0.5, "unplayed": 0.3, "rediscover": 0.2},
           "favorites": {"familiar": 0.8, "rediscover": 0.2},
           "rediscover": {"rediscover": 1.0},
           "unfamiliar": {"unplayed": 1.0}}


class Policy:
    name = "?"
    def pick(self, sess, rng): raise NotImplementedError


class V1(Policy):
    """v1 approximation: CLAP affinity score, slider 0.0 (fresh only), ≤2 artist in a row, 12 % explore."""
    name = "v1 (CLAP-скор, ползунок 0.0)"
    def pick(self, sess, rng):
        W, st = sess.W, sess.st
        fresh = np.nan_to_num(st["tl"], nan=999) > 30
        recent = {j for j, _ in sess.served[-10:]}
        ok = fresh.copy(); ok[list(recent)] = False
        if len(sess.served) >= 2 and W.a_inv[sess.served[-1][0]] == W.a_inv[sess.served[-2][0]]:
            ok &= W.a_inv != W.a_inv[sess.served[-1][0]]
        J = np.where(ok)[0]
        if rng.random() < 0.12: return int(rng.choice(J)), "explore"
        fe = W.space.ctx_features(W.X[J], sess.ctx())
        sc = S.v1_score(fe, 1 / (1 + st["tp"][J]), np.exp(-np.nan_to_num(st["tl"][J], nan=999)))
        return int(J[np.argmax(sc)]), "v1"


class Ranker(Policy):
    def __init__(self, model, name, rerank=False, preset="mix", sound=None, fatigue=False, cl=None, by="region", cap=6):
        self.m, self.name, self.rerank, self.preset, self.sound, self.fatigue, self.cl = model, name, rerank, preset, sound, fatigue, cl
        self.by, self.cap = by, cap
        self.visited = []

    def candidates(self, sess, rng):
        W, st = sess.W, sess.st
        cx = sess.ctx(); C = set()
        pos_j = [W.pos[t] for t in cx["pos"] if t in W.pos]
        pa = {W.a_inv[j] for j in pos_j}
        if pa: C |= set(np.where(np.isin(W.a_inv, list(pa)))[0])
        fe = W.space.ctx_features(W.X, cx)
        C |= set(np.argsort(-(fe["aff"] - 0.7 * fe["rep"]))[:150])
        s_art = np.log1p(st["ap"][W.a_inv]) * (st["af"][W.a_inv] + 1) / (st["ap"][W.a_inv] + 3)
        C |= set(np.argsort(-s_art)[:100])
        if self.cl is not None and pos_j:
            C |= set(np.argsort(-(self.cl @ self.cl[pos_j].T).max(1))[:100])
        P = pools(sess)
        for k, m in P.items():
            w = np.where(m)[0]
            if len(w): C |= set(rng.choice(w, min(80, len(w)), replace=False))
        return np.array(sorted(C))

    def pick(self, sess, rng):
        W = sess.W
        J = self.candidates(sess, rng)
        excl = sess.today if self.rerank else {j for j, _ in sess.served[-10:]}
        if self.rerank:  # hard filter: «вода»-locked for WATER_LOCK_DAYS
            excl = excl | set(np.where(sess.st['water_days'] < WATER_LOCK_DAYS)[0])
        J = np.array([j for j in J if j not in excl])
        if self.sound == "calm": J = J[W.energy[J] <= W.e_p40] if (W.energy[J] <= W.e_p40).sum() > 5 else J
        if self.sound == "energetic": J = J[W.energy[J] >= W.e_p60] if (W.energy[J] >= W.e_p60).sum() > 5 else J
        p = self.m.predict_proba(sess.features(J)[RANK_F].values)[:, 1]
        if not self.rerank:
            return int(J[np.argmax(p)]), "ranker"
        served = [j for j, _ in sess.served]
        # --- artist diversity: not within the last 3, at most 2 per 10
        last3 = {W.a_inv[j] for j in served[-3:]}
        cnt10 = defaultdict(int)
        for j in served[-10:]: cnt10[W.a_inv[j]] += 1
        ok = np.array([(W.a_inv[j] not in last3) and cnt10[W.a_inv[j]] < 2 for j in J])
        # --- preset shares over a rolling window of 12
        P = pools(sess); tgt = PRESETS[self.preset]
        win = sess.pool_log[-12:]
        have = {k: sum(1 for x in win if x == k) for k in tgt}
        need = {k: tgt[k] * (len(win) + 1) - have[k] for k in tgt}
        order = sorted(need, key=lambda k: -need[k])
        # --- regions: soft cap + fatigue travel
        reg = W.region if self.by == "region" else W.g_inv
        Cm = W.C if self.by == "region" else W.gC
        r10 = [reg[j] for j in served[-10:]]
        cur = reg[served[-1]] if served else None
        dwell = 0
        for j in reversed(served):
            if reg[j] == cur: dwell += 1
            else: break
        rskips = sum(1 for j, sk in sess.served[-3:] if reg[j] == cur and sk)
        travel = self.fatigue and cur is not None and (dwell >= 6 or rskips >= 2)
        cap_ok = np.array([r10.count(reg[j]) < self.cap for j in J]) if self.fatigue else np.ones(len(J), bool)
        score = p.copy()
        if travel:
            sims = Cm @ Cm[cur]
            cand_r = [r for r in range(len(Cm)) if r != cur and sims[r] > (W.adj_thr if self.by == 'region' else W.g_adj_thr) and r not in self.visited[-4:]] or \
                     [r for r in np.argsort(-sims)[1:4]]
            tr = cand_r[int(np.argmax([np.mean([p[k] for k in range(len(J)) if reg[J[k]] == r] or [0]) for r in cand_r]))]
            bridge = np.minimum(W.X[J] @ Cm[cur], W.X[J] @ Cm[tr])   # sounds like both regions
            z = (bridge - bridge.mean()) / (bridge.std() + 1e-6)
            score = p + 0.05 * z + 0.1 * (reg[J] == tr)
            cap_ok &= reg[J] != cur                                    # leave the fatigued region now
            self.visited.append(tr)
        # Stream spec §3.3: the POOL is chosen before the artist and genre rules. Stay in
        # it and relax the soft rules (genre cap, then artist) rather than jumping to
        # another pool; move on only when the pool itself has no candidate.
        for n_dry, k in enumerate(order):
            in_pool = P[k][J]
            for m in (ok & cap_ok & in_pool, ok & in_pool, in_pool):
                if m.any():
                    i = int(np.argmax(np.where(m, score, -9)))
                    # a substitute pool is marked: the share rule holds only while the pool has candidates
                    return int(J[i]), (k if n_dry == 0 else f"dry:{order[0]}->{k}")
        m = ok & cap_ok if (ok & cap_ok).any() else np.ones(len(J), bool)
        i = int(np.argmax(np.where(m, score, -9))); return int(J[i]), "fallback"


# ---------------------------------------------------------------- run
def simulate(W, policy, starts, listener, rng):
    rows = []
    for (t0, seed) in starts:
        st = W.history(t0)
        sess = Session(W, st, t0)
        for tr, sk in seed: sess.add(W.pos[tr], bool(sk))
        if hasattr(policy, "visited"): policy.visited = []
        for step in range(STEPS):
            j, why = policy.pick(sess, rng)
            P0 = pools(sess); sess.pool_log.append(next((k for k in ("familiar", "unplayed", "rediscover") if P0[k][j]), "other"))
            p = listener.predict_proba(sess.features([j])[SIM_F].values)[0, 1]
            sk = rng.random() > p
            heard_today = j in sess.today
            rows.append({"start": t0, "step": step, "j": j, "p": p, "skip": sk, "why": why, "artist": W.a_inv[j], "genre": W.gen[j],
                         "region": W.region[j], "energy": W.energy[j], "unplayed": st["tp"][j] == 0,
                         "repeat_today": heard_today, "pool": sess.pool_log[-1],
                         "locked": bool(st["water_days"][j] < WATER_LOCK_DAYS), "in_library": 0 <= j < W.n})
            sess.add(j, sk)
    return pd.DataFrame(rows)


def metrics(df, W):
    out = {"est. дослушивание": 1 - df["skip"].mean(), "P(не скип) ср.": df["p"].mean()}
    art, gen, reg, b2b, tg = [], [], [], [], []
    for _, s in df.groupby("start"):
        s = s.sort_values("step")
        for k in range(0, len(s) - 9, 5):
            w = s.iloc[k:k + 10]
            art.append(w["artist"].nunique()); gen.append(w["genre"].nunique())
            reg.append(w["region"].value_counts().iloc[0] / 10); tg.append(w["genre"].value_counts().iloc[0] / 10)
        b2b.append((s["artist"].values[1:] == s["artist"].values[:-1]).mean())
    out.update({"артистов/10": np.mean(art), "жанров/10": np.mean(gen), "топ-регион/10": np.mean(reg), "топ-жанр/10": np.mean(tg),
                "артист подряд": np.mean(b2b), "непрослушанных": df["unplayed"].mean(), "пулы факт": df["pool"].value_counts(normalize=True).round(2).to_dict() if "pool" in df else None, "повторы за день": df["repeat_today"].mean(),
                "энергия (перцентиль)": np.mean([(W.energy < e).mean() for e in df["energy"]])})
    return out



REFERENCE = "reference: ranker + presets «Микс» + artist rules + genre fatigue, cap 5/10"


def invariants(df, target=PRESETS["mix"]):
    """Hard invariants over a simulated run (phase 0 §4.4)."""
    v = {"same_day_repeat": int(df["repeat_today"].sum()), "locked_served": int(df["locked"].sum()),
         "outside_library": int((~df["in_library"]).sum()), "preset_window": 0}
    for _, g in df.groupby("start"):
        pools, whys = g.sort_values("step")["pool"].tolist(), g.sort_values("step")["why"].tolist()
        for k in range(12, len(pools) - 11):
            win, why = pools[k:k + 12], whys[k:k + 12]
            if any(w == "fallback" or str(w).startswith("dry:") for w in why):
                continue  # a pool ran dry: the share rule is suspended by design
            for pool, share in target.items():
                # «± 1 track» is in whole tracks: 20 % of 12 is 2.4 tracks, so 1–3 is on target
                if abs(win.count(pool) - round(share * 12)) > 1:
                    v["preset_window"] += 1
    return v


def real_v1(W, listener, coll):  # listener: trained BEFORE SPLIT, so this is out-of-sample
    """The logged v1 «Поток» sessions after SPLIT, measured like a policy, plus the
    listener's calibration on them (predicted vs actual not-skipped)."""
    ev, X = feats(coll)
    m = (ev["at"] >= SPLIT).values & ev["stream"].values
    p = listener.predict_proba(X.loc[m, SIM_F].values)[:, 1]
    s = ev[m]
    df = pd.DataFrame({"start": s["lsess"].values, "step": range(len(s)), "p": p, "skip": s["skip"].values,
                       "artist": [W.a_inv[W.pos[t]] for t in s["track"]], "genre": s["genre"].values,
                       "region": [W.region[W.pos[t]] for t in s["track"]],
                       "energy": [W.energy[W.pos[t]] for t in s["track"]],
                       "unplayed": (X.loc[m, "t_plays"] == 0).values, "repeat_today": False})
    mm = metrics(df, W)
    mm.pop("пулы факт", None)
    mm["listener_predicted"] = float(p.mean())
    mm["actual_not_skipped"] = float(1 - s["skip"].mean())
    return mm


def run_e4(n_sessions={D.OWNER: 30, D.FRIEND: 12}):
    rng0 = np.random.default_rng(0)
    listener = train(SIM_F)
    calib = train(SIM_F, until=SPLIT)  # the same model family, out-of-sample on real v1 plays
    ranker = train(RANK_F, until=SPLIT)
    out = {}
    for coll, n_sess in n_sessions.items():
        W = World(coll)
        ev = W.ev
        cl = colisten(ev, W.ids, SPLIT)
        starts = []
        for _, s in ev[ev["at"] >= SPLIT].groupby("lsess"):
            if len(s) >= 5:
                starts.append((s["at"].iloc[0], list(zip(s["track"].iloc[:2], s["skip"].iloc[:2]))))
        starts = [starts[i] for i in sorted(rng0.choice(len(starts), min(n_sess, len(starts)), replace=False))]
        pol = Ranker(ranker, REFERENCE, rerank=True, fatigue=True, cl=cl, by="genre", cap=5)
        df = simulate(W, pol, starts, listener, np.random.default_rng(1))
        m = metrics(df, W)
        out[coll[:9]] = {"real_v1": real_v1(W, calib, coll), "reference_policy": m,
                         "invariants": invariants(df), "sessions": len(starts)}
    return out
