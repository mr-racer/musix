"""Achievements of the library's statistics (the owner's brief of 2026-10-11, design/code/
screens/library.md): ten rules over the listen history, each with a target, the best value so
far and the first local day the target was reached.

They are counted on the statistics tab and, in the background, after each batch of listens
(debounced per account). A rule reached for the first time is stored once and announced on
the realtime channel; the client shows the glass pop-up with its «бульк» on whatever screen it
is. The first count for an account stores what its history already earned without a word,
so nobody gets five pop-ups on the day this ships.

The rules are plain Python over one read of the account's events (thousands of rows): the
same counting the mock was checked with on the owner's real history."""

from __future__ import annotations

import asyncio
import collections
import datetime as dt
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
import structlog
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.screens import schemas as S
from musix.infra.changelog import notify
from musix.infra.tables import metadata

log = structlog.get_logger()
U = UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)

account_achievements = sa.Table(
    "account_achievements",
    metadata,
    sa.Column("account_id", U, primary_key=True),
    sa.Column("code", sa.Text, primary_key=True),
    sa.Column("earned_at", TS, nullable=False),
    sa.Column("note", sa.Text),
)
account_achievement_state = sa.Table(
    "account_achievement_state",
    metadata,
    sa.Column("account_id", U, primary_key=True),
    sa.Column("tz_minutes", sa.Integer, nullable=False),
    sa.Column("seeded_at", TS),
)

DEFAULT_TZ = 180  # the instance is Moscow's until a client says otherwise
MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября",
       "октября", "ноября", "декабря"]  # fmt: skip


@dataclass(frozen=True)
class Rule:
    code: str
    name: str
    line: str
    target: float
    unit: str = ""


RULES = [
    Rule("repeat", "На репите", "Одна песня пять раз за день", 5),
    Rule("marathon", "Марафонец", "Двести песен за один день", 200),
    Rule("picky", "Привереда", "Тридцать пропусков подряд", 30),
    Rule("night", "Ночная смена", "Двадцать песен между двумя и пятью ночи", 20),
    Rule("whole", "От корки до корки", "Альбом целиком, ни одного пропуска", 1),
    Rule("week", "Без выходных", "Семь дней подряд с музыкой", 7),
    Rule("unwrap", "Распаковщик", "Распечатать десять альбомов", 10),
    Rule("time", "Машина времени", "Пять десятилетий за один день", 5),
    Rule("one", "Однолюб", "Три часа одного артиста за день", 3, "ч"),
    Rule("globe", "Кругосветка", "Артисты из десяти стран за неделю", 10),
]
BY_CODE = {r.code: r for r in RULES}


def ru(d: dt.date) -> str:
    return f"{d.day} {MON[d.month - 1]}"


def times(n: int) -> str:
    x, y = n % 10, n % 100
    return "раз" if x == 1 and y != 11 else "раза" if 2 <= x <= 4 and not 12 <= y <= 14 else "раз"


def hours_ru(ms: int) -> str:
    return str(round(ms / 3.6e6, 1)).replace(".", ",")


def country(cc: str | None) -> str | None:
    c = (cc or "").strip().upper()
    if c == "UK":
        return "GB"
    return c if len(c) == 2 and c.isalpha() and c != "NY" else None


@dataclass
class Result:
    rule: Rule
    value: float
    first: dt.date | None
    note: str | None = None
    cover_image_id: str | None = None


@dataclass
class History:
    """What the rules read: events in local time, oldest first, and the library around them."""

    events: list[
        tuple[uuid.UUID, dt.datetime, int, bool]
    ]  # track, local time, played ms, skipped early
    track: dict[
        uuid.UUID, tuple[uuid.UUID | None, uuid.UUID | None, int | None, str]
    ]  # album, artist, year, title
    cover: dict[uuid.UUID, str | None]  # track → cover image
    album: dict[
        uuid.UUID, tuple[str, int, dt.date | None, str | None]
    ]  # title, live tracks, added (local), cover
    artist: dict[uuid.UUID, tuple[str, str | None]]  # name, country


def first_day(per_day: Mapping[Any, float], target: float) -> Any:
    return next((d for d in sorted(per_day) if per_day[d] >= target), None)


def evaluate(h: History) -> list[Result]:
    ev = [e for e in h.events if e[0] in h.track]
    good = [e for e in ev if not e[3]]
    out: dict[str, Result] = {}

    def put(
        code: str, value: float, first: Any, note: str | None = None, cover: str | None = None
    ) -> None:
        out[code] = Result(BY_CODE[code], value, first, note, cover)

    # one song five times in a day
    rep = collections.Counter((e[1].date(), e[0]) for e in good)
    if rep:
        (rd, rt), rv = rep.most_common(1)[0]
        best_day: dict[dt.date, int] = {}
        for (d, _), n in rep.items():
            best_day[d] = max(best_day.get(d, 0), n)
        put(
            "repeat",
            rv,
            first_day(best_day, 5),
            f"«{h.track[rt][3]}» · {rv} {times(rv)} за {ru(rd)}",
            h.cover.get(rt),
        )
    else:
        put("repeat", 0, None)
    # two hundred songs in a day
    per_day = collections.Counter(e[1].date() for e in good)
    md = max(per_day, key=lambda d: per_day[d], default=None)
    put(
        "marathon",
        per_day[md] if md else 0,
        first_day(per_day, 200),
        f"рекорд — {per_day[md]} за {ru(md)}" if md else None,
    )
    # thirty skips in a row
    run = best = 0
    first_skip: dt.date | None = None
    for e in ev:
        run = run + 1 if e[3] else 0
        best = max(best, run)
        if run == 30 and first_skip is None:
            first_skip = e[1].date()
    put("picky", best, first_skip, f"рекорд — {best} подряд" if best else None)
    # twenty songs between two and five at night
    night = collections.Counter(e[1].date() for e in good if 2 <= e[1].hour < 5)
    put(
        "night",
        max(night.values(), default=0),
        first_day(night, 20),
        f"рекорд — {max(night.values())} за ночь" if night else None,
    )
    # a whole album in a day, nothing skipped (albums of six songs or more)
    seen: dict[tuple[dt.date, uuid.UUID], set[uuid.UUID]] = collections.defaultdict(set)
    for e in good:
        al = h.track[e[0]][0]
        if al is not None:
            seen[(e[1].date(), al)].add(e[0])
    whole = sorted(
        (d, al)
        for (d, al), s in seen.items()
        if al in h.album and h.album[al][1] >= 6 and len(s) >= h.album[al][1]
    )
    if whole:
        put(
            "whole",
            len({al for _, al in whole}),
            whole[0][0],
            f"«{h.album[whole[0][1]][0]}»",
            h.album[whole[0][1]][3],
        )
    else:
        put("whole", 0, None)
    # seven days in a row
    days = sorted({e[1].date() for e in ev})
    streak = longest = 0
    week_first: dt.date | None = None
    prev: dt.date | None = None
    for d in days:
        streak = streak + 1 if prev and (d - prev).days == 1 else 1
        prev = d
        longest = max(longest, streak)
        if streak == 7 and week_first is None:
            week_first = d
    put("week", longest, week_first, f"рекорд — {longest} дней" if longest else None)
    # ten albums unwrapped: first heard on a later day than the album came into the library
    first_play: dict[uuid.UUID, dt.date] = {}
    for e in good:
        al = h.track[e[0]][0]
        if al is not None and al not in first_play:
            first_play[al] = e[1].date()
    late = sorted(
        d
        for al, d in first_play.items()
        if (came := h.album.get(al, ("", 0, None, None))[2]) and d > came
    )
    put("unwrap", len(late), late[9] if len(late) >= 10 else None, f"распечатано {len(late)}")
    # five decades in a day
    decs: dict[dt.date, set[int]] = collections.defaultdict(set)
    for e in good:
        y = h.track[e[0]][2]
        if y:
            decs[e[1].date()].add(y // 10)
    dv = {d: len(s) for d, s in decs.items()}
    put(
        "time",
        max(dv.values(), default=0),
        first_day(dv, 5),
        f"рекорд — {max(dv.values())} за день" if dv else None,
    )
    # three hours of one artist in a day
    am: collections.Counter[tuple[dt.date, uuid.UUID]] = collections.Counter()
    for e in ev:
        ar = h.track[e[0]][1]
        if ar is not None:
            am[(e[1].date(), ar)] += e[2]
    if am:
        (ad, aa), av = am.most_common(1)[0]
        hours_day: dict[dt.date, float] = {}
        for (d, _), ms in am.items():
            hours_day[d] = max(hours_day.get(d, 0.0), ms / 3.6e6)
        put(
            "one",
            round(av / 3.6e6, 1),
            first_day(hours_day, 3),
            f"{h.artist.get(aa, ('', None))[0]} · {hours_ru(av)} ч за {ru(ad)}",
        )
    else:
        put("one", 0, None)
    # artists from ten countries in a week
    wk: dict[tuple[int, int], set[str]] = collections.defaultdict(set)
    wk_last: dict[tuple[int, int], dt.date] = {}
    for e in good:
        ar = h.track[e[0]][1]
        c = h.artist.get(ar, ("", None))[1] if ar else None
        if c:
            key = e[1].isocalendar()[:2]
            wk[key].add(c)
            if len(wk[key]) == 10 and key not in wk_last:
                wk_last[key] = e[1].date()
    gv = max((len(s) for s in wk.values()), default=0)
    put(
        "globe",
        gv,
        min(wk_last.values()) if wk_last else None,
        f"рекорд — {gv} стран за неделю" if gv else None,
    )
    return [out[r.code] for r in RULES]


_EVENTS = sa.text("""
SELECT l.track_id, (l.started_at AT TIME ZONE 'UTC') + make_interval(mins => :tz),
       l.played_ms, l.skipped_early
FROM listen_events l WHERE l.account_id = :a ORDER BY l.started_at
""")
_TRACKS = sa.text("""
SELECT t.id, t.album_id, t.primary_artist_id, t.year, coalesce(t.title_display, t.title),
       t.cover_image_id, t.deleted_at IS NULL,
       (t.added_at AT TIME ZONE 'UTC') + make_interval(mins => :tz)
FROM tracks t WHERE t.account_id = :a
""")
_ALBUMS = sa.text("SELECT id, title, cover_image_id FROM albums WHERE id = ANY(:ids)")
_ARTISTS = sa.text("SELECT id, name, profile->>'countryCode' FROM artists WHERE id = ANY(:ids)")


async def history(s: AsyncSession, account_id: uuid.UUID, tz: int) -> History:
    p = {"a": account_id, "tz": tz}
    events = [(r[0], r[1], int(r[2] or 0), bool(r[3])) for r in await s.execute(_EVENTS, p)]
    track: dict[uuid.UUID, tuple[Any, Any, Any, str]] = {}
    cover: dict[uuid.UUID, str | None] = {}
    size: collections.Counter[uuid.UUID] = collections.Counter()
    added: dict[uuid.UUID, dt.date] = {}
    for tid, al, ar, year, title, cov, live, at in await s.execute(_TRACKS, p):
        track[tid] = (al, ar, year, title)
        cover[tid] = cov
        if al is not None and live:
            size[al] += 1
            d = at.date()
            added[al] = min(added.get(al, d), d)
    album = {
        r[0]: (r[1], size[r[0]], added.get(r[0]), r[2])
        for r in await s.execute(_ALBUMS, {"ids": list(size)})
    }
    ars = list({v[1] for v in track.values() if v[1] is not None})
    artist = {r[0]: (r[1], country(r[2])) for r in await s.execute(_ARTISTS, {"ids": ars})}
    return History(events, track, cover, album, artist)


async def tz_of(s: AsyncSession, account_id: uuid.UUID) -> int:
    tz = await s.scalar(
        sa.select(account_achievement_state.c.tz_minutes).where(
            account_achievement_state.c.account_id == account_id
        )
    )
    return DEFAULT_TZ if tz is None else int(tz)


def to_out(r: Result) -> S.AchievementOut:
    return S.AchievementOut(
        code=r.rule.code,
        name=r.rule.name,
        line=r.rule.line,
        target=r.rule.target,
        unit=r.rule.unit,
        value=r.value,
        earned_on=r.first,
        note=r.note,
        cover_image_id=r.cover_image_id,
    )


async def states(
    sm: async_sessionmaker[AsyncSession], account_id: uuid.UUID, tz: int
) -> list[S.AchievementOut]:
    """For the statistics tab: every rule with its best value and the day it was earned."""
    async with sm() as s:
        return [to_out(r) for r in evaluate(await history(s, account_id, tz))]


async def check(sm: async_sessionmaker[AsyncSession], account_id: uuid.UUID) -> list[str]:
    """Store what is newly earned; announce it unless this is the account's first count."""
    async with sm() as s:
        st = account_achievement_state.c
        row = (
            await s.execute(
                sa.select(st.tz_minutes, st.seeded_at).where(st.account_id == account_id)
            )
        ).first()
        tz = DEFAULT_TZ if row is None else int(row.tz_minutes)
        seeded = row is not None and row.seeded_at is not None
        results = evaluate(await history(s, account_id, tz))
        aa = account_achievements.c
        have: set[str] = set(
            (await s.scalars(sa.select(aa.code).where(aa.account_id == account_id))).all()
        )
        new = [r for r in results if r.first is not None and r.rule.code not in have]
        now = dt.datetime.now(dt.UTC)
        for r in new:
            at = now if seeded else dt.datetime.combine(r.first, dt.time(12), dt.UTC)  # type: ignore[arg-type]
            await s.execute(
                pg_insert(account_achievements)
                .values(account_id=account_id, code=r.rule.code, earned_at=at, note=r.note)
                .on_conflict_do_nothing()
            )
        await s.execute(
            pg_insert(account_achievement_state)
            .values(account_id=account_id, tz_minutes=tz, seeded_at=now)
            .on_conflict_do_update(
                index_elements=["account_id"],
                set_={"seeded_at": sa.func.coalesce(st.seeded_at, now)},
            )
        )
        if seeded:
            for r in new:
                await notify(
                    s,
                    account_id,
                    "achievement",
                    code=r.rule.code,
                    name=r.rule.name,
                    line=r.rule.line,
                    note=r.note,
                    coverImageId=r.cover_image_id,
                )
        await s.commit()
        return [r.rule.code for r in new] if seeded else []


async def remember_tz(sm: async_sessionmaker[AsyncSession], account_id: uuid.UUID, tz: int) -> None:
    """The offset a client reports on the home or the statistics, kept for the rules' local days."""
    if _tz_seen.get(account_id) == tz:
        return
    _tz_seen[account_id] = tz
    async with sm() as s:
        await s.execute(
            pg_insert(account_achievement_state)
            .values(account_id=account_id, tz_minutes=tz)
            .on_conflict_do_update(index_elements=["account_id"], set_={"tz_minutes": tz})
        )
        await s.commit()


# after a batch of listens: one count at a time per account, at most every MIN_GAP seconds,
# and a batch that lands during a count asks for one more count after it
MIN_GAP = 20.0
_tz_seen: dict[uuid.UUID, int] = {}
_running: dict[uuid.UUID, asyncio.Task[None]] = {}
_again: set[uuid.UUID] = set()
_last: dict[uuid.UUID, float] = {}


def schedule(sm: async_sessionmaker[AsyncSession], account_id: uuid.UUID) -> None:
    if account_id in _running:
        _again.add(account_id)
        return

    async def go() -> None:
        try:
            while True:
                wait = MIN_GAP - (time.monotonic() - _last.get(account_id, 0.0))
                if wait > 0:
                    await asyncio.sleep(wait)
                _last[account_id] = time.monotonic()
                _again.discard(account_id)
                earned = await check(sm, account_id)
                if earned:
                    log.info("achievements.earned", account=str(account_id), codes=earned)
                if account_id not in _again:
                    break
        except Exception:  # never let a count break listening
            log.exception("achievements.check_failed", account=str(account_id))
        finally:
            _running.pop(account_id, None)

    _running[account_id] = asyncio.get_running_loop().create_task(go())
