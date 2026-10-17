"""Screen shapes, composed from concurrent queries on separate pooled sessions.

A shape only ever holds the account's own tracks: every track query filters by
`account_id` here, and albums/artists are visible only through them."""

from __future__ import annotations

import asyncio
import datetime as dt
import re
import uuid
from collections import Counter
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any, TypeVar

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.knowledge.models import song_relations
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


async def home(
    c: Ctx,
    head: int | None = None,
    tz: int = 0,
    qdrant: Any = None,
    weather: S.WeatherOut | None = None,
) -> S.HomeOut:
    from musix.contexts.screens import picks, stats

    live = sa.select(T.id).where(T.id == St.track_id, T.deleted_at.is_(None))
    wave = asyncio.create_task(stats.wave(c))  # gather's typing stops at six
    anchor_ids = asyncio.create_task(stats.anchor_ids(c))
    recent_ids, added_ids, pls, cnt, vibe_rows, pulse = await asyncio.gather(
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
        stats.vibe_rows(c),
        stats.pulse(c, tz),
    )
    members = [uuid.UUID(m) for v in vibe_rows for m in v["members"]]
    album_picks = asyncio.create_task(picks.album_picks(c, qdrant, vibe_rows))
    strong = await anchor_ids
    both = await c.tracks(list(dict.fromkeys([*recent_ids, *added_ids, *members, *strong])))
    by = {t.id: t for t in both}
    recent = [by[i] for i in recent_ids if i in by]
    added = [by[i] for i in added_ids if i in by]
    anchors, seen = [], set()  # one per primary artist, as v1's islands were
    for i in strong:
        t = by.get(i)
        key = t.artists[0].id if t and t.artists else None
        if t is None or key in seen:
            continue
        seen.add(key)
        anchors.append(t)
        if len(anchors) == 5:
            break
    pls = pls[:12]
    chosen = await album_picks
    imgs = await c.images(
        [
            *_covers(both),
            *(p.cover_image_id for p in pls),
            *(a.album.cover_image_id for a in chosen),
        ]
    )
    return S.HomeOut(
        recent=recent,
        recently_added=added,
        anchors=anchors,
        playlists=pls,
        counts=cnt,
        vibes=await stats.vibes(c, vibe_rows, by),
        wave=await wave,
        pulse=pulse,
        album_picks=chosen,
        weather=weather,
        images=imgs,
    )


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

    async def album_plays(s: AsyncSession) -> list[Any]:
        # «слушаю чаще» on the album grid (the clients sort their offline mirror by it), and
        # the last listen of each album («Пластинка дня», «давно не ставил»)
        rows = await s.execute(
            sa.select(T.album_id, sa.func.sum(St.plays).label("n"), sa.func.max(St.last_played_at))
            .join(account_track_stats, (St.track_id == T.id) & (St.account_id == c.account_id))
            .where(c.live(), T.album_id.is_not(None))
            .group_by(T.album_id)
        )
        return list(rows)

    cnt, tot, gen, pl, ap, more = await asyncio.gather(
        counts(c, head),
        c.run(totals),
        c.run(genres),
        c.run(plays),
        c.run(album_plays),
        c.run(lambda s: summary_extra(s, c)),
    )
    plays_by = {str(a): int(n) for a, n, _ in ap if n}
    last_by = {str(a): last for a, n, last in ap if n and last is not None}
    loved = sorted(
        ((a, int(n), last) for a, n, last in ap if n and int(n) >= 8 and last is not None),
        key=lambda r: r[2],
    )[:8]
    pick = loved[dt.date.today().toordinal() % len(loved)] if loved else None
    return S.LibrarySummaryOut(
        album_last=last_by,
        album_cluster=more[0],
        clusters=more[1],
        artist_country=more[2],
        artist_plays=more[3],
        day_pick=S.DayPick(album_id=pick[0], plays=pick[1], last_played_at=pick[2])
        if pick
        else None,
        counts=cnt,
        duration_ms=int(tot[0]),
        first_added_at=tot[1],
        last_added_at=tot[2],
        genres=gen,
        album_plays=plays_by,
        plays=int(pl[0]),
        played_ms=int(pl[1]),
    )


async def summary_extra(
    s: AsyncSession, c: Ctx
) -> tuple[dict[str, int], list[S.ClusterName], dict[str, str], dict[str, int]]:
    """Each album's commonest sound cluster (the taste map's, by its songs) with the clusters'
    names, and each artist's country (ISO code, cleaned: UK → GB, junk dropped)."""
    from musix.contexts.screens.achievements import country
    from musix.contexts.stream.models import taste_maps

    data = await s.scalar(
        sa.select(taste_maps.c.data).where(taste_maps.c.account_id == c.account_id)
    )
    album_of = {
        tid: al
        for tid, al in await s.execute(
            sa.select(T.id, T.album_id).where(c.live(), T.album_id.is_not(None))
        )
    }
    votes: dict[Any, Counter[int]] = {}
    names: list[S.ClusterName] = []
    if data:
        for tid, cl in zip(data.get("trackIds") or [], data.get("cluster") or [], strict=False):
            al = album_of.get(uuid.UUID(str(tid)))
            if al is not None:
                votes.setdefault(al, Counter())[int(cl)] += 1
        names = [
            S.ClusterName(id=int(k["id"]), name=k.get("nameRu") or k.get("nameEn") or "")
            for k in data.get("clusters") or []
        ]
    cluster = {str(al): v.most_common(1)[0][0] for al, v in votes.items()}
    arts = await s.execute(
        sa.select(Ar.id, Ar.profile["countryCode"].astext).where(
            Ar.id.in_(sa.select(T.primary_artist_id).where(c.live()))
        )
    )
    land = {str(a): code for a, cc in arts if (code := country(cc))}
    plays = await s.execute(
        sa.select(T.primary_artist_id, sa.func.sum(St.plays))
        .join(account_track_stats, (St.track_id == T.id) & (St.account_id == c.account_id))
        .where(c.live(), T.primary_artist_id.is_not(None))
        .group_by(T.primary_artist_id)
    )
    return cluster, names, land, {str(a): int(n) for a, n in plays if n}


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
            original_year=r.original_year,
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
    ts, (plays, last), (producers, label) = await asyncio.gather(
        c.tracks(ids),
        _album_plays(c, ids),
        _album_credits(c, ids, cards[0].album_artist.name if cards[0].album_artist else ""),
    )
    imgs = await c.images([cards[0].cover_image_id, *_covers(ts)])
    return S.AlbumPageOut(
        album=cards[0],
        tracks=ts,
        images=imgs,
        track_plays=plays,
        last_played_at=last,
        producers=producers,
        label=label,
    )


async def _album_plays(c: Ctx, ids: list[uuid.UUID]) -> tuple[dict[str, int], Any]:
    if not ids:
        return {}, None
    q = sa.select(St.track_id, St.plays, St.last_played_at).where(
        St.account_id == c.account_id, St.track_id.in_(ids)
    )
    rows = (await c.run(lambda s: s.execute(q))).all()
    plays = {str(r.track_id): r.plays for r in rows if r.plays}
    last = max((r.last_played_at for r in rows if r.last_played_at), default=None)
    return plays, last


_SPLIT = re.compile(r",\s*|\s*&\s*")


async def _album_credits(
    c: Ctx, ids: list[uuid.UUID], artist: str
) -> tuple[list[S.AlbumCredit], str | None]:
    """Producers and the label summed over the album's songs. The web's relations carry
    noise: the album artist themself (a self-produced album says nothing), single tokens of
    their name ("West", "Kanye"), youtubers. A label row is often a distributor chain («G.O.O.D.
    Music, Roc-A-Fella Records & Def Jam»): its first name is the label."""
    if not ids:
        return [], None
    R = song_relations.c
    q = (
        sa.select(
            R.kind,
            R.target_text,
            sa.func.min(sa.cast(R.target_artist_id, sa.Text)).label("aid"),
            sa.func.count(sa.distinct(R.song_id)).label("n"),
        )
        .join(tracks, T.song_id == R.song_id)
        .where(T.id.in_(ids), R.kind.in_(("producer", "label")))
        .group_by(R.kind, R.target_text)
        .order_by(sa.desc("n"), R.target_text)
    )
    rows = (await c.run(lambda s: s.execute(q))).all()
    return clean_credits([(r.kind, r.target_text, r.aid, r.n) for r in rows], artist)


def clean_credits(
    rows: list[tuple[str, str, str | None, int]], artist: str
) -> tuple[list[S.AlbumCredit], str | None]:
    """(kind, text, artist id, songs) rows, most songs first → producers ≤4 and the label."""
    me = artist.casefold()
    parts = set(me.split())
    producers: list[S.AlbumCredit] = []
    for kind, text, aid, n in rows:
        name = text.strip()
        low = name.casefold()
        if kind != "producer" or low == me or low in parts or "youtube" in low:
            continue
        if n < 2 and len(producers) >= 2:
            continue
        aid_ = uuid.UUID(aid) if aid else None
        producers.append(S.AlbumCredit(name=name, artist_id=aid_, songs=n))
    label = next((_SPLIT.split(t)[0].strip() for k, t, _, _ in rows if k == "label"), None)
    return producers[:4], label or None


async def artists_by_ids(c: Ctx, ids: list[uuid.UUID]) -> list[S.ArtistOut]:
    """Only artists the account's own tracks or albums reference."""
    via_tracks = sa.select(Ta.artist_id).join(tracks, T.id == Ta.track_id).where(c.live())
    via_albums = sa.select(Al.album_artist_id).join(tracks, T.album_id == Al.id).where(c.live())
    q = sa.select(artists).where(
        Ar.id.in_(ids), sa.or_(Ar.id.in_(via_tracks), Ar.id.in_(via_albums))
    )
    rows = await c.run(lambda s: s.execute(q))
    return [S.ArtistOut.model_validate(r._mapping) for r in rows]


# «Ты и …»: the artist's own songs, heard and played; the artist's place among the library's
# artists by plays (ties share a place); the library's artists = those with songs of their own
_YOU = sa.text("""
WITH per AS (
  SELECT ta.artist_id, sum(coalesce(st.plays, 0)) AS p
  FROM tracks t JOIN track_artists ta ON ta.track_id = t.id AND ta.role = 'main'
  LEFT JOIN account_track_stats st ON st.account_id = t.account_id AND st.track_id = t.id
  WHERE t.account_id = :a AND t.deleted_at IS NULL GROUP BY ta.artist_id
), me AS (SELECT p FROM per WHERE artist_id = :ar)
SELECT (SELECT p FROM me) AS plays,
       (SELECT count(*) FROM per WHERE p > (SELECT p FROM me)) + 1 AS rank,
       (SELECT count(*) FROM per) AS artists,
       (SELECT count(*) FROM tracks t
          JOIN track_artists ta ON ta.track_id = t.id AND ta.artist_id = :ar AND ta.role = 'main'
          JOIN account_track_stats st ON st.account_id = t.account_id AND st.track_id = t.id
        WHERE t.account_id = :a AND t.deleted_at IS NULL AND st.plays > 0) AS heard
""")
_HEARD = sa.text("""
SELECT t.album_id, count(*) FILTER (WHERE st.plays > 0) AS heard
FROM tracks t
LEFT JOIN account_track_stats st ON st.account_id = t.account_id AND st.track_id = t.id
WHERE t.account_id = :a AND t.deleted_at IS NULL AND t.album_id = ANY(:albums)
GROUP BY t.album_id
""")
# the Grammy wins of the library's artists, from their bios (any language; Russian first)
_GRAMMY = sa.text("""
WITH lib AS (
  SELECT DISTINCT ta.artist_id FROM tracks t
  JOIN track_artists ta ON ta.track_id = t.id AND ta.role = 'main'
  WHERE t.account_id = :a AND t.deleted_at IS NULL
), w AS (
  SELECT DISTINCT ON (b.artist_id) b.artist_id,
         round((b.facets ->> 'grammy_wins')::numeric)::int AS wins,
         CASE WHEN jsonb_typeof(b.facets -> 'grammy_nominations') = 'number'
              THEN round((b.facets ->> 'grammy_nominations')::numeric)::int END AS noms
  FROM artist_bios b JOIN lib ON lib.artist_id = b.artist_id
  WHERE jsonb_typeof(b.facets -> 'grammy_wins') = 'number'
  ORDER BY b.artist_id, (b.lang = 'ru') DESC
), me AS (SELECT wins, noms FROM w WHERE artist_id = :ar)
SELECT (SELECT wins FROM me) AS wins, (SELECT noms FROM me) AS noms,
       (SELECT count(*) FROM w WHERE wins > 0) AS laureates,
       (SELECT count(*) FROM w WHERE wins > (SELECT wins FROM me)) + 1 AS position
""")


async def artist_page(c: Ctx, artist_id: uuid.UUID) -> S.ArtistPageOut:
    from musix.contexts.knowledge.service import subject_facts

    def by_role(role: str) -> sa.Select[Any]:
        return (
            sa.select(T.id)
            .join(track_artists, Ta.track_id == T.id)
            .where(c.live(), Ta.artist_id == artist_id, Ta.role == role)
        )

    args = {"a": c.account_id, "ar": artist_id}
    page = asyncio.gather(
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
        c.run(
            lambda s: s.execute(
                sa.select(Ar.profile, Ar.photo_id, Ar.wide_id, Ar.logo_id, Ar.editorial).where(
                    Ar.id == artist_id
                )
            )
        ),
    )
    mine = asyncio.gather(
        c.run(lambda s: s.execute(_YOU, args)),
        c.run(lambda s: s.execute(_GRAMMY, args)),
        c.run(lambda s: subject_facts(s, "artist", artist_id, "ru")),
    )
    (found, cards, top_ids, feat_ids, n, row), (you, grammy, facts) = await asyncio.gather(
        page, mine
    )
    if not found:
        raise NotFound("artist")
    r = row.first()
    profile, editorial = (r.profile if r else None) or {}, (r.editorial if r else None) or {}
    y, g = you.first(), grammy.first()
    album_ids = [a.id for a in cards]
    heard_rows = (
        await c.run(lambda s: s.execute(_HEARD, {"a": c.account_id, "albums": album_ids}))
        if album_ids
        else None
    )
    plays_rows = (
        await c.run(
            lambda s: s.execute(
                sa.select(St.track_id, St.plays).where(
                    St.account_id == c.account_id, St.track_id.in_(top_ids)
                )
            )
        )
        if top_ids
        else None
    )
    top, feat = await asyncio.gather(c.tracks(top_ids), c.tracks(feat_ids))
    photo, wide, logo = (r.photo_id, r.wide_id, r.logo_id) if r else (None, None, None)
    imgs = await c.images(
        [
            found[0].image_id,
            found[0].cutout_id,
            photo,
            wide,
            logo,
            *(a.cover_image_id for a in cards),
            *_covers(top),
            *_covers(feat),
        ]
    )
    plays = int(y.plays or 0) if y else 0
    return S.ArtistPageOut(
        artist=found[0],
        albums=cards,
        top_tracks=top,
        appears_on=feat,
        track_count=int(n or 0),
        images=imgs,
        country=profile.get("country"),
        country_code=profile.get("countryCode"),
        photo_id=photo,
        wide_id=wide,
        logo_id=logo,
        page_color=editorial.get("bg"),
        you=S.ArtistYou(
            plays=plays,
            heard_tracks=int(y.heard or 0) if y else 0,
            rank=int(y.rank) if y and plays > 0 else None,
            artists=int(y.artists or 0) if y else 0,
        ),
        heard={str(h.album_id): int(h.heard) for h in heard_rows or []},
        plays={str(p.track_id): int(p.plays) for p in plays_rows or []},
        grammy=S.GrammyOut(
            wins=int(g.wins),
            nominations=g.noms,
            position=int(g.position),
            laureates=int(g.laureates),
        )
        if g is not None and g.wins is not None
        else None,
        facts=facts[0][:8],
    )


async def player_context(c: Ctx, track_id: uuid.UUID, lang: str = "ru") -> S.PlayerContextOut:
    from musix.contexts.knowledge.service import track_knowledge

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

    ts, f, st, kn = await asyncio.gather(
        c.tracks([track_id]),
        c.run(file),
        c.run(stats),
        c.run(lambda s: track_knowledge(s, c.account_id, track_id, lang)),
    )
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
        knowledge=kn,
    )


async def albums_by_ids(c: Ctx, ids: list[uuid.UUID]) -> list[S.AlbumOut]:
    return await album_cards(c, Al.id.in_(ids))
