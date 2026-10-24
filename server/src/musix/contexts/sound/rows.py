"""The sound_analysis queue row, written by ingest (no worker dependencies: intel imports it)."""

from __future__ import annotations

import uuid

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.sound.models import sound_analysis

MIN_MS, MAX_MS = 30_000, 20 * 60_000  # outside: skipped (spec §12)
UPLOAD = 100  # an upload's priority; the backfill gets 0..99


async def queue_row(
    s: AsyncSession, mf_id: uuid.UUID, duration_ms: int | None, priority: int = UPLOAD
) -> None:
    """The pending row of a newly indexed file (intel:embed, in its transaction). Too short or
    too long for the analysis: skipped with the reason (spec §12)."""
    skip = duration_ms is not None and not (MIN_MS <= duration_ms <= MAX_MS)
    await s.execute(
        pg_insert(sound_analysis)
        .values(
            media_file_id=mf_id,
            priority=priority,
            state="skipped" if skip else "pending",
            error=f"duration {duration_ms} ms is outside {MIN_MS}..{MAX_MS}" if skip else None,
        )
        .on_conflict_do_nothing()
    )
