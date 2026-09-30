"""Outbound sources (spec §5): a token bucket and a circuit breaker per source, kept in
Postgres so every worker process shares one budget — "lrclib at 2/s" means 2/s for the
whole instance, not per process. No ad-hoc sleeps anywhere else.

- `acquire` takes a token in one statement. When the bucket is empty the token is taken
  on credit (tokens go negative) and the caller waits exactly the deficit, so concurrent
  callers queue up fairly instead of polling.
- `guard` wraps a call: an open breaker skips the source; 5 failures in a row open it
  for 5 minutes; a success closes it."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.errors import Unavailable

FAILURES_TO_OPEN = 5
OPEN_FOR = "5 minutes"


@dataclass(frozen=True)
class Source:
    name: str
    rate: float  # tokens per second
    burst: float = 1.0


_TAKE = sa.text("""
WITH seed AS (
    INSERT INTO rate_buckets (source, tokens) VALUES (:s, :burst) ON CONFLICT (source) DO NOTHING
)
UPDATE rate_buckets SET
    tokens = least(:burst, tokens + extract(epoch FROM clock_timestamp() - updated_at) * :rate) - 1,
    updated_at = clock_timestamp()
WHERE source = :s
RETURNING tokens
""")


async def acquire(sm: async_sessionmaker[AsyncSession], src: Source) -> None:
    async with sm() as s:
        tokens = await s.scalar(_TAKE, {"s": src.name, "rate": src.rate, "burst": src.burst})
        await s.commit()
    if tokens is None:  # the row was created by this very statement's CTE: not visible yet
        async with sm() as s:
            tokens = await s.scalar(_TAKE, {"s": src.name, "rate": src.rate, "burst": src.burst})
            await s.commit()
    if tokens is not None and tokens < 0:
        await asyncio.sleep(-float(tokens) / src.rate)


async def is_open(sm: async_sessionmaker[AsyncSession], name: str) -> bool:
    async with sm() as s:
        return bool(
            await s.scalar(
                sa.text("SELECT open_until > now() FROM source_health WHERE source = :s"),
                {"s": name},
            )
        )


async def record(
    sm: async_sessionmaker[AsyncSession], name: str, ok: bool, error: str | None = None
) -> None:
    async with sm() as s:
        if ok:
            await s.execute(
                sa.text(
                    "INSERT INTO source_health (source) VALUES (:s) ON CONFLICT (source) "
                    "DO UPDATE SET failures = 0, open_until = NULL"
                ),
                {"s": name},
            )
        else:
            await s.execute(
                sa.text(f"""
                INSERT INTO source_health (source, failures, last_error) VALUES (:s, 1, :e)
                ON CONFLICT (source) DO UPDATE SET
                    failures = CASE WHEN source_health.failures + 1 >= {FAILURES_TO_OPEN}
                                    THEN 0 ELSE source_health.failures + 1 END,
                    open_until = CASE WHEN source_health.failures + 1 >= {FAILURES_TO_OPEN}
                                      THEN now() + interval '{OPEN_FOR}'
                                      ELSE source_health.open_until END,
                    last_error = excluded.last_error
                """),  # noqa: S608 — constants, not input
                {"s": name, "e": (error or "")[:500]},
            )
        await s.commit()


async def guard[T](
    sm: async_sessionmaker[AsyncSession], src: Source, call: Callable[[], Awaitable[T]]
) -> T:
    """Run one call against `src` within its budget. A source error (an exception from
    `call`) counts toward its breaker and is re-raised; "no result" should be returned
    as None by `call`, not raised."""
    if await is_open(sm, src.name):
        raise Unavailable(f"{src.name} is failing; skipped", source=src.name)
    await acquire(sm, src)
    try:
        out = await call()
    except Exception as e:
        await record(sm, src.name, ok=False, error=f"{type(e).__name__}: {e}")
        raise
    await record(sm, src.name, ok=True)
    return out
