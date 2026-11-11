"""Who holds the card (spec §4). llama-server keeps 15.3 GB of the 3090 and `ml`'s trio 5.8 GB,
which leaves ~2.4 GB: SongFormer alone peaks at 4.8. So when songs wait for their sound
analysis, `ml` lends the card to `ml-sound` and takes it back when they are done. Search
keeps dense, sparse and reranking on the CPU during the lease (owner's rule, 2026-11-11);
bulk text indexing waits for the card.

`decide()` is the whole policy as a pure function of one snapshot; `sound:tick` takes the
snapshot every minute under an advisory lock and carries the actions out."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Action = Literal["to_sound", "start_batch", "reattach", "release_ml", "to_ml", "acquire_ml"]


@dataclass(frozen=True)
class World:
    holder: Literal["ml", "sound"]
    ml_gpu: str | None  # ml /health: loaded | lent | empty; None = ml is down
    sound_up: bool  # ml-sound answers /health
    sound_batch: str | None  # the batch ml-sound is running
    batch_job: bool  # a sound:batch job is waiting or running
    uploads: int  # pending rows of uploads (priority 100) whose file is ready
    backfill: int  # pending backfill rows whose file is ready
    ingest_busy: bool  # media / ml queue jobs running: an upload's CPU work isn't done
    gpu_waiting: int  # jobs waiting on queue gpu (text vectors that need ml)


def decide(w: World) -> list[Action]:
    # text vectors wait only while ml could run them: with ml stopped they never would
    gpu_wait = w.gpu_waiting > 0 and w.ml_gpu is not None
    if w.holder == "ml":
        if w.ml_gpu == "lent":  # a swap back died halfway
            return ["acquire_ml"]
        work = w.uploads > 0 or (w.backfill > 0 and not gpu_wait)
        if work and w.sound_up and not w.ingest_busy:
            return ["to_sound"]
        return []
    acts: list[Action] = []
    if w.ml_gpu == "loaded":  # ml restarted and loaded its trio while the lease was on
        acts.append("release_ml")
    if w.sound_batch is not None:
        return [*acts, "reattach"] if not w.batch_job else acts
    if w.batch_job:  # its batch is about to start, or its last results are being written
        return acts
    if not w.sound_up:
        return ["to_ml"]
    if w.uploads > 0 or (w.backfill > 0 and not gpu_wait):
        return [*acts, "start_batch"]
    # nothing to do, or only backfill while new songs' text vectors wait: ml gets the card;
    # a batch lasts 15-20 min, which bounds how often the lease swaps
    return ["to_ml"]
