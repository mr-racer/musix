"""The knowledge runners: one song or one artist per job (v1 walked a whole collection
per run, and a 10-hour run had to be resumable fact by fact; here a job is an entity,
and a rerun of a half-done one is almost free — every LLM answer is in `llm_cache`).

    intel:embed done ─→ knowledge:start ─┬→ knowledge:song   (net: songfacts, Genius)
                                          └→ knowledge:artist (net: songfacts, AudioDB)
    knowledge:song   ─→ knowledge:refine (ai) ─→ knowledge:verify (net, MusicBrainz)
                     ─→ knowledge:relations (ai: GLiNER2 in ml + the LLM)
                     ─→ knowledge:vibe (ai)
    knowledge:artist ─→ knowledge:refine (ai)

Every writer bumps the subject's `knowledge_at` (the player's ETag reads it)."""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import httpx
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.knowledge import sources as src
from musix.contexts.knowledge.models import (
    fact_refinements,
    facts,
    song_relations,
    song_vibes,
    source_fetch_log,
    verification_cache,
)
from musix.contexts.library import artist_split
from musix.contexts.library.models import artists, media_files, songs, track_artists, tracks
from musix.contexts.library.slug import slugify, song_key
from musix.infra.changelog import record_change
from musix.infra.llm import Llm
from musix.infra.ml_client import MlClient
from musix.knowledge import sonic_vibe as SV
from musix.knowledge.fact_relations.service import collect_claims
from musix.knowledge.facts_v2 import pipeline as fv2
from musix.knowledge.facts_v2 import sample_links as sl

SM = async_sessionmaker[AsyncSession]
log = logging.getLogger(__name__)
LANG_NAME = {"ru": "Russian", "en": "English"}
Defer = Callable[[str, dict[str, Any]], Awaitable[None]]


# ── small helpers ────────────────────────────────────────────────────────────


async def _logged(s: AsyncSession, source: str, key: str) -> bool:
    return bool(
        await s.scalar(
            sa.select(sa.literal(True)).where(
                source_fetch_log.c.source == source, source_fetch_log.c.key == key
            )
        )
    )


async def _log(s: AsyncSession, source: str, key: str, status: str) -> None:
    row = {"source": source, "key": key, "status": status, "fetched_at": dt.datetime.now(dt.UTC)}
    await s.execute(
        pg_insert(source_fetch_log)
        .values(**row)
        .on_conflict_do_update(index_elements=["source", "key"], set_=row)
    )


async def _touch(s: AsyncSession, table: sa.Table, subject: uuid.UUID) -> None:
    await s.execute(
        sa.update(table).where(table.c.id == subject).values(knowledge_at=sa.func.now())
    )


async def _add_facts(
    s: AsyncSession,
    kind: str,
    subject: uuid.UUID,
    texts: list[str],
    source: str,
    category: str | None = None,
) -> int:
    rows = [
        {
            "subject_kind": kind,
            "subject_id": subject,
            "lang": "en",
            "text": t.replace("\x00", ""),
            "category": category,
            "source": source,
        }
        for t in texts
        if t and t.strip()
    ]
    if not rows:
        return 0
    got = await s.execute(
        pg_insert(facts).values(rows).on_conflict_do_nothing().returning(facts.c.id)
    )
    return len(got.all())


async def _add_relation(
    s: AsyncSession, song: uuid.UUID, kind: str, text: str, source: str, **kw: Any
) -> None:
    await s.execute(
        pg_insert(song_relations)
        .values(song_id=song, kind=kind, target_text=text.strip(), source=source, **kw)
        .on_conflict_do_nothing()
    )


async def _artist_id(s: AsyncSession, name: str) -> uuid.UUID | None:
    slug = artist_split.canonical_slug(name) or slugify(name)
    got = await s.scalar(sa.select(artists.c.id).where(artists.c.slug == slug))
    return uuid.UUID(str(got)) if got else None


async def _song_id(s: AsyncSession, artist: str, title: str) -> uuid.UUID | None:
    got = await s.scalar(sa.select(songs.c.id).where(songs.c.slug == song_key(artist, title)))
    return uuid.UUID(str(got)) if got else None


async def _song_row(s: AsyncSession, song: uuid.UUID) -> Any:
    """The song with the raw artist tag of one of its tracks — v1 keyed and asked
    sources by the tag, not by the canonical artist name."""
    return (
        await s.execute(
            sa.select(
                songs.c.id,
                songs.c.slug,
                songs.c.title,
                sa.select(tracks.c.artist_display)
                .where(tracks.c.song_id == songs.c.id)
                .order_by(tracks.c.id)
                .limit(1)
                .scalar_subquery()
                .label("artist"),
                sa.select(tracks.c.year)
                .where(tracks.c.song_id == songs.c.id)
                .order_by(tracks.c.id)
                .limit(1)
                .scalar_subquery()
                .label("year"),
                sa.select(media_files.c.sonic_tags)
                .join(tracks, tracks.c.media_file_id == media_files.c.id)
                .where(tracks.c.song_id == songs.c.id)
                .order_by(tracks.c.id)
                .limit(1)
                .scalar_subquery()
                .label("sonic_tags"),
            ).where(songs.c.id == song)
        )
    ).first()


# ── fetchers (net queue) ─────────────────────────────────────────────────────


async def song(sm: SM, http: httpx.AsyncClient, song_id: uuid.UUID) -> bool:
    """songfacts.com + Genius for one song. → whether the song has any facts now."""
    async with sm() as s:
        row = await _song_row(s, song_id)
        if row is None or not row.artist:
            return False
        have_sf = await s.scalar(
            sa.select(sa.literal(True)).where(
                facts.c.subject_kind == "song",
                facts.c.subject_id == song_id,
                facts.c.source == "songfacts.com",
            )
        )
        skip_sf = bool(have_sf) or await _logged(s, "facts:song", row.slug)
        skip_g = await _logged(s, "genius", row.slug) or bool(
            await s.scalar(
                sa.select(sa.literal(True)).where(
                    facts.c.subject_kind == "song",
                    facts.c.subject_id == song_id,
                    facts.c.source == "genius.com",
                )
            )
        )
    if not skip_sf:
        found, definitive = await src.songfacts_song(sm, http, row.artist, row.title)
        async with sm() as s:
            if found:
                await _add_facts(s, "song", song_id, found, "songfacts.com")
            elif definitive:
                await _log(s, "facts:song", row.slug, "miss")
            await _touch(s, songs, song_id)
            await s.commit()
    if not skip_g:
        parsed, definitive = await src.genius_song(sm, http, row.artist, row.title)
        async with sm() as s:
            if parsed is not None:
                from musix.knowledge import genius as G

                for text, cat in G.build_song_facts(parsed):
                    await _add_facts(s, "song", song_id, [text], "genius.com", cat)
                for name in parsed["producers"]:
                    await _add_relation(
                        s,
                        song_id,
                        "producer",
                        name,
                        "genius",
                        target_artist_id=await _artist_id(s, name),
                    )
                if parsed["label"]:
                    await _add_relation(s, song_id, "label", parsed["label"], "genius")
            if parsed is not None or definitive:
                await _log(s, "genius", row.slug, "hit" if parsed is not None else "miss")
            await _touch(s, songs, song_id)
            await s.commit()
    async with sm() as s:
        return bool(
            await s.scalar(
                sa.select(sa.literal(True)).where(
                    facts.c.subject_kind == "song", facts.c.subject_id == song_id
                )
            )
        )


async def artist(sm: SM, http: httpx.AsyncClient, media_dir: Path, artist_id: uuid.UUID) -> bool:
    """songfacts.com artist facts + the AudioDB profile and image (Deezer fallback).
    → whether the artist has any facts now."""
    from musix.contexts.media.process import store_image

    async with sm() as s:
        a = (await s.execute(sa.select(artists).where(artists.c.id == artist_id))).first()
        if a is None:
            return False
        has_facts = await s.scalar(
            sa.select(sa.literal(True)).where(
                facts.c.subject_kind == "artist", facts.c.subject_id == artist_id
            )
        )
        skip_sf = bool(has_facts) or await _logged(s, "facts:artist", a.slug)
        skip_adb = a.profile is not None or await _logged(s, "audiodb", a.slug)
    if not skip_sf:
        found, definitive = await src.songfacts_artist(sm, http, a.name)
        async with sm() as s:
            if found:
                await _add_facts(s, "artist", artist_id, found, "songfacts.com")
            elif definitive:
                await _log(s, "facts:artist", a.slug, "miss")
            await _touch(s, artists, artist_id)
            await s.commit()
    if not skip_adb:
        canonical = src.canonical_artist_name(a.name)
        rec, definitive = await src.audiodb(sm, http, canonical)
        if rec is None and not definitive:
            pass  # unreachable: nothing written, the next pass retries (v1)
        else:
            cutout = await src.download(sm, http, (rec or {}).get("strArtistCutout"))
            thumb = await src.download(sm, http, (rec or {}).get("strArtistThumb"))
            if not cutout and not thumb:
                thumb = await src.download(sm, http, await src.deezer_picture(sm, http, canonical))
            profile = {
                k: v
                for k, v in {
                    "bio": (rec or {}).get("strBiographyEN") or (rec or {}).get("strBiography"),
                    "mood": (rec or {}).get("strMood"),
                    "country": (rec or {}).get("strCountry"),
                    "countryCode": (rec or {}).get("strCountryCode"),
                    "label": (rec or {}).get("strLabel"),
                    "mbid": (rec or {}).get("strMusicBrainzID"),
                    "fetchedAt": dt.datetime.now(dt.UTC).isoformat(),
                }.items()
                if v
            }
            async with sm() as s:
                values: dict[str, Any] = {"profile": profile, "knowledge_at": sa.func.now()}
                if thumb and a.image_id is None:
                    values["image_id"] = await store_image(s, media_dir, thumb, "artist")
                if cutout and a.cutout_id is None:
                    values["cutout_id"] = await store_image(s, media_dir, cutout, "artist_cutout")
                await s.execute(
                    sa.update(artists).where(artists.c.id == artist_id).values(**values)
                )
                if "image_id" in values or "cutout_id" in values:
                    owners: sa.ScalarResult[uuid.UUID] = await s.scalars(
                        sa.select(tracks.c.account_id)
                        .join(track_artists, track_artists.c.track_id == tracks.c.id)
                        .where(
                            track_artists.c.artist_id == artist_id, tracks.c.deleted_at.is_(None)
                        )
                        .distinct()
                    )
                    for acct in owners:
                        await record_change(s, acct, "artist", artist_id)
                await _log(s, "audiodb", a.slug, "hit" if rec else "miss")
                await s.commit()
    async with sm() as s:
        return bool(
            await s.scalar(
                sa.select(sa.literal(True)).where(
                    facts.c.subject_kind == "artist", facts.c.subject_id == artist_id
                )
            )
        )


# ── facts_v2 (ai queue) ──────────────────────────────────────────────────────


def asker(llm: Llm, kind: str) -> Callable[..., Awaitable[str]]:
    async def ask(prompt: str, temperature: float = 0.3) -> str:
        return await llm.ask(prompt, kind=kind, temperature=temperature)

    return ask


async def _library_resolver(s: AsyncSession) -> Callable[[str, str], str | None]:
    """v1 `library_resolver_from_db`: `artist|title` → a song somebody owns. Such a link
    is PROVEN (the file exists); v1 asked the one account's library, v2 any — the
    knowledge is global and a target track is resolved per account at read time."""
    rows = await s.execute(
        sa.select(tracks.c.artist_display, tracks.c.title, songs.c.slug)
        .join(songs, songs.c.id == tracks.c.song_id)
        .where(tracks.c.deleted_at.is_(None))
    )
    index = {(sl.norm(a or ""), sl.norm(t)): slug for a, t, slug in rows}
    return lambda artist, title: index.get((sl.norm(artist), sl.norm(title)))


def _link_kind(direction: str, relation: str) -> str:
    usage = direction == "usage"
    if relation == "interpolation":
        return "interpolated_by" if usage else "interpolation"
    return "sampled_by" if usage else "sample"


async def refine(sm: SM, llm: Llm, kind: str, subject_id: uuid.UUID, lang: str) -> dict[str, int]:
    """Classify → rewrite this subject's raw facts not yet processed in `lang` (v1
    `ai_tasks/refined_facts._do_entity`); a song's sampling links are cleaned by the
    free tiers and written, the ones that need MusicBrainz are left unverified."""
    async with sm() as s:
        todo = [
            {"id": r.id, "fact": r.text, "category": r.category, "source": r.source}
            for r in await s.execute(
                sa.select(facts.c.id, facts.c.text, facts.c.category, facts.c.source)
                .where(
                    facts.c.subject_kind == kind,
                    facts.c.subject_id == subject_id,
                    facts.c.lang == "en",
                    ~sa.exists().where(
                        fact_refinements.c.fact_id == facts.c.id, fact_refinements.c.lang == lang
                    ),
                )
                .order_by(facts.c.id)
            )
        ]
        if not todo:
            return {"facts": 0}
        if kind == "song":
            row = await _song_row(s, subject_id)
            entity = {"slug": row.slug, "artist": row.artist or "", "title": row.title}
        else:
            a = (
                await s.execute(
                    sa.select(artists.c.slug, artists.c.name).where(artists.c.id == subject_id)
                )
            ).one()
            entity = {"slug": a.slug, "name": a.name}
    done: list[dict[str, Any]] = []
    cfg = await llm.config()
    recs = await fv2.process_entity(
        asker(llm, "facts_v2"),
        entity,
        kind,
        todo,
        lang_name=LANG_NAME.get(lang, "Russian"),
        lang_code=lang,
        on_result=done.append,
    )
    async with sm() as s:
        for rec in done:
            fact = rec["fact"]
            labels = [x for x in rec.get("labels", []) if not x.startswith("gate:")] or rec.get(
                "labels", []
            )
            row = {
                "fact_id": int(fact["id"]),
                "lang": lang,
                "labels": labels,
                "text": rec.get("refined") or None,
                "confirmed": not rec.get("unconfirmed", False),
                "src": "annotation" if fact.get("category") == "genius_annotation" else "editorial",
                "model": cfg.model,
                "generated_at": dt.datetime.now(dt.UTC),
            }
            if rec.get("error"):
                continue  # not stored: the next run retries it (v1 stored nothing either)
            await s.execute(
                pg_insert(fact_refinements)
                .values(**row)
                .on_conflict_do_update(index_elements=["fact_id", "lang"], set_=row)
            )
        links = 0
        if kind == "song":
            links = await _store_links(s, subject_id, entity, recs)
        await _touch(s, songs if kind == "song" else artists, subject_id)
        await s.commit()
    return {"facts": len(done), "failed": sum(1 for r in recs if r.get("error")), "links": links}


async def _store_links(
    s: AsyncSession, song_id: uuid.UUID, entity: dict[str, Any], recs: list[dict[str, Any]]
) -> int:
    """v1 `_store_links` → `verify_lane.clean_and_store`, the free tiers only."""
    rows, seen = [], set()
    for rec in recs:
        fact_text = (rec.get("fact") or {}).get("fact") or ""
        for link in rec.get("links") or []:
            artist_name = (link.get("artist") or "").strip()
            title = (link.get("title") or "").strip()
            if not artist_name or not title:
                continue
            direction = link.get("direction") or "source"
            key = (direction, sl.db_key(artist_name, title))
            if key in seen:
                continue
            seen.add(key)
            rows.append(
                {
                    "artist": artist_name,
                    "title": title,
                    "direction": direction,
                    "relation": link.get("relation") or "sample",
                    "src_slug": entity["slug"],
                    "src_artist": entity.get("artist") or "",
                    "src_title": entity.get("title") or "",
                    "fact": fact_text,
                }
            )
    if not rows:
        return 0
    resolve = await _library_resolver(s)
    n = 0
    for lk in sl.clean(rows, resolve=resolve, mb=None):
        if lk.get("verdict") == "reject":
            continue
        settled = lk.get("reason") in ("in_library", "corroborated")
        target = (
            await s.scalar(sa.select(songs.c.id).where(songs.c.slug == lk["dst_slug"]))
            if lk.get("dst_slug")
            else await _song_id(s, lk["artist"], lk["title"])
        )
        await _add_relation(
            s,
            song_id,
            _link_kind(lk["direction"], lk.get("relation") or "sample"),
            f"{lk['artist']} — {lk['title']}",
            "facts",
            target_song_id=target,
            target_artist_id=await _artist_id(s, lk["artist"]),
            evidence=lk.get("fact"),
            confidence=lk.get("confidence"),
            verified=True if settled else None,
        )
        n += 1
    return n


# ── MusicBrainz verification (net queue) ─────────────────────────────────────


async def verify(sm: SM, http: httpx.AsyncClient, song_id: uuid.UUID) -> dict[str, int]:
    """v1 `verify_song_links`: an unchecked link is kept, a link MusicBrainz checked and
    disowned is dropped, a confirmed one is marked verified. Verdicts are cached per
    (artist, title) across songs (`verification_cache`)."""
    async with sm() as s:
        rels = (
            await s.execute(
                sa.select(song_relations.c.id, song_relations.c.target_text).where(
                    song_relations.c.song_id == song_id,
                    song_relations.c.source == "facts",
                    song_relations.c.verified.is_(None),
                )
            )
        ).all()
    out = {"checked": 0, "kept": 0, "dropped": 0}
    for rid, text in rels:
        artist_name, _, title = text.partition(" — ")
        if not title:
            continue
        key = (sl.norm(artist_name), sl.norm(title))
        async with sm() as s:
            hit = (
                await s.execute(
                    sa.select(verification_cache.c.verified).where(
                        verification_cache.c.artist_key == key[0],
                        verification_cache.c.title_key == key[1],
                    )
                )
            ).first()
        if hit is not None:
            res: dict[str, Any] = {"checked": True, "verified": hit.verified}
        else:
            res = await src.musicbrainz_verify(sm, http, artist_name, title)
            out["checked"] += 1
            if res.get("checked"):
                async with sm() as s:
                    await s.execute(
                        pg_insert(verification_cache)
                        .values(
                            artist_key=key[0],
                            title_key=key[1],
                            verified=bool(res.get("verified")),
                            score=res.get("score"),
                            mb_artist=res.get("mb_artist"),
                            mb_title=res.get("mb_title"),
                            mbid=res.get("mbid"),
                        )
                        .on_conflict_do_nothing()
                    )
                    await s.commit()
        async with sm() as s:
            if res.get("verified"):
                await s.execute(
                    sa.update(song_relations)
                    .where(song_relations.c.id == rid)
                    .values(verified=True, confidence=0.9)
                )
                out["kept"] += 1
            elif res.get("checked"):
                await s.execute(sa.delete(song_relations).where(song_relations.c.id == rid))
                out["dropped"] += 1
            else:
                out["kept"] += 1  # silence is not a verdict: keep what the extraction produced
            await _touch(s, songs, song_id)
            await s.commit()
    return out


# ── producers: GLiNER2 in ml + the LLM (ai queue) ────────────────────────────


class _Precomputed:
    """The `extractor` v1's `collect_claims` expects, answered from one batched ml call."""

    def __init__(self, outputs: dict[str, dict[str, Any]]) -> None:
        self.outputs = outputs

    def extract(self, fact: str) -> dict[str, Any]:
        return self.outputs[fact]


async def relations(sm: SM, llm: Llm, ml: MlClient, song_id: uuid.UUID) -> int:
    """v1 `fact_relations.process_song_facts`, the producer leg (sampling links are
    facts_v2's). → the number of producers written."""
    async with sm() as s:
        row = await _song_row(s, song_id)
        texts: list[str] = list(
            await s.scalars(
                sa.select(facts.c.text)
                .where(
                    facts.c.subject_kind == "song",
                    facts.c.subject_id == song_id,
                    facts.c.lang == "en",
                )
                .order_by(facts.c.id)
            )
        )
    if row is None or not texts:
        return 0
    outputs = dict(zip(texts, await ml.gliner(texts), strict=True))
    loop = asyncio.get_running_loop()

    def ask(messages: list[dict[str, str]]) -> Any:
        system = next((m["content"] for m in messages if m.get("role") == "system"), None)
        user = next((m["content"] for m in messages if m.get("role") == "user"), "")
        return asyncio.run_coroutine_threadsafe(
            llm.ask_json(user, system=system, temperature=0, kind="fact_relations"), loop
        ).result()

    claims = await asyncio.to_thread(
        collect_claims, texts, row.title, row.artist or "", ask, _Precomputed(outputs), False
    )
    async with sm() as s:
        for name in claims["producers"]:
            await _add_relation(
                s, song_id, "producer", name, "extract", target_artist_id=await _artist_id(s, name)
            )
        await _log(s, "fact_relations", str(song_id), "done")
        await _touch(s, songs, song_id)
        await s.commit()
    return len(claims["producers"])


# ── the sonic vibe line (ai queue) ───────────────────────────────────────────


async def vibe(sm: SM, llm: Llm, song_id: uuid.UUID, lang: str) -> str | None:
    """v1 `ai_tasks/sonic_vibe.run` for one song: pick the best fact by key, write one
    line from it alone; one validation retry, then an empty slot."""
    async with sm() as s:
        if await s.scalar(
            sa.select(song_vibes.c.phrase).where(
                song_vibes.c.song_id == song_id, song_vibes.c.lang == lang
            )
        ):
            return None
        row = await _song_row(s, song_id)
        meta = [
            {"fact": t, "category": c}
            for t, c in await s.execute(
                sa.select(facts.c.text, facts.c.category)
                .where(
                    facts.c.subject_kind == "song",
                    facts.c.subject_id == song_id,
                    facts.c.lang == "en",
                )
                .order_by(facts.c.id)
            )
        ]
    window = SV._build_fact_window(meta)
    if row is None or not window:
        return None
    lang = lang if lang in SV._LANG_NAMES else "en"
    system = SV._SYSTEM_PROMPT.format(lang_name=SV._LANG_NAMES[lang])
    tags = row.sonic_tags if isinstance(row.sonic_tags, list) else []
    payload = {"artist": row.artist or "", "title": row.title, "year": row.year}
    user = SV._build_user_prompt(tags=tags, payload=payload, window=window, lang=lang)
    by_key = {item["key"]: item for item in window}
    phrase = ""
    for attempt in (0, 1):
        raw = await llm.ask(
            user, system=system, temperature=0.7, kind="sonic_vibe", cache=attempt == 0
        )
        try:
            best, line = SV._parse_vibe_response(raw or "", set(by_key))
        except ValueError:
            continue
        if best is None:
            break
        candidate = SV._validate(line)
        if (
            candidate
            and SV._line_ok(candidate, lang)
            and SV._entities_ok(
                candidate, f"{by_key[best]['text']} {payload['artist']} {payload['title']}"
            )
        ):
            phrase = candidate
            break
    async with sm() as s:
        if phrase:
            await s.execute(
                pg_insert(song_vibes)
                .values(song_id=song_id, lang=lang, phrase=phrase)
                .on_conflict_do_nothing()
            )
            await _touch(s, songs, song_id)
        await _log(s, f"vibe:{lang}", str(song_id), "hit" if phrase else "skip")
        await s.commit()
    return phrase or None


# ── fan-out ──────────────────────────────────────────────────────────────────


async def subjects_of(sm: SM, media_file_id: uuid.UUID) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    """(songs, artists) of every live track of this file."""
    async with sm() as s:
        song_ids: list[uuid.UUID] = list(
            await s.scalars(
                sa.select(tracks.c.song_id)
                .where(
                    tracks.c.media_file_id == media_file_id,
                    tracks.c.song_id.is_not(None),
                    tracks.c.deleted_at.is_(None),
                )
                .distinct()
            )
        )
        artist_ids: list[uuid.UUID] = list(
            await s.scalars(
                sa.select(track_artists.c.artist_id)
                .join(tracks, tracks.c.id == track_artists.c.track_id)
                .where(tracks.c.media_file_id == media_file_id, tracks.c.deleted_at.is_(None))
                .distinct()
            )
        )
    return song_ids, artist_ids


def _read_file(p: Path) -> bytes | None:
    return p.read_bytes() if p.is_file() else None


async def import_artist_images(sm: SM, media_dir: Path, manifest: Path) -> dict[str, int]:
    """One-off for the migration (run inside a container that has libvips): the v1
    artist thumbs and cutouts listed in `manifest` ({artist_id: {thumb, cutout}}, paths
    under the media dir) go through the image pipeline onto their artists."""
    from musix.contexts.media.process import store_image

    todo = json.loads(await asyncio.to_thread(manifest.read_text))
    n = {"images": 0, "missing": 0}
    for aid, paths in todo.items():
        values: dict[str, Any] = {}
        for col, key, kind in (
            ("image_id", "thumb", "artist"),
            ("cutout_id", "cutout", "artist_cutout"),
        ):
            p = Path(paths[key]) if paths.get(key) else None
            if p is None:
                continue
            data = await asyncio.to_thread(_read_file, p)
            if data is None:
                n["missing"] += 1
                continue
            async with sm() as s:
                values[col] = await store_image(s, media_dir, data, kind)
                await s.commit()
            n["images"] += 1
        if values:
            async with sm() as s:
                await s.execute(
                    sa.update(artists).where(artists.c.id == uuid.UUID(aid)).values(**values)
                )
                await s.commit()
    return n
