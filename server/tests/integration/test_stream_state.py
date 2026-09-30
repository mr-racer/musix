"""The «Поток» state: maintained incrementally, equal to a recompute from scratch."""

import datetime as dt
import random
import uuid
from collections import Counter

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from musix.contexts.library.models import tracks
from musix.contexts.listening.models import (
    account_artist_stats,
    account_genre_stats,
    account_track_stats,
)
from musix.recsys.outcome import outcome
from tests.integration.conftest import bearer

pytestmark = pytest.mark.integration


async def test_incremental_state_equals_a_recompute(sm, client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    tok, acct, ids = listener
    async with sm() as s:
        meta = {
            r.id: r
            for r in await s.execute(
                sa.select(
                    tracks.c.id, tracks.c.primary_artist_id, tracks.c.genre, tracks.c.duration_ms
                ).where(tracks.c.account_id == acct)
            )
        }
    rnd = random.Random(11)
    t0 = dt.datetime(2026, 9, 1, tzinfo=dt.UTC)
    events = []
    for i in range(120):  # both skip rules: long tracks (30 s) and short ones (25 %)
        dur = rnd.choice([None, 90_000, 240_000, 600_000])
        events.append(
            {
                "clientEventId": str(uuid.uuid4()),
                "sessionId": f"s{i // 20}",
                "trackId": str(rnd.choice(ids)),
                "startedAt": (t0 + dt.timedelta(minutes=4 * i)).isoformat(),
                "playedMs": rnd.choice([rnd.randint(0, 40_000), rnd.randint(40_000, 600_000)]),
                "durationMs": dur,
                "endReason": rnd.choice(["completed", "skipped", "stopped"]),
            }
        )
    batches = [events[i : i + 17] for i in range(0, 120, 17)]
    batches += rnd.sample(batches, 3)  # replayed outbox flushes
    rnd.shuffle(batches)
    for b in batches:
        assert (
            client.post(
                "/api/v2/events/listens:batch", json={"events": b}, headers=bearer(tok)
            ).status_code
            == 200
        )

    want_t: Counter[tuple[uuid.UUID, str]] = Counter()
    want_a: Counter[tuple[uuid.UUID, str]] = Counter()
    want_g: Counter[tuple[str, str]] = Counter()
    for e in events:
        m = meta[uuid.UUID(e["trackId"])]
        qskip, full = outcome(e["playedMs"], e["durationMs"] or m.duration_ms)
        for key, c in (("listens", True), ("fulls", full), ("quick_skips", qskip)):
            want_t[(m.id, key)] += c
            want_a[(m.primary_artist_id, key)] += c
            want_g[(m.genre or "Other", key)] += c

    async with sm() as s:
        for table, key, want in (
            (account_track_stats, account_track_stats.c.track_id, want_t),
            (account_artist_stats, account_artist_stats.c.artist_id, want_a),
            (account_genre_stats, account_genre_stats.c.genre, want_g),
        ):
            rows = await s.execute(
                sa.select(key, table.c.listens, table.c.fulls, table.c.quick_skips).where(
                    table.c.account_id == acct
                )
            )
            got = Counter()
            for k, n, f, q in rows:
                got.update({(k, "listens"): n, (k, "fulls"): f, (k, "quick_skips"): q})
            assert +got == +want, table.name
