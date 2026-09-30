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
            out.append(TrackHit(track=track, score=score, matched_on=matched_on, lyrics=r.lyrics))  # type: ignore[arg-type]
        return out
