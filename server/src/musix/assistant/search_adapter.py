"""v1's `search_service.search(query, mode, limit, filters, collection_name)` for the
assistant's lyrics and audio branches, over v2 search: lyrics = RRF of dense + BM25 (+
the Cyrillic reading), sound = CLAP text→audio — both inside the account's `owners`
filter. Hits come back as v1 `TrackHit`s, built from the account's own tracks only."""

from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from qdrant_client import AsyncQdrantClient, models
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.assistant.models import SearchFilters, TrackHit, TrackMetadata
from musix.contexts.library.models import albums, artists, lyrics, media_files, tracks
from musix.contexts.search import service as search
from musix.infra.ml_client import MlClient
from musix.infra.vectors import TRACKS, owned_by


class SearchAdapter:
    def __init__(
        self,
        sm: async_sessionmaker[AsyncSession],
        q: AsyncQdrantClient,
        ml: MlClient,
        account: uuid.UUID,
    ) -> None:
        self.sm, self.q, self.ml, self.account = sm, q, ml, account

    async def search(
        self,
        query: str,
        *,
        mode: str = "text",
        limit: int = 10,
        filters: SearchFilters | None = None,
        collection_name: str | None = None,
        **_: Any,
    ) -> list[TrackHit]:
        if mode == "audio":
            hits = await self._sound(query, limit, filters)
        else:
            hits = await search.lyrics(self.q, self.ml, self.account, query, limit)
        return await self._hits(hits, "audio" if mode == "audio" else "lyrics")

    async def sound_profiles(
        self,
        *,
        artist_slug: str | None = None,
        artist_name: str | None = None,
        era: tuple[int, int] | None = None,
        track_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """This account's tracks with a sound profile, as ``query.Profile`` by track id:
        the artist's (every credit, as the CLAP filter's ``artist_ids``) or the library's,
        inside the era when one was asked. ``artist_name`` is for a name that did not
        resolve to a slug («Kanye»): the tracks whose artist line contains it."""
        from musix.contexts.library.models import track_artists
        from musix.contexts.sound import query as SQ

        q = SQ.profile_select(self.account)
        if artist_slug:
            aid = sa.select(artists.c.id).where(artists.c.slug == artist_slug).scalar_subquery()
            q = q.where(
                sa.or_(
                    tracks.c.primary_artist_id == aid,
                    tracks.c.id.in_(
                        sa.select(track_artists.c.track_id).where(track_artists.c.artist_id == aid)
                    ),
                )
            )
        elif artist_name and artist_name.strip():
            like = f"%{_like_escape(artist_name.strip()[:60])}%"
            q = q.where(tracks.c.artist_display.ilike(like, escape="\\"))
        if era:
            q = q.where(tracks.c.year.between(era[0], era[1]))
        if track_ids is not None:
            ids = [uuid.UUID(t) for t in track_ids if _is_uuid(t)]
            if not ids:
                return {}
            q = q.where(tracks.c.id.in_(ids))
        async with self.sm() as s:
            rows = (await s.execute(q)).all()
        out = {}
        for r in rows:
            p = SQ.Profile.from_row(r)
            out[p.track_id] = p
        return out

    async def find_track(self, title: str, artist_slug: str | None = None) -> dict[str, Any] | None:
        """The listener's own track by its title («похожее на Moon»): the exact title first
        (folded: case, ё, punctuation), the artist's when one was named, the original before
        a remix or a live take. None when the library has no such title."""
        from musix.contexts.library.models import track_artists
        from musix.contexts.search.normalize import fold

        want = fold(title)
        if not want:
            return None
        name = sa.func.coalesce(tracks.c.title_display, tracks.c.title)
        q = sa.select(
            tracks.c.id, tracks.c.media_file_id, name.label("title"), tracks.c.artist_display
        ).where(
            tracks.c.account_id == self.account,
            tracks.c.deleted_at.is_(None),
            name.ilike(f"%{_like_escape(title.strip()[:60])}%", escape="\\"),
        )
        if artist_slug:
            aid = sa.select(artists.c.id).where(artists.c.slug == artist_slug).scalar_subquery()
            q = q.where(
                sa.or_(
                    tracks.c.primary_artist_id == aid,
                    tracks.c.id.in_(
                        sa.select(track_artists.c.track_id).where(track_artists.c.artist_id == aid)
                    ),
                )
            )
        async with self.sm() as s:
            rows = (await s.execute(q.limit(200))).all()
        exact = [r for r in rows if fold(r.title) == want]
        if not exact:
            return None
        best = min(exact, key=lambda r: (len(r.title), str(r.id)))
        return {
            "track_id": str(best.id),
            "media_file_id": str(best.media_file_id),
            "title": best.title,
            "artist": best.artist_display,
        }

    async def neighbours(self, media_file_id: str, limit: int) -> list[tuple[str, TrackHit]]:
        """The tracks that sound closest to one of the library's own, by its CLAP vector —
        no text prompt (as the fast path's «похожее на»), as ``(media_file_id, hit)``
        closest first. The track itself is left out."""
        res = await self.q.query_points(
            TRACKS,
            query=media_file_id,  # a point id: Qdrant searches with that point's own vector
            using="clap",
            limit=limit + 1,
            query_filter=owned_by(self.account, []),
        )
        hits = [(str(p.id), float(p.score)) for p in res.points if str(p.id) != media_file_id]
        return await self._pairs(hits, "audio")

    async def track_hits(self, media_file_ids: list[str]) -> list[TrackHit]:
        """Tracks the sound profile brought into the pool, as hits like CLAP's own."""
        return await self._hits([(mf, 0.0) for mf in media_file_ids], "audio")

    async def _sound(
        self, text: str, limit: int, filters: SearchFilters | None
    ) -> list[tuple[str, float]]:
        extra: list[models.Condition] = []
        if filters is not None and filters.artist_slug:
            async with self.sm() as s:
                aid = await s.scalar(
                    sa.select(artists.c.id).where(artists.c.slug == filters.artist_slug)
                )
            if aid is None:
                return []
            extra.append(
                models.FieldCondition(key="artist_ids", match=models.MatchValue(value=str(aid)))
            )
        if filters is not None and filters.point_ids:
            extra.append(models.HasIdCondition(has_id=list(filters.point_ids)))
        vec = (await self.ml.clap_text([text], priority="interactive"))[0]
        res = await self.q.query_points(
            TRACKS,
            query=vec.tolist(),
            using="clap",
            limit=limit,  # the branch sizes its own pool (v1: no cap here)
            score_threshold=search.SOUND_MIN,
            query_filter=owned_by(self.account, extra),
        )
        return [(str(p.id), float(p.score)) for p in res.points]

    async def _hits(self, hits: list[tuple[str, float]], matched_on: str) -> list[TrackHit]:
        return [h for _, h in await self._pairs(hits, matched_on)]

    async def _pairs(
        self, hits: list[tuple[str, float]], matched_on: str
    ) -> list[tuple[str, TrackHit]]:
        if not hits:
            return []
        mfs = [uuid.UUID(h) for h, _ in hits]
        pa = artists.alias("pa")
        async with self.sm() as s:
            rows = (
                await s.execute(
                    sa.select(
                        tracks.c.id,
                        tracks.c.media_file_id,
                        tracks.c.title,
                        tracks.c.title_display,
                        tracks.c.artist_display,
                        tracks.c.year,
                        tracks.c.genre,
                        tracks.c.duration_ms,
                        tracks.c.cover_image_id,
                        media_files.c.path,
                        albums.c.title.label("album"),
                        lyrics.c.text.label("lyrics"),
                        pa.c.slug.label("primary_artist_slug"),
                    )
                    .join(media_files, media_files.c.id == tracks.c.media_file_id)
                    .outerjoin(albums, albums.c.id == tracks.c.album_id)
                    .outerjoin(lyrics, lyrics.c.media_file_id == tracks.c.media_file_id)
                    .outerjoin(pa, pa.c.id == tracks.c.primary_artist_id)
                    .where(
                        tracks.c.account_id == self.account,
                        tracks.c.deleted_at.is_(None),
                        tracks.c.media_file_id.in_(mfs),
                    )
                )
            ).all()
        by_mf = {str(r.media_file_id): r for r in rows}
        out = []
        for mf, score in hits:
            r = by_mf.get(mf)
            if r is None:
                continue
            track = TrackMetadata(
                track_id=str(r.id),
                title=r.title,
                title_display=r.title_display,
                artist=r.artist_display,
                album=r.album,
                year=r.year,
                genre=r.genre,
                duration_sec=(r.duration_ms or 0) / 1000.0,
                file_path=r.path,
                lyrics=r.lyrics,
                cover_art_path=r.cover_image_id,
                primary_artist_slug=r.primary_artist_slug,
            )
            hit = TrackHit(track=track, score=score, matched_on=matched_on, lyrics=r.lyrics)  # type: ignore[arg-type]
            out.append((mf, hit))
        return out


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


def _like_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
