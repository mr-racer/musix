"""Turns: the API writes a row and defers a job; the `ai` worker runs v1's assistant
(or track chat) against the account, streams its progress frames over the WebSocket
(`assistant.stage`), stores the result and says `assistant.done`.

Frames go out through ONE pump task, in order: v1's `EventSink` is already the queue
that orders events coming from worker threads and from the loop."""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import json
import logging
import uuid
from types import SimpleNamespace
from typing import Any

import sqlalchemy as sa
from qdrant_client import AsyncQdrantClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.assistant import schemas as S
from musix.contexts.assistant.models import assistant_turns
from musix.contexts.library.models import albums, lyrics, tracks
from musix.errors import NotFound
from musix.infra.changelog import notify
from musix.infra.llm import Llm
from musix.infra.ml_client import MlClient

SM = async_sessionmaker[AsyncSession]
log = logging.getLogger(__name__)
FRAME_MAX = 6000  # NOTIFY carries ≤ 8000 bytes; a progress frame never needs more


async def create(
    s: AsyncSession, account_id: uuid.UUID, kind: str, request: dict[str, Any]
) -> uuid.UUID:
    tid = await s.scalar(
        sa.insert(assistant_turns)
        .values(account_id=account_id, kind=kind, request=request)
        .returning(assistant_turns.c.id)
    )
    return uuid.UUID(str(tid))


async def get(
    s: AsyncSession, base_url: str, secret: bytes, account_id: uuid.UUID, turn_id: uuid.UUID
) -> S.TurnOut:
    from musix.contexts.library.service import get_tracks
    from musix.contexts.media.delivery import load_images

    row = (
        await s.execute(
            sa.select(assistant_turns).where(
                assistant_turns.c.id == turn_id, assistant_turns.c.account_id == account_id
            )
        )
    ).first()
    if row is None:
        raise NotFound("turn")
    ids = _track_ids(row.result) if row.result else []
    ts = await get_tracks(s, account_id, ids) if ids else []
    subject = ((row.result or {}).get("answer") or {}).get("subject") or {}
    return S.TurnOut(
        id=row.id,
        kind=row.kind,
        status=row.status,
        result=row.result,
        error=row.error,
        tracks={str(t.id): t for t in ts},
        images=await load_images(
            s, base_url, secret, [t.cover_image_id for t in ts] + [subject.get("image_id")]
        ),
        created_at=row.created_at,
        finished_at=row.finished_at,
    )


async def with_tracks(
    s: AsyncSession,
    base_url: str,
    secret: bytes,
    account_id: uuid.UUID,
    cards: list[dict[str, Any]],
) -> S.DiscoveriesOut:
    from musix.contexts.library.service import get_tracks
    from musix.contexts.media.delivery import load_images

    ids = _track_ids(cards)
    ts = await get_tracks(s, account_id, ids) if ids else []
    return S.DiscoveriesOut(
        cards=cards,
        tracks={str(t.id): t for t in ts},
        images=await load_images(s, base_url, secret, [t.cover_image_id for t in ts]),
    )


def _track_ids(result: Any) -> list[uuid.UUID]:
    """Every `track_id` anywhere in a v1 payload."""
    out: dict[uuid.UUID, None] = {}

    def walk(x: Any) -> None:
        if isinstance(x, dict):
            for k, v in x.items():
                if k in ("track_id", "last_track_id") and isinstance(v, str):
                    with contextlib.suppress(ValueError):
                        out[uuid.UUID(v)] = None
                else:
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(result)
    return list(out)[:200]


class _Pump:
    """Drains v1's EventSink queue into NOTIFYs, one at a time, in order."""

    def __init__(
        self, sm: SM, account_id: uuid.UUID, turn_id: uuid.UUID, queue: asyncio.Queue[Any]
    ) -> None:
        self.sm, self.account_id, self.turn_id, self.queue = sm, account_id, turn_id, queue

    async def run(self) -> None:
        while True:
            frame = await self.queue.get()
            if frame is None:
                return
            body = json.loads(json.dumps(frame, ensure_ascii=False, default=str))
            if len(json.dumps(body, ensure_ascii=False).encode()) > FRAME_MAX:
                body = {k: v for k, v in body.items() if k in ("type", "stage", "human", "intent")}
            try:
                async with self.sm() as s:
                    await notify(
                        s, self.account_id, "assistant.stage", turn=str(self.turn_id), frame=body
                    )
                    await s.commit()
            except Exception:  # a lost progress frame is not a lost answer
                log.warning("[assistant] frame not delivered", exc_info=True)


def bind(sm: SM, llm: Llm, conninfo: str, loop: asyncio.AbstractEventLoop) -> None:
    from musix.assistant import compat, data

    compat.bind_loop(loop)
    compat.set_llm(llm)
    compat.set_sessionmaker(sm)
    data.configure(conninfo)


async def run(
    sm: SM, llm: Llm, q: AsyncQdrantClient, ml: MlClient, conninfo: str, turn_id: uuid.UUID
) -> str:
    from musix.assistant import compat
    from musix.assistant.service import EventSink

    async with sm() as s:
        row = (
            await s.execute(
                sa.select(assistant_turns).where(assistant_turns.c.id == turn_id).with_for_update()
            )
        ).first()
        if row is None or row.status != "queued":
            return "skipped"
        await s.execute(
            sa.update(assistant_turns)
            .where(assistant_turns.c.id == turn_id)
            .values(status="running")
        )
        await s.commit()
    bind(sm, llm, conninfo, asyncio.get_running_loop())
    compat.set_config(await llm.config())
    req = dict(row.request)
    sink = EventSink(req.get("lang"))
    pump = asyncio.create_task(_Pump(sm, row.account_id, turn_id, sink.queue).run())
    status, result, error = "done", None, None
    try:
        if row.kind == "track_chat":
            result = await _track_chat(sm, row.account_id, req, sink)
        else:
            result = await _assistant(sm, q, ml, llm, row.account_id, req, sink)
    except Exception as e:
        log.exception("[assistant] turn %s failed", turn_id)
        status, error = "error", f"{type(e).__name__}: {e}"[:500]
    finally:
        sink.queue.put_nowait(None)
        await pump
        from musix.assistant import data

        await asyncio.to_thread(data.close_all)
    async with sm() as s:
        await s.execute(
            sa.update(assistant_turns)
            .where(assistant_turns.c.id == turn_id)
            .values(status=status, result=result, error=error, finished_at=dt.datetime.now(dt.UTC))
        )
        await notify(s, row.account_id, "assistant.done", turn=str(turn_id), status=status)
        await s.commit()
    return status


async def _assistant(
    sm: SM,
    q: AsyncQdrantClient,
    ml: MlClient,
    llm: Llm,
    account_id: uuid.UUID,
    req: dict[str, Any],
    sink: Any,
) -> dict[str, Any]:
    from musix.assistant.models import AssistantRequest, AssistantResponse
    from musix.assistant.search_adapter import SearchAdapter
    from musix.assistant.service import run_assistant
    from musix.contexts.assistant import fast

    try:
        quick = await fast.answer(sm, q, llm, account_id, req, sink)
    except Exception:  # the library path is a shortcut: the agent still answers
        log.warning("[assistant] fast path failed — the agent takes the turn", exc_info=True)
        quick = None
    if quick is not None:
        return AssistantResponse(**quick).model_dump(mode="json")

    hint = req.get("hint") or {}
    if hint.get("kind") == "about_artist" and hint.get("artist_slug"):
        req = {**req, "subject_artist_slug": req.get("subject_artist_slug") or hint["artist_slug"]}
    if hint.get("kind") == "about_song" and hint.get("track_id"):
        req = {**req, "subject_track_id": req.get("subject_track_id") or hint["track_id"]}
    body = {k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in req.items() if v is not None}
    areq = AssistantRequest.model_validate(body)
    result = await run_assistant(
        areq,
        search_service=SearchAdapter(sm, q, ml, account_id),
        qdrant=None,
        collection_name=str(account_id),
        current_user=SimpleNamespace(id=account_id),
        sink=sink,
    )
    out = AssistantResponse(**result).model_dump(mode="json")
    try:
        await _enrich(sm, llm, account_id, req, out)
    except Exception:  # the extras are decoration: never cost the answer
        log.warning("[assistant] enrich failed", exc_info=True)
    return out


_SOURCE_LABEL = {
    "genius": "Genius",
    "songfacts": "Songfacts",
    "wikipedia": "Википедия",
    "lastfm": "Last.fm",
}


async def _enrich(
    sm: SM, llm: Llm, account_id: uuid.UUID, req: dict[str, Any], out: dict[str, Any]
) -> None:
    """What the v2 page shows around an agent's answer: the subject's picture, links to
    the library's artists it names, its sources, what to ask next, and the few words
    under a web-built playlist."""
    from urllib.parse import urlparse

    from musix.contexts.assistant import fast
    from musix.contexts.library.models import artists
    from musix.contexts.search.normalize import fold

    ans = out.get("answer")
    pl = out.get("playlist")
    rows: list[dict[str, Any]] = []
    facts: list[str] = []
    async with sm() as s:
        if ans and ans.get("answer"):
            subj = ans.get("subject") or {}
            if subj.get("track_id"):
                with contextlib.suppress(ValueError):
                    subj["image_id"] = await s.scalar(
                        sa.select(tracks.c.cover_image_id).where(
                            tracks.c.id == uuid.UUID(subj["track_id"]),
                            tracks.c.account_id == account_id,
                        )
                    )
            elif subj.get("artist_slug"):
                a = artists.c
                subj["image_id"] = await s.scalar(
                    sa.select(sa.func.coalesce(a.photo_id, a.image_id, a.cutout_id)).where(
                        a.slug == subj["artist_slug"]
                    )
                )
            text = f" {fold(ans['answer'])} "
            mine = (
                await s.execute(
                    sa.text(
                        "SELECT DISTINCT ar.name, ar.slug FROM artists ar JOIN tracks t ON t.primary_artist_id = ar.id"
                        " WHERE t.account_id = :a AND t.deleted_at IS NULL"
                    ),
                    {"a": account_id},
                )
            ).all()
            out["links"] = [
                {"name": n, "slug": sl}
                for n, sl in mine
                if len(fold(n)) >= 3 and f" {fold(n)} " in text
            ][:8]
            labels: list[str] = []
            for e in ans.get("evidence") or []:
                if not e.get("used"):
                    continue
                if e.get("url"):
                    host = urlparse(e["url"]).netloc.removeprefix("www.")
                    label = (
                        "Википедия"
                        if "wikipedia.org" in host
                        else _SOURCE_LABEL.get(host.split(".")[0], host)
                    )
                else:
                    label = _SOURCE_LABEL.get(
                        str(e.get("source") or "").lower(), "Факты библиотеки"
                    )
                if label not in labels:
                    labels.append(label)
            out["sources"] = labels[:4]
            nxt: list[dict[str, Any]] = []
            if subj.get("kind") == "song" and subj.get("track_id"):
                t = subj.get("title") or ""
                nxt.append(
                    {
                        "q": f"Похожее по звуку на «{t}»",
                        "intent": "audio_search",
                        "hint": {"kind": "similar", "track_id": subj["track_id"]},
                    }
                )
            if subj.get("artist_slug") and subj.get("kind") == "artist":
                nxt.append(
                    {
                        "q": f"Хиты {subj.get('title')}",
                        "intent": "playlist",
                        "hint": {"kind": "hits", "artist_slug": subj["artist_slug"]},
                    }
                )
            about = (
                {"kind": "about_song", "track_id": subj["track_id"]}
                if subj.get("track_id")
                else {"kind": "about_artist", "artist_slug": subj["artist_slug"]}
                if subj.get("artist_slug")
                else None
            )
            for f in (ans.get("follow_ups") or [])[:2]:
                nxt.append({"q": f, "intent": "general", "hint": about})
            out["next"] = nxt
        if pl and pl.get("tracks") and not pl.get("blurb") and out.get("intent") == "playlist":
            ids = []
            for t in pl["tracks"]:
                with contextlib.suppress(ValueError, KeyError):
                    ids.append(uuid.UUID(t["track_id"]))
            rows = [
                dict(r)
                for r in (
                    await s.execute(
                        sa.text(f"{fast._TRACK} AND t.id = ANY(:ids)"),
                        {"a": account_id, "ids": ids},
                    )
                ).mappings()
            ]
            order = {i: n for n, i in enumerate(ids)}
            rows.sort(key=lambda r: order.get(r["id"], 0))
            facts = await fast._facts(s, rows, req.get("lang") or "ru")
            pl["source"] = pl.get("source") or "web"
    if pl and pl.get("tracks") and not pl.get("blurb") and out.get("intent") == "playlist" and rows:
        pl["blurb"] = await fast.write_blurb(
            llm,
            req.get("message", ""),
            pl.get("title") or "",
            rows,
            facts,
            "web",
            req.get("lang") or "ru",
        )


async def _track_chat(
    sm: SM, account_id: uuid.UUID, req: dict[str, Any], sink: Any
) -> dict[str, Any]:
    from musix.assistant.models import ChatMessage, TrackChatContext, TrackChatRequest
    from musix.assistant.track_chat import answer_track_chat

    tid = uuid.UUID(str(req["track_id"]))
    async with sm() as s:
        t = (
            await s.execute(
                sa.select(
                    tracks.c.title,
                    tracks.c.artist_display,
                    tracks.c.year,
                    tracks.c.genre,
                    albums.c.title.label("album"),
                    lyrics.c.text.label("lyrics"),
                )
                .outerjoin(albums, albums.c.id == tracks.c.album_id)
                .outerjoin(lyrics, lyrics.c.media_file_id == tracks.c.media_file_id)
                .where(
                    tracks.c.id == tid,
                    tracks.c.account_id == account_id,
                    tracks.c.deleted_at.is_(None),
                )
            )
        ).first()
    if t is None:
        raise NotFound("track")
    treq = TrackChatRequest(
        track_context=TrackChatContext(
            title=t.title,
            artist=t.artist_display,
            album=t.album,
            year=t.year,
            genre=t.genre,
            full_lyrics=t.lyrics or "",
        ),
        mode=req["mode"],
        selected_line=req.get("selected_line"),
        history=[ChatMessage(**m) for m in req.get("history") or []],
        message=req["message"],
        lang=req.get("lang"),
    )

    def on_event(event: dict[str, Any]) -> None:
        sink.on_status(event)

    sink.on_status({"type": "status", "stage": "thinking"})
    res: Any = await answer_track_chat(treq, on_event=on_event)  # type: ignore[no-untyped-call]
    return dict(res.model_dump(mode="json"))


# v1 MetadataDB.HIDDEN_LABELS (+ the gate's rejects): what the strip must not show
_HIDDEN = ["other", "about_artist", "about_song", "gate:junk", "gate:roster"]
_IDEAS = sa.text("""
WITH mine AS (SELECT t.id, t.song_id, t.cover_image_id FROM tracks t
              WHERE t.account_id = :a AND t.deleted_at IS NULL),
     artists_mine AS (SELECT DISTINCT ta.artist_id FROM track_artists ta JOIN mine ON mine.id = ta.track_id)
SELECT f.subject_kind, f.subject_id, r.text
FROM fact_refinements r JOIN facts f ON f.id = r.fact_id
WHERE r.lang = :lang AND r.text IS NOT NULL AND length(r.text) <= 220
  AND NOT (r.labels ?| CAST(:hidden AS text[]))
  AND ((f.subject_kind = 'song' AND f.subject_id IN (SELECT song_id FROM mine))
    OR (f.subject_kind = 'artist' AND f.subject_id IN (SELECT artist_id FROM artists_mine)))
ORDER BY random() LIMIT :n
""")


async def ideas(
    s: AsyncSession, base: str, secret: bytes, account_id: uuid.UUID, lang: str, limit: int
) -> S.IdeasOut:
    from musix.contexts.library.models import artists, songs, tracks
    from musix.contexts.media.delivery import load_images

    rows = (
        await s.execute(_IDEAS, {"a": account_id, "lang": lang, "hidden": _HIDDEN, "n": limit * 4})
    ).all()
    picked: list[tuple[str, uuid.UUID, str]] = []
    seen: set[tuple[str, uuid.UUID]] = set()
    for kind, sid, text in rows:  # one fact per subject, so the picks never share one
        if (kind, sid) not in seen:
            seen.add((kind, sid))
            picked.append((kind, sid, text))
        if len(picked) >= limit:
            break
    song_ids = [sid for k, sid, _ in picked if k == "song"]
    artist_ids = [sid for k, sid, _ in picked if k == "artist"]
    by_song: dict[uuid.UUID, Any] = {}
    if song_ids:
        T, So, Ar = tracks.c, songs.c, artists.c
        q = (
            sa.select(So.id, So.title, Ar.name, T.id.label("track_id"), T.cover_image_id)
            .join(tracks, T.song_id == So.id)
            .outerjoin(artists, Ar.id == So.primary_artist_id)
            .where(So.id.in_(song_ids), T.account_id == account_id, T.deleted_at.is_(None))
            .order_by(So.id, T.cover_image_id.is_(None), T.added_at)
            .distinct(So.id)
        )
        by_song = {r.id: r for r in (await s.execute(q)).all()}
    by_artist: dict[uuid.UUID, Any] = {}
    if artist_ids:
        Ar = artists.c
        q2 = sa.select(Ar.id, Ar.name, Ar.slug, Ar.image_id, Ar.cutout_id).where(
            Ar.id.in_(artist_ids)
        )
        by_artist = {r.id: r for r in (await s.execute(q2)).all()}
    out: list[S.Idea] = []
    for kind, sid, text in picked:
        if kind == "song" and (r := by_song.get(sid)) is not None:
            out.append(
                S.Idea(
                    fact=text,
                    kind="song",
                    title=r.title,
                    artist=r.name,
                    track_id=r.track_id,
                    artist_slug=None,
                    image_id=r.cover_image_id,
                )
            )
        elif kind == "artist" and (a := by_artist.get(sid)) is not None:
            out.append(
                S.Idea(
                    fact=text,
                    kind="artist",
                    title=None,
                    artist=a.name,
                    track_id=None,
                    artist_slug=a.slug,
                    image_id=a.image_id or a.cutout_id,
                )
            )
    imgs = await load_images(s, base, secret, [i.image_id for i in out])
    return S.IdeasOut(ideas=out, images=imgs)


async def home(
    s: AsyncSession, base: str, secret: bytes, account_id: uuid.UUID, lang: str, hour: int | None
) -> S.HomeOut:
    from musix.contexts.assistant import home as H
    from musix.contexts.media.delivery import load_images

    got = await H.build(s, account_id, lang, hour)
    return S.HomeOut(
        orbit=got["orbit"],
        cards=got["cards"],
        sky=got["sky"],
        images=await load_images(s, base, secret, got["image_ids"]),
    )
