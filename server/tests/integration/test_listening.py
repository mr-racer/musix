"""Listen events + stats, огонёк/вода state, playlist ordering."""

import datetime as dt
import random
import uuid

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from musix.contexts.listening.models import account_track_stats, taste_signals
from musix.contexts.playlists.models import playlist_items
from musix.infra.tables import change_log
from tests.integration.conftest import bearer

pytestmark = pytest.mark.integration
T0 = dt.datetime(2026, 9, 1, 12, tzinfo=dt.UTC)


def event(track: uuid.UUID, **kw: object) -> dict[str, object]:
    return {
        "clientEventId": str(uuid.uuid4()),
        "sessionId": "s1",
        "trackId": str(track),
        "startedAt": T0.isoformat(),
        "playedMs": 150_000,
        "durationMs": 200_000,
        "endReason": "completed",
        **kw,
    }


async def _stats(sm, acct: uuid.UUID) -> dict[uuid.UUID, tuple]:  # type: ignore[no-untyped-def,type-arg]
    st = account_track_stats.c
    async with sm() as s:
        rows = await s.execute(
            sa.select(
                st.track_id,
                st.plays,
                st.completes,
                st.skips,
                st.total_played_ms,
                st.first_played_at,
                st.last_played_at,
            ).where(st.account_id == acct)
        )
        return {r[0]: tuple(r[1:]) for r in rows}


async def test_replayed_batch_is_a_noop(sm, client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    tok, acct, (a, b, _) = listener
    batch = {"events": [event(a), event(a, endReason="skipped", skippedEarly=True), event(b)]}
    first = client.post("/api/v2/events/listens:batch", json=batch, headers=bearer(tok)).json()
    assert first == {"accepted": 3, "duplicates": 0, "rejected": []}
    before = await _stats(sm, acct)
    again = client.post("/api/v2/events/listens:batch", json=batch, headers=bearer(tok)).json()
    assert again == {"accepted": 0, "duplicates": 3, "rejected": []}
    assert await _stats(sm, acct) == before


async def test_stats_match_the_events(sm, client: TestClient, owner, listener) -> None:  # type: ignore[no-untyped-def]
    tok, acct, ids = listener
    rnd = random.Random(3)
    events = []
    for i in range(60):
        played = rnd.randint(0, 200_000)
        events.append(
            event(
                rnd.choice(ids),
                startedAt=(T0 + dt.timedelta(minutes=i)).isoformat(),
                playedMs=played,
                endReason=rnd.choice(["completed", "skipped", "stopped", "error"]),
                skippedEarly=played < 30_000,
            )
        )
    foreign = event(uuid.uuid4())  # not this account's track
    h = bearer(tok)
    r1 = client.post("/api/v2/events/listens:batch", json={"events": events[:40]}, headers=h).json()
    r2 = client.post(
        "/api/v2/events/listens:batch", json={"events": [*events[30:], foreign]}, headers=h
    ).json()
    assert (r1["accepted"], r2["accepted"], r2["duplicates"]) == (40, 20, 10)
    assert r2["rejected"] == [foreign["clientEventId"]]

    want: dict[uuid.UUID, list] = {}  # type: ignore[type-arg]
    for e in events:
        reason = e["endReason"]
        if reason in ("skipped", "stopped") and e["playedMs"] >= 0.9 * 200_000:  # type: ignore[operator]
            reason = "completed"
        started = dt.datetime.fromisoformat(str(e["startedAt"]))
        w = want.setdefault(uuid.UUID(str(e["trackId"])), [0, 0, 0, 0, started, started])
        w[0] += not e["skippedEarly"]
        w[1] += reason == "completed"
        w[2] += reason == "skipped"
        w[3] += e["playedMs"]
        w[4], w[5] = min(w[4], started), max(w[5], started)
    assert await _stats(sm, acct) == {k: tuple(v) for k, v in want.items()}


async def test_signal_charge_and_lock_over_time(sm, client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    tok, acct, (a, *_) = listener
    h, url = bearer(tok), f"/api/v2/tracks/{a}/signals"

    def fire(kind: str = "fire") -> dict[str, object]:
        r = client.post(url, json={"kind": kind, "clientEventId": str(uuid.uuid4())}, headers=h)
        assert r.status_code == 200, r.text
        return dict(r.json())

    assert fire() == {"kind": "fire", "contribution": 1.0, "locked": True}
    assert fire()["locked"]  # still locked: the second tap adds nothing
    async with sm() as s:
        n = await s.scalar(sa.select(sa.func.count()).where(taste_signals.c.account_id == acct))
        assert n == 1
        await s.execute(
            sa.update(taste_signals)
            .where(taste_signals.c.account_id == acct)
            .values(created_at=sa.func.now() - dt.timedelta(days=1.5))
        )
        await s.commit()
    state = client.get(f"/api/v2/signals/state?trackIds={a}", headers=h).json()["states"][str(a)]
    assert state["kind"] == "fire"
    assert not state["locked"]
    assert state["contribution"] == pytest.approx(0.5**1.5, abs=1e-3)
    assert fire("water") == {"kind": "water", "contribution": 1.0, "locked": True}


async def test_moving_an_item_touches_one_row(sm, client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    tok, acct, (a, b, c) = listener
    h = bearer(tok)
    pl = client.post("/api/v2/playlists", json={"name": "mix"}, headers=h).json()
    base = f"/api/v2/playlists/{pl['id']}/items"
    items = client.post(
        base, json={"items": [{"trackId": str(t)} for t in (a, b, c, a, b)]}, headers=h
    ).json()
    ids = [i["itemId"] for i in items]

    async def snapshot() -> tuple[dict[str, str], int]:
        async with sm() as s:
            pos = dict(
                (str(k), v)
                for k, v in await s.execute(
                    sa.select(playlist_items.c.item_id, playlist_items.c.position).where(
                        playlist_items.c.playlist_id == uuid.UUID(pl["id"])
                    )
                )
            )
            seq = await s.scalar(
                sa.select(sa.func.max(change_log.c.seq)).where(change_log.c.account_id == acct)
            )
            return pos, int(seq or 0)

    before, seq0 = await snapshot()
    r = client.patch(f"{base}/{ids[4]}", json={"afterItemId": ids[0]}, headers=h)
    assert r.status_code == 200, r.text
    after, seq1 = await snapshot()
    assert [k for k in before if before[k] != after[k]] == [ids[4]]
    assert seq1 == seq0 + 1
    order = [i["itemId"] for i in client.get(base, headers=h).json()]
    assert order == [ids[0], ids[4], ids[1], ids[2], ids[3]]
    client.patch(f"{base}/{ids[3]}", json={"afterItemId": None}, headers=h)
    assert client.get(base, headers=h).json()[0]["itemId"] == ids[3]
