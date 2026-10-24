"""Reads of the sound engine's tables for the API (spec §10): profiles rendered into labels
in the request's language (ru for now: the words are keys, so English is a table away)."""

from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.knowledge.models import song_tags
from musix.contexts.library.models import albums, tracks
from musix.contexts.sound import albums as A
from musix.contexts.sound import derive as D
from musix.contexts.sound import schemas as S
from musix.contexts.sound import words as W
from musix.contexts.sound.models import gpu_lease, sound_analysis, sound_profiles, sound_texts

P, SA = sound_profiles.c, sound_analysis.c
DAY_AGO = sa.func.now() - sa.text("interval '24 hours'")


def _l(table: dict[str, str], key: str | None) -> S.Label | None:
    return S.Label(key=key, label=table[key]) if key else None


def _render(p: Any, signature: str | None) -> S.TrackSound:
    secs = p.sections
    return S.TrackSound(
        ratings=S.Ratings(space=p.space, tech=p.tech, odd=p.odd, facets=p.facets),
        instruments=[S.Label(key=k, label=W.NAMES[k]) for k in p.instruments],
        drums=_l({"live": W.NAMES["drums_live"], "machine": W.NAMES["drum_machine"]}, p.drums),
        vocals=None if p.vocals in (None, "none") else _l(W.NAMES, p.vocals),
        pace=_l(W.PACE, p.pace),
        feel=_l(W.FEEL, p.feel),
        echo=S.Label(key=p.echo, label=W.ECHO[p.echo]),
        width=_l(W.WIDTH, p.width),
        traits=list(p.traits),
        sections=[
            S.Section(
                start=s["start"],
                end=s["end"],
                kind=s["kind"],
                label=W.section_label(s["kind"], s["n"], s["last"]),
            )
            for s in secs
        ],
        moments=[
            S.Moment(
                t=m["t"],
                kind=m["kind"],
                label=D.moment_text(m, secs),
                section=W.section_label(
                    **{k: secs[m["section_i"]][k] for k in ("kind", "n", "last")}
                )
                if m["section_i"] is not None
                else "",
            )
            for m in p.moments
        ],
        stems=[
            S.StemPlace(
                stem=s["stem"],
                name=S.Label(key=s["name"], label=W.NAMES[s["name"]]),
                side=S.Label(key=s["side"], label=W.SIDES[s["side"]]),
                pan=s["pan"],
                width=s["width"],
            )
            for s in p.stems
        ],
        signature=signature,
        has_stage=p.has_stage,
        ver=p.derive_ver,
    )


async def track_sound(
    s: AsyncSession, mf_id: uuid.UUID
) -> tuple[S.TrackSound | None, str | None, tuple[Any, ...]]:
    """(the rendered profile or None, the analysis state when there is no profile, a version
    tuple for the ETag)."""
    T = sound_texts.c
    sig = (
        sa.select(T.text, T.generated_at)
        .where(
            T.subject_kind == "media_file",
            T.subject_id == mf_id,
            T.kind == "signature",
            T.lang == "ru",
            T.state == "ok",
        )
        .subquery()
    )
    row = (
        await s.execute(
            sa.select(
                sound_profiles,
                SA.stage_frames.is_not(None).label("has_stage"),
                sig.c.text.label("signature"),
                sig.c.generated_at.label("sig_at"),
            )
            .join(sound_analysis, SA.media_file_id == P.media_file_id)
            .outerjoin(sig, sa.true())
            .where(P.media_file_id == mf_id)
        )
    ).first()
    if row is None:
        state = await s.scalar(sa.select(SA.state).where(SA.media_file_id == mf_id))
        return None, state or "none", ()
    return _render(row, row.signature), None, (row.derive_ver, row.derived_at, row.sig_at)


async def stage_frames(s: AsyncSession, mf_id: uuid.UUID) -> tuple[bytes, Any] | None:
    row = (
        await s.execute(
            sa.select(SA.stage_frames, SA.analysed_at).where(
                SA.media_file_id == mf_id, SA.stage_frames.is_not(None)
            )
        )
    ).first()
    return (row.stage_frames, row.analysed_at) if row else None


async def status(s: AsyncSession, batch: dict[str, Any] | None) -> S.SoundStatus:
    lease = (await s.execute(sa.select(gpu_lease).where(gpu_lease.c.id == 1))).one()
    c = (
        await s.execute(
            sa.select(
                sa.func.count().filter(SA.state == "pending", SA.priority >= 100),
                sa.func.count().filter(SA.state == "pending", SA.priority < 100),
                sa.func.count().filter(SA.state == "running"),
                sa.func.count().filter(SA.state == "done"),
                sa.func.count().filter(SA.state == "failed"),
                sa.func.count().filter(SA.state == "skipped"),
                # the pace of the last 24 h: tracks an hour since the first of them
                sa.func.count().filter(SA.analysed_at > DAY_AGO),
                sa.func.extract(
                    "epoch",
                    sa.func.now() - sa.func.min(SA.analysed_at).filter(SA.analysed_at > DAY_AGO),
                ),
            )
        )
    ).one()
    pending = c[0] + c[1] + c[2]
    eta = None
    if c[6] >= 2 and c[7] and pending:
        eta = round(pending / (c[6] / max(float(c[7]) / 3600, 0.1)), 1)
    return S.SoundStatus(
        holder=lease.holder,
        lease_since=lease.changed_at.isoformat(),
        lease_reason=lease.reason,
        batch=(batch or {}).get("batch"),
        stage=(batch or {}).get("stage"),
        pending_uploads=c[0],
        pending_backfill=c[1],
        running=c[2],
        done=c[3],
        failed=c[4],
        skipped=c[5],
        eta_hours=eta,
    )


async def media_file_of(
    s: AsyncSession, account_id: uuid.UUID, track_id: uuid.UUID
) -> uuid.UUID | None:
    return await s.scalar(
        sa.select(tracks.c.media_file_id).where(
            tracks.c.id == track_id,
            tracks.c.account_id == account_id,
            tracks.c.deleted_at.is_(None),
        )
    )


# ── albums and artists (spec §9, §10) ────────────────────────────────────────


class Pooled:
    """An artist's album with its pool (None below A.MIN_TRACKS analysed recordings)."""

    def __init__(self, id: uuid.UUID, title: str, year: int | None, ms: list[A.Member]) -> None:
        self.id, self.title, self.year, self.members = id, title, year, ms
        self.pool = A.pool(ms) if len(ms) >= A.MIN_TRACKS else None
        self.derived_at: Any = None

    @property
    def album(self) -> A.Album:
        assert self.pool is not None
        return (self.title, self.year, self.pool)


async def artist_albums(
    s: AsyncSession, artist_id: uuid.UUID | None, album_id: uuid.UUID | None = None
) -> list[Pooled]:
    """Every album of the artist (or the one album when it has no album artist) with its
    analysed recordings, each recording once: shared data, any account's copy counts."""
    Al, T = albums.c, tracks.c
    year = sa.func.coalesce(Al.original_year, Al.year)
    where = Al.album_artist_id == artist_id if artist_id else Al.id == album_id
    rows = (
        await s.execute(
            sa.select(
                Al.id.label("album_id"),
                Al.title.label("album"),
                year.label("year"),
                T.title,
                T.song_id,
                sound_profiles,
            )
            .join(tracks, T.album_id == Al.id)
            .join(sound_profiles, P.media_file_id == T.media_file_id)
            .where(where, T.deleted_at.is_(None))
            .order_by(year.nulls_last(), Al.id, T.disc_no, T.track_no, T.added_at)
        )
    ).all()
    song_ids = {r.song_id for r in rows if r.song_id}
    tags: dict[uuid.UUID, list[str]] = {}
    if song_ids:
        for sid, tag in (
            await s.execute(
                sa.select(song_tags.c.song_id, song_tags.c.tag)
                .where(song_tags.c.song_id.in_(song_ids), song_tags.c.source == "genius")
                .order_by(song_tags.c.song_id, song_tags.c.pos)
            )
        ).all():
            tags.setdefault(sid, []).append(tag)
    out: dict[uuid.UUID, Pooled] = {}
    seen: set[tuple[uuid.UUID, uuid.UUID]] = set()
    by_album: dict[uuid.UUID, list[A.Member]] = {}
    heads: dict[uuid.UUID, Any] = {}
    latest: dict[uuid.UUID, Any] = {}
    for r in rows:
        if (r.album_id, r.media_file_id) in seen:
            continue
        seen.add((r.album_id, r.media_file_id))
        heads.setdefault(r.album_id, r)
        m = r._mapping
        by_album.setdefault(r.album_id, []).append(
            A.member(r.title, m, tags.get(r.song_id, []) if r.song_id else [])
        )
        latest[r.album_id] = max(latest.get(r.album_id, r.derived_at), r.derived_at)
    for aid, ms in by_album.items():
        h = heads[aid]
        out[aid] = Pooled(aid, h.album, h.year, ms)
        out[aid].derived_at = latest[aid]
    return list(out.values())


def _scale(v: dict[str, Any] | None) -> S.PoolScale | None:
    if v is None:
        return None
    return S.PoolScale(
        mean=v["mean"],
        min=S.PoolEnd(value=v["min"][0], title=v["min"][1]),
        max=S.PoolEnd(value=v["max"][0], title=v["max"][1]),
        facets=v["facets"],
    )


def pool_out(a: Pooled) -> S.AlbumPool:
    p = a.pool
    assert p is not None
    return S.AlbumPool(
        album_id=a.id,
        title=a.title,
        year=a.year,
        n=p["n"],
        tech=_scale(p["tech"]),
        space=_scale(p["space"]),
        odd=_scale(p["odd"]),
        traits=[
            S.TraitShare(key=k, label=A.trait_ru(k), share=v)
            for k, v in sorted(p["share"].items(), key=lambda kv: -kv[1])
        ],
        tempo=[S.Label(key=k, label=A.tempo_ru(k)) for k in p["tempo"]],
    )


async def _text(s: AsyncSession, kind: str, subject: uuid.UUID) -> tuple[str | None, Any]:
    T = sound_texts.c
    row = (
        await s.execute(
            sa.select(T.text, T.generated_at).where(
                T.subject_kind == ("album" if kind == "album_sound" else "artist"),
                T.subject_id == subject,
                T.kind == kind,
                T.lang == "ru",
                T.state == "ok",
            )
        )
    ).first()
    return (row.text, row.generated_at) if row else (None, None)


async def has_album(s: AsyncSession, account_id: uuid.UUID, album_id: uuid.UUID) -> bool:
    """The account has a live track on the album (the album page's rule)."""
    return bool(
        await s.scalar(
            sa.select(
                sa.exists().where(
                    tracks.c.album_id == album_id,
                    tracks.c.account_id == account_id,
                    tracks.c.deleted_at.is_(None),
                )
            )
        )
    )


async def album_sound(
    s: AsyncSession, album_id: uuid.UUID
) -> tuple[S.AlbumSound | None, tuple[Any, ...]]:
    mine = next(iter(await artist_albums(s, None, album_id)), None)
    if mine is None or mine.pool is None:
        return None, ()
    text, at = await _text(s, "album_sound", album_id)
    return S.AlbumSound(pool=pool_out(mine), text=text), (mine.derived_at, at)


async def has_artist(s: AsyncSession, account_id: uuid.UUID, artist_id: uuid.UUID) -> bool:
    return bool(
        await s.scalar(
            sa.select(
                sa.exists().where(
                    tracks.c.account_id == account_id,
                    tracks.c.deleted_at.is_(None),
                    sa.or_(
                        tracks.c.primary_artist_id == artist_id,
                        tracks.c.album_id.in_(
                            sa.select(albums.c.id).where(albums.c.album_artist_id == artist_id)
                        ),
                    ),
                )
            )
        )
    )


async def artist_sound(
    s: AsyncSession, artist_id: uuid.UUID
) -> tuple[S.ArtistSound | None, tuple[Any, ...]]:
    pooled = [a for a in await artist_albums(s, artist_id) if a.pool is not None]
    if not pooled:
        return None, ()
    text, at = await _text(s, "timeline", artist_id)
    return (
        S.ArtistSound(albums=[pool_out(a) for a in pooled], timeline=text),
        (max(a.derived_at for a in pooled), at),
    )
