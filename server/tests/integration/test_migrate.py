"""The v1 → v2 migrator (tools/migrate) on a tiny synthetic v1 snapshot."""

import datetime as dt
import hashlib
import json
import sqlite3
import sys
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa

from tests.integration.conftest import AUDIO

pytestmark = pytest.mark.integration
TOOLS = Path(__file__).resolve().parents[3] / "tools" / "migrate"
FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def snapshot(root: Path) -> tuple[Path, str, list[str]]:
    """A v1 snapshot: one account, three tracks, three listens, a signal, a playlist."""
    snap = root / "snap"
    (snap / "qdrant").mkdir(parents=True)
    user = uuid.uuid4().hex
    tracks = [str(uuid.uuid4()) for _ in range(3)]
    sq = sqlite3.connect(snap / "metadata.db")
    sq.executescript((FIXTURES / "v1_schema.sql").read_text())
    now = dt.datetime(2026, 9, 1, 12, 0).timestamp()
    sq.execute(
        "insert into users (id, email, password_hash, role, created_at) values (?, ?, 'argon2id$x', 'member', ?)",
        (user, f"mig-{user[:8]}@example.com", now),
    )
    coll = f"acct_{user}"
    sq.execute(
        "insert into collection_settings (collection_name, ai_enabled, stream_liked_share) values (?, 1, 0.9)",
        (coll,),
    )
    files = []
    for tid, name in zip(tracks, ("tiny.flac", "tiny.mp3", "tiny.m4a"), strict=True):
        p = AUDIO / name
        files.append(
            {
                "path": f"/music/{name}",
                "size": p.stat().st_size,
                "mtime": p.stat().st_mtime,
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            }
        )
        sq.execute(
            "insert into track_metadata (collection_name, track_id, title, artist, duration, file_path) "
            "values (?, ?, ?, 'Band', 100.0, ?)",
            (coll, tid, f"Song {name}", f"/music/{name}"),
        )
    for i, (tid, played, early) in enumerate(
        ((tracks[0], 100, 0), (tracks[1], 5, 1), (tracks[2], 50, 0)), 1
    ):
        sq.execute(
            "insert into playback_events (id, session_id, collection_name, track_id, played_at, played_sec, "
            "total_dur, skipped_early) values (?, 's1', ?, ?, ?, ?, 100, ?)",
            (i, coll, tid, f"2026-09-0{i} 10:00:00", played, early),
        )
    sq.execute(
        "insert into taste_signals (collection_name, session_id, track_id, kind, created_at) "
        "values (?, 's1', ?, 'fire', '2026-09-02 10:01:00')",
        (coll, tracks[0]),
    )
    sq.execute("insert into playlists (id, collection_name, name) values (7, ?, 'Mix')", (coll,))
    for pos, tid in enumerate((tracks[2], tracks[0], tracks[1])):
        sq.execute(
            "insert into playlist_tracks (playlist_id, track_id, position) values (7, ?, ?)",
            (tid, pos),
        )
    sq.commit()
    sq.close()
    (snap / "manifest.json").write_text(
        json.dumps({"host_map": {"/music/": f"{AUDIO}/"}, "files": files})
    )
    return snap, user, tracks


async def test_the_migrator_keeps_v1_ids_maps_listens_and_reruns_to_the_same_state(
    settings, tmp_path
) -> None:  # type: ignore[no-untyped-def]
    sys.path.insert(0, str(TOOLS))
    import migrate as M

    snap, user, tids = snapshot(tmp_path)
    acct = uuid.UUID(hex=user)
    q = sa.text("""SELECT (SELECT count(*) FROM tracks WHERE account_id = :a), (SELECT count(*) FROM listen_events WHERE account_id = :a),
                          (SELECT count(*) FROM taste_signals WHERE account_id = :a),
                          (SELECT count(*) FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id WHERE p.account_id = :a),
                          (SELECT sum(plays) FROM account_track_stats WHERE account_id = :a)""")
    states = []
    for _ in range(2):  # the second run must change nothing
        m = M.Migrator(snap, settings.database_url, settings.qdrant_url)
        for stage in ("accounts", "library", "listening"):
            await getattr(m, stage)()
        async with m.sm() as s:
            states.append(tuple((await s.execute(q, {"a": acct})).one()))
            got_ids = {
                str(t)
                for t in await s.scalars(
                    sa.text("SELECT id FROM tracks WHERE account_id = :a"), {"a": acct}
                )
            }
            reasons = dict(
                (
                    await s.execute(
                        sa.text(
                            "SELECT track_id::text, end_reason FROM listen_events WHERE account_id = :a"
                        ),
                        {"a": acct},
                    )
                ).all()
            )
            first_event = await s.scalar(
                sa.text(
                    "SELECT client_event_id FROM listen_events WHERE account_id = :a AND track_id = :t"
                ),
                {"a": acct, "t": uuid.UUID(tids[0])},
            )
            order = [
                str(t)
                for t in await s.scalars(
                    sa.text(
                        "SELECT i.track_id FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id WHERE p.account_id = :a "
                        "ORDER BY i.position"
                    ),
                    {"a": acct},
                )
            ]
            stream = await s.scalar(
                sa.text(
                    "SELECT value -> 'stream' ->> 'familiarity' FROM account_settings WHERE account_id = :a"
                ),
                {"a": acct},
            )
            device = await s.scalar(
                sa.text("SELECT name FROM devices WHERE account_id = :a"), {"a": acct}
            )
        await m.close()
    assert got_ids == set(tids)  # v1's track ids survive: clients cache them
    assert reasons == {tids[0]: "completed", tids[1]: "skipped", tids[2]: "stopped"}
    assert first_event == uuid.uuid5(M.NS, "event:1")
    assert order == [tids[2], tids[0], tids[1]]  # v1's positions, as fractional keys
    assert stream == "favorites"  # the liked-share slider at 0.9 (stream spec §4)
    assert device == "legacy-v1"
    assert states[0] == states[1] == (3, 3, 1, 3, 2)  # plays: the early skip is not one


async def _migrated(settings, tmp_path):  # type: ignore[no-untyped-def]
    sys.path.insert(0, str(TOOLS))
    import migrate as M
    import verify as V

    snap, user, tids = snapshot(tmp_path)
    # a database of its own: verify counts the whole target, as the cutover's is
    admin = settings.database_url.rsplit("/", 1)[0] + "/postgres"
    url = await M.prepare(admin, f"mig_{uuid.uuid4().hex[:8]}", True, settings.qdrant_url)
    m = M.Migrator(snap, url, settings.qdrant_url)
    for stage in ("accounts", "library", "listening"):
        await getattr(m, stage)()
    clean = await V.run_verify(m, with_gates=False, write=False)
    return m, V, clean, uuid.UUID(hex=user), tids


async def test_verify_flags_a_listen_the_migration_lost(settings, tmp_path) -> None:  # type: ignore[no-untyped-def]
    m, V, clean, acct, tids = await _migrated(settings, tmp_path)
    async with m.sm() as s:
        await s.execute(
            sa.text("DELETE FROM listen_events WHERE account_id = :a AND track_id = :t"),
            {"a": acct, "t": uuid.UUID(tids[2])},
        )
        await s.commit()
    got = await V.run_verify(m, with_gates=False, write=False)
    await m.close()
    assert clean["ok"], clean["first"]
    assert not got["ok"]
    assert any(f.startswith("count listens: v1 3 − 0 ≠ v2 2") for f in got["first"])


async def test_verify_flags_a_changed_playlist_order(settings, tmp_path) -> None:  # type: ignore[no-untyped-def]
    m, V, clean, _acct, tids = await _migrated(settings, tmp_path)
    async with m.sm() as s:  # the first and the last item swap places
        await s.execute(
            sa.text("""
            UPDATE playlist_items i SET position = CASE WHEN i.track_id = :a THEN (SELECT position FROM playlist_items WHERE track_id = :b)
                                                        ELSE (SELECT position FROM playlist_items WHERE track_id = :a) END
            WHERE i.track_id IN (:a, :b)"""),
            {"a": uuid.UUID(tids[2]), "b": uuid.UUID(tids[1])},
        )
        await s.commit()
    got = await V.run_verify(m, with_gates=False, write=False)
    await m.close()
    assert clean["ok"], clean["first"]
    assert got["failures"] == 1
    assert "playlist sequences" in got["first"][0]
