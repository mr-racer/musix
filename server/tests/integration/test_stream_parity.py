"""Training/serving parity: the features the online path computes from the database
equal the replay's for the same moment (stream spec §12.3)."""

import datetime as dt
import random
import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient

from musix.contexts.stream import history, state
from musix.recsys import features
from musix.recsys import replay as R
from tests.integration.conftest import bearer

pytestmark = pytest.mark.integration


async def test_online_features_equal_the_replay(sm, client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    tok, acct, ids = listener
    h = bearer(tok)
    now = dt.datetime.now(dt.UTC)
    rnd = random.Random(5)
    events = []
    for i in range(40):  # two sessions: an old one, and one still going
        at = (
            now - dt.timedelta(hours=10) + dt.timedelta(minutes=4 * i)
            if i < 20
            else now - dt.timedelta(minutes=4 * (40 - i))
        )
        events.append(
            {
                "clientEventId": str(uuid.uuid4()),
                "sessionId": "p",
                "trackId": str(rnd.choice(ids)),
                "startedAt": at.isoformat(),
                "playedMs": rnd.choice([5_000, 100_000, 230_000]),
                "durationMs": 240_000,
                "endReason": "stopped",
            }
        )
    assert (
        client.post("/api/v2/events/listens:batch", json={"events": events}, headers=h).status_code
        == 200
    )
    client.post(
        f"/api/v2/tracks/{ids[0]}/signals",
        json={"kind": "fire", "clientEventId": str(uuid.uuid4())},
        headers=h,
    )
    now = dt.datetime.now(dt.UTC)

    async with sm() as s:
        snap = await state.load(s, acct, "p", now, 0)
        rows = await state.candidates(s, acct, [str(t) for t in ids], now)
        meta, ls, sg = await history.load(s, acct)
    online = features.matrix(snap.acc, snap.sess, [rows[str(t)].cand for t in ids])
    st = next(st for st, row in reversed(list(R.replay(meta, ls, sg))) if row is None)
    offline = features.matrix(st.account(), st.session(now), [st.cand(str(t), now) for t in ids])
    assert len(snap.sess) == 20  # the live session only
    assert np.allclose(online, offline, equal_nan=True), [
        f
        for f, a, b in zip(features.FEATURES, online.T, offline.T, strict=True)
        if not np.allclose(a, b, equal_nan=True)
    ]
