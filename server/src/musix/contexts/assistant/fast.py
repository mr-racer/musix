"""Turns the library answers by itself: no planner, no web, at most one short LLM call.

The assistant's web path costs 30–70 s from this host (SearXNG's engines are blocked,
Bing serves geo-poisoned results) and still failed on questions the library knows
cold: «Что ещё спродюсировал Max Martin в моей музыке?» went to the web for 57 s and
answered «Точного ответа нет» while Genius credits name him on 112 of the listener's
tracks (2026-10-23). These kinds are answered here in 1–3 s:

- `producer` — songs whose Genius / extracted credits name the producer;
- `guest` — songs where the artist is a featured guest;
- `hits` — the artist's most popular songs by Deezer's chart, those the listener owns;
  their own most played when Deezer is unreachable;
- `best` — the artist's songs the listener played most;
- `similar` — sound-alikes of one track: its own CLAP vector, no text prompt.

The kind comes from the page's `hint` (the orbit and the cards know what they ask) or
from a strict reading of the text; anything unsure goes to the agent as before."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

import httpx
import sqlalchemy as sa
from qdrant_client import AsyncQdrantClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.assistant.humanize import plural_ru
from musix.contexts.search.normalize import fold
from musix.infra.vectors import TRACKS, owned_by

log = logging.getLogger(__name__)
SM = async_sessionmaker[AsyncSession]
LIMIT = 15

_TRACK = """SELECT t.id, t.title, t.title_display, t.artist_display, t.year, t.duration_ms,
       t.media_file_id, t.song_id, t.primary_artist_id, al.title AS album, coalesce(st.listens, 0) AS listens
FROM tracks t LEFT JOIN albums al ON al.id = t.album_id
LEFT JOIN account_track_stats st ON st.track_id = t.id AND st.account_id = :a
WHERE t.account_id = :a AND t.deleted_at IS NULL"""

_BY_PRODUCER = sa.text(f"""{_TRACK} AND t.song_id IN (
  SELECT r.song_id FROM song_relations r WHERE r.kind = 'producer' AND lower(r.target_text) = lower(:name))
ORDER BY listens DESC, t.year DESC NULLS LAST""")

_PRODUCER_NAMES = sa.text("""SELECT DISTINCT r.target_text FROM song_relations r
JOIN tracks t ON t.song_id = r.song_id AND t.account_id = :a AND t.deleted_at IS NULL
WHERE r.kind = 'producer'""")

_BY_GUEST = sa.text(f"""{_TRACK} AND t.id IN (
  SELECT ta.track_id FROM track_artists ta WHERE ta.artist_id = :artist AND ta.role = 'feat')
ORDER BY listens DESC""")

_BY_ARTIST = sa.text(f"""{_TRACK} AND (t.primary_artist_id = :artist OR t.id IN (
  SELECT ta.track_id FROM track_artists ta WHERE ta.artist_id = :artist))
ORDER BY listens DESC""")

_ARTIST = sa.text("SELECT id, slug, name FROM artists WHERE slug = :slug")
_MY_ARTISTS = sa.text("""SELECT DISTINCT ar.id, ar.slug, ar.name FROM artists ar
JOIN track_artists ta ON ta.artist_id = ar.id
JOIN tracks t ON t.id = ta.track_id AND t.account_id = :a AND t.deleted_at IS NULL""")
_ONE = sa.text(f"{_TRACK} AND t.id = :id")
_BY_MF = sa.text(f"{_TRACK} AND t.media_file_id = ANY(:mfs)")
_TITLES = sa.text(f"{_TRACK} ORDER BY listens DESC")

# Facts for the playlist's few words: one short refined fact per song, the best known first.
_FACTS = sa.text("""SELECT DISTINCT ON (f.subject_id) f.subject_id, r.text FROM fact_refinements r
JOIN facts f ON f.id = r.fact_id
WHERE f.subject_kind = 'song' AND f.subject_id = ANY(:songs) AND r.lang = :lang AND r.text IS NOT NULL
  AND length(r.text) <= 260 AND NOT (r.labels ?| ARRAY['other', 'about_artist', 'gate:junk', 'gate:roster'])
ORDER BY f.subject_id, length(r.text)""")

_QO, _QC = r"[«\"“']?", r"[»\"”']?"
_RX = {
    "producer": re.compile(r"(?:продюс\w*|спродюсир\w*|produc\w*)", re.I),
    "guest": re.compile(
        r"(?:где (?:появляется|участвует|есть|поёт|поет)|фиты|фиты с|с участием|featuring|feat\.?)\s+(.+?)\??$",
        re.I,
    ),
    "hits": re.compile(
        r"^(?:хиты|главные хиты|самые популярные (?:песни|треки)|популярное|топ)\s+(?:у\s+)?(.+?)\??$",
        re.I,
    ),
    "best": re.compile(r"^(?:лучшее|лучшие (?:песни|треки)|любимое)\s+(?:у\s+)?(.+?)\??$", re.I),
    "similar": re.compile(rf"похож\w*(?: по звуку| по звучанию)? на\s+{_QO}(.+?){_QC}\??$", re.I),
}


# The stage line after «Понял: …» (the route frame): what the library is doing.
_FIRST = {
    "producer": "Смотрю титры библиотеки",
    "guest": "Смотрю титры библиотеки",
    "hits": "Сверяю с чартом Deezer",
    "best": "Смотрю, что ты слушаешь чаще",
    "similar": "Сравниваю звучание",
}


async def parse(s: AsyncSession, account_id: uuid.UUID, text: str) -> dict[str, Any] | None:
    """A strict reading of a typed question. None when unsure — the agent takes it."""
    t = " ".join((text or "").split())
    a = {"a": account_id}
    if _RX["producer"].search(t):
        names = [r[0] for r in (await s.execute(_PRODUCER_NAMES, a)).all()]
        hay = f" {fold(t)} "
        found = sorted((n for n in names if len(fold(n)) >= 3 and f" {fold(n)} " in hay), key=len)
        if found:
            return {"kind": "producer", "name": found[-1]}
        return None
    for kind in ("guest", "hits", "best"):
        m = _RX[kind].search(t)
        if m:
            art = await _my_artist(s, account_id, m.group(1))
            return {"kind": kind, "artist_slug": art["slug"]} if art else None
    m = _RX["similar"].search(t)
    if m:
        want = _key(m.group(1))
        for r in (await s.execute(_TITLES, a)).mappings():
            if want in (_key(r["title_display"] or r["title"]), _key(r["title"])):
                return {"kind": "similar", "track_id": str(r["id"])}
    return None


async def _my_artist(s: AsyncSession, account_id: uuid.UUID, raw: str) -> dict[str, Any] | None:
    want = fold(raw)
    if not want:
        return None
    for r in (await s.execute(_MY_ARTISTS, {"a": account_id})).mappings():
        if fold(r["name"]) == want:
            return dict(r)
    return None


async def answer(
    sm: SM,
    q: AsyncQdrantClient,
    llm: Any,
    account_id: uuid.UUID,
    req: dict[str, Any],
    sink: Any,
) -> dict[str, Any] | None:
    """The turn's result in the agent's payload shape, or None to hand it to the agent."""
    async with sm() as s:
        hint = req.get("hint") or await parse(s, account_id, req.get("message", ""))
        kind = (hint or {}).get("kind")
        if kind not in ("producer", "guest", "hits", "best", "similar"):
            return None
        intent = "audio_search" if kind == "similar" else "playlist"
        sink.on_status({"stage": "plan", "intent": intent, "fast": kind, "human": _FIRST[kind]})
        got = await _collect(s, q, account_id, kind, hint or {})
    if got is None:
        return None
    title, rows, source, caption = got
    if not rows:
        return None
    rows = rows[: req.get("limit") or LIMIT]
    sink.on_status(
        {"stage": "library", "human": caption, "track_ids": [str(r["id"]) for r in rows[:8]]}
    )
    blurb = None
    if intent == "playlist":
        async with sm() as s:
            facts = await _facts(s, rows, req.get("lang") or "ru")
        blurb = await write_blurb(
            llm, req.get("message", ""), title, rows, facts, source, req.get("lang") or "ru"
        )
    n = len(rows)
    sink.on_status(
        {
            "stage": "select_done",
            "picked": n,
            "human": f"Собрал подборку из {n} {plural_ru(n, 'трека', 'треков', 'треков')}",
        }
    )
    return {
        "intent": intent,
        "human": "",
        "slots": {"last_intent": intent, "last_playlist_ids": [str(r["id"]) for r in rows]},
        "playlist": {
            "title": title,
            "steps": [],
            "tracks": [_track(r, source) for r in rows],
            "blurb": blurb,
            "source": source,
        },
        "fast": kind,
    }


async def _collect(
    s: AsyncSession, q: AsyncQdrantClient, account_id: uuid.UUID, kind: str, hint: dict[str, Any]
) -> tuple[str, list[dict[str, Any]], str, str] | None:
    a = {"a": account_id}
    if kind == "producer":
        name = str(hint.get("name") or "")
        rows = [dict(r) for r in (await s.execute(_BY_PRODUCER, {**a, "name": name})).mappings()]
        n = len(rows)
        return (
            f"{name} в твоей библиотеке",
            rows,
            "credits",
            f"В титрах библиотеки {n} {plural_ru(n, 'песня', 'песни', 'песен')} с {name}",
        )
    if kind == "similar":
        return await _similar(s, q, account_id, str(hint.get("track_id") or ""))
    art = (await s.execute(_ARTIST, {"slug": hint.get("artist_slug")})).mappings().first()
    if art is None:
        return None
    if kind == "guest":
        rows = [
            dict(r) for r in (await s.execute(_BY_GUEST, {**a, "artist": art["id"]})).mappings()
        ]
        n = len(rows)
        return (
            f"{art['name']} в гостях",
            rows,
            "credits",
            f"{art['name']} на фитах в {n} {plural_ru(n, 'песне', 'песнях', 'песнях')}",
        )
    mine = [dict(r) for r in (await s.execute(_BY_ARTIST, {**a, "artist": art["id"]})).mappings()]
    if kind == "best":
        return f"Лучшее {art['name']}", mine, "listens", "Беру то, что ты слушаешь чаще всего"
    chart = await deezer_top(art["name"])
    if not chart:
        return (
            f"Хиты {art['name']}",
            mine,
            "listens",
            "Чарт не ответил, беру твои самые заслушанные",
        )
    rank = {t: i for i, t in enumerate(chart)}
    seen_songs: set[Any] = set()
    seen_keys: set[str] = set()
    hits = []
    # The chart's order; within one title the original before a remix, a live take or a
    # second artist's version («Moth to a Flame» came twice, «Starboy» as a Kygo remix).
    for r in sorted(
        mine,
        key=lambda r: (
            rank.get(_key(r["title_display"] or r["title"]), 10**6),
            bool(_VARIANT.search(r["title"])),
            -r["listens"],
        ),
    ):
        k = _key(r["title_display"] or r["title"])
        if k not in rank or k in seen_keys or r["song_id"] in seen_songs:
            continue
        seen_keys.add(k)
        seen_songs.add(r["song_id"])
        hits.append(r)
    if len(hits) < 5:  # a thin overlap with the chart: the listener's own favourites fill in
        hits += [r for r in mine if r["song_id"] not in seen_songs][: 10 - len(hits)]
    n = len(hits)
    return (
        f"Хиты {art['name']}",
        hits,
        "chart",
        f"Сверил с чартом Deezer: у тебя {n} {plural_ru(n, 'хит', 'хита', 'хитов')}",
    )


async def _similar(
    s: AsyncSession, q: AsyncQdrantClient, account_id: uuid.UUID, track_id: str
) -> tuple[str, list[dict[str, Any]], str, str] | None:
    try:
        seed = (
            (await s.execute(_ONE, {"a": account_id, "id": uuid.UUID(track_id)})).mappings().first()
        )
    except ValueError:
        return None
    if seed is None:
        return None
    res = await q.query_points(
        TRACKS,
        query=str(seed["media_file_id"]),  # the track's own CLAP vector
        using="clap",
        limit=LIMIT * 3,
        query_filter=owned_by(account_id, []),
    )
    order = [str(p.id) for p in res.points if str(p.id) != str(seed["media_file_id"])]
    if not order:
        return None
    by_mf = {
        str(r["media_file_id"]): dict(r)
        for r in (
            await s.execute(_BY_MF, {"a": account_id, "mfs": [uuid.UUID(m) for m in order]})
        ).mappings()
    }
    seen = {seed["song_id"]}
    rows = []
    for mf in order:
        r = by_mf.get(mf)
        if r is None or r["song_id"] in seen:
            continue
        seen.add(r["song_id"])
        rows.append(r)
    t = seed["title_display"] or seed["title"]
    return f"Похоже на «{t}»", rows, "clap", f"Сравнил звучание «{t}» со всей библиотекой"


_VARIANT = re.compile(r"\b(remix|live|version|instrumental|acoustic|edit|demo|mix)\b", re.I)


def _key(title: str) -> str:
    """A title as charts and tags both spell it: no feat, no brackets, no «Remastered»."""
    t = re.sub(r"\s*[\(\[].*?[\)\]]", "", title or "")
    t = re.split(r"\s+(?:feat\.?|ft\.?|featuring)\s+", t, flags=re.I)[0]
    return fold(t)


async def deezer_top(artist: str, limit: int = 50) -> list[str]:
    """The artist's chart on Deezer (public API, ~1 s), as title keys. [] when unreachable
    or when the artist found is not this one."""
    try:
        async with httpx.AsyncClient(timeout=4.0) as c:
            r = await c.get(
                "https://api.deezer.com/search/artist", params={"q": artist, "limit": 3}
            )
            cand = [
                a for a in r.json().get("data") or [] if fold(a.get("name", "")) == fold(artist)
            ]
            if not cand:
                return []
            r = await c.get(
                f"https://api.deezer.com/artist/{cand[0]['id']}/top", params={"limit": limit}
            )
            out: list[str] = []
            for t in r.json().get("data") or []:
                k = _key(t.get("title_short") or t.get("title") or "")
                if k and k not in out:
                    out.append(k)
            return out
    except Exception:
        log.info("[fast] deezer chart unavailable for %r", artist, exc_info=True)
        return []


async def _facts(s: AsyncSession, rows: list[dict[str, Any]], lang: str) -> list[str]:
    songs = [r["song_id"] for r in rows[:8] if r["song_id"]]
    if not songs:
        return []
    got: dict[Any, Any] = dict((await s.execute(_FACTS, {"songs": songs, "lang": lang})).all())
    out = []
    for r in rows[:8]:
        if r["song_id"] in got:
            out.append(f"«{r['title_display'] or r['title']}»: {got[r['song_id']]}")
    return out[:4]


def _track(r: dict[str, Any], source: str) -> dict[str, Any]:
    return {
        "track_id": str(r["id"]),
        "title": r["title"],
        "title_display": r["title_display"],
        "artist": r["artist_display"] or "",
        "album": r["album"],
        "year": r["year"],
        "duration_sec": (r["duration_ms"] or 0) / 1000,
        "file_path": "",
        "reason": None,
        "source_tool": source,
    }


async def write_blurb(
    llm: Any,
    request: str,
    title: str,
    rows: list[dict[str, Any]],
    facts: list[str],
    source: str,
    lang: str,
) -> str | None:
    """The playlist's few words (the owner's brief: «плейлист + немного слов от LLM»).
    Only what the list and the facts say; None when the model is down — the card stands
    without words rather than with a template."""
    from musix.assistant.prompts import BLURB_SYSTEM

    listing = "\n".join(
        f"- {r['artist_display']} — {r['title_display'] or r['title']}"
        + (f" ({r['year']})" if r["year"] else "")
        for r in rows[:15]
    )
    why = {
        "credits": "songs from the listener's library whose credits name this person",
        "chart": "the artist's most popular songs (Deezer chart) that the listener owns",
        "listens": "the songs of this artist the listener plays most",
        "clap": "songs that sound close to the seed track",
    }.get(source, "")
    user = (
        f"Request: {request}\nPlaylist: {title}\nHow it was built: {why}\nTracks:\n{listing}\n\n"
        f"Facts:\n" + ("\n".join(f"- {f}" for f in facts) if facts else "(none)")
    )
    try:
        text = await llm.ask(
            user,
            kind="assistant_blurb",
            system=BLURB_SYSTEM.format(lang=_lang(lang)),
            temperature=0.4,
        )
    except Exception:
        log.info("[fast] blurb skipped", exc_info=True)
        return None
    text = " ".join((text or "").split())
    if len(text) > 2 and text[0] in '"«' and text[-1] in '"»' and text.count(text[0]) == 1:
        text = text[1:-1].strip()
    if not text:
        return None
    from musix.assistant.editor import edit

    # the same editor as the answers: the draft invented a chart record for «Blinding
    # Lights» and a quote out of nothing (2026-10-23 tests)
    edited, _ = await edit(_JsonAsk(llm), lang, user, text)
    return edited or None


class _JsonAsk:
    """The editor's `ask_json` over the worker's LLM client."""

    def __init__(self, llm: Any) -> None:
        self.llm = llm

    async def ask_json(
        self,
        messages: list[dict[str, str]],
        *,
        required: tuple[str, ...] = (),
        temperature: float = 0.1,
    ) -> dict[str, Any] | None:
        from musix.assistant.llm import extract_json_object

        try:
            raw = await self.llm.chat(messages, kind="assistant_edit", temperature=temperature)
        except Exception:
            log.info("[fast] editor skipped", exc_info=True)
            return None
        obj = extract_json_object(raw)
        return obj if obj is not None and all(k in obj for k in required) else None


def _lang(lang: str) -> str:
    return "Russian" if (lang or "").startswith("ru") else "English"
