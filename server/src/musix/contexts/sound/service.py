"""Reads of the sound engine's tables for the API (spec §10): profiles rendered into labels
in the request's language (ru for now: the words are keys, so English is a table away)."""

from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.library.models import tracks
from musix.contexts.sound import derive as D
from musix.contexts.sound import schemas as S
from musix.contexts.sound import words as W
from musix.contexts.sound.models import gpu_lease, sound_analysis, sound_profiles, sound_texts

P, SA = sound_profiles.c, sound_analysis.c
DAY_AGO = sa.func.now() - sa.text("interval '24 hours'")


def _l(table: dict[str, str], key: str | None) -> S.Label | None:
    return S.Label(key=key, label=table[key]) if key else None


def _render(p: Any, signature: str | None) -> S.TrackSound:
    secs = p.sections
    return S.TrackSound(
        ratings=S.Ratings(space=p.space, tech=p.tech, odd=p.odd, facets=p.facets),
        instruments=[S.Label(key=k, label=W.NAMES[k]) for k in p.instruments],
        drums=_l({"live": W.NAMES["drums_live"], "machine": W.NAMES["drum_machine"]}, p.drums),
        vocals=None if p.vocals in (None, "none") else _l(W.NAMES, p.vocals),
        pace=_l(W.PACE, p.pace),
        feel=_l(W.FEEL, p.feel),
        echo=S.Label(key=p.echo, label=W.ECHO[p.echo]),
        width=_l(W.WIDTH, p.width),
        traits=list(p.traits),
        sections=[
            S.Section(
                start=s["start"],
                end=s["end"],
                kind=s["kind"],
                label=W.section_label(s["kind"], s["n"], s["last"]),
            )
            for s in secs
        ],
        moments=[
            S.Moment(
                t=m["t"],
                kind=m["kind"],
                label=D.moment_text(m, secs),
                section=W.section_label(
                    **{k: secs[m["section_i"]][k] for k in ("kind", "n", "last")}
                )
                if m["section_i"] is not None
                else "",
            )
            for m in p.moments
        ],
        stems=[
            S.StemPlace(
                stem=s["stem"],
                name=S.Label(key=s["name"], label=W.NAMES[s["name"]]),
                side=S.Label(key=s["side"], label=W.SIDES[s["side"]]),
                pan=s["pan"],
                width=s["width"],
            )
            for s in p.stems
        ],
        signature=signature,
        has_stage=p.has_stage,
        ver=p.derive_ver,
    )


async def track_sound(
    s: AsyncSession, mf_id: uuid.UUID
) -> tuple[S.TrackSound | None, str | None, tuple[Any, ...]]:
    """(the rendered profile or None, the analysis state when there is no profile, a version
    tuple for the ETag)."""
    T = sound_texts.c
    sig = (
        sa.select(T.text, T.generated_at)
        .where(
            T.subject_kind == "media_file",
            T.subject_id == mf_id,
            T.kind == "signature",
            T.lang == "ru",
            T.state == "ok",
        )
        .subquery()
    )
    row = (
        await s.execute(
            sa.select(
                sound_profiles,
                SA.stage_frames.is_not(None).label("has_stage"),
                sig.c.text.label("signature"),
                sig.c.generated_at.label("sig_at"),
            )
            .join(sound_analysis, SA.media_file_id == P.media_file_id)
            .outerjoin(sig, sa.true())
            .where(P.media_file_id == mf_id)
        )
    ).first()
    if row is None:
        state = await s.scalar(sa.select(SA.state).where(SA.media_file_id == mf_id))
        return None, state or "none", ()
    return _render(row, row.signature), None, (row.derive_ver, row.derived_at, row.sig_at)


async def stage_frames(s: AsyncSession, mf_id: uuid.UUID) -> tuple[bytes, Any] | None:
    row = (
        await s.execute(
            sa.select(SA.stage_frames, SA.analysed_at).where(
                SA.media_file_id == mf_id, SA.stage_frames.is_not(None)
            )
        )
    ).first()
    return (row.stage_frames, row.analysed_at) if row else None


async def status(s: AsyncSession, batch: dict[str, Any] | None) -> S.SoundStatus:
    lease = (await s.execute(sa.select(gpu_lease).where(gpu_lease.c.id == 1))).one()
    c = (
        await s.execute(
            sa.select(
                sa.func.count().filter(SA.state == "pending", SA.priority >= 100),
                sa.func.count().filter(SA.state == "pending", SA.priority < 100),
                sa.func.count().filter(SA.state == "running"),
                sa.func.count().filter(SA.state == "done"),
                sa.func.count().filter(SA.state == "failed"),
                sa.func.count().filter(SA.state == "skipped"),
                # the pace of the last 24 h: tracks an hour since the first of them
                sa.func.count().filter(SA.analysed_at > DAY_AGO),
                sa.func.extract(
                    "epoch",
                    sa.func.now() - sa.func.min(SA.analysed_at).filter(SA.analysed_at > DAY_AGO),
                ),
            )
        )
    ).one()
    pending = c[0] + c[1] + c[2]
    eta = None
    if c[6] >= 2 and c[7] and pending:
        eta = round(pending / (c[6] / max(float(c[7]) / 3600, 0.1)), 1)
    return S.SoundStatus(
        holder=lease.holder,
        lease_since=lease.changed_at.isoformat(),
        lease_reason=lease.reason,
        batch=(batch or {}).get("batch"),
        stage=(batch or {}).get("stage"),
        pending_uploads=c[0],
        pending_backfill=c[1],
        running=c[2],
        done=c[3],
        failed=c[4],
        skipped=c[5],
        eta_hours=eta,
    )


async def media_file_of(
    s: AsyncSession, account_id: uuid.UUID, track_id: uuid.UUID
) -> uuid.UUID | None:
    return await s.scalar(
        sa.select(tracks.c.media_file_id).where(
            tracks.c.id == track_id,
            tracks.c.account_id == account_id,
            tracks.c.deleted_at.is_(None),
        )
    )
