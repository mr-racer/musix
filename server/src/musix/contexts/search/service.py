"""`GET /search` (spec §4): sections run concurrently.

- **Catalog** — Postgres, not a Python BM25 over a full scroll: `musix_key` (v1's fold +
  Cyrillic→Latin) on both sides, trigram similarity / word similarity (typos, prefixes,
  transliteration), and v1's bonuses — exact name +0.6, prefix +0.3, history ≤ +0.25 —
  so an exact name always beats a partial match lifted by plays.
- **Lyrics** — v1's hybrid: Qdrant dense (limit 15, score ≥ 0.4) + BM25 (limit 25), RRF
  fusion, the dense query vector from `ml` at interactive priority; plus, for Russian
  typed in Latin letters, a BM25 leg on its Cyrillic reading (gate 4.1 translit
  recall@10 0.69 → 0.84, the other kinds unchanged).
- **Sound** — CLAP text → the pooled `clap` vector (limit 15, score ≥ 0.01), as v1.
Every Qdrant query carries the `owners` filter; hits are content ids mapped to the
account's own track ids in one query."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import sqlalchemy as sa
from qdrant_client import AsyncQdrantClient, models
from sqlalchemy.dialects.postgresql import JSONB

from musix.contexts.library.models import tracks
from musix.contexts.screens import service as screens
from musix.contexts.search import schemas as S
from musix.contexts.search.translit import as_cyrillic
from musix.errors import Unavailable
from musix.infra.ml_client import MlClient
from musix.infra.vectors import BM25, TRACKS, owned_by

_CATALOG = sa.text("""
WITH q AS (SELECT musix_key(:q) AS k),
hist AS (SELECT coalesce(max(plays), 0) AS mx FROM account_track_stats WHERE account_id = :a),
songs AS (
    SELECT 'song'::text AS type, t.id, coalesce(t.title_display, t.title) AS name,
           t.artist_display AS artist, musix_key(coalesce(t.title_display, t.title)) AS key,
           musix_key(t.title) AS raw, coalesce(st.plays, 0)::bigint AS plays
    FROM tracks t CROSS JOIN q
    LEFT JOIN account_track_stats st ON st.account_id = t.account_id AND st.track_id = t.id
    WHERE t.account_id = :a AND t.deleted_at IS NULL
      AND (musix_key(coalesce(t.title_display, t.title)) % q.k
           OR q.k <% musix_key(coalesce(t.title_display, t.title))
           OR musix_key(coalesce(t.title_display, t.title)) LIKE q.k || '%'
           OR musix_key(t.title) % q.k OR q.k <% musix_key(t.title))
),
albums_ AS (
    SELECT 'album'::text, al.id, al.title, min(ar.name), musix_key(al.title), NULL::text,
           sum(coalesce(st.plays, 0))::bigint
    FROM albums al CROSS JOIN q
    JOIN tracks t ON t.album_id = al.id AND t.account_id = :a AND t.deleted_at IS NULL
    LEFT JOIN artists ar ON ar.id = al.album_artist_id
    LEFT JOIN account_track_stats st ON st.account_id = t.account_id AND st.track_id = t.id
    WHERE musix_key(al.title) % q.k OR q.k <% musix_key(al.title)
       OR musix_key(al.title) LIKE q.k || '%'
    GROUP BY al.id, al.title
),
artists_ AS (
    SELECT 'artist'::text, ar.id, ar.name, NULL::text, musix_key(ar.name), NULL::text,
           sum(coalesce(st.plays, 0))::bigint
    FROM artists ar CROSS JOIN q
    JOIN track_artists ta ON ta.artist_id = ar.id
    JOIN tracks t ON t.id = ta.track_id AND t.account_id = :a AND t.deleted_at IS NULL
    LEFT JOIN account_track_stats st ON st.account_id = t.account_id AND st.track_id = t.id
    WHERE musix_key(ar.name) % q.k OR q.k <% musix_key(ar.name)
       OR musix_key(ar.name) LIKE q.k || '%'
    GROUP BY ar.id, ar.name
),
hits AS (SELECT * FROM songs UNION ALL SELECT * FROM albums_ UNION ALL SELECT * FROM artists_),
scored AS (
    SELECT h.*, (
        SELECT max(
            -- the mean, not the max, of the two: word similarity alone ties "Pearls"
            -- with "Peace of Mind" for "pea"; plain similarity keeps the shorter name ahead
            (similarity(k, q.k) + word_similarity(q.k, k)) / 2
            + CASE WHEN k = q.k THEN 0.6 WHEN k LIKE q.k || '%' THEN 0.3 ELSE 0 END)
        FROM unnest(ARRAY[h.key, h.raw]) AS k WHERE k IS NOT NULL
    ) AS name_score
    FROM hits h, q
)
SELECT s.type, s.id, s.name, s.artist,
    s.name_score
    + CASE WHEN hist.mx > 0 THEN least(0.25, 0.15 * ln(1 + s.plays) / ln(1 + hist.mx)) ELSE 0 END
      AS score
FROM scored s, hist
ORDER BY score DESC, s.type, length(s.key), s.name
LIMIT :limit
""")

LYRICS_DENSE, LYRICS_BM25, LYRICS_MIN = 15, 25, 0.4
SOUND_LIMIT, SOUND_MIN = 15, 0.01


async def catalog(c: screens.Ctx, q: str, limit: int) -> list[S.TopHit]:
    rows = await c.run(lambda s: s.execute(_CATALOG, {"q": q, "a": c.account_id, "limit": limit}))
    return [
        S.TopHit(type=r.type, id=r.id, name=r.name, artist=r.artist, score=float(r.score))
        for r in rows
    ]


def decades(years: list[int]) -> models.Filter | None:
    """«1990s,2000s» → a payload filter: any of those decades (v1's year facets)."""
    if not years:
        return None
    return models.Filter(
        should=[
            models.FieldCondition(key="year", range=models.Range(gte=d, lte=d + 9)) for d in years
        ]
    )


async def lyrics(
    q: AsyncQdrantClient,
    ml: MlClient,
    account: uuid.UUID,
    text: str,
    limit: int,
    years: list[int] | None = None,
) -> list[tuple[str, float]]:
    yf = decades(years or [])
    own = owned_by(account, [yf] if yf else [])
    dense = (await ml.embed_text([text], is_query=True, priority="interactive"))[0]
    legs = [
        models.Prefetch(
            query=dense.tolist(),
            using="text",
            limit=LYRICS_DENSE,
            score_threshold=LYRICS_MIN,
            filter=own,
        ),
        models.Prefetch(
            query=models.Document(text=text, model=BM25),
            using="bm25",
            limit=LYRICS_BM25,
            filter=own,
        ),
    ]
    if cyr := as_cyrillic(text):  # Russian typed in Latin: BM25 on its Cyrillic reading too
        legs.append(
            models.Prefetch(
                query=models.Document(text=cyr, model=BM25),
                using="bm25",
                limit=LYRICS_BM25,
                filter=own,
            )
        )
    res = await q.query_points(
        TRACKS,
        prefetch=legs,
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        limit=limit,
    )
    return [(str(p.id), float(p.score)) for p in res.points]


async def sound(
    q: AsyncQdrantClient,
    ml: MlClient,
    account: uuid.UUID,
    text: str,
    limit: int,
    years: list[int] | None = None,
) -> list[tuple[str, float]]:
    vec = (await ml.clap_text([text], priority="interactive"))[0]
    yf = decades(years or [])
    res = await q.query_points(
        TRACKS,
        query=vec.tolist(),
        using="clap",
        limit=min(limit, SOUND_LIMIT),
        score_threshold=SOUND_MIN,
        query_filter=owned_by(account, [yf] if yf else []),
    )
    return [(str(p.id), float(p.score)) for p in res.points]


async def _tracks_of(
    c: screens.Ctx, hits: list[tuple[str, float]]
) -> list[tuple[uuid.UUID, float]]:
    """Content ids → this account's own track ids, order kept."""
    if not hits:
        return []
    mfs = [uuid.UUID(h) for h, _ in hits]
    rows = await c.run(
        lambda s: s.execute(
            sa.select(tracks.c.media_file_id, tracks.c.id).where(
                tracks.c.account_id == c.account_id,
                tracks.c.deleted_at.is_(None),
                tracks.c.media_file_id.in_(mfs),
            )
        )
    )
    by = {mf: tid for mf, tid in rows}
    return [(by[uuid.UUID(h)], score) for h, score in hits if uuid.UUID(h) in by]


async def _filtered(
    c: screens.Ctx, ids: list[uuid.UUID], years: list[int], tags: list[str]
) -> set[uuid.UUID]:
    """The tracks among `ids` in one of `years` (decades) carrying all of `tags`."""
    if not ids:
        return set()
    from musix.contexts.library.models import media_files

    q = (
        sa.select(tracks.c.id)
        .join(media_files, media_files.c.id == tracks.c.media_file_id)
        .where(tracks.c.id.in_(ids))
    )
    if years:
        q = q.where(sa.or_(*(tracks.c.year.between(d, d + 9) for d in years)))
    if tags:
        q = q.where(media_files.c.sonic_tags.op("@>")(sa.cast(tags, JSONB)))
    rows = await c.run(lambda s: s.execute(q))
    return {r[0] for r in rows}


async def facets(c: screens.Ctx) -> S.FacetsOut:
    """The chips of the search filters: decades and sonic tags with their track counts."""
    from musix.contexts.library.models import media_files

    async def run(s: Any) -> S.FacetsOut:
        dec = await s.execute(
            sa.select((tracks.c.year - tracks.c.year % 10).label("d"), sa.func.count())
            .where(
                tracks.c.account_id == c.account_id,
                tracks.c.deleted_at.is_(None),
                tracks.c.year > 0,
            )
            .group_by("d")
            .order_by("d")
        )
        tag = (
            sa.func.jsonb_array_elements_text(media_files.c.sonic_tags)
            .table_valued("value")
            .alias("t")
        )
        tg = await s.execute(
            sa.select(tag.c.value, sa.func.count())
            .select_from(
                tracks.join(media_files, media_files.c.id == tracks.c.media_file_id).join(
                    tag, sa.true()
                )
            )
            .where(tracks.c.account_id == c.account_id, tracks.c.deleted_at.is_(None))
            .group_by(tag.c.value)
            .order_by(sa.func.count().desc())
            .limit(30)
        )
        return S.FacetsOut(
            decades=[S.Facet(value=f"{int(d)}s", count=n) for d, n in dec],
            tags=[S.Facet(value=v, count=n) for v, n in tg],
        )

    return await c.run(run)


async def _none() -> list[Any]:
    return []


async def search(
    c: screens.Ctx,
    q: AsyncQdrantClient,
    ml: MlClient,
    text: str,
    limit: int,
    sections: set[str] = frozenset({"catalog", "lyrics", "sound"}),  # type: ignore[assignment]
    years: list[int] | None = None,
    tags: list[str] | None = None,
) -> S.SearchOut:
    degraded: list[str] = []

    async def leg(name: str, coro: Any) -> list[tuple[str, float]]:
        try:
            return await coro  # type: ignore[no-any-return]
        except Unavailable:
            degraded.append(name)  # the model host is down: the other sections still answer
            return []

    top, lyr, snd = await asyncio.gather(
        catalog(c, text, max(limit, 12)) if "catalog" in sections else _none(),
        leg("lyrics", lyrics(q, ml, c.account_id, text, limit, years))
        if "lyrics" in sections
        else _none(),
        leg("sound", sound(q, ml, c.account_id, text, limit, years))
        if "sound" in sections
        else _none(),
    )
    lyr_t, snd_t = await asyncio.gather(_tracks_of(c, lyr), _tracks_of(c, snd))
    song_ids = [h.id for h in top if h.type == "song"][:limit]
    album_ids = [h.id for h in top if h.type == "album"][:limit]
    artist_ids = [h.id for h in top if h.type == "artist"][:limit]
    all_tracks, albums, artists = await asyncio.gather(
        c.tracks(list(dict.fromkeys([*song_ids, *(t for t, _ in lyr_t), *(t for t, _ in snd_t)]))),
        screens.albums_by_ids(c, album_ids) if album_ids else _none(),
        screens.artists_by_ids(c, artist_ids) if artist_ids else _none(),
    )
    by = {t.id: t for t in all_tracks}
    if years or tags:  # the sound and year filters (v1's search chips) also narrow the catalog hits
        keep = await _filtered(c, list(by), years or [], tags or [])
        by = {i: t for i, t in by.items() if i in keep}
    rank_a = {a: i for i, a in enumerate(album_ids)}
    rank_r = {a: i for i, a in enumerate(artist_ids)}
    albums = sorted(albums, key=lambda a: rank_a[a.id])
    artists = sorted(artists, key=lambda a: rank_r[a.id])
    imgs = await c.images(
        [
            *(t.cover_image_id for t in all_tracks),
            *(a.cover_image_id for a in albums),
            *(a.image_id for a in artists),
        ]
    )
    return S.SearchOut(
        query=text,
        top=top[:limit],
        tracks=[by[i] for i in song_ids if i in by],
        albums=albums,
        artists=artists,
        lyrics=[S.Scored(track=by[t], score=sc) for t, sc in lyr_t if t in by],
        sound=[S.Scored(track=by[t], score=sc) for t, sc in snd_t if t in by],
        images=imgs,
        degraded=degraded,
    )
