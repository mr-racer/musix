"""The load guard (spec §5). The host powered off three times on 2026-10-17, each time with
the GPU separating at full power AND the CPU lane analysing; GPU-only and CPU-only runs never
did. The 290 W cap is the owner's and stays, so the only protection is not to overlap:
before each GPU item the rest of the host's CPU must be quiet, before each CPU-phase track
the GPU must be idle. An overlap is then at most one item (~25 s on SW).

`/proc/stat` inside the container is the host's (no lxcfs), so it sees transcodes and the
other services; this process's own share is taken out of it."""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import deque

log = logging.getLogger("musix_sound")

CPU_MAX = float(os.environ.get("SOUND_GUARD_CPU", "0.35"))  # other processes' share of the host
GPU_MAX = float(os.environ.get("SOUND_GUARD_GPU", "0.20"))  # GPU utilization (not watts: idle is 120 W)
WINDOW_S, POLL_S, LOG_AFTER_S = 5, 2.0, 30.0
CLK = os.sysconf("SC_CLK_TCK")


def may_start(kind: str, cpu_other: float, gpu_util: float) -> bool:
    """A GPU item waits for a quiet CPU, a CPU-phase track waits for an idle GPU."""
    return cpu_other < CPU_MAX if kind == "gpu" else gpu_util < GPU_MAX


def _host_ticks() -> tuple[int, int]:
    """(busy, total) jiffies of the whole host."""
    with open("/proc/stat") as f:
        v = [int(x) for x in f.readline().split()[1:]]
    idle = v[3] + v[4]  # idle + iowait
    return sum(v[:8]) - idle, sum(v[:8])


def _own_ticks() -> int:
    """This process's CPU (all its threads) in jiffies. The CPU-phase pool never runs during
    a GPU item, so the GPU phase's own share is this process alone."""
    t = os.times()
    return int((t.user + t.system) * CLK)


_nvml: list[object] = []  # the device handle, once NVML is up


def _handle() -> object:
    if not _nvml:
        import pynvml

        pynvml.nvmlInit()
        _nvml.append(pynvml.nvmlDeviceGetHandleByIndex(0))
    return _nvml[0]


def nvml_ok() -> bool:
    """The guard's GPU side and the VRAM check read NVML. The live GPU test of 2026-10-24 ran
    in an env without pynvml: both read "nothing to wait for" and nobody noticed, so on a GPU
    device a missing NVML is a startup error (Runner), not a quiet zero."""
    try:
        _handle()
        return True
    except Exception:
        return False


def _gpu_util() -> float:
    try:
        import pynvml

        return float(pynvml.nvmlDeviceGetUtilizationRates(_handle()).gpu) / 100
    except Exception:  # no NVML (CPU host, tests): nothing to wait for
        return 0.0


def gpu_free_mb() -> int | None:
    try:
        import pynvml

        return int(pynvml.nvmlDeviceGetMemoryInfo(_handle()).free // 2**20)
    except Exception:
        return None


class Guard:
    """A daemon thread samples the host CPU and the GPU once a second; `wait(kind)` returns as
    soon as the mean of the last WINDOW_S seconds allows `kind`. Counts its waits."""

    def __init__(self) -> None:
        self.waits, self.waited_s = 0, 0.0
        self._cpu: deque[float] = deque(maxlen=WINDOW_S)
        self._gpu: deque[float] = deque(maxlen=WINDOW_S)
        threading.Thread(target=self._sample, name="guard", daemon=True).start()

    def _sample(self) -> None:
        b0, t0 = _host_ticks()
        o0 = _own_ticks()
        while True:
            time.sleep(1.0)
            b1, t1 = _host_ticks()
            o1 = _own_ticks()
            self._cpu.append(max(0.0, (b1 - b0) - (o1 - o0)) / max(1, t1 - t0))
            self._gpu.append(_gpu_util())
            b0, t0, o0 = b1, t1, o1

    def now(self) -> tuple[float, float]:
        """(other CPU share, GPU utilization) over the last WINDOW_S seconds."""
        cpu, gpu = list(self._cpu), list(self._gpu)
        return (sum(cpu) / len(cpu) if cpu else 1.0), (sum(gpu) / len(gpu) if gpu else 1.0)

    def wait(self, kind: str) -> None:
        start = time.monotonic()
        logged = False
        while not may_start(kind, *self.now()):
            if not logged and time.monotonic() - start > LOG_AFTER_S:
                cpu, gpu = self.now()
                log.info("guard: %s item waits (other CPU %.0f%%, GPU %.0f%%)", kind, 100 * cpu, 100 * gpu)
                logged = True
            time.sleep(POLL_S)
        dt = time.monotonic() - start
        if dt > 1:
            self.waits += 1
            self.waited_s += dt
