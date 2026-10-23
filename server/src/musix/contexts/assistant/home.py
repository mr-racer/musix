"""The assistant page at rest: the questions on the orbit, the carousel of hooks and the
sky of questions asked before. Built per listener by SQL over their own listens, credits,
facts and bios. No LLM is called here: the owner pays for a model only when a question is
actually asked (design/code/preferences.md, 2026-10-15 and 2026-10-23).

Every orbit question and card carries a `hint` — what the server already knows about it
(the kind and the subject's id). The client echoes it back in `POST /assistant/turns`, and
the turn skips the planner, often the model altogether (`fast.py`)."""

from __future__ import annotations

import datetime as dt
import random
import re
import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from musix.assistant.humanize import plural_ru
from musix.contexts.search.normalize import fold

# The listener's tracks with their listens: every query below starts here.
_MINE = """mine AS (
  SELECT t.id AS track_id, t.song_id, t.title, t.cover_image_id, t.primary_artist_id,
         t.album_id, t.media_file_id, coalesce(st.listens, 0) AS listens, st.last_played_at
  FROM tracks t LEFT JOIN account_track_stats st ON st.track_id = t.id AND st.account_id = :a
  WHERE t.account_id = :a AND t.deleted_at IS NULL)"""

_TOP_ARTISTS = sa.text(f"""WITH {_MINE}
SELECT ar.id, ar.slug, ar.name, coalesce(ar.photo_id, ar.image_id, ar.cutout_id) AS image_id,
       s.listens, s.last_heard_at,
       (SELECT m.cover_image_id FROM mine m WHERE m.primary_artist_id = ar.id AND m.cover_image_id IS NOT NULL
        ORDER BY m.listens DESC LIMIT 1) AS cover_id
FROM account_artist_stats s JOIN artists ar ON ar.id = s.artist_id
WHERE s.account_id = :a AND s.listens > 0
ORDER BY s.listens DESC LIMIT 40""")

_NAME_ORIGINS = sa.text("""SELECT artist_id, facets->>'name_origin' AS origin
FROM artist_bios WHERE lang = :lang AND artist_id = ANY(:ids) AND coalesce(facets->>'name_origin', '') <> ''""")

# One fact per (song, label), from the song's most-listened track.
_SONG_FACTS = sa.text(f"""WITH {_MINE}
SELECT DISTINCT ON (m.song_id, l.label) m.track_id, m.title, ar.name AS artist, ar.slug AS artist_slug,
       m.cover_image_id, m.listens, l.label, r.text
FROM fact_refinements r JOIN facts f ON f.id = r.fact_id
JOIN mine m ON f.subject_kind = 'song' AND f.subject_id = m.song_id
LEFT JOIN artists ar ON ar.id = m.primary_artist_id
CROSS JOIN LATERAL jsonb_array_elements_text(r.labels) AS l(label)
WHERE r.lang = :lang AND r.text IS NOT NULL AND l.label = ANY(:labels) AND m.listens >= 2
ORDER BY m.song_id, l.label, m.listens DESC, length(r.text)""")

# A producer credited on songs of several of the listener's artists (not their own songs).
_PRODUCERS = sa.text(f"""WITH {_MINE}
SELECT max(r.target_text) AS name, count(DISTINCT m.track_id) AS n, count(DISTINCT m.primary_artist_id) AS m,
       array_agg(DISTINCT m.primary_artist_id) AS artist_ids, sum(m.listens) AS listens
FROM song_relations r JOIN mine m ON m.song_id = r.song_id
LEFT JOIN artists own ON own.id = m.primary_artist_id
WHERE r.kind = 'producer' AND lower(r.target_text) <> lower(coalesce(own.name, ''))
GROUP BY lower(r.target_text)
HAVING count(DISTINCT m.primary_artist_id) >= 3
ORDER BY count(DISTINCT m.primary_artist_id) DESC, count(DISTINCT m.track_id) DESC LIMIT 8""")

_GUESTS = sa.text(f"""WITH {_MINE}
SELECT g.id, g.slug, g.name, coalesce(g.photo_id, g.image_id, g.cutout_id) AS image_id,
       count(DISTINCT m.track_id) AS n, count(DISTINCT m.primary_artist_id) AS m,
       array_agg(DISTINCT m.primary_artist_id) AS artist_ids
FROM track_artists ta JOIN mine m ON m.track_id = ta.track_id JOIN artists g ON g.id = ta.artist_id
WHERE ta.role = 'feat' AND ta.artist_id <> m.primary_artist_id
GROUP BY g.id HAVING count(DISTINCT m.primary_artist_id) >= 2
ORDER BY count(DISTINCT m.primary_artist_id) DESC, sum(m.listens) DESC LIMIT 4""")

_ALBUMS = sa.text(f"""WITH {_MINE}
SELECT al.id, al.title, coalesce(al.original_year, al.year) AS year, ar.name AS artist, ar.slug AS artist_slug,
       al.cover_image_id, sum(m.listens) AS listens
FROM mine m JOIN albums al ON al.id = m.album_id LEFT JOIN artists ar ON ar.id = al.album_artist_id
WHERE coalesce(al.original_year, al.year) = ANY(:years)
GROUP BY al.id, ar.name, ar.slug HAVING sum(m.listens) >= 5
ORDER BY sum(m.listens) DESC LIMIT 4""")

_COVERS = sa.text(f"""WITH {_MINE}
SELECT DISTINCT ON (m.primary_artist_id) m.primary_artist_id, m.cover_image_id
FROM mine m WHERE m.primary_artist_id = ANY(:ids) AND m.cover_image_id IS NOT NULL
ORDER BY m.primary_artist_id, m.listens DESC""")

_NAMES = sa.text("SELECT id, name FROM artists WHERE id = ANY(:ids)")

# The most-heard track of the last month outside the top artist: «похожее по звуку на…».
_RECENT_FAV = sa.text(f"""WITH {_MINE}
SELECT m.track_id, m.title, m.listens FROM mine m
WHERE m.last_played_at > now() - interval '30 days' AND m.primary_artist_id IS DISTINCT FROM :skip
ORDER BY m.listens DESC LIMIT 1""")

# Lines of the most-listened songs, for one lyrics example on the orbit.
_LYRIC_SOURCES = sa.text(f"""WITH {_MINE}
SELECT m.title, ly.text FROM mine m JOIN lyrics ly ON ly.media_file_id = m.media_file_id
WHERE ly.text IS NOT NULL AND length(ly.text) > 200
ORDER BY m.listens DESC LIMIT 12""")

_SKY = sa.text("""SELECT request->>'message' AS q, result->>'intent' AS intent, created_at
FROM assistant_turns WHERE account_id = :a AND kind = 'assistant' AND status = 'done'
  AND result->>'intent' IS NOT NULL
ORDER BY created_at DESC LIMIT 40""")


def _mood(hour: int) -> str:
    if 5 <= hour < 11:
        return "Что-нибудь бодрое для утра"
    if 11 <= hour < 18:
        return "Ровное и спокойное, чтобы работать"
    if 18 <= hour < 23:
        return "Что-нибудь спокойное на вечер"
    return "Тихое и ночное"


def _lyric_line(rows: list[Any], rnd: random.Random) -> str | None:
    """A line people remember: the most repeated one of a song (the hook), 18–60 chars,
    without the title in it (that would answer itself)."""
    for title, text in rows:
        counts: dict[str, int] = {}
        for raw in text.splitlines():
            line = raw.strip().strip(",.!?;:—-").strip()
            words = re.findall(r"\w+", line.lower())
            if not (18 <= len(line) <= 60) or line[:1] in "[(" or fold(title) in fold(line):
                continue
            if len(set(words)) < 4:  # «and they say, and they say» is a stutter, not a line
                continue
            counts[line] = counts.get(line, 0) + 1
        best = sorted(counts.items(), key=lambda kv: -kv[1])
        if best and best[0][1] >= 2:
            return best[0][0]
    return None


def _cut(text: str, limit: int) -> str | None:
    """A fact for a card: whole, or not at all (no ellipsis — the card stays honest)."""
    t = " ".join((text or "").split())
    return t if 0 < len(t) <= limit else None


async def build(
    s: AsyncSession, account_id: uuid.UUID, lang: str = "ru", hour: int | None = None
) -> dict[str, Any]:
    a = {"a": account_id}
    today = dt.date.today()
    # Shuffled per day: the page changes between days but not on every reload.
    rnd = random.Random(f"{account_id}:{today.isoformat()}")
    hour = dt.datetime.now().hour if hour is None else hour

    top = (await s.execute(_TOP_ARTISTS, a)).mappings().all()
    by_id = {r["id"]: r for r in top}
    origins = (
        (await s.execute(_NAME_ORIGINS, {"lang": lang, "ids": [r["id"] for r in top[:30]]})).all()
        if top
        else []
    )
    # facets carry formed_year for solo artists too: the origin text says which it is
    origin_of = {
        r.artist_id: (r.origin, not re.match(r"\s*(имя|псевдоним|прозвище)", r.origin, re.I))
        for r in origins
    }
    facts = (
        (
            await s.execute(
                _SONG_FACTS, {**a, "lang": lang, "labels": ["title_origin", "placement", "record"]}
            )
        )
        .mappings()
        .all()
    )
    by_label: dict[str, list[Any]] = {}
    for f in sorted(facts, key=lambda f: -f["listens"]):
        by_label.setdefault(f["label"], []).append(f)
    producers = (await s.execute(_PRODUCERS, a)).mappings().all()
    guests = (await s.execute(_GUESTS, a)).mappings().all()
    years = [today.year - k for k in (10, 20, 25, 30, 40, 50)]
    albums = (await s.execute(_ALBUMS, {**a, "years": years})).mappings().all()

    ids = {i for p in producers for i in p["artist_ids"] if i} | {
        i for g in guests for i in g["artist_ids"] if i
    }
    covers: dict[Any, Any] = (
        dict((await s.execute(_COVERS, {**a, "ids": list(ids)})).all()) if ids else {}
    )
    names: dict[Any, Any] = dict((await s.execute(_NAMES, {"ids": list(ids)})).all()) if ids else {}

    def hosts(artist_ids: list[Any]) -> list[Any]:
        """The host artists of a producer / guest, the most listened first."""
        return sorted(
            (i for i in artist_ids if i), key=lambda i: -(by_id[i]["listens"] if i in by_id else 0)
        )

    def named(artist_ids: list[Any], k: int = 3) -> str:
        hs = hosts(artist_ids)
        out = ", ".join(names.get(i, "?") for i in hs[:k])
        return out + (f" и ещё {len(hs) - k}" if len(hs) > k else "")

    def origin_q(r: Any) -> str:
        band = origin_of[r["id"]][1]
        return f"Откуда {'название' if band else 'имя'} {r['name']}?"

    # ── the orbit ────────────────────────────────────────────────────────
    orbit: list[dict[str, Any]] = []
    if top:
        r = top[0]
        orbit.append(
            {
                "q": f"Хиты {r['name']}",
                "intent": "playlist",
                "hint": {"kind": "hits", "artist_slug": r["slug"]},
            }
        )
    with_origin = [r for r in top[:30] if r["id"] in origin_of]
    for r in with_origin[:2]:
        orbit.append(
            {
                "q": origin_q(r),
                "intent": "general",
                "hint": {"kind": "about_artist", "artist_slug": r["slug"]},
            }
        )
    for f in by_label.get("title_origin", [])[:2]:
        orbit.append(
            {
                "q": f"Что значит название «{f['title']}»?",
                "intent": "general",
                "hint": {"kind": "about_song", "track_id": str(f["track_id"])},
            }
        )
    if producers:
        p = producers[0]
        orbit.append(
            {
                "q": f"Песни с продюсером {p['name']}",
                "intent": "playlist",
                "hint": {"kind": "producer", "name": p["name"]},
            }
        )
    orbit.append({"q": _mood(hour), "intent": "audio_search", "hint": {"kind": "mood"}})
    line = _lyric_line(list((await s.execute(_LYRIC_SOURCES, a)).all()), rnd)
    if line:
        orbit.append(
            {
                "q": f"Песня, где поётся «{line}»",
                "intent": "lyrics_search",
                "hint": {"kind": "lyrics"},
            }
        )
    fav = (await s.execute(_RECENT_FAV, {**a, "skip": top[0]["id"] if top else None})).first()
    if fav:
        orbit.append(
            {
                "q": f"Похожее по звуку на «{fav.title}»",
                "intent": "audio_search",
                "hint": {"kind": "similar", "track_id": str(fav.track_id)},
            }
        )
    for f in by_label.get("placement", [])[:1]:
        orbit.append(
            {
                "q": f"Где звучала «{f['title']}»?",
                "intent": "general",
                "hint": {"kind": "about_song", "track_id": str(f["track_id"])},
            }
        )

    # ── the carousel ─────────────────────────────────────────────────────
    groups: dict[str, list[dict[str, Any]]] = {}
    for p in producers[:4]:
        hs = hosts(p["artist_ids"])
        groups.setdefault("producer", []).append(
            {
                "kind": "producer",
                "kicker": "Продюсер",
                "title": p["name"],
                "line": named(p["artist_ids"]),
                "n": p["n"],
                "m": p["m"],
                "covers": [covers[i] for i in hs[:4] if covers.get(i)],
                "ask": f"Песни с продюсером {p['name']}",
                "intent": "playlist",
                "hint": {"kind": "producer", "name": p["name"]},
            }
        )
    for g in guests[:2]:
        hs = hosts(g["artist_ids"])
        groups.setdefault("guest", []).append(
            {
                "kind": "guest",
                "kicker": "Гость",
                "title": g["name"],
                "line": "на фитах у " + named(g["artist_ids"]),
                "n": g["n"],
                "m": g["m"],
                "image_id": g["image_id"],
                "covers": [covers[i] for i in hs[:4] if covers.get(i)],
                "ask": f"Песни, где появляется {g['name']}",
                "intent": "playlist",
                "hint": {"kind": "guest", "artist_slug": g["slug"]},
            }
        )
    seen_artists: set[str] = set()
    kickers = {"placement": "Звучала в кадре", "record": "Рекорд"}
    for label in ("placement", "record"):
        for f in by_label.get(label, []):
            text = _cut(f["text"], 170)
            if not text or f["artist_slug"] in seen_artists:
                continue
            seen_artists.add(f["artist_slug"])
            groups.setdefault("story", []).append(
                {
                    "kind": "story",
                    "kicker": kickers[label],
                    "title": f["title"],
                    "line": text,
                    "artist": f["artist"],
                    "image_id": f["cover_image_id"],
                    "ask": f"Расскажи историю «{f['title']}»",
                    "intent": "general",
                    "hint": {"kind": "about_song", "track_id": str(f["track_id"])},
                }
            )
            if len(groups["story"]) >= 4:
                break
    for r in with_origin[2:5]:
        band = origin_of[r["id"]][1]
        groups.setdefault("name", []).append(
            {
                "kind": "name",
                "kicker": "Происхождение названия" if band else "Происхождение имени",
                "title": r["name"],
                "line": origin_q(r),
                "image_id": r["image_id"],
                "ask": origin_q(r),
                "intent": "general",
                "hint": {"kind": "about_artist", "artist_slug": r["slug"]},
            }
        )
    for al in albums[:2]:
        n = today.year - al["year"]
        groups.setdefault("year", []).append(
            {
                "kind": "year",
                "kicker": "Юбилей в этом году",
                "title": al["title"],
                "artist": al["artist"],
                "years": n,
                "line": f"{n} {plural_ru(n, 'год', 'года', 'лет')} · {al['year']}",
                "image_id": al["cover_image_id"],
                "ask": f"Расскажи историю альбома «{al['title']}» {al['artist'] or ''}".strip(),
                "intent": "general",
                "hint": {"kind": "about_artist", "artist_slug": al["artist_slug"]}
                if al["artist_slug"]
                else None,
            }
        )
    cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(days=45)
    for r in top:
        if r["listens"] >= 25 and r["last_heard_at"] and r["last_heard_at"] < cutoff:
            when = r["last_heard_at"].strftime("%d.%m")
            groups.setdefault("forgotten", []).append(
                {
                    "kind": "forgotten",
                    "kicker": "Давно не звучит",
                    "title": r["name"],
                    "line": f"{r['listens']} {plural_ru(r['listens'], 'прослушивание', 'прослушивания', 'прослушиваний')}, последнее {when}",
                    "image_id": r["image_id"],
                    "ask": f"Лучшее {r['name']}",
                    "intent": "playlist",
                    "hint": {"kind": "best", "artist_slug": r["slug"]},
                }
            )
            break
    for grp in groups.values():
        rnd.shuffle(grp)
    cards = _interleave(groups, ("producer", "story", "name", "year", "guest", "forgotten"))

    sky = [
        {"q": r.q, "intent": r.intent, "at": r.created_at.isoformat()}
        for r in (await s.execute(_SKY, a)).all()
        if r.q
    ]
    image_ids = [c.get("image_id") for c in cards] + [i for c in cards for i in c.get("covers", [])]
    return {"orbit": orbit, "cards": cards, "sky": sky, "image_ids": [i for i in image_ids if i]}


def _interleave(
    groups: dict[str, list[dict[str, Any]]], order: tuple[str, ...]
) -> list[dict[str, Any]]:
    """One of each kind in turn, so the first screen shows variety, not four producers."""
    out: list[dict[str, Any]] = []
    for i in range(max((len(g) for g in groups.values()), default=0)):
        for k in order:
            if i < len(groups.get(k, [])):
                out.append(groups[k][i])
    return out
