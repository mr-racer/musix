"""Worker tasks of the sound engine (spec §3, §4, §11).

    intel:embed ── a song is indexed ──→ sound_analysis row: pending (priority 100)
    sound:tick (every minute) ── decide() ──→ ml lends the card → start a batch on ml-sound
    sound:batch (queue sound) ── polls the batch, writes each finished track at once
                                 (measures → derive → sound_profiles)
    nothing pending ──→ the card goes back to ml, the waiting text vectors run now

Sound never gates `ready`: a song plays and is found before its analysis exists."""

from __future__ import annotations

import asyncio
import base64
import contextlib
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import procrastinate
import sqlalchemy as sa
from procrastinate.exceptions import AlreadyEnqueued
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.knowledge.models import song_credits, song_relations, song_tags
from musix.contexts.library.models import albums, artists, lyrics, media_files, renditions, tracks
from musix.contexts.sound import albums as A
from musix.contexts.sound import derive as D
from musix.contexts.sound.client import SoundClient
from musix.contexts.sound.lease import World, decide
from musix.contexts.sound.models import gpu_lease, sound_analysis, sound_profiles, sound_texts
from musix.contexts.sound.rows import MAX_MS, MIN_MS, UPLOAD
from musix.errors import Unavailable
from musix.workers.context import sessionmaker, settings

log = logging.getLogger("musix.sound")
SA, M, T = sound_analysis.c, media_files.c, tracks.c
BATCH_SIZE = 16  # ~15-20 min a batch: model loads stay ~5 % of it, and it bounds the swap rate
MAX_ATTEMPTS = 3
BACKFILL_TOP = 99
POLL_S = 10
EXTRACTOR_VER = 2  # musix_sound.measure.VERSION the rows were measured with
READY = sa.and_(SA.state == "pending", M.state == "media_done", M.intel_state == "indexed")


def _client() -> SoundClient | None:
    s = settings()
    return SoundClient(s.ml_sound_url, s.ml_url) if s.ml_sound_url else None


# ── the tick ──────────────────────────────────────────────────────────────────


async def _snapshot(c: SoundClient) -> World:
    health = await c.sound_health()
    async with sessionmaker()() as s:
        holder = await s.scalar(sa.select(gpu_lease.c.holder).where(gpu_lease.c.id == 1))
        up, bf = (
            await s.execute(
                sa.select(
                    sa.func.count().filter(SA.priority >= UPLOAD),
                    sa.func.count().filter(SA.priority < UPLOAD),
                )
                .select_from(sound_analysis.join(media_files, M.id == SA.media_file_id))
                .where(READY)
            )
        ).one()
        q = (
            await s.execute(
                sa.text("""
                SELECT
                  bool_or(queue_name IN ('media', 'ml') AND status = 'doing'),
                  count(*) FILTER (WHERE queue_name = 'gpu' AND status = 'todo'),
                  bool_or(task_name = 'sound:batch' AND status IN ('todo', 'doing'))
                FROM procrastinate_jobs WHERE status IN ('todo', 'doing')""")
            )
        ).one()
    return World(
        holder=holder or "ml",
        ml_gpu=await c.ml_gpu(),
        sound_up=health is not None,
        sound_batch=(health or {}).get("batch"),
        batch_job=bool(q[2]),
        uploads=up,
        backfill=bf,
        ingest_busy=bool(q[0]),
        gpu_waiting=int(q[1] or 0),
    )


async def _set_holder(holder: str, reason: str) -> None:
    async with sessionmaker()() as s:
        await s.execute(
            sa.update(gpu_lease)
            .where(gpu_lease.c.id == 1)
            .values(holder=holder, changed_at=sa.func.now(), reason=reason)
        )
        await s.commit()
    log.info("GPU lease: %s holds the card (%s)", holder, reason)


async def _defer_batch(batch_id: str) -> None:
    from musix.workers.app import app

    with contextlib.suppress(AlreadyEnqueued):
        await app.configure_task("sound:batch", queueing_lock="sound:batch").defer_async(
            batch_id=batch_id
        )


async def _start_batch(c: SoundClient) -> str | None:
    """Claim up to BATCH_SIZE ready rows, uploads first, and hand them to ml-sound."""
    async with sessionmaker()() as s:
        rows = (
            await s.execute(
                sa.select(SA.media_file_id, SA.keep_stems, M.path)
                .select_from(sound_analysis.join(media_files, M.id == SA.media_file_id))
                .where(READY)
                .order_by(SA.priority.desc(), SA.queued_at)
                .limit(BATCH_SIZE)
                .with_for_update(of=sound_analysis, skip_locked=True)
            )
        ).all()
        if not rows:
            return None
        ids = [r.media_file_id for r in rows]
        compat: dict[uuid.UUID, str] = dict(
            (
                await s.execute(
                    sa.select(renditions.c.media_file_id, renditions.c.path).where(
                        renditions.c.media_file_id.in_(ids), renditions.c.tier == "lossless_compat"
                    )
                )
            ).all()
        )
        lrc: dict[uuid.UUID, str] = dict(
            (
                await s.execute(
                    sa.select(lyrics.c.media_file_id, lyrics.c.synced_lrc).where(
                        lyrics.c.media_file_id.in_(ids), lyrics.c.synced_lrc.is_not(None)
                    )
                )
            ).all()
        )
        names = await _export_names(s, [r.media_file_id for r in rows if r.keep_stems])
        items = [
            {
                "id": str(r.media_file_id),
                # the same file CLAP reads, or the rendition every decoder can open (ALAC, Dolby)
                "path": compat.get(r.media_file_id) or r.path,
                "lrc": lrc.get(r.media_file_id),
                "keep_stems": r.keep_stems,
                "export_name": names.get(r.media_file_id),
            }
            for r in rows
        ]
        batch_id = await c.start_batch(items)
        await s.execute(
            sa.update(sound_analysis)
            .where(SA.media_file_id.in_(ids))
            .values(state="running", attempts=SA.attempts + 1, error=None)
        )
        await s.commit()
    log.info("sound batch %s: %d tracks", batch_id, len(items))
    await _defer_batch(batch_id)
    return batch_id


async def _swap_back(c: SoundClient, reason: str) -> None:
    """ml gets the card back; the text vectors that waited for it run now, not at their next
    10-minute retry."""
    await _set_holder("ml", reason)
    with contextlib.suppress(Unavailable):  # ml is down: it loads on its own when it starts
        await c.ml_acquire()
    async with sessionmaker()() as s:
        await s.execute(
            sa.text("""
            UPDATE procrastinate_jobs SET scheduled_at = now()
            WHERE queue_name = 'gpu' AND status = 'todo' AND scheduled_at > now()""")
        )
        await s.commit()
    await _defer_texts()


async def _defer_texts() -> int:
    """Texts for the profiles derived since their last text (spec §9). Deferred only while ml
    holds the card, so the LLM's GPU load never meets the sound CPU phase."""
    from musix.workers.app import app

    async with sessionmaker()() as s:
        ids: list[uuid.UUID] = list(
            await s.scalars(
                sa.select(sound_profiles.c.media_file_id)
                .outerjoin(
                    sound_texts,
                    sa.and_(
                        sound_texts.c.subject_kind == "media_file",
                        sound_texts.c.subject_id == sound_profiles.c.media_file_id,
                        sound_texts.c.kind == "signature",
                    ),
                )
                .where(
                    sa.or_(
                        sound_texts.c.subject_id.is_(None),
                        sound_texts.c.generated_at < sound_profiles.c.derived_at,
                    )
                )
            )
        )
    for mf in ids:
        with contextlib.suppress(AlreadyEnqueued):
            await app.configure_task(
                "sound:signature", queueing_lock=f"sound:signature:{mf}", priority=-20
            ).defer_async(media_file_id=str(mf))
    artists = await _changed_artists()
    for a in artists:
        with contextlib.suppress(AlreadyEnqueued):
            await app.configure_task(
                "sound:artist_texts", queueing_lock=f"sound:artist_texts:{a}", priority=-20
            ).defer_async(artist_id=str(a))
    return len(ids) + len(artists)


async def _changed_artists() -> list[uuid.UUID]:
    """Artists with a pooled album (≥3 analysed recordings) whose text is missing or older
    than one of its profiles. Their every album is redone: an album text compares with the
    album before it and with the artist's others (the facts hash skips the unchanged)."""
    X = sound_texts.c
    mf = sa.func.count(sa.distinct(sound_profiles.c.media_file_id))
    async with sessionmaker()() as s:
        return list(
            await s.scalars(
                sa.select(albums.c.album_artist_id)
                .distinct()
                .select_from(albums)
                .join(tracks, sa.and_(T.album_id == albums.c.id, T.deleted_at.is_(None)))
                .join(sound_profiles, sound_profiles.c.media_file_id == T.media_file_id)
                .outerjoin(
                    sound_texts,
                    sa.and_(
                        X.subject_kind == "album",
                        X.subject_id == albums.c.id,
                        X.kind == "album_sound",
                        X.lang == "ru",
                    ),
                )
                .where(albums.c.album_artist_id.is_not(None))
                .group_by(albums.c.id, albums.c.album_artist_id, X.generated_at)
                .having(
                    sa.and_(
                        mf >= A.MIN_TRACKS,
                        sa.or_(
                            X.generated_at.is_(None),
                            sa.func.max(sound_profiles.c.derived_at) > X.generated_at,
                        ),
                    )
                )
            )
        )


async def _save_text(
    subject_kind: str,
    subject: uuid.UUID,
    kind: str,
    facts: Any,
    ver: int,
    make: Callable[[], Awaitable[tuple[str, str | None]]],
) -> str:
    """The shared tail of every text: the same facts keep the old answer (now dated), new
    facts go through `make()` → (state, text)."""
    from musix.contexts.sound import texts as X
    from musix.workers.context import llm

    key = sa.and_(
        sound_texts.c.subject_kind == subject_kind,
        sound_texts.c.subject_id == subject,
        sound_texts.c.kind == kind,
        sound_texts.c.lang == "ru",
    )
    h = X.facts_hash(facts, ver)
    async with sessionmaker()() as s:
        prev = await s.scalar(sa.select(sound_texts.c.facts_hash).where(key))
        if h == prev:
            await s.execute(sa.update(sound_texts).where(key).values(generated_at=sa.func.now()))
            await s.commit()
            return "unchanged"
    state, text = await make()
    cfg = await llm().config()
    row = dict(state=state, text=text, facts=facts, facts_hash=h, model=cfg.model)
    async with sessionmaker()() as s:
        await s.execute(
            pg_insert(sound_texts)
            .values(subject_kind=subject_kind, subject_id=subject, kind=kind, lang="ru", **row)
            .on_conflict_do_update(
                index_elements=["subject_kind", "subject_id", "kind", "lang"],
                set_={**row, "generated_at": sa.func.now()},
            )
        )
        await s.commit()
    return state


async def artist_texts(artist_id: str) -> str:
    """The texts of every pooled album of the artist, then the artist's timeline."""
    from musix.contexts.sound import service as V
    from musix.contexts.sound import texts as X
    from musix.workers.context import llm

    aid = uuid.UUID(artist_id)
    async with sessionmaker()() as s:
        name = await s.scalar(sa.select(artists.c.name).where(artists.c.id == aid))
        pooled = [a for a in await V.artist_albums(s, aid) if a.pool is not None]
        recent: list[str] = list(
            await s.scalars(
                sa.select(sound_texts.c.text)
                .where(sound_texts.c.kind == "album_sound", sound_texts.c.state == "ok")
                .order_by(sound_texts.c.generated_at.desc())
                .limit(12)
            )
        )
    if name is None or not pooled:
        return "nothing pooled"
    used = [" ".join(t.split()[:3]) + "…" for t in recent[::-1]]
    alb = [a.album for a in pooled]
    states = []
    for i, a in enumerate(pooled):
        rest = [x[2] for j, x in enumerate(alb) if j != i]
        facts = A.album_facts(alb[i], A.previous(alb, i), A.more_than_others(alb[i][2], rest))

        async def make(facts: dict[str, Any] = facts) -> tuple[str, str | None]:
            st, text = await X.album_text(llm(), name, facts, used)
            if text:
                used.append(" ".join(text.split()[:3]) + "…")
            return st, text

        states.append(await _save_text("album", a.id, "album_sound", facts, X.ALBUM_VER, make))
    dated = [x for x in alb if x[1] is not None]
    if len(dated) >= A.MIN_ALBUMS:
        rows = A.timeline_rows(dated)
        states.append(
            await _save_text(
                "artist",
                aid,
                "timeline",
                rows,
                X.ALBUM_VER,
                lambda: X.timeline_text(llm(), name, rows),
            )
        )
    return ", ".join(states)


async def signature(media_file_id: str) -> str:
    """The song's «изюминка»: regenerated only when its facts changed."""
    from musix.contexts.sound import texts as X
    from musix.workers.context import llm

    mf = uuid.UUID(media_file_id)
    async with sessionmaker()() as s:
        measures = await s.scalar(
            sa.select(SA.measures).where(SA.media_file_id == mf, SA.state == "done")
        )
        if measures is None:
            return "no measures"
        g = await genius(s, mf)
        prev = await s.scalar(
            sa.select(sound_texts.c.facts_hash).where(
                sound_texts.c.subject_kind == "media_file",
                sound_texts.c.subject_id == mf,
                sound_texts.c.kind == "signature",
                sound_texts.c.lang == "ru",
            )
        )
        recent: list[str] = list(
            await s.scalars(
                sa.select(sound_texts.c.text)
                .where(sound_texts.c.kind == "signature", sound_texts.c.state == "ok")
                .order_by(sound_texts.c.generated_at.desc())
                .limit(12)
            )
        )
        used = [" ".join(t.split()[:3]) + "…" for t in recent]
    fl = X.signature_facts(D.features(measures, g), g)
    h = X.facts_hash(fl, X.SIGNATURE_VER)
    if h == prev:
        async with sessionmaker()() as s:  # same facts: the old answer stands, now dated
            await s.execute(
                sa.update(sound_texts)
                .where(
                    sound_texts.c.subject_kind == "media_file",
                    sound_texts.c.subject_id == mf,
                    sound_texts.c.kind == "signature",
                )
                .values(generated_at=sa.func.now())
            )
            await s.commit()
        return "unchanged"
    state, text = await X.signature(llm(), fl, used[::-1])
    cfg = await llm().config()
    row = dict(state=state, text=text, facts=fl, facts_hash=h, model=cfg.model)
    async with sessionmaker()() as s:
        await s.execute(
            pg_insert(sound_texts)
            .values(subject_kind="media_file", subject_id=mf, kind="signature", lang="ru", **row)
            .on_conflict_do_update(
                index_elements=["subject_kind", "subject_id", "kind", "lang"],
                set_={**row, "generated_at": sa.func.now()},
            )
        )
        await s.commit()
    return state


async def _retry_stalled_batch() -> None:
    """A recreated worker leaves its sound:batch `doing` forever: retry it, it re-attaches."""
    from musix.workers.app import app

    stalled = await app.job_manager.get_stalled_jobs(
        task_name="sound:batch", seconds_since_heartbeat=120
    )
    for job in stalled:
        assert job.id is not None
        await app.job_manager.retry_job_by_id_async(job.id, retry_at=datetime.now(UTC))
        log.warning("sound:batch job %s stalled: retried", job.id)


async def tick(timestamp: int) -> str:
    """One step of the lease (spec §4). Jobs of this task never overlap (procrastinate `lock`)."""
    c = _client()
    if c is None:
        return "off"
    try:
        return await _tick(c)
    finally:
        await c.close()


async def _tick(c: SoundClient) -> str:
    await _retry_stalled_batch()
    w = await _snapshot(c)
    acts = decide(w)
    for a in acts:
        if a == "to_sound":
            if w.ml_gpu is not None:
                await c.ml_release()
            await _set_holder("sound", f"{w.uploads} uploads, {w.backfill} backfill pending")
            if await _start_batch(c) is None:  # the rows went elsewhere meanwhile
                await _swap_back(c, "nothing to analyse")
        elif a == "start_batch":
            if await _start_batch(c) is None:
                await _swap_back(c, "nothing to analyse")
        elif a == "reattach":
            assert w.sound_batch is not None
            await _defer_batch(w.sound_batch)
        elif a == "release_ml":
            await c.ml_release()
        elif a == "acquire_ml":
            await c.ml_acquire()
        elif a == "to_ml":
            await _swap_back(c, "sound queue empty" if w.sound_up else "ml-sound is down")
    return ",".join(acts) or "idle"


# ── the batch ─────────────────────────────────────────────────────────────────


async def genius(s: AsyncSession, mf_id: uuid.UUID) -> D.Genius:
    """The Genius page data of the file's song (its first registration's song)."""
    song_id = await s.scalar(
        sa.select(T.song_id)
        .where(T.media_file_id == mf_id, T.song_id.is_not(None))
        .order_by(T.added_at)
        .limit(1)
    )
    if song_id is None:
        return D.Genius()
    tags: list[str] = list(
        await s.scalars(
            sa.select(song_tags.c.tag)
            .where(song_tags.c.song_id == song_id, song_tags.c.source == "genius")
            .order_by(song_tags.c.pos)
        )
    )
    credits: dict[str, list[str]] = {}
    for role, name in (
        await s.execute(
            sa.select(song_credits.c.role, song_credits.c.name).where(
                song_credits.c.song_id == song_id, song_credits.c.source == "genius"
            )
        )
    ).all():
        credits.setdefault(role, []).append(name)
    samples: list[str] = list(
        await s.scalars(
            sa.select(song_relations.c.target_text).where(
                song_relations.c.song_id == song_id,
                song_relations.c.source == "genius",
                song_relations.c.kind == "sample",
            )
        )
    )
    return D.Genius(tags=tags, credits=credits, samples=samples)


async def derive_one(
    s: AsyncSession, mf_id: uuid.UUID, measures: dict[str, Any] | None = None
) -> bool:
    """measures + Genius → sound_profiles (the caller commits). False when there are no measures."""
    if measures is None:
        measures = await s.scalar(
            sa.select(SA.measures).where(SA.media_file_id == mf_id, SA.state == "done")
        )
        if measures is None:
            return False
    row = D.derive(measures, await genius(s, mf_id))
    await s.execute(
        pg_insert(sound_profiles)
        .values(media_file_id=mf_id, **row)
        .on_conflict_do_update(
            index_elements=["media_file_id"], set_={**row, "derived_at": sa.func.now()}
        )
    )
    return True


async def _write_done(d: dict[str, Any]) -> None:
    mf = uuid.UUID(d["id"])
    async with sessionmaker()() as s:
        n = (
            await s.execute(
                sa.update(sound_analysis)
                .where(SA.media_file_id == mf)
                .values(
                    state="done",
                    error=None,
                    extractor_ver=d["measures"].get("v", EXTRACTOR_VER),
                    measures=d["measures"],
                    stage_frames=base64.b64decode(d["stage_frames_b64"]),
                    gpu_ms=d["gpu_ms"],
                    cpu_ms=d["cpu_ms"],
                    analysed_at=sa.func.now(),
                    keep_stems=False,
                )
                .returning(SA.media_file_id)
            )
        ).first()
        if n:  # the file may have been deleted meanwhile (the row cascaded away)
            try:  # a derive bug must not lose the measures: they re-derive later. The savepoint
                # matters: a statement Postgres rejects (NaN in jsonb) aborted the whole
                # transaction, the measures rolled back and the track looped through 28 batches
                async with s.begin_nested():
                    await derive_one(s, mf, d["measures"])
            except Exception:
                log.exception("derive %s failed", mf)
        await s.commit()


async def _write_failed(f: dict[str, Any]) -> None:
    mf = uuid.UUID(f["id"])
    async with sessionmaker()() as s:
        att = await s.scalar(sa.select(SA.attempts).where(SA.media_file_id == mf))
        give_up = not f["retryable"] or (att or 0) >= MAX_ATTEMPTS
        await s.execute(
            sa.update(sound_analysis)
            .where(SA.media_file_id == mf, SA.state == "running")
            .values(state="failed" if give_up else "pending", error=f["error"])
        )
        await s.commit()


async def run_batch(batch_id: str) -> int:
    """Follow one ml-sound batch to its end, writing each track the moment it is measured, so
    a recreated worker loses nothing (the retry re-attaches by id; writes are idempotent)."""
    c = _client()
    if c is None:
        return 0
    try:
        return await _follow(c, batch_id)
    finally:
        await c.close()


async def _follow(c: SoundClient, batch_id: str) -> int:
    since, written, seen_failed = 0, 0, set()
    while True:
        b = await c.batch(batch_id, since)
        if b is None:  # ml-sound restarted and lost it: the rows go back to the queue
            break
        for d in b["done"]:
            await _write_done(d)
            written += 1
        since = b["n_done"]
        for f in b["failed"]:
            if f["id"] not in seen_failed:
                seen_failed.add(f["id"])
                await _write_failed(f)
        if b["state"] == "done":
            break
        await asyncio.sleep(POLL_S)
    async with sessionmaker()() as s:  # whatever this batch claimed and did not report
        await s.execute(
            sa.update(sound_analysis).where(SA.state == "running").values(state="pending")
        )
        await s.commit()
    log.info("sound batch %s: %d written, %d failed", batch_id, written, len(seen_failed))
    from musix.workers.app import app

    # the next batch or the swap back without a minute's wait; 5 s on, once this job is no
    # longer `doing` (a tick that sees it still running leaves the card where it is)
    with contextlib.suppress(AlreadyEnqueued):
        await app.configure_task(
            "sound:tick", queueing_lock="sound:tick_now", schedule_in={"seconds": 5}
        ).defer_async(timestamp=0)
    return written


# ── backfills ─────────────────────────────────────────────────────────────────


async def backfill(only: list[str] | None = None, priority: int | None = None) -> int:
    """Pending rows for every indexed file without one (spec §11): priority 0..99 by plays over
    180 days across accounts, uploads (100) always first. `only` = these media files (the demo
    tracks first, at 99, before the owner's go for the rest).
    `procrastinate defer sound:backfill '{"only": [...]}'`."""
    async with sessionmaker()() as s:
        res = await s.execute(
            sa.text("""
            WITH plays AS (
              SELECT t.media_file_id, count(*) AS n
              FROM listen_events e JOIN tracks t ON t.id = e.track_id
              WHERE e.started_at > now() - interval '180 days'
              GROUP BY 1)
            INSERT INTO sound_analysis (media_file_id, priority, state, error)
            SELECT m.id,
                   COALESCE(:prio, LEAST(98, (ln(1 + COALESCE(p.n, 0)) * 14)::int)),
                   CASE WHEN m.duration_ms BETWEEN :lo AND :hi THEN 'pending' ELSE 'skipped' END,
                   CASE WHEN m.duration_ms BETWEEN :lo AND :hi THEN NULL
                        ELSE 'duration ' || m.duration_ms || ' ms is outside the range' END
            FROM media_files m LEFT JOIN plays p ON p.media_file_id = m.id
            WHERE m.intel_state = 'indexed'
              AND (CAST(:only AS uuid[]) IS NULL OR m.id = ANY(CAST(:only AS uuid[])))
            ON CONFLICT (media_file_id) DO NOTHING
            RETURNING 1"""),
            {
                "prio": priority if priority is not None else (BACKFILL_TOP if only else None),
                "lo": MIN_MS,
                "hi": MAX_MS,
                "only": only,
            },
        )
        n = len(res.all())
        await s.commit()
    return n


async def derive_backfill(below_ver: int | None = None) -> int:
    """Re-derive every measured file whose profile is older than DERIVE_VER (no GPU).
    `procrastinate defer sound:derive_backfill '{}'`."""
    q = (
        sa.select(SA.media_file_id)
        .outerjoin(sound_profiles, sound_profiles.c.media_file_id == SA.media_file_id)
        .where(SA.state == "done")
        .where(
            sa.or_(
                sound_profiles.c.derive_ver.is_(None),
                sound_profiles.c.derive_ver < (below_ver or D.DERIVE_VER),
            )
        )
    )
    async with sessionmaker()() as s:
        ids: list[uuid.UUID] = list(await s.scalars(q))
    n = 0
    for mf in ids:
        async with sessionmaker()() as s:
            n += await derive_one(s, mf)
            await s.commit()
    return n


async def remeasure(only: list[str] | None = None, priority: int | None = None) -> int:
    """Measured rows older than EXTRACTOR_VER back to the queue (the stems are gone after a
    batch, so new measures mean a new GPU pass). Each keeps its priority unless `priority`
    is given (`only` = these files first); the old measures and stage keep serving the player
    until the new ones land. `procrastinate defer sound:remeasure '{}'`."""
    q = (
        sa.update(sound_analysis)
        .where(SA.state == "done", sa.func.coalesce(SA.extractor_ver, 1) < EXTRACTOR_VER)
        .values(state="pending", attempts=0, queued_at=sa.func.now())
        .returning(SA.media_file_id)
    )
    if only:
        q = q.where(SA.media_file_id.in_([uuid.UUID(m) for m in only]))
    if priority is not None:
        q = q.values(priority=priority)
    async with sessionmaker()() as s:
        n = len((await s.execute(q)).all())
        await s.commit()
    return n


async def derive_song(song_id: str) -> int:
    """Re-derive the measured files of a song whose Genius page just landed (style tags,
    credits and samples move unusualness and technicality)."""
    async with sessionmaker()() as s:
        ids: list[uuid.UUID] = list(
            await s.scalars(
                sa.select(SA.media_file_id)
                .join(tracks, T.media_file_id == SA.media_file_id)
                .where(T.song_id == uuid.UUID(song_id), SA.state == "done")
                .distinct()
            )
        )
        for mf in ids:
            await derive_one(s, mf)
        await s.commit()
    return len(ids)


async def _export_names(s: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = (
        await s.execute(
            sa.select(T.media_file_id, T.artist_display, T.title)
            .where(T.media_file_id.in_(ids))
            .order_by(T.media_file_id, T.added_at)
            .distinct(T.media_file_id)
        )
    ).all()
    return {r.media_file_id: f"{r.artist_display} — {r.title}" for r in rows}


async def export_stems(media_file_ids: list[str]) -> int:
    """The owner's one-off stems (spec §6.6): the files go back to the queue at upload priority
    with keep_stems, through the normal lease and guard; ml-sound copies their stems to the
    export dir and nowhere else.
    `procrastinate defer sound:export_stems '{"media_file_ids": [...]}'`."""
    ids = [uuid.UUID(m) for m in media_file_ids]
    async with sessionmaker()() as s:
        await s.execute(
            pg_insert(sound_analysis)
            .values([dict(media_file_id=m, priority=UPLOAD, keep_stems=True) for m in ids])
            .on_conflict_do_update(
                index_elements=["media_file_id"],
                set_=dict(
                    state="pending",
                    priority=UPLOAD,
                    keep_stems=True,
                    attempts=0,
                    queued_at=sa.func.now(),
                ),
            )
        )
        await s.commit()
    return len(ids)


def register(app: procrastinate.App) -> None:
    t = app.task(name="sound:tick", queue="default", lock="sound:tick")(tick)
    app.periodic(cron="* * * * *", periodic_id="sound_tick")(t)
    # retries only reach a batch whose worker died (the stalled check); ml-sound unreachable
    # mid-batch: wait and re-attach
    app.task(
        name="sound:batch",
        queue="sound",
        retry=procrastinate.RetryStrategy(max_attempts=20, wait=30, retry_exceptions={Unavailable}),
    )(run_batch)
    app.task(name="sound:backfill", queue="default")(backfill)
    app.task(name="sound:derive_backfill", queue="default")(derive_backfill)
    app.task(name="sound:derive_song", queue="default")(derive_song)
    app.task(name="sound:remeasure", queue="default")(remeasure)
    app.task(name="sound:export_stems", queue="default")(export_stems)
    # an unreachable LLM: wait for it like the other enrichment on the ai queue
    app.task(
        name="sound:signature",
        queue="ai",
        retry=procrastinate.RetryStrategy(
            max_attempts=10, wait=600, retry_exceptions={Unavailable}
        ),
    )(signature)
    app.task(
        name="sound:artist_texts",
        queue="ai",
        retry=procrastinate.RetryStrategy(
            max_attempts=10, wait=600, retry_exceptions={Unavailable}
        ),
    )(artist_texts)
