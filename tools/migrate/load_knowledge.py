"""Load v1's knowledge base into a dev v2 database that `load_snapshot.py` filled
(it needs `migr_track_map`): facts, facts_v2 refinements, bios, song relations, vibe
lines, aliases, the negative fetch cache and the MusicBrainz verdicts.

Knowledge is global in both versions, keyed by song / artist slug. Songs are first
re-keyed with v1's song key (`slug.song_key`), then every v1 song and artist is upserted
by slug — orphans too: a fact about a song nobody owns today is a cache hit tomorrow.

Legacy `refined_facts` blobs (pre-facts_v2, ~530 subjects without items) are not
loaded: those subjects fall back to their raw facts until the facts_v2 job refines them.

Usage (from v2/server):
    uv run python ../tools/migrate/load_knowledge.py /mnt/data/musix-snapshots/2026-09-29 [--db musix_snap]
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import re
import sqlite3
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import asyncpg

from musix.contexts.library import artist_split
from musix.contexts.library.slug import slugify, song_key


def v1_time(s: Any) -> dt.datetime:
    if s is None:
        return dt.datetime.now(dt.UTC)
    if isinstance(s, int | float):
        return dt.datetime.fromtimestamp(s, dt.UTC)
    t = dt.datetime.fromisoformat(str(s))
    return t if t.tzinfo else t.replace(tzinfo=dt.UTC)


def dedup_key(name: str) -> str:
    """v1 `_name_dedup_key`: case and punctuation do not make a second producer."""
    return re.sub(r"[\W_]+", "", name.casefold())


async def rekey_songs(pg: asyncpg.Connection) -> int:
    """tracks.song_id ← songs keyed by v1's song key; orphaned songs removed."""
    rows = await pg.fetch("SELECT id, artist_display, title, primary_artist_id FROM tracks")
    by_key: dict[str, list[Any]] = defaultdict(list)
    for r in rows:
        by_key[song_key(r["artist_display"] or "", r["title"])].append(r)
    await pg.execute("CREATE TEMP TABLE rk (track_id uuid, slug text, title text, artist uuid)")
    await pg.copy_records_to_table(
        "rk",
        records=[(r["id"], k, rs[0]["title"], rs[0]["primary_artist_id"]) for k, rs in by_key.items() for r in rs],
    )
    await pg.execute("""
        INSERT INTO songs (slug, title, primary_artist_id)
        SELECT DISTINCT ON (slug) slug, title, artist FROM rk ORDER BY slug
        ON CONFLICT (slug) DO NOTHING;
        UPDATE tracks t SET song_id = s.id FROM rk JOIN songs s ON s.slug = rk.slug
        WHERE t.id = rk.track_id AND t.song_id IS DISTINCT FROM s.id;
        DELETE FROM songs s WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.song_id = s.id);
        DROP TABLE rk;
    """)
    return len(by_key)


class Loader:
    def __init__(self, snap: Path, pg: asyncpg.Connection) -> None:
        self.sq = sqlite3.connect(f"file:{snap / 'metadata.db'}?mode=ro", uri=True)
        self.sq.row_factory = sqlite3.Row
        self.pg = pg
        self.song: dict[str, Any] = {}
        self.artist: dict[str, Any] = {}
        self.counts: dict[str, int] = {}

    def rows(self, sql: str) -> list[sqlite3.Row]:
        return list(self.sq.execute(sql))

    async def catalog(self) -> None:
        for r in self.rows("SELECT slug, name, mbid FROM artists"):
            await self.pg.execute(
                "INSERT INTO artists (slug, name, mbid) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING",
                r["slug"], r["name"], r["mbid"],
            )
        self.artist = {r["slug"]: r["id"] for r in await self.pg.fetch("SELECT slug, id FROM artists")}
        for r in self.rows("SELECT slug, title, artist_slug, recording_mbid FROM songs"):
            await self.pg.execute(
                "INSERT INTO songs (slug, title, primary_artist_id, mbid) VALUES ($1, $2, $3, $4) "
                "ON CONFLICT (slug) DO NOTHING",
                r["slug"], r["title"], self.artist.get(r["artist_slug"]), r["recording_mbid"],
            )
        self.song = {r["slug"]: r["id"] for r in await self.pg.fetch("SELECT slug, id FROM songs")}

    async def facts(self) -> dict[tuple[str, int], int]:
        """→ (v1 table, v1 row id) → v2 fact id, for the refinements."""
        ids: dict[tuple[str, int], int] = {}
        for table, kind, key, subjects in (
            ("song_facts", "song", "song_slug", self.song),
            ("artist_facts", "artist", "artist_slug", self.artist),
        ):
            recs = [
                (r["id"], kind, subjects[r[key]], r["lang"], r["fact"].replace("\x00", ""), r["category"], r["source"],
                 v1_time(r["created_at"]))
                for r in self.rows(f"SELECT * FROM {table} ORDER BY id")  # noqa: S608
                if r[key] in subjects and r["fact"]
            ]
            await self.pg.execute("CREATE TEMP TABLE ff (v1 bigint, k text, sid uuid, lang text, text text, cat text, src text, at timestamptz)")
            await self.pg.copy_records_to_table("ff", records=recs)
            await self.pg.execute("""
                INSERT INTO facts (subject_kind, subject_id, lang, text, category, source, created_at)
                SELECT k, sid, lang, text, cat, src, at FROM ff ORDER BY v1
                ON CONFLICT (subject_kind, subject_id, lang, md5(text)) DO NOTHING
            """)
            got = await self.pg.fetch("""
                SELECT ff.v1, f.id FROM ff JOIN facts f
                  ON f.subject_kind = ff.k AND f.subject_id = ff.sid AND f.lang = ff.lang AND md5(f.text) = md5(ff.text)
            """)
            await self.pg.execute("DROP TABLE ff")
            ids.update({(table, r["v1"]): r["id"] for r in got})
            self.counts[table] = len(recs)
        return ids

    async def refinements(self, ids: dict[tuple[str, int], int]) -> None:
        recs = []
        for r in self.rows("SELECT * FROM refined_fact_items"):
            fid = ids.get((r["origin_kind"], r["origin_id"]))
            if fid is not None:
                text = r["text"].replace("\x00", "") if r["text"] else r["text"]
                recs.append((fid, r["lang"], r["labels_json"] or "[]", text, bool(r["confirmed"]), r["src"], v1_time(r["generated_at"])))
        await self.pg.executemany(
            "INSERT INTO fact_refinements (fact_id, lang, labels, text, confirmed, src, generated_at) "
            "VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7) ON CONFLICT DO NOTHING",
            recs,
        )
        self.counts["fact_refinements"] = len(recs)

    async def bios(self) -> None:
        latest: dict[tuple[str, str], sqlite3.Row] = {}
        for r in self.rows("SELECT * FROM artist_bios ORDER BY generated_at"):
            latest[(r["artist_slug"], r["lang"])] = r  # bios were per account in v1: the newest wins
        recs = []
        for (slug, lang), r in latest.items():
            if slug not in self.artist or not r["bio_text"]:
                continue
            facets = {k: r[k] for k in ("grammy_wins", "grammy_nominations", "formed_year", "formed_place",
                                        "name_origin", "active_from", "active_to", "status") if r[k] is not None}
            sources = {k: r[k] for k in ("source_url", "source_kind", "grammy_source", "formed_source",
                                         "name_origin_source", "status_source") if r[k] is not None}
            recs.append((self.artist[slug], lang, r["bio_text"], json.dumps(facets), json.dumps(sources), v1_time(r["generated_at"])))
        await self.pg.executemany(
            "INSERT INTO artist_bios (artist_id, lang, text, facets, sources, generated_at) "
            "VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6) ON CONFLICT DO NOTHING",
            recs,
        )
        self.counts["artist_bios"] = len(recs)

    async def relations(self) -> None:
        verdicts = {(r["artist_key"], r["title_key"]): bool(r["verified"]) for r in self.rows("SELECT * FROM sample_link_verdicts")}
        recs: list[tuple[Any, ...]] = []
        seen: set[tuple[Any, str, str]] = set()

        def add(song: Any, kind: str, text: str, source: str, *, target_song: Any = None,
                target_artist: Any = None, evidence: str | None = None, confidence: float | None = None,
                verified: bool | None = None) -> None:
            k = (song, kind, dedup_key(text))
            if not text.strip() or k in seen:
                return
            seen.add(k)
            recs.append((song, kind, text.strip(), target_song, target_artist, evidence, confidence, verified, source))

        def artist_of(name: str) -> Any:
            return self.artist.get(artist_split.canonical_slug(name) or slugify(name))

        for r in self.rows("SELECT slug, producers, producers_genius, label, samples_json FROM songs"):
            sid = self.song.get(r["slug"])
            if sid is None:
                continue
            for col, source in (("producers_genius", "genius"), ("producers", "extract")):  # Genius first: it wins spelling
                for name in json.loads(r[col] or "[]") or []:
                    if isinstance(name, str):
                        add(sid, "producer", name, source, target_artist=artist_of(name))
            if r["label"]:
                add(sid, "label", r["label"], "genius")
            rel = json.loads(r["samples_json"] or "{}") or {}
            for field, kind in (("samples", "sample"), ("sampled_by", "sampled_by")):
                for e in rel.get(field) or []:
                    if isinstance(e, dict) and e.get("song") and e.get("artist"):
                        add(sid, kind, f"{e['artist']} — {e['song']}", "extract",
                            target_song=self.song.get(song_key(e["artist"], e["song"])), target_artist=artist_of(e["artist"]))
        for r in self.rows("SELECT * FROM sample_links ORDER BY created_at"):
            sid = self.song.get(r["src_slug"])
            if sid is None or not (r["dst_artist"] and r["dst_title"]):
                continue
            usage = r["direction"] == "usage"
            kind = {("sample", False): "sample", ("interpolation", False): "interpolation",
                    ("sample", True): "sampled_by", ("interpolation", True): "interpolated_by"}[(r["relation"], usage)]
            a_key, _, t_key = r["dst_key"].partition("|")
            add(sid, kind, f"{r['dst_artist']} — {r['dst_title']}", "facts",
                target_song=self.song.get(r["dst_slug"]) if r["dst_slug"] else self.song.get(song_key(r["dst_artist"], r["dst_title"])),
                target_artist=artist_of(r["dst_artist"]), evidence=r["evidence"], confidence=r["confidence"],
                verified=verdicts.get((a_key, t_key)))
        await self.pg.executemany(
            "INSERT INTO song_relations (song_id, kind, target_text, target_song_id, target_artist_id, evidence, "
            "confidence, verified, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING",
            recs,
        )
        self.counts["song_relations"] = len(recs)
        await self.pg.executemany(
            "INSERT INTO verification_cache (artist_key, title_key, verified, score, mb_artist, mb_title, mbid, checked_at) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING",
            [(r["artist_key"], r["title_key"], bool(r["verified"]), r["score"], r["mb_artist"], r["mb_title"], r["mbid"],
              v1_time(r["checked_at"])) for r in self.rows("SELECT * FROM sample_link_verdicts")],
        )

    async def vibes_aliases_misses(self) -> None:
        tmap = {(r["coll"], r["v1"]): r["song_id"] for r in await self.pg.fetch(
            "SELECT m.v1_collection AS coll, m.v1_track_id AS v1, t.song_id FROM migr_track_map m "
            "JOIN tracks t ON t.id = m.track_id WHERE t.song_id IS NOT NULL")}
        latest: dict[tuple[Any, str], tuple[str, dt.datetime]] = {}
        for r in self.rows("SELECT * FROM sonic_vibes ORDER BY generated_at"):
            sid = tmap.get((r["collection_name"], r["track_id"]))
            if sid is not None and r["phrase"]:
                latest[(sid, r["lang"])] = (r["phrase"], v1_time(r["generated_at"]))
        await self.pg.executemany(
            "INSERT INTO song_vibes (song_id, lang, phrase, generated_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
            [(sid, lang, p, at) for (sid, lang), (p, at) in latest.items()],
        )
        self.counts["song_vibes"] = len(latest)
        await self.pg.executemany(
            "INSERT INTO artist_aliases (artist_id, alias, source) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            [(self.artist[r["artist_slug"]], r["alias"], r["source"]) for r in self.rows("SELECT * FROM artist_aliases")
             if r["artist_slug"] in self.artist and r["alias"]],
        )
        await self.pg.executemany(
            "INSERT INTO source_fetch_log (source, key, status, fetched_at) VALUES ($1, $2, 'miss', $3) ON CONFLICT DO NOTHING",
            [(f"facts:{r['kind']}", r["slug"], v1_time(r["fetched_at"])) for r in self.rows("SELECT * FROM fact_fetch_misses")],
        )

    async def artist_media(self, media_dir: Path) -> None:
        """AudioDB profiles onto `artists.profile`; the v1 image files copied under the
        media dir with a manifest for `jobs.import_artist_images` (the host has no
        libvips — the import runs in the worker container)."""
        import shutil

        v1_front = Path("/mnt/data/lyrics-search/frontend")
        out_dir = media_dir / "import" / "v1-artists"
        out_dir.mkdir(parents=True, exist_ok=True)
        manifest: dict[str, dict[str, str]] = {}
        n = 0
        for r in self.rows("SELECT * FROM artists WHERE audiodb_fetched_at IS NOT NULL OR thumb_path IS NOT NULL"):
            aid = self.artist.get(r["slug"])
            if aid is None:
                continue
            profile = {k: v for k, v in {
                "bio": r["audiodb_bio"], "mood": r["mood"], "country": r["country"],
                "countryCode": r["country_code"], "label": r["label"], "mbid": r["audiodb_mbid"],
                "fetchedAt": str(v1_time(r["audiodb_fetched_at"]).isoformat()) if r["audiodb_fetched_at"] else None,
            }.items() if v}
            await self.pg.execute("UPDATE artists SET profile = $2::jsonb WHERE id = $1", aid, json.dumps(profile))
            entry: dict[str, str] = {}
            for key, col in (("thumb", "thumb_path"), ("cutout", "cutout_path")):
                if r[col]:
                    src_file = v1_front / r[col].lstrip("/")
                    if src_file.is_file():
                        dst = out_dir / src_file.name
                        if not dst.exists():
                            shutil.copyfile(src_file, dst)
                        entry[key] = str(dst)
            if entry:
                manifest[str(aid)] = entry
            n += 1
        (out_dir / "manifest.json").write_text(json.dumps(manifest))
        self.counts["artist_profiles"] = n
        self.counts["artist_images"] = sum(len(v) for v in manifest.values())

    async def run(self) -> None:
        t = time.time()
        async with self.pg.transaction():
            await self.pg.execute(
                "TRUNCATE facts, fact_refinements, artist_bios, song_relations, song_vibes, artist_aliases, "
                "source_fetch_log, verification_cache"
            )
            self.counts["song_keys"] = await rekey_songs(self.pg)
            await self.catalog()
            await self.refinements(await self.facts())
            await self.bios()
            await self.relations()
            await self.vibes_aliases_misses()
            await self.artist_media(Path("/mnt/data/musix-v2-media"))
            await self.pg.execute("UPDATE songs SET knowledge_at = now(); UPDATE artists SET knowledge_at = now()")
        print(json.dumps({**self.counts, "seconds": round(time.time() - t, 1)}))


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("snapshot", type=Path)
    ap.add_argument("--db", default="musix_snap")
    ap.add_argument("--dsn", default="postgresql://musix:musix@127.0.0.1:18432/")
    a = ap.parse_args()
    pg = await asyncpg.connect(a.dsn + a.db)
    try:
        await Loader(a.snapshot, pg).run()
    finally:
        await pg.close()


if __name__ == "__main__":
    asyncio.run(main())
