"""«Поток» state jobs on the queue: debounced profile refreshes, and the nightly pass."""

from __future__ import annotations

import json
import uuid

import procrastinate
import sqlalchemy as sa

from musix.contexts.stream import jobs
from musix.workers.context import qdrant, sessionmaker

REFRESH_AFTER = 20  # new listens before the profile is recomputed


async def profile(account_id: str) -> None:
    await jobs.profile(sessionmaker(), uuid.UUID(account_id))


async def genres(account_id: str) -> None:
    await jobs.genres(sessionmaker(), await qdrant(), uuid.UUID(account_id))


async def colisten(account_id: str) -> None:
    await jobs.colisten(sessionmaker(), uuid.UUID(account_id))


async def train(timestamp: int | None = None) -> dict[str, float]:
    """Nightly: every account's history replayed → one model; promoted by the rule."""
    import datetime as dt

    from musix.contexts.stream import history
    from musix.recsys import replay as R
    from musix.recsys import train as TR

    now = dt.datetime.now(dt.UTC)
    async with sessionmaker()() as s:
        accounts = list(await s.scalars(sa.text("SELECT DISTINCT account_id FROM listen_events")))
        data = []
        for a in accounts:
            meta, ls, sg = await history.load(s, a)
            data.append([r for _, r in R.replay(meta, ls, sg) if r is not None])
        current = await s.scalar(sa.text("SELECT metrics FROM ranker_models WHERE promoted"))
    d = TR.dataset(data)
    if len(d.y) < 200:
        return {"rows": float(len(d.y))}
    model, metrics = TR.train(d, now)
    ok = TR.promote(metrics, current)
    async with sessionmaker()() as s:
        if ok:
            await s.execute(sa.text("UPDATE ranker_models SET promoted = false WHERE promoted"))
        await s.execute(
            sa.text("INSERT INTO ranker_models (metrics, model, promoted) VALUES (:m, :t, :p)"),
            {"m": json.dumps(metrics), "t": model.dump(), "p": ok},
        )
        await s.commit()
    return {**metrics, "promoted": float(ok)}


async def _defer(name: str, account_id: object) -> None:
    from musix.workers.app import app

    await app.configure_task(name, queueing_lock=f"{name}:{account_id}").defer_async(
        account_id=str(account_id)
    )


async def refresh(timestamp: int) -> int:
    """Every 10 min: profiles of the accounts that listened ≥ REFRESH_AFTER since."""
    async with sessionmaker()() as s:
        stale = list(
            await s.scalars(
                sa.text("""
                SELECT s.account_id FROM account_track_stats s
                LEFT JOIN taste_profile p ON p.account_id = s.account_id
                GROUP BY s.account_id, p.listens_seen
                HAVING sum(s.listens) - coalesce(p.listens_seen, 0) >= :n
                """),
                {"n": REFRESH_AFTER},
            )
        )
    for a in stale:
        await _defer("stream:profile", a)
    return len(stale)


async def nightly(timestamp: int) -> int:
    async with sessionmaker()() as s:
        accounts = list(await s.scalars(sa.text("SELECT DISTINCT account_id FROM tracks")))
    for a in accounts:
        for name in ("stream:genres", "stream:colisten", "stream:profile"):
            await _defer(name, a)
    from musix.workers.app import app

    await app.configure_task("stream:train", queueing_lock="stream:train").defer_async()
    return len(accounts)


def register(app: procrastinate.App) -> None:
    for name, fn in (("profile", profile), ("genres", genres), ("colisten", colisten)):
        app.task(name=f"stream:{name}", queue="default")(fn)
    r = app.task(name="stream:refresh", queue="default")(refresh)
    app.periodic(cron="*/10 * * * *", periodic_id="stream_refresh")(r)
    app.task(name="stream:train", queue="default")(train)
    n = app.task(name="stream:nightly", queue="default")(nightly)
    app.periodic(cron="30 3 * * *", periodic_id="stream_nightly")(n)
