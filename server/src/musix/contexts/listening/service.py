"""Listen events and огонёк/вода signals.

The playback path does nothing synchronous beyond the insert: stats are kept in the same
transaction (so no read path ever scans events) and phase 2's stream state picks the
batch up from the NOTIFY."""

from __future__ import annotations

import datetime as dt
import json
import uuid

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, distinct_on
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.library.service import own_track_ids
from musix.contexts.listening import schemas as S
from musix.contexts.listening.models import taste_signals
from musix.errors import Conflict, NotFound
from musix.infra.changelog import CHANNEL, record_change

COMPLETE_SHARE = 0.9
H_REACTION_DAYS = 1.0  # v1: the «заряд» halves in a day; the button unlocks at 0.5


def now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _end_reason(e: S.ListenIn) -> str:
    """Clients report what ended playback; a track heard to ≥ 90% counts as completed
    whatever ended it (a skip in the outro is not a skip)."""
    heard = bool(e.duration_ms) and e.played_ms >= COMPLETE_SHARE * (e.duration_ms or 0)
    if e.end_reason in ("skipped", "stopped") and heard:
        return "completed"
    return e.end_reason


# One statement, one round trip: the batch is checked against the account's tracks,
# inserted idempotently (ON CONFLICT DO NOTHING), and only the rows actually inserted are
# folded into account_track_stats — so a replayed outbox flush changes nothing. The stats
# rows are upserted in track order: one lock order for everyone, or concurrent batches
# over the same tracks deadlock (seen in the phase-1 bench). pg_notify is transactional.
_INGEST = sa.text("""
WITH input AS (
    SELECT * FROM jsonb_to_recordset(:events) AS x(
        client_event_id uuid, session_id text, track_id uuid, started_at timestamptz,
        played_ms int, duration_ms int, end_reason text, skipped_early bool,
        interacted bool, influence bool, source text, context_type text, context_id text)
), valid AS (
    SELECT i.* FROM input i
    JOIN tracks t ON t.id = i.track_id AND t.account_id = :account AND t.deleted_at IS NULL
), ins AS (
    INSERT INTO listen_events (client_event_id, account_id, device_id, session_id, track_id,
        started_at, played_ms, duration_ms, end_reason, skipped_early, interacted, influence,
        source, context_type, context_id)
    SELECT client_event_id, :account, :device, session_id, track_id, started_at, played_ms,
        duration_ms, end_reason, skipped_early, interacted, influence, source, context_type,
        context_id
    FROM valid
    ON CONFLICT (client_event_id) DO NOTHING
    RETURNING track_id, started_at, played_ms, end_reason, skipped_early
), agg AS (
    SELECT track_id,
        count(*) FILTER (WHERE NOT skipped_early) AS plays,  -- v1: a play = not skipped early
        count(*) FILTER (WHERE end_reason = 'completed') AS completes,
        count(*) FILTER (WHERE end_reason = 'skipped') AS skips,
        sum(played_ms) AS ms, min(started_at) AS first, max(started_at) AS last
    FROM ins GROUP BY track_id
), up AS (
    INSERT INTO account_track_stats AS s (account_id, track_id, plays, completes, skips,
        total_played_ms, first_played_at, last_played_at)
    SELECT :account, track_id, plays, completes, skips, ms, first, last FROM agg ORDER BY track_id
    ON CONFLICT (account_id, track_id) DO UPDATE SET
        plays = s.plays + excluded.plays,
        completes = s.completes + excluded.completes,
        skips = s.skips + excluded.skips,
        total_played_ms = s.total_played_ms + excluded.total_played_ms,
        first_played_at = least(s.first_played_at, excluded.first_played_at),
        last_played_at = greatest(s.last_played_at, excluded.last_played_at)
    RETURNING 1
)
SELECT
    (SELECT count(*) FROM ins) AS inserted,
    (SELECT count(*) FROM valid) AS valid,
    (SELECT coalesce(array_agg(client_event_id), '{}') FROM input
        WHERE client_event_id NOT IN (SELECT client_event_id FROM valid)) AS rejected,
    (SELECT count(*) FROM up) AS stats,
    CASE WHEN EXISTS (SELECT 1 FROM ins) THEN pg_notify(:channel, :payload) END AS notified
""").bindparams(sa.bindparam("events", type_=JSONB))


async def ingest_listens(
    s: AsyncSession, account_id: uuid.UUID, device_id: uuid.UUID, body: S.ListenBatchIn
) -> S.ListenBatchOut:
    events = [
        {**e.model_dump(mode="json", exclude={"end_reason"}), "end_reason": _end_reason(e)}
        for e in body.events
    ]
    row = (
        await s.execute(
            _INGEST,
            {
                "events": events,
                "account": account_id,
                "device": device_id,
                "channel": CHANNEL,
                "payload": json.dumps({"account": str(account_id), "kind": "listens"}),
            },
        )
    ).one()
    await s.commit()
    return S.ListenBatchOut(
        accepted=row.inserted, duplicates=row.valid - row.inserted, rejected=list(row.rejected)
    )


def charge(age_days: float) -> float:
    """v1 `reaction_contribution`: 1.0 fresh, 0.5 at one day, decaying toward 0."""
    return 1.0 if age_days <= 0 else max(0.0, min(1.0, 0.5 ** (age_days / H_REACTION_DAYS)))


def state_of(kind: str, created_at: dt.datetime, at: dt.datetime) -> S.SignalState:
    c = charge((at - created_at).total_seconds() / 86400)
    return S.SignalState(kind=kind, contribution=round(c, 4), locked=c > 0.5)  # type: ignore[arg-type]


async def signal_states(
    s: AsyncSession, account_id: uuid.UUID, track_ids: list[uuid.UUID]
) -> dict[uuid.UUID, S.SignalState]:
    """The newest signal per track wins (v1 semantics)."""
    ts = taste_signals.c
    rows = await s.execute(
        sa.select(ts.track_id, ts.kind, ts.created_at)
        .where(ts.account_id == account_id, ts.track_id.in_(track_ids))
        .ext(distinct_on(ts.track_id))
        .order_by(ts.track_id, ts.created_at.desc())
    )
    t = now()
    return {r.track_id: state_of(r.kind, r.created_at, t) for r in rows}


async def add_signal(
    s: AsyncSession, account_id: uuid.UUID, track_id: uuid.UUID, body: S.SignalIn
) -> S.SignalState:
    if not await own_track_ids(s, account_id, [track_id]):
        raise NotFound("track")
    current = (await signal_states(s, account_id, [track_id])).get(track_id)
    if current and current.locked and current.kind == body.kind:
        return current  # the same button is still locked: nothing to add
    hit = await s.scalar(
        pg_insert(taste_signals)
        .values(
            client_event_id=body.client_event_id,
            account_id=account_id,
            session_id=body.session_id,
            track_id=track_id,
            kind=body.kind,
        )
        .on_conflict_do_nothing(index_elements=["client_event_id"])
        .returning(taste_signals.c.id)
    )
    if hit is not None:
        await record_change(s, account_id, "signalState", track_id)
    else:
        same = await s.scalar(
            sa.select(taste_signals.c.id).where(
                taste_signals.c.client_event_id == body.client_event_id,
                taste_signals.c.account_id == account_id,
                taste_signals.c.track_id == track_id,
            )
        )
        if same is None:
            raise Conflict("clientEventId was used for another signal")
    await s.commit()
    return (await signal_states(s, account_id, [track_id]))[track_id]
