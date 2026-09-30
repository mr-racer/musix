"""E1 / E2 / E4 with the v2 engine itself (phase 2 §10): `musix.recsys` — the features,
the replay, the ranker, the policy — on the snapshot as v2 stores it (the database
`MUSIX_SNAP_DB`, default `musix_mig`, loaded by tools/migrate/migrate.py).

- E1: session GAUC of the v2 ranker, rolling-origin folds (the same folds as the study).
- E2: recall of the v2 merged candidate set (the online sources, their budgets).
- E4: whole-session simulation. The system under test is the v2 online path run in
  memory (candidates → features → ranker → policy); the simulated LISTENER is the
  harness's response model (`e4.train(SIM_F)` over the v1-id world), so the engine
  never grades itself. Track ids cross between the two through migr_track_map.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import os
from collections import defaultdict
from dataclasses import dataclass

import numpy as np
import pandas as pd
import sqlalchemy as sa

from musix.contexts.stream import history, jobs
from musix.infra import db
from musix.recsys import features, policy
from musix.recsys import replay as R
from musix.recsys import train as TR
from musix.recsys.outcome import W_FULL
from musix.recsys.session import Listen, sessions
from musix.settings import Settings

from . import data as D
from . import e4 as H

SNAP_DB = os.environ.get("MUSIX_SNAP_DB", "musix_mig")
DB = os.environ.get("MUSIX_SNAP_DSN", f"postgresql://musix:musix@127.0.0.1:18432/{SNAP_DB}")  # the prod stack: its own
FOLDS = [dt.datetime(2026, m, d, tzinfo=dt.UTC) for m, d in [(7, 28), (8, 12), (8, 27), (9, 10), (10, 1)]]
SPLIT = dt.datetime(2026, 9, 10, tzinfo=dt.UTC)
MIX = {"familiar": 0.5, "unplayed": 0.3, "rediscover": 0.2}


@dataclass
class Library:
    account: object
    coll: str
    meta: dict[str, R.TrackMeta]
    listens: list[Listen]
    signals: list[R.Signal]
    v1_of: dict[str, str]  # v2 track id → v1 track id
    v2_of: dict[str, str]


async def _load(coll: str) -> Library:
    engine = db.make_engine(Settings(_env_file=None, database_url=DB), statement_timeout_ms=600_000)  # type: ignore[call-arg]
    sm = db.make_sessionmaker(engine)
    async with sm() as s:
        acct = await s.scalar(sa.text("SELECT account_id FROM migr_account_map WHERE v1_user_id = :u"),
                              {"u": coll.removeprefix("acct_")})
        meta, ls, sg = await history.load(s, acct)
        rows = (await s.execute(sa.text("SELECT track_id, v1_track_id FROM migr_track_map WHERE v1_collection = :c"),
                                {"c": coll})).all()
    await engine.dispose()
    v1_of = {str(t): v for t, v in rows}
    return Library(acct, coll, meta, ls, sg, v1_of, {v: k for k, v in v1_of.items()})


def load(coll: str) -> Library:
    return asyncio.run(_load(coll))


def rows_of(lib: Library) -> list[R.Row]:
    return [r for _, r in R.replay(lib.meta, lib.listens, lib.signals) if r is not None]


# ── E1 ───────────────────────────────────────────────────────────────────────


def run_e1(libs: list[Library]) -> dict:
    d = TR.dataset([rows_of(lib) for lib in libs])
    pred = np.full(len(d.y), np.nan)
    for lo, hi in zip(FOLDS[:-1], FOLDS[1:], strict=True):
        tr, te = d.at < lo.timestamp(), (d.at >= lo.timestamp()) & (d.at < hi.timestamp())
        if te.any():
            pred[te] = TR.fit(d, tr).predict(d.X[te])
    out = {}
    for k, lib in enumerate(libs):
        m = (d.group // 1_000_000 == k) & ~np.isnan(pred)
        out[lib.coll[:9]] = {"gauc": round(TR.gauc(d.group[m], d.full[m], d.skip[m], pred[m]), 3),
                             "rows": int(m.sum())}
    return out


# ── the in-memory online path ────────────────────────────────────────────────


class Engine:
    """contexts/stream/{candidates,service}.py, run over memory instead of Postgres/Qdrant."""

    def __init__(self, lib: Library, W: H.World, model: TR.Model, until: dt.datetime) -> None:
        self.lib, self.W, self.model = lib, W, model
        self.ids = [t for t in lib.meta if t in lib.v1_of and lib.v1_of[t] in W.pos]
        self.row = {t: i for i, t in enumerate(self.ids)}
        self.X = np.stack([W.X[W.pos[lib.v1_of[t]]] for t in self.ids])  # CLAP (copied vectors)
        self.art = np.array([lib.meta[t].artist or "" for t in self.ids])
        self.by_artist: dict[str, list[int]] = defaultdict(list)
        for i, a in enumerate(self.art):
            self.by_artist[a].append(i)
        before = [x for x in lib.listens if x.at < until]
        heard = [[x.track_id for x in s if not (x.played_ms < 30_000)] for s in sessions(before)]
        V = jobs.ppmi_svd(self.ids, heard)
        self.cl = V
        genres: dict[str, list[int]] = defaultdict(list)
        for i, t in enumerate(self.ids):
            genres[lib.meta[t].genre].append(i)
        C = {g: self.X[ix].mean(0) for g, ix in genres.items()}
        self.gvec = {g: v / max(np.linalg.norm(v), 1e-8) for g, v in C.items()}
        M = np.stack(list(self.gvec.values()))
        cc = M @ M.T
        self.adj = float(np.quantile(cc[np.triu_indices(len(M), 1)], 0.7)) if len(M) > 1 else 1.0
        e = np.array([lib.meta[t].energy for t in self.ids if lib.meta[t].energy is not None])
        self.p40, self.p60 = np.quantile(e, [0.4, 0.6]) if len(e) else (None, None)
        self.tolerance = jobs.genre_tolerance(before)

    def long_positives(self, st: R.State, now: dt.datetime) -> list[str]:
        w: dict[str, float] = defaultdict(float)
        for x in self.lib.listens:
            if x.at >= now:
                break
            if x.played_ms >= 0.85 * (x.duration_ms or 1e18):
                w[x.track_id] += W_FULL * 0.5 ** ((now - x.at).total_seconds() / 86400 / 30)
        return [t for t, _ in sorted(w.items(), key=lambda kv: -kv[1])[:30] if t in self.row]

    def candidates(self, st: R.State, now: dt.datetime, longp: list[str], rng: np.random.Generator) -> dict[str, set[str]]:
        out: dict[str, set[str]] = defaultdict(set)
        sess = st.session(now)
        pos = [x.track for x in sess if x.w > 0 and x.track in self.row]
        neg = [x.track for x in sess if x.w < 0 and x.track in self.row]
        liked = {x.artist for x in sess if x.w > 0 and x.artist}
        pool = [i for a in liked for i in self.by_artist.get(a, [])]
        for i in rng.permutation(pool)[:100]:
            out[self.ids[i]].add("session_artist")
        aff = sorted(self.by_artist, key=lambda a: -np.log1p(st.a_n[a]) * (st.a_full[a] + 1) / (st.a_n[a] + 3))[:30]
        pool = [i for a in aff for i in self.by_artist[a]]
        for i in rng.permutation(pool)[:100]:
            out[self.ids[i]].add("artist_affinity")
        anchors = list(dict.fromkeys(pos + longp))[:40]
        if anchors:
            ps = (self.X @ self.X[[self.row[t] for t in anchors]].T).max(1)
            ns = (self.X @ self.X[[self.row[t] for t in neg]].T).max(1) if neg else np.full(len(self.ids), -1.0)
            sc = np.where(ps > ns, ps, -ns)  # Qdrant BEST_SCORE
            sc[[self.row[t] for t in anchors]] = -np.inf
            for i in np.argsort(-sc)[:150]:
                out[self.ids[i]].add("clap")
        if self.cl is not None and (pos or longp):
            P = [self.row[t] for t in (pos or longp)]
            s2 = (self.cl @ self.cl[P].T).max(1)
            s2[P] = -np.inf
            for i in np.argsort(-s2)[:100]:
                out[self.ids[i]].add("colisten")
        for name in ("familiar", "rediscover", "unplayed"):
            members = [i for i, t in enumerate(self.ids)
                       if name in policy.pools_of(st.t_full[t], st.fires[t], st.t_n[t],
                                                  (now - st.t_last[t]).total_seconds() / 86400 if t in st.t_last else None)]
            for i in rng.permutation(members)[:80]:
                out[self.ids[i]].add(f"pool:{name}")
        return out

    def pick(self, st: R.State, now: dt.datetime, longp: list[str], served: list[tuple[str, str]],
             visited: list[str], today: set[str], locked: set[str], rng: np.random.Generator) -> tuple[str, policy.Decision] | None:
        props = self.candidates(st, now, longp, rng)
        ids = [t for t in props if t not in today and t not in locked] or list(props)
        cands = [st.cand(t, now) for t in ids]
        p = self.model.predict(features.matrix(st.account(), st.session(now), cands))
        items = [policy.Item(t, c.artist, c.genre, c.energy,
                             policy.pools_of(c.fulls, c.fires, c.listens, c.days_since), float(p[k]),
                             self.X[self.row[t]]) for k, (t, c) in enumerate(zip(ids, cands, strict=True))]
        recent = [policy.Recent(x.track, x.artist, x.genre, x.w < 0) for x in st.session(now)]
        ctx = policy.Ctx(shares=MIX, recent=recent, pool_log=[pl for _, pl in served], excluded=today | locked,
                         tolerance=self.tolerance, genre_vec=self.gvec, adjacency=self.adj, visited=visited,
                         explore=policy.is_explore_slot(len(served)))
        d = policy.pick(items, ctx, rng)
        return (ids[d.index], d) if d else None


# ── E2 ───────────────────────────────────────────────────────────────────────


def run_e2(lib: Library, W: H.World) -> dict:
    """Recall of the merged v2 candidate set: the next completed, non-album-continuation
    listens after the first fold, for chosen (manual) and never-played targets."""
    rows = rows_of(lib)
    model = TR.fit(TR.dataset([rows]))  # unused by E2 but keeps Engine's signature
    eng = Engine(lib, W, model, FOLDS[1])
    rng = np.random.default_rng(0)
    hits = {"chosen": [], "never_played": []}
    idx = 0
    for st, row in R.replay(lib.meta, lib.listens, lib.signals):
        if row is None:
            break
        x = lib.listens[idx]
        idx += 1
        if row.at < FOLDS[1] or not row.full or not row.sess or row.cand.track not in eng.row:
            continue
        last = row.sess[-1]
        if row.cand.album and last.album == row.cand.album:
            continue  # an album continuation is not a recommendation target
        got = row.cand.track in eng.candidates(st, row.at, eng.long_positives(st, row.at), rng)
        if x.source == "manual":
            hits["chosen"].append(got)
        if row.cand.listens == 0:
            hits["never_played"].append(got)
    return {k: {"recall": round(float(np.mean(v)), 3) if v else None, "n": len(v)} for k, v in hits.items()}


# ── E4 ───────────────────────────────────────────────────────────────────────


def run_e4(libs: list[Library], n_sessions: dict[str, int]) -> dict:
    listener = H.train(H.SIM_F)
    d = TR.dataset([[r for r in rows_of(lib) if r.at < SPLIT] for lib in libs])
    model = TR.fit(d)
    out = {}
    for lib in libs:
        W = H.World(lib.coll)
        eng = Engine(lib, W, model, SPLIT)
        starts = []
        for _, s in W.ev[W.ev["at"] >= pd.Timestamp(SPLIT.replace(tzinfo=None))].groupby("lsess"):
            if len(s) >= 5:
                starts.append((s["at"].iloc[0], list(zip(s["track"].iloc[:2], s["skip"].iloc[:2], strict=True))))
        rng0 = np.random.default_rng(0)
        n = n_sessions[lib.coll]
        starts = [starts[i] for i in sorted(rng0.choice(len(starts), min(n, len(starts)), replace=False))]
        rows = []
        rng = np.random.default_rng(1)
        for t0, seed in starts:
            now = pd.Timestamp(t0).to_pydatetime().replace(tzinfo=dt.UTC)
            st = next(s for s, r in R.replay(lib.meta, [x for x in lib.listens if x.at < now],
                                             [g for g in lib.signals if g.at < now]) if r is None)
            hst = W.history(t0)
            sess = H.Session(W, hst, t0)
            midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
            today = {x.track_id for x in lib.listens if midnight <= x.at < now}
            locked = {g.track_id for g in lib.signals if g.kind == "water" and now - g.at < dt.timedelta(days=1)}
            for tr, sk in seed:  # the session's real first two plays
                sess.add(W.pos[tr], bool(sk))
                if tr in lib.v2_of:
                    t2 = lib.v2_of[tr]
                    st.apply(Listen(t2, now, 15_000 if sk else 200_000, 240_000, lib.meta[t2].artist,
                                    lib.meta[t2].album, lib.meta[t2].genre, lib.meta[t2].energy), False)
                    today.add(t2)
                now += dt.timedelta(minutes=4)
            longp = eng.long_positives(st, now)
            served: list[tuple[str, str]] = []
            visited: list[str] = []
            for step in range(H.STEPS):
                got = eng.pick(st, now, longp, served, visited, today, locked, rng)
                if got is None:
                    break
                t2, dcs = got
                j = W.pos[lib.v1_of[t2]]
                p = listener.predict_proba(sess.features([j])[H.SIM_F].values)[0, 1]
                sk = rng.random() > p
                pool = dcs.pool.split("->")[-1] if dcs.pool.startswith("dry:") else dcs.pool
                rows.append({"start": t0, "step": step, "j": j, "p": p, "skip": sk, "why": dcs.pool,
                             "artist": W.a_inv[j], "genre": W.gen[j], "region": W.region[j],
                             "energy": W.energy[j], "unplayed": st.t_n[t2] == 0,
                             "repeat_today": t2 in today, "pool": pool,
                             "locked": t2 in locked, "in_library": True})
                served.append((t2, pool))
                sess.add(j, bool(sk))
                dur = lib.meta[t2].dur_s or 240
                played = 15_000 if sk else int(dur * 950)
                st.apply(Listen(t2, now, played, int(dur * 1000), lib.meta[t2].artist, lib.meta[t2].album,
                                lib.meta[t2].genre, lib.meta[t2].energy), False)
                today.add(t2)
                now += dt.timedelta(seconds=15 if sk else dur * 0.95)
        df = pd.DataFrame(rows)
        m = H.metrics(df, W)
        out[lib.coll[:9]] = {"v2_engine": m, "invariants": H.invariants(df), "sessions": len(starts)}
    return out


def run() -> dict:
    libs = [load(D.OWNER), load(D.FRIEND)]
    r = {"e1": run_e1(libs), "e2": {lib.coll[:9]: run_e2(lib, H.World(lib.coll)) for lib in libs},
         "e4": run_e4(libs, {D.OWNER: 30, D.FRIEND: 12})}
    o = r["e4"][D.OWNER[:9]]["v2_engine"]
    e2 = r["e2"][D.OWNER[:9]]
    inv = {k: v for x in r["e4"].values() for k, v in x["invariants"].items() if v}
    r["gates"] = {
        "E1 v2 ranker GAUC ≥ 0.70 (owner)": r["e1"][D.OWNER[:9]]["gauc"] >= 0.70,
        "E2 merged set ≥ 21 % chosen (owner)": (e2["chosen"]["recall"] or 0) >= 0.21,
        "E2 merged set ≥ 14.5 % never played (owner)": (e2["never_played"]["recall"] or 0) >= 0.145,
        "E4 top genre / 10 ≤ 0.50": o["топ-жанр/10"] <= 0.50,
        "E4 genres / 10 ≥ 3.0": o["жанров/10"] >= 3.0,
        "E4 artists / 10 ≥ 8.0": o["артистов/10"] >= 8.0,
        "invariants: 0 violations": not inv,
    }
    return r


def main() -> None:
    import json
    import sys
    from pathlib import Path

    snap = Path(sys.argv[1])
    D.use(snap)
    r = {"snapshot": snap.name, "engine": "v2 (musix.recsys)", **run()}
    text = json.dumps(r, indent=2, ensure_ascii=False, default=float)
    for acct, role in ((D.OWNER[:9], "owner"), (D.FRIEND[:9], "friend")):
        text = text.replace(acct, role)  # the report is committed: roles, never ids
    r = json.loads(text)
    name = f"{snap.name}-v2.json" if SNAP_DB == "musix_snap" else f"{snap.name}-v2-{SNAP_DB}.json"
    out = Path(__file__).resolve().parents[1] / "report" / name
    out.write_text(text)
    md = [f"# «Поток» gates — the v2 engine, snapshot {snap.name}", "", "## Gates (stream spec §10)", ""]
    md += [f"- {'PASS' if ok else 'FAIL'} — {name}" for name, ok in r["gates"].items()]
    for k in ("e1", "e2", "e4"):
        md += ["", f"## {k.upper()}", "", "```json", json.dumps(r[k], indent=1, ensure_ascii=False, default=float), "```"]
    out.with_suffix(".md").write_text("\n".join(md) + "\n")
    print(json.dumps(r["gates"], indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
