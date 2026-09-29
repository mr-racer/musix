"""Listen events and огонёк/вода signals.

The playback path does nothing synchronous beyond the insert: stats are kept in the same
transaction (so no read path ever scans events) and phase 2's stream state picks the
batch up from the NOTIFY."""

from __future__ import annotations

import datetime as dt
import uuid

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.library.service import own_track_ids
from musix.contexts.listening import schemas as S
from musix.contexts.listening.models import account_track_stats, listen_events, taste_signals
from musix.errors import NotFound
from musix.infra.changelog import notify, record_change

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


async def ingest_listens(
    s: AsyncSession, account_id: uuid.UUID, device_id: uuid.UUID, body: S.ListenBatchIn
) -> S.ListenBatchOut:
    own = await own_track_ids(s, account_id, (e.track_id for e in body.events))
    good = [e for e in body.events if e.track_id in own]
    rejected = [e.client_event_id for e in body.events if e.track_id not in own]
    if not good:
        return S.ListenBatchOut(accepted=0, duplicates=0, rejected=rejected)
    # ON CONFLICT DO NOTHING + RETURNING: stats come from the rows actually inserted,
    # so a replayed outbox flush changes nothing
    inserted = (
        await s.execute(
            pg_insert(listen_events)
            .values(
                [
                    {
                        **e.model_dump(exclude={"end_reason"}),
                        "end_reason": _end_reason(e),
                        "account_id": account_id,
                        "device_id": device_id,
                    }
                    for e in good
                ]
            )
            .on_conflict_do_nothing(index_elements=["client_event_id"])
            .returning(
                listen_events.c.track_id,
                listen_events.c.started_at,
                listen_events.c.played_ms,
                listen_events.c.end_reason,
                listen_events.c.skipped_early,
            )
        )
    ).all()
    # one row per track: ON CONFLICT DO UPDATE may not touch the same row twice
    agg: dict[uuid.UUID, dict] = {}  # type: ignore[type-arg]
    for r in inserted:
        a = agg.setdefault(
            r.track_id,
            {
                "plays": 0,
                "completes": 0,
                "skips": 0,
                "ms": 0,
                "first": r.started_at,
                "last": r.started_at,
            },
        )
        a["plays"] += not r.skipped_early  # v1: a play is any listen not skipped early
        a["completes"] += r.end_reason == "completed"
        a["skips"] += r.end_reason == "skipped"
        a["ms"] += r.played_ms
        a["first"] = min(a["first"], r.started_at)
        a["last"] = max(a["last"], r.started_at)
    if agg:
        st = account_track_stats.c
        ins = pg_insert(account_track_stats).values(
            [
                {
                    "account_id": account_id,
                    "track_id": tid,
                    "plays": a["plays"],
                    "completes": a["completes"],
                    "skips": a["skips"],
                    "total_played_ms": a["ms"],
                    "first_played_at": a["first"],
                    "last_played_at": a["last"],
                }
                for tid, a in agg.items()
            ]
        )
        x = ins.excluded
        await s.execute(
            ins.on_conflict_do_update(
                index_elements=["account_id", "track_id"],
                set_={
                    "plays": st.plays + x.plays,
                    "completes": st.completes + x.completes,
                    "skips": st.skips + x.skips,
                    "total_played_ms": st.total_played_ms + x.total_played_ms,
                    "first_played_at": sa.func.least(st.first_played_at, x.first_played_at),
                    "last_played_at": sa.func.greatest(st.last_played_at, x.last_played_at),
                },
            )
        )
        await notify(s, account_id, "listens")
    await s.commit()
    return S.ListenBatchOut(
        accepted=len(inserted), duplicates=len(good) - len(inserted), rejected=rejected
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
    await s.commit()
    return (await signal_states(s, account_id, [track_id]))[track_id]
