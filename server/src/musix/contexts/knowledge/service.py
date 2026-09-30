"""Reads. Visibility by join: a track is readable only by its account, so its song's and
its artists' knowledge is too; an artist's bio needs one of the account's live tracks
by that artist. A relation's target track is resolved only among the account's own."""

from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.knowledge import schemas as S
from musix.contexts.knowledge.models import artist_bios, song_vibes
from musix.contexts.library.models import track_artists, tracks

HIDDEN_LABELS = frozenset({"other", "about_artist", "about_song"})  # v1 MetadataDB.HIDDEN_LABELS
SAMPLE_KINDS = ("sample", "interpolation")
SAMPLED_BY_KINDS = ("sampled_by", "interpolated_by")

_FACTS = sa.text("""
SELECT f.text AS raw, f.lang AS raw_lang, f.source, r.lang AS rlang, r.text, r.labels, r.confirmed
FROM facts f LEFT JOIN fact_refinements r ON r.fact_id = f.id AND r.lang = :lang
WHERE f.subject_kind = :kind AND f.subject_id = :id
ORDER BY f.id
""")
_RELATIONS = sa.text("""
SELECT r.kind, r.target_text, r.target_song_id, r.target_artist_id, r.verified,
       (SELECT t.id FROM tracks t WHERE t.account_id = :a AND t.song_id = r.target_song_id
          AND t.deleted_at IS NULL ORDER BY t.id LIMIT 1) AS track_id
FROM song_relations r WHERE r.song_id = :song
ORDER BY r.kind, r.id
""")


def pick_facts(rows: list[Any]) -> tuple[list[S.FactOut], bool]:
    """v1 `get_refined_facts_meta` then `get_song_facts`: any refinement in this language
    means the subject was seen by facts_v2 — its showable items, possibly none; otherwise
    the raw English facts."""
    if any(r.rlang is not None for r in rows):
        out = [
            S.FactOut(text=r.text, labels=list(r.labels), confirmed=r.confirmed, source=r.source)
            for r in rows
            if r.rlang is not None and r.text and not HIDDEN_LABELS & set(r.labels)
        ]
        return out, True
    raw = [
        S.FactOut(text=r.raw, labels=[], confirmed=True, source=r.source)
        for r in rows
        if r.raw_lang == "en"
    ]
    return raw, False


async def subject_facts(
    s: AsyncSession, kind: str, subject: uuid.UUID | None, lang: str
) -> tuple[list[S.FactOut], bool]:
    if subject is None:
        return [], False
    rows = (await s.execute(_FACTS, {"kind": kind, "id": subject, "lang": lang})).all()
    return pick_facts(list(rows))


async def track_knowledge(
    s: AsyncSession, account_id: uuid.UUID, track_id: uuid.UUID, lang: str
) -> S.TrackKnowledge | None:
    t = (
        await s.execute(
            sa.select(tracks.c.song_id, tracks.c.primary_artist_id).where(
                tracks.c.id == track_id,
                tracks.c.account_id == account_id,
                tracks.c.deleted_at.is_(None),
            )
        )
    ).first()
    if t is None:
        return None
    song_facts, refined = await subject_facts(s, "song", t.song_id, lang)
    artist_facts, _ = await subject_facts(s, "artist", t.primary_artist_id, lang)
    rels: list[Any] = []
    vibe = None
    if t.song_id is not None:
        rels = list((await s.execute(_RELATIONS, {"a": account_id, "song": t.song_id})).all())
        vibe = await s.scalar(
            sa.select(song_vibes.c.phrase).where(
                song_vibes.c.song_id == t.song_id, song_vibes.c.lang == lang
            )
        )

    def of(*kinds: str) -> list[S.RelationOut]:
        return [
            S.RelationOut(
                text=r.target_text,
                kind=r.kind,
                song_id=r.target_song_id,
                track_id=r.track_id,
                artist_id=r.target_artist_id,
                verified=r.verified,
            )
            for r in rels
            if r.kind in kinds
        ]

    return S.TrackKnowledge(
        song_facts=song_facts,
        artist_facts=artist_facts,
        refined=refined,
        producers=of("producer"),
        labels=of("label"),
        samples=of(*SAMPLE_KINDS),
        sampled_by=of(*SAMPLED_BY_KINDS),
        vibe=vibe,
    )


async def artist_bio(
    s: AsyncSession, account_id: uuid.UUID, artist_id: uuid.UUID, lang: str
) -> S.BioOut | None:
    owns = (
        sa.select(1)
        .select_from(track_artists.join(tracks, tracks.c.id == track_artists.c.track_id))
        .where(
            track_artists.c.artist_id == artist_id,
            tracks.c.account_id == account_id,
            tracks.c.deleted_at.is_(None),
        )
        .exists()
    )
    row = (
        await s.execute(
            sa.select(artist_bios).where(
                artist_bios.c.artist_id == artist_id, artist_bios.c.lang == lang, owns
            )
        )
    ).first()
    return S.BioOut.model_validate(row._mapping) if row else None


def knowledge_version(account_id: uuid.UUID, track_id: uuid.UUID) -> tuple[Any, Any]:
    """Two scalar subqueries for an ETag: the song's and the primary artist's
    `knowledge_at`, bumped by every knowledge writer."""
    from musix.contexts.library.models import artists, songs

    def of(table: sa.Table, col: Any) -> Any:
        return (
            sa.select(table.c.knowledge_at)
            .select_from(tracks.join(table, table.c.id == col))
            .where(tracks.c.id == track_id, tracks.c.account_id == account_id)
            .scalar_subquery()
        )

    return of(songs, tracks.c.song_id), of(artists, tracks.c.primary_artist_id)
