"""Screen shapes, composed from concurrent queries on separate pooled sessions.

A shape only ever holds the account's own tracks: every track query filters by
`account_id` here, and albums/artists are visible only through them."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any, TypeVar

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.library.models import (
    albums,
    artists,
    lyrics,
    media_files,
    track_artists,
    tracks,
)
from musix.contexts.library.schemas import TrackOut
from musix.contexts.library.service import get_tracks
from musix.contexts.listening.models import account_track_stats
from musix.contexts.media.delivery import load_images
from musix.contexts.media.schemas import ImageData
from musix.contexts.playlists.models import playlists
from musix.contexts.playlists.service import list_playlists
from musix.contexts.screens import schemas as S
from musix.errors import NotFound

R = TypeVar("R")
T, Al, Ar, Ta, St = tracks.c, albums.c, artists.c, track_artists.c, account_track_stats.c


@dataclass(frozen=True)
class Ctx:
    sm: async_sessionmaker[AsyncSession]
    account_id: uuid.UUID
    base_url: str
    image_secret: bytes

    def live(self) -> sa.ColumnElement[bool]:
        return sa.and_(T.account_id == self.account_id, T.deleted_at.is_(None))

    async def run(self, fn: Callable[[AsyncSession], Awaitable[R]]) -> R:
        async with self.sm() as s:
            return await fn(s)

    async def tracks(self, ids: list[uuid.UUID]) -> list[TrackOut]:
        """In the order given."""
        got = {t.id: t for t in await self.run(lambda s: get_tracks(s, self.account_id, ids))}
        return [got[i] for i in ids if i in got]

    async def images(self, ids: Iterable[str | None]) -> dict[str, ImageData]:
        return await self.run(lambda s: load_images(s, self.base_url, self.image_secret, ids))


def _covers(ts: Iterable[TrackOut]) -> list[str | None]:
    return [t.cover_image_id for t in ts]


async def _ids(c: Ctx, q: sa.Select[Any]) -> list[uuid.UUID]:
    return list(await c.run(lambda s: s.scalars(q)))


_COUNTS: dict[tuple[uuid.UUID, int], S.Counts] = {}


async def counts(c: Ctx, head: int | None = None) -> S.Counts:
    """Library counts. They change only with the account's change_log, so given its head
    (the ETag version, already read) they are memoized per process."""
    if head is not None and (hit := _COUNTS.get((c.account_id, head))):
        return hit
    album_ids = sa.select(T.album_id).where(c.live(), T.album_id.is_not(None)).distinct().subquery()
    artist_ids = (
        sa.select(Ta.artist_id)
        .join(tracks, T.id == Ta.track_id)
        .where(c.live())
        .distinct()
        .subquery()
    )
    q = sa.select(
        sa.select(sa.func.count()).where(c.live()).scalar_subquery(),
        sa.select(sa.func.count()).select_from(album_ids).scalar_subquery(),
        sa.select(sa.func.count()).select_from(artist_ids).scalar_subquery(),
        sa.select(sa.func.count())
        .where(playlists.c.account_id == c.account_id, playlists.c.deleted_at.is_(None))
        .scalar_subquery(),
    )
    row = (await c.run(lambda s: s.execute(q))).one()
    out = S.Counts(tracks=row[0], albums=row[1], artists=row[2], playlists=row[3])
    if head is not None:
        if len(_COUNTS) > 4096:
            _COUNTS.clear()
        _COUNTS[(c.account_id, head)] = out
    return out


async def home(c: Ctx, head: int | None = None) -> S.HomeOut:
    live = sa.select(T.id).where(T.id == St.track_id, T.deleted_at.is_(None))
    recent_ids, added_ids, pls, cnt = await asyncio.gather(
        _ids(  # walks account_track_stats_recent_idx, probing tracks by key
            c,
            sa.select(St.track_id)
            .where(St.account_id == c.account_id, sa.exists(live))
            .order_by(St.last_played_at.desc().nulls_last())
            .limit(20),
        ),
        _ids(c, sa.select(T.id).where(c.live()).order_by(T.added_at.desc()).limit(20)),
        c.run(lambda s: list_playlists(s, c.account_id)),
        counts(c, head),
    )
    both = await c.tracks(list(dict.fromkeys([*recent_ids, *added_ids])))
    by = {t.id: t for t in both}
    recent = [by[i] for i in recent_ids if i in by]
    added = [by[i] for i in added_ids if i in by]
    pls = pls[:12]
    imgs = await c.images([*_covers(both), *(p.cover_image_id for p in pls)])
    return S.HomeOut(recent=recent, recently_added=added, playlists=pls, counts=cnt, images=imgs)


async def library_summary(c: Ctx, head: int | None = None) -> S.LibrarySummaryOut:
    async def totals(s: AsyncSession) -> Any:
        return (
            await s.execute(
                sa.select(
                    sa.func.coalesce(sa.func.sum(T.duration_ms), 0),
                    sa.func.min(T.added_at),
                    sa.func.max(T.added_at),
                ).where(c.live())
            )
        ).one()

    async def genres(s: AsyncSession) -> list[S.GenreCount]:
        rows = await s.execute(
            sa.select(T.genre, sa.func.count().label("n"))
            .where(c.live(), T.genre.is_not(None), T.genre != "")
            .group_by(T.genre)
            .order_by(sa.text("n desc"), T.genre)
            .limit(12)
        )
        return [S.GenreCount(genre=g, tracks=n) for g, n in rows]

    async def plays(s: AsyncSession) -> Any:
        return (
            await s.execute(
                sa.select(
                    sa.func.coalesce(sa.func.sum(St.plays), 0),
                    sa.func.coalesce(sa.func.sum(St.total_played_ms), 0),
                ).where(St.account_id == c.account_id)
            )
        ).one()

    cnt, tot, gen, pl = await asyncio.gather(
        counts(c, head), c.run(totals), c.run(genres), c.run(plays)
    )
    return S.LibrarySummaryOut(
        counts=cnt,
        duration_ms=int(tot[0]),
        first_added_at=tot[1],
        last_added_at=tot[2],
        genres=gen,
        plays=int(pl[0]),
        played_ms=int(pl[1]),
    )


async def album_cards(c: Ctx, where: sa.ColumnElement[bool], order: Any = None) -> list[S.AlbumOut]:
    """Albums the account has live tracks in, with its own track count and duration."""
    aa = artists.alias("aa")
    mine = (
        sa.select(
            T.album_id,
            sa.func.count().label("n"),
            sa.func.coalesce(sa.func.sum(T.duration_ms), 0).label("ms"),
        )
        .where(c.live(), T.album_id.is_not(None))
        .group_by(T.album_id)
        .subquery()
    )
    q = (
        sa.select(albums, aa.c.name.label("aa_name"), mine.c.n, mine.c.ms)
        .join(mine, mine.c.album_id == Al.id)
        .outerjoin(aa, aa.c.id == Al.album_artist_id)
        .where(where)
        .order_by(*(order if order is not None else [Al.title]))
    )
    rows = await c.run(lambda s: s.execute(q))
    return [
        S.AlbumOut(
            id=r.id,
            title=r.title,
            year=r.year,
            album_artist=S.ArtistRef(id=r.album_artist_id, name=r.aa_name)
            if r.album_artist_id
            else None,
            cover_image_id=r.cover_image_id,
            track_count=r.n,
            duration_ms=int(r.ms),
        )
        for r in rows
    ]


async def album_page(c: Ctx, album_id: uuid.UUID) -> S.AlbumPageOut:
    cards, ids = await asyncio.gather(
        album_cards(c, Al.id == album_id),
        _ids(
            c,
            sa.select(T.id)
            .where(c.live(), T.album_id == album_id)
            .order_by(T.disc_no.nulls_first(), T.track_no.nulls_last(), T.title),
        ),
    )
    if not cards:
        raise NotFound("album")
    ts = await c.tracks(ids)
    imgs = await c.images([cards[0].cover_image_id, *_covers(ts)])
    return S.AlbumPageOut(album=cards[0], tracks=ts, images=imgs)


async def artists_by_ids(c: Ctx, ids: list[uuid.UUID]) -> list[S.ArtistOut]:
    """Only artists the account's own tracks or albums reference."""
    via_tracks = sa.select(Ta.artist_id).join(tracks, T.id == Ta.track_id).where(c.live())
    via_albums = sa.select(Al.album_artist_id).join(tracks, T.album_id == Al.id).where(c.live())
    q = sa.select(artists).where(
        Ar.id.in_(ids), sa.or_(Ar.id.in_(via_tracks), Ar.id.in_(via_albums))
    )
    rows = await c.run(lambda s: s.execute(q))
    return [S.ArtistOut.model_validate(r._mapping) for r in rows]


async def artist_page(c: Ctx, artist_id: uuid.UUID) -> S.ArtistPageOut:
    def by_role(role: str) -> sa.Select[Any]:
        return (
            sa.select(T.id)
            .join(track_artists, Ta.track_id == T.id)
            .where(c.live(), Ta.artist_id == artist_id, Ta.role == role)
        )

    found, cards, top_ids, feat_ids, n = await asyncio.gather(
        artists_by_ids(c, [artist_id]),
        album_cards(c, Al.album_artist_id == artist_id, [Al.year.desc().nulls_last(), Al.title]),
        _ids(
            c,
            by_role("main")
            .outerjoin(
                account_track_stats, sa.and_(St.track_id == T.id, St.account_id == c.account_id)
            )
            .order_by(sa.func.coalesce(St.plays, 0).desc(), T.added_at.desc())
            .limit(10),
        ),
        _ids(c, by_role("feat").order_by(T.added_at.desc()).limit(20)),
        c.run(
            lambda s: s.scalar(sa.select(sa.func.count()).select_from(by_role("main").subquery()))
        ),
    )
    if not found:
        raise NotFound("artist")
    top, feat = await asyncio.gather(c.tracks(top_ids), c.tracks(feat_ids))
    imgs = await c.images(
        [found[0].image_id, *(a.cover_image_id for a in cards), *_covers(top), *_covers(feat)]
    )
    return S.ArtistPageOut(
        artist=found[0],
        albums=cards,
        top_tracks=top,
        appears_on=feat,
        track_count=int(n or 0),
        images=imgs,
    )


async def player_context(c: Ctx, track_id: uuid.UUID) -> S.PlayerContextOut:
    mf = media_files.c

    async def file(s: AsyncSession) -> Any:
        return (
            await s.execute(
                sa.select(
                    media_files,
                    lyrics.c.text,
                    lyrics.c.synced_lrc,
                    lyrics.c.source,
                    lyrics.c.language,
                )
                .join(tracks, T.media_file_id == mf.id)
                .outerjoin(lyrics, lyrics.c.media_file_id == mf.id)
                .where(T.id == track_id, c.live())
            )
        ).first()

    async def stats(s: AsyncSession) -> Any:
        return (
            await s.execute(
                sa.select(St.plays, St.last_played_at).where(
                    St.account_id == c.account_id, St.track_id == track_id
                )
            )
        ).first()

    ts, f, st = await asyncio.gather(c.tracks([track_id]), c.run(file), c.run(stats))
    if not ts or f is None:
        raise NotFound("track")
    return S.PlayerContextOut(
        track=ts[0],
        lyrics=S.LyricsOut(
            text=f.text, synced_lrc=f.synced_lrc, source=f.source, language=f.language
        )
        if f.text
        else None,
        credits=f.credits or {},
        audio=S.AudioInfo.model_validate(f._mapping),
        stats=S.TrackStats(
            plays=st.plays if st else 0, last_played_at=st.last_played_at if st else None
        ),
        images=await c.images([ts[0].cover_image_id]),
    )


async def albums_by_ids(c: Ctx, ids: list[uuid.UUID]) -> list[S.AlbumOut]:
    return await album_cards(c, Al.id.in_(ids))
