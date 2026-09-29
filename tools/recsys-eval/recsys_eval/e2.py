"""Throwaway spike: E2b — candidate-generation sources compared on the whole
library: which source puts the next completed (self-chosen) track in its top K."""
import sys, numpy as np, pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import svds
from . import data as D, space as S
from ._evalrank import cached_ctx

SPACES = ["clap"]
FOLDS = [pd.Timestamp(x) for x in ["2026-07-28", "2026-08-12", "2026-08-27", "2026-09-10", "2026-10-01"]]
KS = (10, 50, 200)


def colisten(ev, ids, before):
    """PPMI over tracks completed in the same listening session → SVD-64."""
    pos = {t: i for i, t in enumerate(ids)}
    e = ev[(ev["at"] < before) & (~ev["skip"])]
    rows, cols = [], []
    for _, g in e.groupby("lsess"):
        tr = [pos[t] for t in g["track"] if t in pos]
        tr = list(dict.fromkeys(tr))
        for a in range(len(tr)):
            for b in range(max(0, a - 5), min(len(tr), a + 6)):
                if a != b: rows.append(tr[a]); cols.append(tr[b])
    n = len(ids)
    if not rows: return None
    C = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n)).tocsr()
    tot = C.sum(); rs = np.asarray(C.sum(1)).ravel(); cs = np.asarray(C.sum(0)).ravel()
    C = C.tocoo()
    pmi = np.log(C.data * tot / (rs[C.row] * cs[C.col] + 1e-9))
    keep = pmi > 0
    P = coo_matrix((pmi[keep], (C.row[keep], C.col[keep])), shape=(n, n)).tocsr()
    k = min(64, n - 2)
    U, s, _ = svds(P.astype(np.float64), k=k)
    V = U * np.sqrt(s)
    nrm = np.linalg.norm(V, axis=1, keepdims=True)
    return np.where(nrm > 0, V / np.maximum(nrm, 1e-9), 0)


def run(coll):
    ev, F, ctxs = cached_ctx(coll)
    lib = D.library(coll)
    ids = list(lib.index)
    pos_of = {t: j for j, t in enumerate(ids)}
    art = lib["artist_key"].values
    art_idx = {a: [] for a in set(art)}
    for j, a in enumerate(art): art_idx[a].append(j)
    spaces = {sp: S.Space(coll, sp) for sp in SPACES}
    Xs = {}
    for sp, space in spaces.items():
        X = np.zeros((len(ids), space.M.shape[1]), np.float32); have = np.zeros(len(ids), bool)
        for j, t in enumerate(ids):
            if t in space.idx: X[j] = space.M[space.idx[t]]; have[j] = True
        Xs[sp] = (X, have)
    # running per-artist / per-track stats
    a_plays = {}; a_full = {}; a_last = {}; t_plays = np.zeros(len(ids)); tot = [0, 0]
    targets = set(i for i in ev.index[(ev["full"]) & (~ev["album_cont"])] if F.at[i, "s_pos"] >= 1 and ev.at[i, "track"] not in ctxs[i]["recent"])
    fold_of = lambda t: next((k for k in range(len(FOLDS) - 1) if FOLDS[k] <= t < FOLDS[k + 1]), None)
    cl_cache = {}
    out = []
    rng = np.random.default_rng(0)
    for i, r in enumerate(ev.itertuples()):
        if i in targets and r.track in pos_of:
            cx = ctxs[i]; t = pos_of[r.track]
            excl = np.zeros(len(ids), bool)
            for u in cx["recent"]:
                if u in pos_of: excl[pos_of[u]] = True
            prior = (tot[1] + 2) / (tot[0] + 4)
            ap = np.array([a_plays.get(a, 0) for a in art]); af = np.array([a_full.get(a, 0) for a in art])
            ad = np.array([(r.at - a_last[a]).total_seconds() / 86400 if a in a_last else 999 for a in art])
            s_art = np.log1p(ap) * (af + 3 * prior) / (ap + 3) * (1 + 1 / (1 + ad))
            sess_art = {art[pos_of[u]] for u, w in cx["pos"].items() if u in pos_of}
            s_sessart = np.array([a in sess_art for a in art], float) + 1e-3 * s_art
            sc = {"random": rng.random(len(ids)), "popularity (own plays)": t_plays + 1e-3 * rng.random(len(ids)),
                  "artist affinity": s_art, "artists liked this session": s_sessart}
            for sp, space in spaces.items():
                X, have = Xs[sp]
                fe = space.ctx_features(X, cx)
                a_ = np.where(have, fe["aff"] - 0.7 * fe["rep"], -9)
                sc[f"audio[{sp}]"] = a_
                ra = pd.Series(a_).rank(pct=True).values; rb = pd.Series(s_art).rank(pct=True).values
                sc[f"hybrid artist+audio[{sp}]"] = 0.5 * ra + 0.5 * rb
            k = fold_of(r.at)
            if k is not None and k > 0:
                if k not in cl_cache: cl_cache[k] = colisten(ev, ids, FOLDS[k])
                V = cl_cache[k]
                if V is not None:
                    P = [pos_of[u] for u, w in cx["pos"].items() if u in pos_of and w > 0]
                    if P:
                        sc["co-listen (PPMI-SVD)"] = (V @ V[P].T).max(1)
            for name, s in sc.items():
                s = np.where(excl, -np.inf, s)
                rank = float((s > s[t]).sum() + 0.5 * ((s == s[t]).sum() - 1) + 1)  # ties split evenly
                out.append({"i": i, "src": name, "kind": "organic" if r.organic else ("stream" if r.stream else "unlabelled"),
                            "rank": rank, "unplayed": t_plays[t] == 0, "fold": k})
        # apply
        a = art[pos_of[r.track]] if r.track in pos_of else None
        if a is not None:
            a_plays[a] = a_plays.get(a, 0) + 1; a_full[a] = a_full.get(a, 0) + int(r.full); a_last[a] = r.at
            t_plays[pos_of[r.track]] += 1
        tot[0] += 1; tot[1] += int(r.full)
    return pd.DataFrame(out)



BUDGET = {"artists liked this session": 100, "audio[clap]": 150, "artist affinity": 100,
          "co-listen (PPMI-SVD)": 100}


def run_e2() -> dict:
    """E2: recall@200 per source, and the merged candidate set (stream spec §3.1 budgets),
    for self-chosen (organic) and never-played targets."""
    out = {}
    for coll in [D.OWNER, D.FRIEND]:
        df = run(coll)
        df = df[df.fold.fillna(-1) >= 1]
        per = {}
        for (src, kind), g in df.groupby(["src", "kind"]):
            per.setdefault(src, {})[kind] = round(float((g["rank"] <= 200).mean()), 3)
        for src, g in df[df.unplayed].groupby("src"):
            per.setdefault(src, {})["never_played"] = round(float((g["rank"] <= 200).mean()), 3)
        w = df.pivot_table(index=["i", "kind", "unplayed"], columns="src", values="rank").reset_index()
        hit = np.zeros(len(w), bool)
        for s_, k in BUDGET.items():
            if s_ in w:
                hit |= (w[s_] <= k).fillna(False).values
        w["merged"] = hit
        w["random500"] = w["random"] <= 500
        org, unp = w[w.kind == "organic"], w[w.unplayed]
        out[coll[:9]] = {"per_source_recall@200": per,
                         "merged_set": {"chosen": round(float(org["merged"].mean()), 3),
                                        "never_played": round(float(unp["merged"].mean()), 3),
                                        "random500_chosen": round(float(org["random500"].mean()), 3),
                                        "random500_never_played": round(float(unp["random500"].mean()), 3)}}
    return out
