"""The migrator's `verify` stage: the migration gate (phase 3 spec §6).

Every check derives what v2 must hold from the snapshot by v1's own rules (not by
re-running the migrator's code), and names each expected difference:

- counts per entity: v1 rows − named collapses (orphans, duplicates, per-account copies of
  what v2 keeps once, removed features) must equal v2's rows, exactly;
- checksums per account: the track id set, v2's OWN stats (`account_track_stats`, computed
  by the listening service) against v1's events, fire/water per track, playlist sequences,
  facts per subject visible in both, bio presence;
- spot checks: N seeded-random tracks per account, what the player shows (metadata,
  lyrics, facts, producers/samples, vibe line) against v1's read rules;
- the gates: search 4.1–4.3 and «Поток» 4.4 run on the migrated DB (`make migrate` runs
  them before this stage); their reports are read here.

The report (`report/<snapshot>-<db>.md|json`) holds numbers only: accounts appear as
`owner`/`member N`, never as ids, emails or titles."""

from __future__ import annotations

import gzip
import json
import random
import re
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from musix.contexts.library.slug import song_key

HERE = Path(__file__).resolve().parent
REPORT = HERE / "report"
GATES = HERE.parent / "gates" / "report"
RECSYS = HERE.parent / "recsys-eval" / "report"
NS = uuid.UUID("5b1e7c0e-0000-4000-8000-000000000001")  # = migrate.NS (ids are the contract)
SAMPLE_KINDS = ("sample", "interpolation", "sampled_by", "interpolated_by")


@dataclass
class Count:
    entity: str
    v1: int
    v2: int
    collapses: dict[str, int] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.v1 - sum(self.collapses.values()) == self.v2


def _dk(name: str) -> str:
    """v1 `_name_dedup_key`: case and punctuation do not make a second name."""
    return re.sub(r"[\W_]+", "", name.casefold())


def _nul(s: str | None) -> str:
    return (s or "").replace("\x00", "")


class V1:
    """The snapshot, read by v1's rules."""

    def __init__(self, m: Any) -> None:
        self.m = m
        self.accts = m.accounts_v1()  # coll → account id
        self.migrated = {(r["collection_name"], r["track_id"]) for r in m.rows("select collection_name, track_id, file_path from track_metadata")
                         if r["collection_name"] in self.accts and r["file_path"] in m.by_path}
        self.sha = {r["track_id"]: m.by_path[r["file_path"]]["sha256"]
                    for r in m.rows("select collection_name, track_id, file_path from track_metadata")
                    if (r["collection_name"], r["track_id"]) in self.migrated}
        self.lyrics: dict[str, bool] = {}  # v1 track id → the Qdrant payload carried lyrics
        for f in (m.snap / "qdrant").glob("acct_*.jsonl.gz"):
            with gzip.open(f, "rt", encoding="utf-8") as fh:
                for line in fh:
                    r = json.loads(line)
                    self.lyrics[str(r["id"])] = bool(r["payload"].get("lyrics"))

    def events(self, coll: str | None = None) -> list[Any]:
        return [e for e in self.m.rows("select * from playback_events") if (e["collection_name"], e["track_id"]) in self.migrated
                and (coll is None or e["collection_name"] == coll)]


async def _scalar(m: Any, sql: str, **p: Any) -> Any:
    async with m.sm() as s:
        return await s.scalar(sa.text(sql), p)


async def _all(m: Any, sql: str, **p: Any) -> list[Any]:
    async with m.sm() as s:
        return list((await s.execute(sa.text(sql), p)).all())


# ── counts ──────────────────────────────────────────────────────────────────


async def counts(m: Any, v1: V1) -> list[Count]:
    out: list[Count] = []
    rows = m.rows
    out.append(Count("accounts", len(rows("select id from users")), await _scalar(m, "SELECT count(*) FROM accounts")))
    inv = rows("select created_by from invites")
    known = {u["id"] for u in rows("select id from users")}
    out.append(Count("invites", len(inv), await _scalar(m, "SELECT count(*) FROM invites"),
                     {"creator gone": sum(1 for r in inv if r["created_by"] not in known)}))
    tm = rows("select collection_name, track_id from track_metadata")
    out.append(Count("tracks", len(tm), await _scalar(m, "SELECT count(*) FROM tracks"),
                     {"orphan (no account or no file)": len(tm) - len(v1.migrated)}))
    shas = set(v1.sha.values())
    out.append(Count("media_files", len(shas), await _scalar(m, "SELECT count(*) FROM media_files")))
    from musix.infra import vectors
    from qdrant_client import models

    owners = [str(a) for a in v1.accts.values()]
    points = (await m.q.count(vectors.TRACKS, count_filter=models.Filter(
        must=[models.FieldCondition(key="owners", match=models.MatchAny(any=owners))]), exact=True)).count \
        if await m.q.collection_exists(vectors.TRACKS) else 0
    with_point = {v1.sha[t] for t, has in v1.lyrics.items() if t in v1.sha}
    out.append(Count("vector points", len(shas), points, {"no v1 point": len(shas - with_point)}))
    ev = rows("select collection_name, track_id from playback_events")
    kept = sum(1 for e in ev if (e["collection_name"], e["track_id"]) in v1.migrated)
    out.append(Count("listens", len(ev), await _scalar(m, "SELECT count(*) FROM listen_events"),
                     {"orphan (account or track gone)": len(ev) - kept}))
    sg = rows("select collection_name, track_id from taste_signals")
    out.append(Count("taste signals", len(sg), await _scalar(m, "SELECT count(*) FROM taste_signals"),
                     {"orphan": sum(1 for g in sg if (g["collection_name"], g["track_id"]) not in v1.migrated)}))
    pl = rows("select collection_name from playlists")
    out.append(Count("playlists", len(pl), await _scalar(m, "SELECT count(*) FROM playlists"),
                     {"no account": sum(1 for p in pl if p["collection_name"] not in v1.accts)}))
    pi = rows("select p.collection_name, t.track_id from playlist_tracks t join playlists p on p.id = t.playlist_id")
    out.append(Count("playlist items", len(pi), await _scalar(m, "SELECT count(*) FROM playlist_items"),
                     {"orphan": sum(1 for r in pi if (r["collection_name"], r["track_id"]) not in v1.migrated)}))
    # knowledge: a shared pool keyed by slug in both versions
    subjects = {("song", s) for (s,) in await _all(m, "SELECT slug FROM songs")} | \
               {("artist", s) for (s,) in await _all(m, "SELECT slug FROM artists")}
    total, orphan, empty, keys = 0, 0, 0, set()
    for table, kind, col in (("song_facts", "song", "song_slug"), ("artist_facts", "artist", "artist_slug")):
        for r in rows(f"select {col} as slug, lang, fact from {table}"):
            total += 1
            if (kind, r["slug"]) not in subjects:
                orphan += 1
            elif not r["fact"]:
                empty += 1
            else:
                keys.add((kind, r["slug"], r["lang"], _nul(r["fact"])))
    out.append(Count("facts", total, await _scalar(m, "SELECT count(*) FROM facts"),
                     {"subject gone": orphan, "empty": empty, "duplicate text": total - orphan - empty - len(keys)}))
    rs = rows("select scope, scope_key from refined_facts")
    out.append(Count("refined fact sets", len(rs), await _scalar(m, "SELECT count(*) FROM fact_refinement_sets"),
                     {"subject gone": sum(1 for r in rs if (r["scope"], r["scope_key"]) not in subjects)}))
    bios = rows("select artist_slug, lang, bio_text from artist_bios")
    once = {(b["artist_slug"], b["lang"]) for b in bios}
    good = {(b["artist_slug"], b["lang"]) for b in bios if ("artist", b["artist_slug"]) in subjects and b["bio_text"]}
    out.append(Count("artist bios", len(bios), await _scalar(m, "SELECT count(*) FROM artist_bios"),
                     {"per-account copies (v2 keeps one)": len(bios) - len(once), "artist gone or empty": len(once) - len(good)}))
    song_of = {(c, v): s for c, v, s in await _all(
        m, "SELECT m.v1_collection, m.v1_track_id, t.song_id FROM migr_track_map m JOIN tracks t ON t.id = m.track_id")}
    vb = rows("select collection_name, track_id, lang, phrase from sonic_vibes")
    mapped = [(song_of.get((r["collection_name"], r["track_id"])), r["lang"]) for r in vb if r["phrase"]]
    live = [k for k in mapped if k[0] is not None]
    out.append(Count("song vibes", len(vb), await _scalar(m, "SELECT count(*) FROM song_vibes"),
                     {"orphan or empty": len(vb) - len(live), "same song twice (newest kept)": len(live) - len(set(live))}))
    qr = rows("select collection_name, answered_at from quiz_rounds")
    out.append(Count("quiz rounds", len(qr), await _scalar(m, "SELECT count(*) FROM quiz_rounds"),
                     {"unanswered (not carried)": sum(1 for r in qr if r["answered_at"] is None),
                      "no account": sum(1 for r in qr if r["answered_at"] is not None and r["collection_name"] not in v1.accts)}))
    yi = rows("select account_id, yandex_track_id from yandex_imports")
    kept_yi = [(r["account_id"], r["yandex_track_id"]) for r in yi if r["account_id"] in known]
    out.append(Count("yandex imports", len(yi), await _scalar(m, "SELECT count(*) FROM yandex_imports"),
                     {"no account": len(yi) - len(kept_yi), "same track twice": len(kept_yi) - len(set(kept_yi))}))
    for table in ("track_gems", "track_reactions", "recsys_llm_texts"):  # program §4.3 / plan Task 2
        n = len(rows(f"select 1 from {table}"))
        out.append(Count(table, n, 0, {"removed feature" if table != "recsys_llm_texts" else "recomputed by stream:ai_texts": n}))
    return out


# ── checksums per account ───────────────────────────────────────────────────


def _end(played: float, dur: float, early: bool) -> str:
    return "completed" if dur and played >= 0.9 * dur else ("skipped" if early else "stopped")  # spec §3


async def checksums(m: Any, v1: V1) -> dict[str, dict[str, Any]]:
    """coll → {check: [v1, v2] | 'ok'}; a value that is not 'ok' is a failure."""
    out: dict[str, dict[str, Any]] = {}
    vis: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for r in m.rows("select kind, slug, collection_name from fact_visibility"):
        vis[r["collection_name"]].add((r["kind"], r["slug"]))
    v1_facts: Counter[tuple[str, str]] = Counter()
    for table, kind, col in (("song_facts", "song", "song_slug"), ("artist_facts", "artist", "artist_slug")):
        seen: set[tuple[str, str, str]] = set()
        for r in m.rows(f"select {col} as slug, lang, fact from {table}"):
            k = (r["slug"], r["lang"], _nul(r["fact"]))
            if r["fact"] and k not in seen:
                seen.add(k)
                v1_facts[(kind, r["slug"])] += 1
    v2_facts = {(k, slug): n for k, slug, n in await _all(m, """
        SELECT f.subject_kind, coalesce(s.slug, a.slug), count(*) FROM facts f
        LEFT JOIN songs s ON f.subject_kind = 'song' AND s.id = f.subject_id
        LEFT JOIN artists a ON f.subject_kind = 'artist' AND a.id = f.subject_id GROUP BY 1, 2""")}
    for coll, acct in v1.accts.items():
        c: dict[str, Any] = {}
        want = {t for (cl, t) in v1.migrated if cl == coll}
        got = {str(t) for (t,) in await _all(m, "SELECT id FROM tracks WHERE account_id = :a", a=acct)}
        c["track ids"] = "ok" if want == got else [len(want), len(got)]
        evs = v1.events(coll)
        exp = [len(evs), sum(round((e["played_sec"] or 0) * 1000) for e in evs),
               sum(1 for e in evs if not e["skipped_early"]),
               sum(1 for e in evs if _end(e["played_sec"] or 0, e["total_dur"] or 0, bool(e["skipped_early"])) == "completed"),
               sum(1 for e in evs if _end(e["played_sec"] or 0, e["total_dur"] or 0, bool(e["skipped_early"])) == "skipped")]
        st = (await _all(m, """SELECT coalesce(sum(listens), 0), coalesce(sum(total_played_ms), 0), coalesce(sum(plays), 0),
                                      coalesce(sum(completes), 0), coalesce(sum(skips), 0)
                               FROM account_track_stats WHERE account_id = :a""", a=acct))[0]
        c["stats (listens, played ms, plays, completes, skips)"] = "ok" if exp == [int(x) for x in st] else [exp, [int(x) for x in st]]
        sig1 = Counter((g["track_id"], g["kind"]) for g in m.rows("select * from taste_signals where collection_name = ?", coll)
                       if (coll, g["track_id"]) in v1.migrated)
        sig2 = Counter((str(t), k) for t, k in await _all(m, "SELECT track_id, kind FROM taste_signals WHERE account_id = :a", a=acct))
        c["fire/water per track"] = "ok" if sig1 == sig2 else [sum(sig1.values()), sum(sig2.values())]
        seq1 = {str(uuid.uuid5(NS, f"playlist:{p['id']}")): [t["track_id"] for t in m.rows(
            "select track_id from playlist_tracks where playlist_id = ? order by position", p["id"]) if (coll, t["track_id"]) in v1.migrated]
            for p in m.rows("select id from playlists where collection_name = ?", coll)}
        seq2: dict[str, list[str]] = defaultdict(list)
        for pid, t in await _all(m, """SELECT p.id::text, i.track_id::text FROM playlists p LEFT JOIN playlist_items i ON i.playlist_id = p.id
                                       WHERE p.account_id = :a ORDER BY p.id, i.position""", a=acct):
            seq2[pid] += [t] if t else []
        bad = [p for p in set(seq1) | set(seq2) if seq1.get(p) != seq2.get(p)]
        c["playlist sequences"] = "ok" if not bad else [len(seq1), len(bad)]
        seen2 = {(k, s) for k, s in await _all(m, """
            SELECT 'song', s.slug FROM tracks t JOIN songs s ON s.id = t.song_id WHERE t.account_id = :a AND t.deleted_at IS NULL
            UNION SELECT 'artist', ar.slug FROM tracks t JOIN track_artists ta ON ta.track_id = t.id JOIN artists ar ON ar.id = ta.artist_id
            WHERE t.account_id = :a AND t.deleted_at IS NULL""", a=acct)}
        both = vis[coll] & seen2
        diff = [k for k in both if v1_facts.get(k, 0) != v2_facts.get(k, 0)]
        c["facts per visible subject"] = "ok" if not diff else [len(both), len(diff)]
        # v1 never pruned fact_visibility when a track left the library: a subject only v1
        # «sees» is stale unless the account's v1 library still holds it
        lib1 = {("song", song_key(r["artist"] or "", r["title"] or "")) for r in m.rows(
            "select artist, title from track_metadata where collection_name = ?", coll)}
        lib1 |= {("artist", r["artist_slug"]) for r in m.rows(
            "select s.artist_slug from track_artist_slugs s join track_metadata t on t.track_id = s.track_id where t.collection_name = ?", coll)}
        lost = [k for k in vis[coll] - seen2 if k in lib1 and v1_facts.get(k)]
        c["facts of library subjects only v1 shows"] = "ok" if not lost else [len(lost), sum(v1_facts[k] for k in lost)]
        c["_facts visibility (v1, both, stale: track gone, no facts)"] = [
            len(vis[coll]), len(both), len([k for k in vis[coll] - seen2 if k not in lib1]),
            len([k for k in vis[coll] - seen2 if k in lib1 and not v1_facts.get(k)])]
        bio1 = {(r["artist_slug"], r["lang"]) for r in m.rows("select artist_slug, lang from artist_bios where collection_name = ? and bio_text <> ''", coll)}
        bio2 = {(s, lg) for s, lg in await _all(m, "SELECT a.slug, b.lang FROM artist_bios b JOIN artists a ON a.id = b.artist_id")}
        c["bio presence"] = "ok" if bio1 <= bio2 else [len(bio1), len(bio1 - bio2)]
        out[coll] = c
    return out


# ── spot checks ─────────────────────────────────────────────────────────────


HIDDEN_LABELS = {"other", "about_artist", "about_song"}  # v1 MetadataDB.HIDDEN_LABELS


def _v1_shows_facts(m: Any, kind: str, slug: str | None, coll: str, lang: str) -> bool:
    """v1 `GET /tracks/{id}/facts`: the refined items of the subject (an empty, all-hidden
    set is a real «nothing»), else the legacy refined blob, else the raw English facts
    when `fact_visibility` lets the account see the subject."""
    if slug is None:
        return False
    items = m.rows("select text, labels_json from refined_fact_items where scope = ? and scope_key = ? and lang = ?", kind, slug, lang)
    if items:
        return any(r["text"] and not set(json.loads(r["labels_json"] or "[]")) & HIDDEN_LABELS for r in items)
    blob = m.rows("select refined_json from refined_facts where scope = ? and scope_key = ? and lang = ?", kind, slug, lang)
    if blob:
        try:
            return any(isinstance(x, dict) and x.get("text") for x in json.loads(blob[0]["refined_json"] or "[]"))
        except ValueError:
            return False
    if not m.rows("select 1 from fact_visibility where kind = ? and slug = ? and collection_name = ?", kind, slug, coll):
        return False
    table, col = ("song_facts", "song_slug") if kind == "song" else ("artist_facts", "artist_slug")
    return bool(m.rows(f"select 1 from {table} where {col} = ? and lang = 'en' and fact <> '' limit 1", slug))


async def spots(m: Any, v1: V1, per_account: int = 5, lang: str = "ru") -> dict[str, Any]:
    from musix.contexts.knowledge.service import track_knowledge

    fails: list[str] = []
    n = Counter[str]()
    slug_of = {(c, v): s for c, v, s in await _all(m, """SELECT m.v1_collection, m.v1_track_id, s.slug FROM migr_track_map m
                                                          JOIN tracks t ON t.id = m.track_id JOIN songs s ON s.id = t.song_id""")}
    phrases: dict[str, set[str]] = defaultdict(set)  # song slug → every v1 vibe line of its tracks
    for x in m.rows("select collection_name, track_id, phrase from sonic_vibes where lang = ?", lang):
        if (song := slug_of.get((x["collection_name"], x["track_id"]))) is not None:
            phrases[song].add(x["phrase"])
    for coll, acct in v1.accts.items():
        ids = sorted(t for (cl, t) in v1.migrated if cl == coll)
        rng = random.Random(f"{m.snap.name}:{coll}")  # the same tracks on every run of a snapshot
        for k, tid in enumerate(rng.sample(ids, min(per_account, len(ids)))):
            where = f"{coll[-4:]}#{k}"  # an id suffix is not a secret; the report maps it to a role
            r = m.rows("select * from track_metadata where collection_name = ? and track_id = ?", coll, tid)[0]
            async with m.sm() as s:
                t = (await s.execute(sa.text("""
                    SELECT t.title, t.artist_display, t.duration_ms, s.slug AS song, a.slug AS artist,
                           (SELECT l.text FROM lyrics l WHERE l.media_file_id = t.media_file_id) AS lyrics
                    FROM tracks t LEFT JOIN songs s ON s.id = t.song_id LEFT JOIN artists a ON a.id = t.primary_artist_id
                    WHERE t.id = :t AND t.account_id = :a"""), {"t": uuid.UUID(tid), "a": acct})).one()
                kn = await track_knowledge(s, acct, uuid.UUID(tid), lang)
            n["tracks"] += 1
            if t.title != (r["title"] or Path(r["file_path"]).stem) or t.artist_display != (r["artist"] or "Unknown Artist"):
                fails.append(f"{where} metadata")
            if r["duration"] and abs((t.duration_ms or 0) - r["duration"] * 1000) > 1000:
                fails.append(f"{where} duration")
            if v1.lyrics.get(tid) and not t.lyrics:
                fails.append(f"{where} lyrics")
            n["lyrics"] += bool(t.lyrics)
            assert kn is not None
            for kind, slug, got in (("song", t.song, kn.song_facts), ("artist", t.artist, kn.artist_facts)):
                shown = _v1_shows_facts(m, kind, slug, coll, lang)
                if shown and not got:
                    fails.append(f"{where} {kind} facts")
                n[f"{kind} facts: v1 shows"] += shown
                n[f"{kind} facts: v2 shows"] += bool(got)
            song = m.rows("select producers, producers_genius, samples_json from songs where slug = ?", t.song) if t.song else []
            prod1 = {_dk(p) for s_ in song for col in ("producers", "producers_genius")
                     for p in (json.loads(s_[col] or "[]") or []) if isinstance(p, str) and p.strip()}
            if not prod1 <= {_dk(p.text) for p in kn.producers}:
                fails.append(f"{where} producers")
            smp1 = {_dk(f"{e['artist']} — {e['song']}") for s_ in song for fld in ("samples", "sampled_by")
                    for e in (json.loads(s_["samples_json"] or "{}") or {}).get(fld) or [] if isinstance(e, dict) and e.get("song") and e.get("artist")}
            smp1 |= {_dk(f"{x['dst_artist']} — {x['dst_title']}") for x in m.rows(
                "select dst_artist, dst_title from sample_links where collection_name = ? and src_slug = ?", coll, t.song or "")
                if x["dst_artist"] and x["dst_title"]}
            if not smp1 <= {_dk(p.text) for p in kn.samples + kn.sampled_by}:
                fails.append(f"{where} samples")
            n["with producers"] += bool(prod1)
            n["with samples"] += bool(smp1)
            vibe1 = m.rows("select phrase from sonic_vibes where collection_name = ? and track_id = ? and lang = ?", coll, tid, lang)
            # v2 keeps one line per song: the newest v1 copy among the song's tracks
            if vibe1 and kn.vibe != vibe1[0]["phrase"] and kn.vibe not in phrases.get(t.song or "", set()):
                fails.append(f"{where} vibe")
            n["with vibe"] += bool(kn.vibe)
    return {"counts": dict(n), "failures": fails}


# ── gates ───────────────────────────────────────────────────────────────────


def gates(snap: str, db: str) -> dict[str, Any]:
    """Search 4.1–4.3 on the migrated DB against the accepted v2 run on phase 2's snapshot
    load (which the phase 1–2 gates held against v1), tolerance max(0.01, run spread);
    «Поток» 4.4: every gate of the v2 engine's report PASS."""
    out: dict[str, Any] = {"failures": []}
    base, mig = GATES / f"{snap}-v2.json", GATES / f"{snap}-v2-{db}.json"
    if not mig.exists() or not base.exists():
        out["search"] = "not run"
        out["failures"].append("search gates not run on this DB")
    else:
        b, g = json.loads(base.read_text()), json.loads(mig.read_text())
        rows = []
        for suite, metrics_ in (("lyrics", ("recall@1", "recall@10", "mrr")), ("catalog", ("recall@1", "recall@5"))):
            for kind, vals in b[suite].items():
                for mt in metrics_:
                    tol = max(0.01, vals.get("spread", {}).get(mt, 0))
                    got = g[suite].get(kind, {}).get(mt, -1)
                    rows.append([f"{suite}/{kind}/{mt}", round(vals[mt], 3), round(got, 3)])
                    if got < vals[mt] - tol:
                        out["failures"].append(f"search {suite}/{kind} {mt} {got:.3f} < {vals[mt]:.3f}")
        sb, sg = b["sound"]["precision@10"], g["sound"]["precision@10"]
        rows.append(["sound/precision@10", round(sb, 3), round(sg, 3)])
        if sg < sb - 0.01:
            out["failures"].append(f"search sound precision@10 {sg:.3f} < {sb:.3f}")
        out["search"] = rows
    rec = RECSYS / f"{snap}-v2-{db}.json"
    if not rec.exists():
        out["stream"] = "not run"
        out["failures"].append("«Поток» gates not run on this DB")
    else:
        gs = json.loads(rec.read_text())["gates"]
        out["stream"] = gs
        out["failures"] += [f"«Поток» {k}" for k, ok in gs.items() if not ok]
    return out


# ── the stage ───────────────────────────────────────────────────────────────


async def run_verify(m: Any, *, per_account: int = 5, with_gates: bool = True, write: bool = True) -> dict[str, Any]:
    v1 = V1(m)
    cs = await counts(m, v1)
    sums = await checksums(m, v1)
    sp = await spots(m, v1, per_account)
    db = m.url.rsplit("/", 1)[1]
    gt = gates(m.snap.name, db) if with_gates else {"failures": []}
    failures = [f"count {c.entity}: v1 {c.v1} − {sum(c.collapses.values())} ≠ v2 {c.v2}" for c in cs if not c.ok]
    roles = _roles(m, v1)
    failures += [f"checksum {roles[coll]} {k}: {v}" for coll, c in sums.items() for k, v in c.items()
                 if not k.startswith("_") and v != "ok"]
    failures += [f"spot {_role_of(roles, f)}" for f in sp["failures"]]
    failures += gt["failures"]
    res = {"ok": not failures, "failures": failures,
           "counts": [{"entity": c.entity, "v1": c.v1, "v2": c.v2, "collapses": {k: v for k, v in c.collapses.items() if v}, "ok": c.ok} for c in cs],
           "checksums": {roles[coll]: c for coll, c in sums.items()}, "spots": {**sp, "failures": [_role_of(roles, f) for f in sp["failures"]]},
           "gates": {k: v for k, v in gt.items() if k != "failures"},
           "run seconds": {st: sec for st, sec in await _all(
               m, "SELECT DISTINCT ON (stage) stage, round(seconds) FROM migr_runs ORDER BY stage, started_at DESC")}}
    if write:
        _write(m.snap.name, db, res)
    return {"ok": res["ok"], "failures": len(failures), "first": failures[:5]}


def _roles(m: Any, v1: V1) -> dict[str, str]:
    out, k = {}, 0
    for u in m.rows("select id, role from users order by created_at"):
        coll = f"acct_{u['id'].replace('-', '')}"
        if u["role"] == "owner":
            out[coll] = "owner"
        else:
            k += 1
            out[coll] = f"member {k}"
    return out


def _role_of(roles: dict[str, str], line: str) -> str:
    suffix, _, rest = line.partition("#")
    for coll, role in roles.items():
        if coll.endswith(suffix):
            return f"{role} #{rest}"
    return line


def _write(snap: str, db: str, res: dict[str, Any]) -> None:
    REPORT.mkdir(exist_ok=True)
    base = REPORT / f"{snap}-{db}"
    base.with_suffix(".json").write_text(json.dumps(res, indent=1, ensure_ascii=False, default=str))
    md = [f"# Migration gate — snapshot {snap} → {db}", "", f"**{'PASS' if res['ok'] else 'FAIL'}** — {len(res['failures'])} failures", ""]
    md += [f"- {f}" for f in res["failures"]]
    md += ["", "## Counts", "", "| entity | v1 | named collapses | v2 | ok |", "|---|---|---|---|---|"]
    md += [f"| {c['entity']} | {c['v1']} | {', '.join(f'{k} {v}' for k, v in c['collapses'].items()) or '—'} | {c['v2']} | "
           f"{'✓' if c['ok'] else '✗'} |" for c in res["counts"]]
    md += ["", "## Checksums per account", ""]
    for role, c in res["checksums"].items():
        md += [f"- **{role}**: " + "; ".join(f"{k.lstrip('_')} {'✓' if v == 'ok' else v}" for k, v in c.items())]
    secs = res["run seconds"]
    md += ["", "## Run", "", " · ".join(f"{k} {int(v)} s" for k, v in secs.items()) + f" — total {int(sum(secs.values()))} s"]
    md += ["", "## Spot checks", "", "```", json.dumps(res["spots"], indent=1, ensure_ascii=False), "```",
           "", "## Gates on the migrated DB", "", "```", json.dumps(res["gates"], indent=1, ensure_ascii=False), "```"]
    base.with_suffix(".md").write_text("\n".join(md) + "\n")
