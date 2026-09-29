"""«Поток» harness data: a prod snapshot → per-library event tables with outcomes.

`use(<snapshot dir>)` first. The snapshot's metadata.db and Qdrant dump are read
once and cached as recsys/snap.pkl next to the snapshot (never in git).
"""
import gzip
import json
import pickle
import sqlite3
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

OWNER = "acct_c2b5b12d55d341feb0940929e5a12c0d"
FRIEND = "acct_55804614d9c247e7961a8f76b57178ad"
STREAM_SOURCES = {"fresh", "band", "familiar", "explore"}
GAP_MIN = 30  # a new listening session after 30 min of silence
SNAP_DIR: Path | None = None


def use(snap_dir: str | Path) -> None:
    global SNAP_DIR
    SNAP_DIR = Path(snap_dir)
    for f in (snap, library, events, signals, vectors):
        f.cache_clear()


def cache_dir() -> Path:
    assert SNAP_DIR is not None, "call data.use(<snapshot dir>) first"
    d = SNAP_DIR / "recsys"
    d.mkdir(exist_ok=True)
    return d


def _build() -> dict:
    db = sqlite3.connect(f"file:{SNAP_DIR / 'metadata.db'}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    rows = lambda sql: [dict(r) for r in db.execute(sql)]  # noqa: E731
    out = {
        "events": rows("select id, collection_name coll, session_id sess, track_id track, played_at at, played_sec played, total_dur dur, skipped_early skip, interacted, influence, source from playback_events order by played_at, id"),
        "signals": rows("select collection_name coll, session_id sess, track_id track, kind, created_at at from taste_signals order by created_at"),
        "tracks": rows("select collection_name coll, track_id id, title, artist, primary_artist_slug artist_slug, album, year, genre, duration, file_path, sonic_axes axes, created_at from track_metadata"),
        "vectors": {},
    }
    for f in sorted((SNAP_DIR / "qdrant").glob("acct_*.jsonl.gz")):
        ids, clap, text = [], [], []
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            for r in map(json.loads, fh):
                v = r["vector"]
                if "clap" not in v:
                    continue
                ids.append(str(r["id"]))
                clap.append(v["clap"])
                text.append(v.get("text") or [0.0] * 1024)
        out["vectors"][f.name.removesuffix(".jsonl.gz")] = {
            "ids": ids, "clap": np.asarray(clap, np.float32), "text": np.asarray(text, np.float32)}
    return out


@lru_cache(None)
def snap():
    p = cache_dir() / "snap.pkl"
    if p.exists():
        return pickle.load(open(p, "rb"))
    s = _build()
    pickle.dump(s, open(p, "wb"))
    return s


def is_skip(played, dur):
    if dur and 0 < dur < 120: return played < 0.25 * dur
    return played < 30.0

@lru_cache(None)
def library(coll):
    s = snap()
    tr = pd.DataFrame([t for t in s["tracks"] if t["coll"] == coll]).drop_duplicates("id").set_index("id")
    ax = tr["axes"].map(lambda a: json.loads(a) if a else {})
    for k in ["energy", "vocal_lead", "spacious", "experimental", "brightness", "acousticness"]:
        tr["ax_" + k] = ax.map(lambda d: d.get(k, np.nan))
    tr["genre"] = tr["genre"].fillna("Other").replace("", "Other")
    tr["artist_key"] = tr["artist_slug"].fillna(tr["artist"].fillna("?").str.lower())
    tr["album_key"] = tr["artist_key"] + "|" + tr["album"].fillna("?").str.lower()
    return tr

@lru_cache(None)
def events(coll):
    s = snap()
    ev = pd.DataFrame([e for e in s["events"] if e["coll"] == coll])
    ev["at"] = pd.to_datetime(ev["at"])
    ev = ev.sort_values(["at", "id"]).reset_index(drop=True)
    lib = library(coll)
    ev = ev[ev["track"].isin(lib.index)].reset_index(drop=True)
    dur = ev["dur"].where(ev["dur"] > 0, ev["track"].map(lib["duration"]))
    ev["dur"] = dur
    ev["ratio"] = (ev["played"] / dur).clip(0, 1.5)
    ev["skip"] = [is_skip(p, d) for p, d in zip(ev["played"], dur)]
    ev["full"] = (ev["ratio"] >= 0.85) & ~ev["skip"]
    ev["stream"] = ev["source"].isin(STREAM_SOURCES)
    gap = ev["at"].diff().dt.total_seconds().div(60).fillna(1e9)
    ev["lsess"] = (gap > GAP_MIN).cumsum()
    sig = pd.DataFrame([x for x in s["signals"] if x["coll"] == coll])
    if len(sig):
        sig["at"] = pd.to_datetime(sig["at"])
        # a reaction belongs to the latest play of that track at or before it (within 6 h)
        ev["fire"] = False; ev["water"] = False
        for _, r in sig.iterrows():
            m = (ev["track"] == r["track"]) & (ev["at"] <= r["at"] + pd.Timedelta(minutes=10)) & (ev["at"] >= r["at"] - pd.Timedelta(hours=6))
            idx = ev.index[m]
            if len(idx): ev.loc[idx[-1], r["kind"]] = True
    else:
        ev["fire"] = False; ev["water"] = False
    lib_a = lib["artist_key"]; lib_al = lib["album_key"]
    ev["artist"] = ev["track"].map(lib_a); ev["album"] = ev["track"].map(lib_al); ev["genre"] = ev["track"].map(lib["genre"])
    # organic = picked by the listener, not by «Поток»
    ev["organic"] = ev["source"].eq("manual")
    prev_album = ev.groupby("lsess")["album"].shift(1)
    ev["album_cont"] = ev["album"].eq(prev_album)
    return ev

@lru_cache(None)
def signals(coll):
    s = snap()
    sig = pd.DataFrame([x for x in s["signals"] if x["coll"] == coll])
    if len(sig): sig["at"] = pd.to_datetime(sig["at"])
    return sig

@lru_cache(None)
def vectors(coll, space):
    """{track_id: row} index + unit matrix for one embedding space."""
    lib = library(coll)
    v = snap()["vectors"][coll]
    ids, M = v["ids"], v[space]
    M = np.asarray(M, np.float32)
    M = M / np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-8)
    idx = {t: i for i, t in enumerate(ids)}
    return idx, M
