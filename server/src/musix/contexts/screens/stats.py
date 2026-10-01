"""The stats tab and the home page's «вайбики» / weekly pulse — v1's definitions, kept:
a listen «counts» for top lists unless it was an early skip; completion is
min(played / duration, 1); a finish is ≥ 90 % of the duration. Days and hours are the
listener's local ones, from the client's UTC offset (minutes, UTC+3 → 180)."""

from __future__ import annotations

import asyncio
import datetime as dt
import uuid
from collections import Counter
from typing import TYPE_CHECKING, Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.library.schemas import TrackOut
from musix.contexts.screens import schemas as S
from musix.contexts.stream.models import taste_maps, taste_profile

if TYPE_CHECKING:
    from musix.contexts.screens.service import Ctx

LOCAL = "((l.started_at AT TIME ZONE 'UTC') + make_interval(mins => :tz))"
WEEK_START = (
    "((date_trunc('week', (now() AT TIME ZONE 'UTC') + make_interval(mins => :tz))"
    " - make_interval(mins => :tz)) AT TIME ZONE 'UTC')"
)
LOVED_MIN_FINISHES, GUILTY_MIN_SKIPS, GUILTY_MAX_SECONDS, TOP_N = 2, 3, 10.0, 5

_PULSE = sa.text(f"""
WITH ev AS (
    SELECT l.track_id, l.played_ms, l.skipped_early, extract(isodow FROM {LOCAL})::int AS dow
    FROM listen_events l WHERE l.account_id = :a AND l.started_at >= {WEEK_START}
)
SELECT
    (SELECT coalesce(sum(played_ms), 0) FROM ev),
    (SELECT t.genre FROM ev JOIN tracks t ON t.id = ev.track_id
     WHERE NOT ev.skipped_early AND t.genre <> '' GROUP BY t.genre ORDER BY count(*) DESC, t.genre
     LIMIT 1),
    (SELECT count(*) FROM account_track_stats
     WHERE account_id = :a AND first_played_at >= {WEEK_START}),
    (SELECT array_agg(coalesce(d.ms, 0) ORDER BY g) FROM generate_series(1, 7) g
     LEFT JOIN (SELECT dow, sum(played_ms) AS ms FROM ev GROUP BY dow) d ON d.dow = g)
""")
_TOTALS = sa.text("""
SELECT coalesce(sum(played_ms), 0), min(started_at),
       avg(least(played_ms::float8 / duration_ms, 1)) FILTER (WHERE duration_ms > 0)
FROM listen_events WHERE account_id = :a
""")
_PER_TRACK = sa.text("""
SELECT track_id, count(*) AS plays,
       count(*) FILTER (WHERE NOT skipped_early) AS kept,
       avg(least(played_ms::float8 / duration_ms, 1)) FILTER (WHERE duration_ms > 0) AS comp,
       count(*) FILTER (WHERE duration_ms > 0 AND played_ms >= 0.9 * duration_ms) AS finishes,
       count(*) FILTER (WHERE skipped_early) AS skips,
       avg(played_ms / 1000.0) FILTER (WHERE skipped_early) AS skip_sec
FROM listen_events WHERE account_id = :a GROUP BY track_id
""")
_TOP_ARTIST = sa.text("""
SELECT t.primary_artist_id, count(*) AS n FROM listen_events l JOIN tracks t ON t.id = l.track_id
WHERE l.account_id = :a AND NOT l.skipped_early AND t.primary_artist_id IS NOT NULL
GROUP BY 1 ORDER BY n DESC LIMIT 1
""")
_DAYS = sa.text(f"""
SELECT {LOCAL}::date AS d, count(*) FROM listen_events l WHERE l.account_id = :a
GROUP BY 1 ORDER BY 1
""")
_HOURS = sa.text(f"""
SELECT extract(hour FROM {LOCAL})::int AS h, count(*), count(*) FILTER (WHERE NOT l.skipped_early)
FROM listen_events l WHERE l.account_id = :a GROUP BY 1
""")
_DAY_TOP = sa.text(f"""
SELECT l.track_id, count(*) AS n FROM listen_events l
WHERE l.account_id = :a AND NOT l.skipped_early AND {LOCAL}::date = :d
GROUP BY 1 ORDER BY n DESC, l.track_id LIMIT 1
""")

_LIBRARY = sa.text("""
SELECT t.genre, t.duration_ms, t.year, t.primary_artist_id, m.path
FROM tracks t LEFT JOIN media_files m ON m.id = t.media_file_id
WHERE t.account_id = :a AND t.deleted_at IS NULL
""")
FORMATS = {
    "flac": "FLAC", "mp3": "MP3", "m4a": "M4A", "aac": "AAC", "alac": "ALAC", "wav": "WAV",
    "aiff": "AIFF", "aif": "AIFF", "ogg": "OGG", "oga": "OGG", "opus": "OPUS", "wma": "WMA",
    "ape": "APE",
}  # fmt: skip
LOSSLESS = {"FLAC", "WAV", "AIFF", "ALAC", "APE"}


def duration_buckets(seconds: list[float]) -> list[str]:
    """v1 `_duration_range_buckets`: six IQR buckets over the library's own durations,
    labelled "lo-hi" in seconds (the client prints minutes)."""
    import numpy as np

    if not seconds:
        return []
    arr = np.array(seconds, dtype=float)
    p25, p50, p75 = (float(np.percentile(arr, q)) for q in (25, 50, 75))
    iqr = p50 - p25
    lower, upper = p25 - 1.5 * iqr, p75 + 1.5 * iqr

    def r(x: float) -> int:
        return round(x)

    labels = [
        f"0-{r(lower)}", f"{r(lower)}-{r(p25)}", f"{r(p25)}-{r(p50)}",
        f"{r(p50)}-{r(p75)}", f"{r(p75)}-{r(upper)}", f"{r(upper)}-{int(arr.max())}",
    ]  # fmt: skip

    def label(d: float) -> str:
        if d < lower:
            return labels[0]
        if d < p25:
            return labels[1]
        if d < p50:
            return labels[2]
        if d <= p75:
            return labels[3]
        if d <= upper:
            return labels[4]
        return labels[5]

    return [label(d) for d in seconds]


def _shares(counter: Counter[str], n: int) -> list[S.Share]:
    total = sum(counter.values()) or 1
    return [S.Share(key=k, count=v, pct=round(v / total * 100)) for k, v in counter.most_common(n)]


async def collection(c: Ctx) -> tuple[S.Collection, list[str | None]]:
    """«Карта коллекции» over the account's live tracks, and the artist photos it shows."""
    from musix.contexts.screens.service import artists_by_ids

    rows = list((await c.run(lambda s: s.execute(_LIBRARY, {"a": c.account_id}))).all())
    genres = Counter(str(g).strip() for g, *_ in rows if g and str(g).strip())
    durs = [ms / 1000 for _, ms, *_ in rows if ms]
    lengths = Counter(duration_buckets(durs))
    artists = Counter(a for *_, a, _ in rows if a)
    exts = (str(p or "").rsplit("/", 1)[-1] for *_, p in rows)
    formats = Counter(
        f for f in (FORMATS.get(e.rsplit(".", 1)[-1].lower()) for e in exts if "." in e) if f
    )
    decades: Counter[int] = Counter(
        (y // 10) * 10 for _, _, y, *_ in rows if y and 1900 <= y <= 2100
    )
    top = artists.most_common(5)
    found = {a.id: a for a in await artists_by_ids(c, [a for a, _ in top])}
    total_a = sum(artists.values()) or 1
    total_d = sum(decades.values()) or 1
    total_f = sum(formats.values())
    out = S.Collection(
        decades=[
            S.DecadeShare(decade=d, count=n, pct=round(n / total_d * 100))
            for d, n in sorted(decades.items())
        ],
        genres=_shares(genres, 5),
        durations=_shares(lengths, 6),
        artists=[
            S.ArtistShare(artist=found[a], count=n, pct=round(n / total_a * 100))
            for a, n in top
            if a in found
        ],
        formats=_shares(formats, 6),
        lossless_pct=round(sum(n for f, n in formats.items() if f in LOSSLESS) / total_f * 100)
        if total_f
        else 0,
    )
    return out, [a.artist.image_id for a in out.artists]


def local_today(tz: int) -> dt.date:
    return (dt.datetime.now(dt.UTC) + dt.timedelta(minutes=tz)).date()


async def pulse(c: Ctx, tz: int) -> S.WeeklyPulse:
    row = (await c.run(lambda s: s.execute(_PULSE, {"a": c.account_id, "tz": tz}))).one()
    return S.WeeklyPulse(
        played_ms=int(row[0]),
        top_genre=row[1],
        discoveries=int(row[2]),
        daily_ms=[int(x) for x in row[3]],
    )


async def vibe_rows(c: Ctx) -> list[dict[str, Any]]:
    got = await c.run(
        lambda s: s.scalar(
            sa.select(taste_profile.c.vibes).where(taste_profile.c.account_id == c.account_id)
        )
    )
    return list(got or [])


async def anchor_ids(c: Ctx) -> list[uuid.UUID]:
    """The taste profile's long-term positives, strongest first: v1's «якоря вкуса»."""
    got = await c.run(
        lambda s: s.scalar(
            sa.select(taste_profile.c.long_positives).where(
                taste_profile.c.account_id == c.account_id
            )
        )
    )
    return [uuid.UUID(str(t)) for t, _ in (got or [])[:30]]


async def wave(c: Ctx, lang: str = "ru") -> S.WaveOut | None:
    """The hero's phrase: the AI one when `stream:ai_texts` has written it for this
    language, else v1's instant deterministic phrase (no LLM on the request path)."""
    from musix.contexts.stream import ai_texts
    from musix.knowledge.stream_texts import deterministic_taste_vibe

    got = await c.run(
        lambda s: s.scalar(
            sa.select(taste_profile.c.wave).where(taste_profile.c.account_id == c.account_id)
        )
    )
    if not (got and got.get("phrase") and got.get("lang") == lang):
        islands, recent = await c.run(lambda s: ai_texts.inputs(s, c.account_id))
        got = deterministic_taste_vibe({"islands": islands}, recent, lang)
    return S.WaveOut(phrase=got["phrase"], source=got["source"]) if got.get("phrase") else None


async def vibes(
    c: Ctx, rows: list[dict[str, Any]], by: dict[uuid.UUID, TrackOut]
) -> list[S.VibeOut]:
    out = []
    for v in rows:
        ts = [by[m] for m in map(uuid.UUID, v["members"]) if m in by]
        if ts:
            out.append(S.VibeOut(id=v["track"], weight=v["weight"], name=v.get("name"), tracks=ts))
    return out


def streaks(days: list[dt.date], today: dt.date) -> tuple[int, int]:
    """(current, best): the current run ends today, or yesterday if nothing played yet."""
    have = set(days)
    best = run = 0
    prev: dt.date | None = None
    for d in sorted(have):
        run = run + 1 if prev is not None and (d - prev).days == 1 else 1
        best, prev = max(best, run), d
    probe = today if today in have else today - dt.timedelta(days=1)
    current = 0
    while probe in have:
        current, probe = current + 1, probe - dt.timedelta(days=1)
    return current, best


async def stats(c: Ctx, tz: int) -> S.StatsOut:
    p = {"a": c.account_id, "tz": tz}

    async def rows(q: sa.TextClause, s: AsyncSession) -> list[Any]:
        return list((await s.execute(q, p)).all())

    tot, per, art, days, hours, (library, faces) = await asyncio.gather(
        c.run(lambda s: rows(_TOTALS, s)),
        c.run(lambda s: rows(_PER_TRACK, s)),
        c.run(lambda s: rows(_TOP_ARTIST, s)),
        c.run(lambda s: rows(_DAYS, s)),
        c.run(lambda s: rows(_HOURS, s)),
        collection(c),
    )
    played_ms, since, overall = tot[0]
    top = max(per, key=lambda r: (r.kept, r.plays), default=None)
    loved = sorted(
        (r for r in per if r.finishes >= LOVED_MIN_FINISHES),
        key=lambda r: (r.finishes, r.comp or 0.0),
        reverse=True,
    )[:TOP_N]
    guilty = sorted(
        (
            r
            for r in per
            if r.skips >= GUILTY_MIN_SKIPS
            and r.skip_sec is not None
            and r.skip_sec < GUILTY_MAX_SECONDS
        ),
        key=lambda r: (r.skip_sec, -r.skips),
    )[:TOP_N]
    busiest = max(days, key=lambda r: r[1], default=None)
    day_top = None
    if busiest is not None:
        day = busiest[0]
        day_top = (await c.run(lambda s: s.execute(_DAY_TOP, {**p, "d": day}))).first()
    want = [r.track_id for r in [*([top] if top and top.kept else []), *loved, *guilty]]
    if day_top is not None:
        want.append(day_top[0])
    by = {t.id: t for t in await c.tracks(list(dict.fromkeys(want)))}

    def plays(tid: uuid.UUID, n: int) -> S.TrackPlays | None:
        return S.TrackPlays(track=by[tid], plays=n) if tid in by else None

    def engaged(r: Any) -> S.EngagedTrack | None:
        if r.track_id not in by:
            return None
        return S.EngagedTrack(
            track=by[r.track_id],
            plays=r.plays,
            completion=round(float(r.comp or 0.0), 3),
            finishes=r.finishes,
            skips=r.skips,
            skip_seconds=None if r.skip_sec is None else round(float(r.skip_sec), 1),
        )

    top_artist = None
    if art:
        from musix.contexts.screens.service import artists_by_ids

        found = await artists_by_ids(c, [art[0][0]])
        if found:
            top_artist = S.ArtistPlays(artist=found[0], plays=art[0][1])
    by_hour, kept_hour = [0] * 24, [0] * 24
    for h, n, k in hours:
        by_hour[h], kept_hour[h] = n, k
    current, best = streaks([d for d, _ in days], local_today(tz))
    loved_out = [e for e in map(engaged, loved) if e]
    guilty_out = [e for e in map(engaged, guilty) if e]
    top_track = plays(top.track_id, top.kept) if top is not None and top.kept else None
    images = await c.images(
        [
            *(t.cover_image_id for t in by.values()),
            top_artist.artist.image_id if top_artist else None,
            *faces,
        ]
    )
    return S.StatsOut(
        listening=S.Listening(
            played_ms=int(played_ms),
            since=since,
            top_track=top_track,
            top_artist=top_artist,
            peak_hour=max(range(24), key=lambda h: kept_hour[h]) if any(kept_hour) else None,
        ),
        rhythm=S.Rhythm(
            days=[S.DayCount(date=d, count=n) for d, n in days],
            by_hour=by_hour,
            streak_current=current,
            streak_best=best,
            busiest_day=S.BusiestDay(
                date=busiest[0],
                count=busiest[1],
                top_track=plays(day_top[0], day_top[1]) if day_top is not None else None,
            )
            if busiest is not None
            else None,
        ),
        engagement=S.Engagement(
            overall_completion=round(float(overall or 0.0), 3),
            loved=loved_out,
            guilty=guilty_out,
        ),
        images=images,
        collection=library,
    )


async def taste_map(c: Ctx) -> S.TasteMapOut:
    row = (
        await c.run(
            lambda s: s.execute(
                sa.select(taste_maps.c.data, taste_maps.c.updated_at).where(
                    taste_maps.c.account_id == c.account_id
                )
            )
        )
    ).first()
    if row is None:
        return S.TasteMapOut(track_ids=[], x=[], y=[], cluster=[], clusters=[], updated_at=None)
    return S.TasteMapOut.model_validate({**row.data, "updatedAt": row.updated_at})
