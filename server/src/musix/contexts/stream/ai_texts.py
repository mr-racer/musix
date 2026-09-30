"""The `ai`-queue job behind «вайбики» names and the hero's wave phrase: inputs from
Postgres, prompts and validators from `musix.knowledge.stream_texts` (v1's)."""

from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.stream.models import taste_profile
from musix.errors import Unavailable
from musix.infra.llm import Llm
from musix.knowledge import stream_texts as T

SM = async_sessionmaker[AsyncSession]

_TOP_ARTISTS = sa.text("""
SELECT a.name, (SELECT t.genre FROM tracks t WHERE t.account_id = st.account_id
                AND t.primary_artist_id = st.artist_id AND t.genre <> '' GROUP BY t.genre
                ORDER BY count(*) DESC LIMIT 1) AS genre,
       ln(1 + st.listens) * (st.fulls + 1) / (st.listens + 3) AS w
FROM account_artist_stats st JOIN artists a ON a.id = st.artist_id
WHERE st.account_id = :a ORDER BY w DESC LIMIT :n
""")
_RECENT = sa.text("""
SELECT DISTINCT ON (a.id) a.name, t.genre, l.started_at FROM listen_events l
JOIN tracks t ON t.id = l.track_id JOIN artists a ON a.id = t.primary_artist_id
WHERE l.account_id = :a AND l.started_at > now() - interval '30 days'
ORDER BY a.id, l.started_at DESC
""")


async def inputs(
    s: AsyncSession, account_id: uuid.UUID
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(islands, recent): v1's shapes — [{weight, tracks: [{artist, genre}]}], [{artist, genre}]."""
    tops = (await s.execute(_TOP_ARTISTS, {"a": account_id, "n": 8})).all()
    islands = [
        {"weight": round(float(w), 3), "tracks": [{"artist": n, "genre": g}]} for n, g, w in tops
    ]
    rec = sorted(
        (await s.execute(_RECENT, {"a": account_id})).all(),
        key=lambda r: r.started_at,
        reverse=True,
    )
    return islands, [{"artist": r.name, "genre": r.genre or None} for r in rec[:6]]


async def vibe_names(
    s: AsyncSession, llm: Llm, rows: list[dict[str, Any]], lang: str
) -> dict[str, str]:
    if not rows:
        return {}
    ids = [uuid.UUID(m) for v in rows for m in v["members"]]
    info = {
        str(r.id): {"artist": r.artist_display, "title": r.title, "genre": r.genre}
        for r in await s.execute(
            sa.text("SELECT id, artist_display, title, genre FROM tracks WHERE id = ANY(:i)"),
            {"i": ids},
        )
    }
    vibes = [
        {"track_id": v["track"], "tracks": [info[m] for m in v["members"] if m in info]}
        for v in rows
    ]
    raw = await llm.ask_json(
        T._vibe_names_user_prompt(vibes),
        system=T._VIBE_NAMES_SYSTEM.format(lang_name=T._lang_name(lang)),
        temperature=0.6,
        kind="vibe_names",
    )
    valid = {v["track"] for v in rows}
    return {
        k: str(v).strip()
        for k, v in ((raw or {}).get("vibe_names") or {}).items()
        if k in valid and str(v).strip()
    }


async def wave(
    llm: Llm, islands: list[dict[str, Any]], recent: list[dict[str, Any]], lang: str
) -> dict[str, Any]:
    if not islands:
        return {"phrase": None, "source": None}
    user = T._vibe_user_prompt({"islands": islands}, recent)
    system = T._VIBE_SYSTEM.format(lang_name=T._lang_name(lang))
    for attempt in range(2):  # v1: one retry on a wrong-script reply, then the fallback
        try:
            candidate = T._validate_vibe(
                await llm.ask(
                    user, system=system, temperature=0.7, kind="taste_vibe", cache=attempt == 0
                )
            )
        except Unavailable:
            break
        if not candidate:
            break
        if T._lang_conforms(candidate, lang):
            return {"phrase": candidate, "source": "ai"}
    return T.deterministic_taste_vibe({"islands": islands}, recent, lang)


async def run(sm: SM, llm: Llm, account_id: uuid.UUID, lang: str) -> dict[str, Any]:
    async with sm() as s:
        rows = list(
            await s.scalar(
                sa.select(taste_profile.c.vibes).where(taste_profile.c.account_id == account_id)
            )
            or []
        )
        islands, recent = await inputs(s, account_id)
        try:
            names = await vibe_names(s, llm, rows, lang)
        except (Unavailable, ValueError):
            names = {}
    w = await wave(llm, islands, recent, lang)
    async with sm() as s:
        cur = await s.scalar(
            sa.select(taste_profile.c.vibes)
            .where(taste_profile.c.account_id == account_id)
            .with_for_update()
        )
        if cur is None:
            return {}
        named = [{**v, **({"name": names[v["track"]]} if v["track"] in names else {})} for v in cur]
        await s.execute(
            sa.update(taste_profile)
            .where(taste_profile.c.account_id == account_id)
            .values(vibes=named, wave={**w, "lang": lang}, updated_at=sa.func.now())
        )
        await s.commit()
    return {"names": len(names), "wave": w.get("source")}
