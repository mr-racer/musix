"""The sound engine against real Postgres (spec sound-engine §3, §4, §10, §14): an indexed song
queues its analysis, the lease lends ml's card to ml-sound and takes it back, a finished batch
becomes a profile the API reads. ml and ml-sound are fakes; the batch's measures are a demo
track's, stored by the real measure()."""

from __future__ import annotations

import base64
import gzip
import json
import uuid
from pathlib import Path
from typing import Any

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import insert as pg_insert

from musix.contexts.intel import pipeline
from musix.contexts.library.models import media_files, tracks
from musix.contexts.sound import tasks
from musix.contexts.sound.models import gpu_lease, sound_analysis, sound_profiles
from musix.infra import vectors
from musix.infra.queue import make_queue_app
from musix.settings import Settings
from tests.integration.conftest import bearer
from tests.integration.test_intel import _CpuOnlyMl

pytestmark = pytest.mark.integration
POWER = json.loads((Path(__file__).parents[1] / "fixtures" / "sound" / "power.json").read_text())[
    "measures"
]
SA = sound_analysis.c


class FakeSound:
    """ml-sound and ml's lease endpoints: one batch that finishes at once."""

    def __init__(self) -> None:
        self.ml = "loaded"
        self.running: str | None = None
        self.items: list[dict[str, Any]] = []
        self.calls: list[str] = []

    async def sound_health(self) -> dict[str, Any] | None:
        return {"ok": True, "batch": self.running}

    async def ml_gpu(self) -> str | None:
        return self.ml

    async def ml_release(self) -> None:
        self.calls.append("release")
        self.ml = "lent"

    async def ml_acquire(self) -> None:
        self.calls.append("acquire")
        self.ml = "loaded"

    async def start_batch(self, items: list[dict[str, Any]]) -> str:
        self.items, self.running = items, "b1"
        return "b1"

    async def batch(self, batch_id: str, since: int) -> dict[str, Any] | None:
        done = [
            {
                "id": it["id"],
                "measures": POWER,
                "stage_frames_b64": base64.b64encode(gzip.compress(bytes(120))).decode(),
                "gpu_ms": 50_000,
                "cpu_ms": 4_000,
            }
            for it in self.items
        ]
        self.running = None
        return {"state": "done", "done": done[since:], "n_done": len(done), "failed": []}

    async def close(self) -> None:
        pass


async def _holder(sm) -> str:  # type: ignore[no-untyped-def]
    async with sm() as s:
        return str(await s.scalar(sa.select(gpu_lease.c.holder).where(gpu_lease.c.id == 1)))


async def _jobs(sm, task: str) -> int:  # type: ignore[no-untyped-def]
    async with sm() as s:
        return int(
            await s.scalar(
                sa.text("select count(*) from procrastinate_jobs where task_name = :t"),
                {"t": task},
            )
            or 0
        )


async def test_the_card_goes_to_sound_and_back_and_the_profile_reads_back(
    sm,
    settings: Settings,
    client: TestClient,
    listener,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tok, _, ids = listener
    async with sm() as s:
        mfs = list(
            await s.scalars(
                sa.select(tracks.c.media_file_id)
                .where(tracks.c.id.in_(ids[:2]))
                .order_by(tracks.c.id)
            )
        )
    short, song = mfs

    # the fixtures are 3 s long: indexing queues the row as skipped, with the reason
    q = vectors.client(settings.qdrant_url)
    await pipeline.embed_step(sm, _CpuOnlyMl(), q, short)  # type: ignore[arg-type]
    await q.close()
    async with sm() as s:
        row = (
            await s.execute(sa.select(SA.state, SA.error).where(SA.media_file_id == short))
        ).one()
    assert row.state == "skipped"
    assert "outside" in row.error
    assert await _holder(sm) == "ml"  # migration 0029's seed

    # the other one as if it were a full song, ready for the GPU
    async with sm() as s:
        await s.execute(
            sa.update(media_files)
            .where(media_files.c.id == song)
            .values(state="media_done", intel_state="indexed")
        )
        await s.execute(  # media files are shared by content: another test may have its row
            pg_insert(sound_analysis)
            .values(media_file_id=song, priority=100, state="pending")
            .on_conflict_do_update(
                index_elements=["media_file_id"], set_={"state": "pending", "priority": 100}
            )
        )
        await s.commit()

    import musix.workers.app as workers

    qapp = make_queue_app(settings)
    monkeypatch.setattr(tasks, "sessionmaker", lambda: sm)
    monkeypatch.setattr(workers, "app", qapp)
    fake = FakeSound()
    async with qapp.open_async():
        assert await tasks._tick(fake) == "to_sound"  # type: ignore[arg-type]
        assert await _holder(sm) == "sound"
        assert fake.calls == ["release"]
        assert [i["id"] for i in fake.items] == [str(song)]
        assert await _jobs(sm, "sound:batch") == 1

        assert await tasks._follow(fake, "b1") == 1  # type: ignore[arg-type]
        async with sm() as s:
            st = await s.scalar(sa.select(SA.state).where(SA.media_file_id == song))
            prof = (
                await s.execute(
                    sa.select(sound_profiles.c.tech, sound_profiles.c.drums).where(
                        sound_profiles.c.media_file_id == song
                    )
                )
            ).one()
        assert st == "done"
        assert prof.drums == "machine"

        async with sm() as s:  # what the worker does when _follow returns
            await s.execute(
                sa.text(
                    "update procrastinate_jobs set status = 'succeeded'"
                    " where task_name = 'sound:batch'"
                )
            )
            await s.commit()
        assert await tasks._tick(fake) == "to_ml"  # type: ignore[arg-type]
        assert await _holder(sm) == "ml"
        assert fake.calls == ["release", "acquire"]
        assert await _jobs(sm, "sound:signature") == 1  # texts only once ml holds the card

    h = bearer(tok)
    r = client.get(f"/api/v2/tracks/{ids[1]}/sound", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ratings"]["tech"] == prof.tech
    assert body["drums"]["key"] == "machine"
    assert body["hasStage"] is True
    assert body["moments"]
    # the stage names its parts; Power's voice is just «голос», no gender (2026-10-25)
    stage_names = {x["stem"]: x["name"]["key"] for x in body["stage"]}
    assert stage_names["vocals"] == "voice" and "part" not in stage_names.values()
    assert (
        client.get(
            f"/api/v2/tracks/{ids[1]}/sound", headers={**h, "If-None-Match": r.headers["etag"]}
        ).status_code
        == 304
    )
    stage = client.get(f"/api/v2/tracks/{ids[1]}/sound/stage", headers=h)
    assert stage.status_code == 200
    assert stage.headers["x-stage-fps"] == "10"
    assert stage.headers["x-stage-stems"].split(",")[0] == "vocals"

    r = client.get(f"/api/v2/tracks/{ids[0]}/sound", headers=h)
    assert r.status_code == 404
    assert r.json()["state"] == "skipped"
    assert client.get(f"/api/v2/tracks/{uuid.uuid4()}/sound", headers=h).status_code == 404
