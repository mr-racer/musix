"""One batch, end to end (spec §6): the GPU phase stage by stage, then the CPU phase on a
process pool, never both at once. Stems exist only in scratch while their batch runs:
scratch is wiped at the start and at the end (spec §6.5); the only copy that survives is
the owner's one-off export for items flagged `keep_stems` (§6.6)."""

from __future__ import annotations

import base64
import logging
import multiprocessing
import os
import shutil
import threading
import time
import uuid
from concurrent.futures import Future, ProcessPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from musix_sound import guard as G
from musix_sound.stages import ORDER, PARTS, START_MB, STEMS, Item, Stages

log = logging.getLogger("musix_sound")

# a track can't be measured without these; a failed dereverb / drums / struct only loses detail
# (analyse falls back: no echo windows, no drum parts, sections from synced lyrics)
FATAL = {"sep", "beats", "tags"}
MIN_FREE_GB = 10  # musix-disk-guard stops worker-media at 3 GB; a batch's stems take ~2 GB


@dataclass
class BatchItem:
    id: str
    path: str
    lrc: str | None = None
    keep_stems: bool = False
    export_name: str | None = None  # "<artist> — <title>" for the stems export


@dataclass
class Batch:
    items: list[BatchItem]
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    state: str = "gpu"  # gpu | cpu | done
    stage: str | None = None
    done: list[dict[str, Any]] = field(default_factory=list)
    failed: list[dict[str, Any]] = field(default_factory=list)
    gpu_ms: dict[str, int] = field(default_factory=dict)
    started: float = field(default_factory=time.time)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def fail(self, item_id: str, error: str, retryable: bool) -> None:
        with self.lock:
            if not any(f["id"] == item_id for f in self.failed):
                self.failed.append(dict(id=item_id, error=error[:500], retryable=retryable))

    def view(self, since: int = 0) -> dict[str, Any]:
        with self.lock:
            return dict(
                id=self.id, state=self.state, stage=self.stage, done=self.done[since:],
                n_done=len(self.done), failed=list(self.failed),
            )  # fmt: skip


def _measure_one(src: str, work: str, lrc: str | None) -> tuple[dict[str, Any], bytes, int]:
    """Runs in a pool process (nice 19, one thread of BLAS each)."""
    from musix_sound.measure import measure

    t0 = time.time()
    m, frames = measure(src, work, lrc)
    return m, frames, int(1000 * (time.time() - t0))


_SLOT_LOCK: Any = None  # held for the process's life: the numba cache slot stays ours


def _numba_slot() -> None:
    """A numba cache dir of this worker's own. Four workers compiling librosa's jitted functions
    into one shared NUMBA_CACHE_DIR at once left it corrupt, and every worker that loaded it
    then segfaulted in librosa.beat (2026-10-25: after a restart, every batch 0/16 with
    BrokenProcessPool). A slot is taken under flock, so no two live workers write one dir, and
    it is kept across batches, so the functions compile once per slot, not once per batch."""
    import fcntl

    global _SLOT_LOCK
    base = os.environ.get("NUMBA_CACHE_DIR") or os.path.expanduser("~/.cache/numba")
    os.makedirs(base, exist_ok=True)
    for i in range(64):
        f = open(os.path.join(base, f"slot{i}.lock"), "w")  # noqa: SIM115 (kept open on purpose)
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            f.close()
            continue
        _SLOT_LOCK = f
        os.environ["NUMBA_CACHE_DIR"] = os.path.join(base, f"slot{i}")
        return
    os.environ["NUMBA_CACHE_DIR"] = os.path.join(base, f"pid{os.getpid()}")  # >64 workers


def _pool_init() -> None:
    """A spawned worker: one BLAS thread each (the pool is the parallelism), lowest priority,
    its own numba cache (set before numba is first imported: measure is imported lazily)."""
    for v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
        os.environ[v] = "1"
    _numba_slot()
    os.nice(19)


class Runner:
    def __init__(self, models: str, scratch: str, export: str, device: str) -> None:
        self.models, self.scratch, self.export, self.device = models, scratch, export, device
        if device == "cpu":
            # audio-separator picks the device itself: on a CPU run it must not see the card
            # (a CPU test put SW on the GPU next to prod's ml, 2026-10-24)
            os.environ["CUDA_VISIBLE_DEVICES"] = ""
        if device == "cuda" and not G.nvml_ok():
            raise RuntimeError("NVML is unavailable: the power guard and the VRAM check would be blind")
        self.guard = G.Guard()
        self.current: Batch | None = None
        self.last: Batch | None = None

    def start(self, b: Batch) -> None:
        self.current = b
        threading.Thread(target=self._run, args=(b,), name=f"batch-{b.id[:8]}", daemon=True).start()

    def _wipe(self) -> None:
        shutil.rmtree(self.scratch, ignore_errors=True)
        os.makedirs(self.scratch, exist_ok=True)

    def _run(self, b: Batch) -> None:
        try:
            self._wipe()
            if shutil.disk_usage(self.scratch).free < MIN_FREE_GB * 2**30:
                for it in b.items:
                    b.fail(it.id, "disk: under 10 GB free", retryable=True)
                return
            alive = self._gpu_phase(b)
            self._cpu_phase(b, alive)
            self._export(b, alive)
        except BaseException as e:  # anything unexpected (audio-separator even sys.exit()s on a
            # model it can't load): every unfinished item is retryable, nothing is lost silently
            log.exception("batch %s crashed", b.id)
            finished = {d["id"] for d in b.done}
            for it in b.items:
                if it.id not in finished:
                    b.fail(it.id, f"batch: {type(e).__name__}: {e}", retryable=True)
        finally:
            self._wipe()
            with b.lock:
                b.state, b.stage = "done", None
            self.last, self.current = b, None
            log.info(
                "batch %s: %d done, %d failed in %.0f s; guard waits %d (%.0f s)",
                b.id[:8], len(b.done), len(b.failed), time.time() - b.started,
                self.guard.waits, self.guard.waited_s,
            )  # fmt: skip

    def _gpu_phase(self, b: Batch) -> list[Item]:
        items = [Item(it.id, it.path, os.path.join(self.scratch, it.id)) for it in b.items]
        dead: set[str] = set()

        def on_fail(stage: str, it: Item, e: BaseException) -> None:
            import torch

            if stage in FATAL:
                oom = isinstance(e, torch.OutOfMemoryError)
                b.fail(it.id, f"{stage}: {type(e).__name__}: {e}", retryable=oom)
                dead.add(it.id)

        def on_item(stage: str, it: Item, s: float) -> None:
            b.gpu_ms[it.id] = b.gpu_ms.get(it.id, 0) + int(1000 * s)

        st = Stages(self.models, self.scratch, self.device, lambda: self.guard.wait("gpu"), on_item, on_fail)
        for stage in ORDER:
            todo = [it for it in items if it.id not in dead]
            if not todo:
                break
            free = G.gpu_free_mb()
            if self.device == "cuda" and free is not None and free < START_MB[stage]:
                for it in todo:
                    b.fail(it.id, f"vram: {free} MB free, {stage} needs {START_MB[stage]}", True)
                return []
            with b.lock:
                b.stage = stage
            t0 = time.time()
            try:
                st.run(stage, todo)
            except Exception as e:  # the model would not load: the whole stage is out
                log.exception("batch %s stage %s failed", b.id[:8], stage)
                if stage in FATAL:
                    for it in todo:
                        b.fail(it.id, f"{stage}: {type(e).__name__}: {e}", retryable=True)
                    return []
                continue  # a detail stage: the tracks are measured without it
            log.info("batch %s stage %s: %d tracks in %.0f s", b.id[:8], stage, len(todo), time.time() - t0)
        return [it for it in items if it.id not in dead]

    def _cpu_phase(self, b: Batch, items: list[Item]) -> None:
        with b.lock:
            b.state, b.stage = "cpu", "measure"
        by_id = {it.id: it for it in b.items}
        # cores-2 (the owner, 10-18: use all cores while the GPU is idle), capped by memory: a
        # worker peaks at ~2.7 GB on a six-minute track (stems, drum parts, tagger windows); 8
        # of them took 21.6 GB of the box's 30 next to prod (2026-10-24), 4 stay near 11
        cap = int(os.environ.get("SOUND_CPU_WORKERS", "4"))
        workers = max(1, min(cap, (os.cpu_count() or 4) - 2))
        ctx = multiprocessing.get_context("spawn")
        with ProcessPoolExecutor(workers, mp_context=ctx, initializer=_pool_init) as ex:
            futs: dict[Future[Any], Item] = {}
            for it in items:
                self.guard.wait("cpu")
                futs[ex.submit(_measure_one, it.src, it.work, by_id[it.id].lrc)] = it
            for fut, it in futs.items():
                try:
                    m, frames, cpu_ms = fut.result()
                except Exception as e:
                    log.exception("measure %s failed", it.id)
                    b.fail(it.id, f"measure: {type(e).__name__}: {e}", retryable=False)
                    continue
                with b.lock:
                    b.done.append(dict(
                        id=it.id, measures=m, stage_frames_b64=base64.b64encode(frames).decode(),
                        gpu_ms=b.gpu_ms.get(it.id, 0), cpu_ms=cpu_ms,
                    ))  # fmt: skip

    def _export(self, b: Batch, items: list[Item]) -> None:
        """The owner's one-off stems (spec §6.6): the 6 stems and the drum parts as FLAC."""
        work = {it.id: it.work for it in items}
        for it in b.items:
            if not it.keep_stems or it.id not in work:
                continue
            # a file name, never a path: no separators, no "..", nothing hidden
            name = (it.export_name or "").replace("/", "∕").replace("\0", "").lstrip(".").strip() or it.id
            dst = os.path.join(self.export, name)
            os.makedirs(dst, exist_ok=True)
            for s in [*STEMS, *(f"dr_{p}" for p in PARTS)]:
                src = os.path.join(work[it.id], f"{s}.flac")
                if os.path.exists(src):
                    shutil.copyfile(src, os.path.join(dst, f"{s}.flac"))
            log.info("exported the stems of %s to %s", it.id, dst)
