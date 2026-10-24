"""The GPU phase (spec §6.3): the research prototype's v3/gpu3.py stages, run stage by stage
over a batch. Each stage loads its one model, runs every track, then frees it, so models
never sit on the card together and there is no per-track CUDA init or model reload (the
host powered off at CUDA init and at sharp load drops, 2026-10-17).

Every stage takes the batch as [Item] and writes into each item's work dir the files the
CPU phase reads (proto/analyse.py, measure.py):
  sep       BS-Roformer SW (overlap 2): vocals, drums, bass, guitar, piano, other  → <stem>.flac
  drums     MDX23C DrumSep on the drums stem                                       → dr_<part>.flac
  dereverb  anvuew Mel-RoFormer on sampled vocal windows                           → wet.json
  beats     beat_this beats + downbeats                                            → beats.json
  tags      EfficientAT mn10_as on 10 s windows (hop 2.5 s): the kept classes on the mix and every
            stem → tags.npz, all 527 classes of the mix → tagall.npz (one pass for both)
  struct    SongFormer sections                                                    → struct.json

EfficientAT and SongFormer ship their code next to their weights (like HF remote code):
they are loaded from `models/efficientat` and `models/songformer` as the prototype did.
Heavy imports stay inside the stages: `import musix_sound.stages` is cheap."""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np

from musix_sound.proto import stage as dsp

log = logging.getLogger("musix_sound")

SR = 44100
STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"]
PARTS = ["kick", "snare", "toms", "hh", "ride", "crash"]
SW = "BS-Roformer-SW.ckpt"
DRUMSEP = "MDX23C-DrumSep-aufr33-jarredou.ckpt"
DEREVERB = "dereverb_mel_band_roformer_anvuew_sdr_19.1729.ckpt"
BEATS_CKPT = "beat_this-final0.ckpt"
OVERLAP = 2  # the owner's ruling 2026-10-18: SW at overlap 2 (22 s vs 41 s, stems within -12..-25 dB)
TAG_SR = 32000
# classes kept per window (instruments, voices, drum voices, room cues)
KEEP = [
    "Music", "Speech", "Male speech, man speaking", "Female speech, woman speaking", "Singing", "Choir", "Male singing",
    "Female singing", "Child singing", "Synthetic singing", "Rapping", "Humming", "Whistling", "Clapping", "Beatboxing",
    "Plucked string instrument", "Guitar", "Electric guitar", "Bass guitar", "Acoustic guitar", "Steel guitar, slide guitar",
    "Strum", "Banjo", "Sitar", "Mandolin", "Ukulele", "Keyboard (musical)", "Piano", "Electric piano", "Organ",
    "Electronic organ", "Hammond organ", "Synthesizer", "Sampler", "Harpsichord", "Percussion", "Drum kit",
    "Drum machine", "Drum", "Snare drum", "Rimshot", "Drum roll", "Bass drum", "Timpani", "Tabla", "Cymbal", "Hi-hat",
    "Wood block", "Tambourine", "Maraca", "Gong", "Cowbell", "Mallet percussion", "Marimba, xylophone", "Glockenspiel",
    "Vibraphone", "Steelpan", "Orchestra", "Brass instrument", "French horn", "Trumpet", "Trombone",
    "Bowed string instrument", "String section", "Violin, fiddle", "Pizzicato", "Cello", "Double bass",
    "Wind instrument, woodwind instrument", "Flute", "Saxophone", "Clarinet", "Harp", "Bell", "Harmonica", "Accordion",
    "Bagpipes", "Theremin", "Scratching (performance technique)", "Electronic music", "Reverberation", "Echo",
    "Distortion", "Silence",
]  # fmt: skip
# peak VRAM per stage (measured 2026-10-17/18): the NVML check before each load wants this + 512 MB
PEAK_MB = {"sep": 1600, "drums": 850, "dereverb": 2050, "beats": 400, "tags": 350, "struct": 4900}
ORDER = ("sep", "drums", "dereverb", "beats", "tags", "struct")


class StageError(RuntimeError):
    """A whole stage failed (its model would not load): no track of the batch got through it."""


@dataclass(frozen=True)
class Item:
    id: str
    src: str  # the audio file (the lossless_compat rendition when there is one)
    work: str  # this item's dir in scratch


def _atomic_json(obj: Any, path: str) -> None:
    with open(path + ".tmp", "w") as f:
        json.dump(obj, f)
    os.replace(path + ".tmp", path)


def _free() -> None:
    import gc

    import torch

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


class Stages:
    """One instance per batch. `on_item(stage, item, seconds)` is called after each track;
    `before_item()` (the load guard) before each one; a stage raising on one track records
    that track as failed and goes on with the others."""

    def __init__(
        self,
        models: str,
        scratch: str,
        device: str = "cuda",
        before_item: Callable[[], None] = lambda: None,
        on_item: Callable[[str, Item, float], None] = lambda *_: None,
        on_fail: Callable[[str, Item, BaseException], None] = lambda *_: None,
    ) -> None:
        self.models, self.scratch, self.device = models, scratch, device
        self.before_item, self.on_item, self.on_fail = before_item, on_item, on_fail

    def run(self, stage: str, items: list[Item]) -> None:
        """Raises StageError when the stage's model could not load (the items are untouched)."""
        try:
            getattr(self, f"_{stage}")(items)
        except SystemExit as e:  # audio-separator exits on a model it can't load
            raise StageError(f"{stage}: the model would not load (exit {e.code})") from e
        finally:
            _free()

    def _each(self, stage: str, items: list[Item], fn: Callable[[Item], None]) -> None:
        for it in items:
            self.before_item()
            t0 = time.time()
            try:
                fn(it)
            except Exception as e:
                import torch

                if isinstance(e, torch.OutOfMemoryError):
                    torch.cuda.empty_cache()
                log.exception("%s %s failed", stage, it.id)
                self.on_fail(stage, it, e)
                continue
            self.on_item(stage, it, time.time() - t0)

    # ── separation (audio-separator) ──────────────────────────────────────────

    def _separator(self, model: str) -> tuple[Any, str]:
        from audio_separator.separator import Separator

        tmp = os.path.join(self.scratch, f".tmp_{model.split('.')[0]}")
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        sep = Separator(
            output_dir=tmp, model_file_dir=os.path.join(self.models, "sep"), output_format="FLAC",
            log_level=logging.ERROR, use_autocast=True,
            mdxc_params={"segment_size": 256, "override_model_segment_size": False, "batch_size": 1,
                         "overlap": OVERLAP, "pitch_shift": 0},
        )  # fmt: skip
        sep.load_model(model_filename=model)
        return sep, tmp

    @staticmethod
    def _run_sep(sep: Any, tmp: str, src: str, out: str, prefix: str = "") -> None:
        """Separate src; move each stem to out/<prefix><stem>.flac (temp name, then renamed)."""
        for f in sep.separate(src):
            p = f if os.path.isabs(f) else os.path.join(tmp, f)
            stem = os.path.basename(p).split("_(")[1].split(")")[0].lower().replace(" ", "")
            dst = os.path.join(out, f"{prefix}{stem}.flac")
            shutil.move(p, dst + ".part")
            os.replace(dst + ".part", dst)

    def _sep(self, items: list[Item]) -> None:
        sep, tmp = self._separator(SW)

        def one(it: Item) -> None:
            os.makedirs(it.work, exist_ok=True)
            self._run_sep(sep, tmp, it.src, it.work)
            missing = [s for s in STEMS if not os.path.exists(os.path.join(it.work, f"{s}.flac"))]
            if missing:
                raise RuntimeError(f"separation gave no {missing}")

        self._each("sep", items, one)
        del sep

    def _drums(self, items: list[Item]) -> None:
        sep, tmp = self._separator(DRUMSEP)
        todo = [it for it in items if os.path.exists(os.path.join(it.work, "drums.flac"))]
        self._each(
            "drums", todo, lambda it: self._run_sep(sep, tmp, os.path.join(it.work, "drums.flac"), it.work, "dr_")
        )
        del sep

    def _dereverb(self, items: list[Item]) -> None:
        sep, tmp = self._separator(DEREVERB)

        def one(it: Item) -> None:
            v = dsp.load(os.path.join(it.work, "vocals.flac"))
            wins = vocal_windows(v)
            res = []
            if wins:
                gap = np.zeros((2, SR // 2), np.float32)
                parts, offs, pos = [], [], 0
                for a, b in wins:
                    seg = v[:, int(a * SR) : int(b * SR)]
                    offs.append((pos, pos + seg.shape[1]))
                    parts += [seg, gap]
                    pos += seg.shape[1] + gap.shape[1]
                src = os.path.join(it.work, ".wins.wav")
                _save_wav(np.concatenate(parts, 1), src)
                self._run_sep(sep, tmp, src, it.work, prefix="vr_")
                os.remove(src)
                dry = dsp.load(os.path.join(it.work, "vr_noreverb.flac"))
                rev = dsp.load(os.path.join(it.work, "vr_reverb.flac"))
                for (a, b), (p0, p1) in zip(wins, offs, strict=True):
                    ed, er = float((dry[:, p0:p1] ** 2).mean()), float((rev[:, p0:p1] ** 2).mean())
                    res.append(dict(t0=a, t1=b, wet=round(er / (ed + er + 1e-12), 3)))
            _atomic_json(res, os.path.join(it.work, "wet.json"))

        todo = [it for it in items if os.path.exists(os.path.join(it.work, "vocals.flac"))]
        self._each("dereverb", todo, one)
        del sep

    # ── beats, tags, sections ─────────────────────────────────────────────────

    def _beats(self, items: list[Item]) -> None:
        from beat_this.inference import Audio2Beats

        a2b = Audio2Beats(
            checkpoint_path=os.path.join(self.models, "beat_this", BEATS_CKPT), device=self.device, dbn=False
        )

        def one(it: Item) -> None:
            os.makedirs(it.work, exist_ok=True)
            b, d = a2b(dsp.load(it.src).mean(0), dsp.SR)
            _atomic_json(
                dict(beats=[round(float(x), 3) for x in b], downbeats=[round(float(x), 3) for x in d]),
                os.path.join(it.work, "beats.json"),
            )

        self._each("beats", items, one)
        del a2b

    def _tags(self, items: list[Item]) -> None:
        import librosa

        m = _load_efficientat(os.path.join(self.models, "efficientat"), self.device)
        keep = np.array([m["labels"].index(c) for c in KEEP if c in m["labels"]])

        def one(it: Item) -> None:
            arrs, mix = {}, None
            starts = None
            for name in ["mix", *STEMS, *(f"dr_{p}" for p in PARTS)]:
                path = it.src if name == "mix" else os.path.join(it.work, f"{name}.flac")
                if not os.path.exists(path):
                    continue
                w, _ = librosa.load(path, sr=TAG_SR, mono=True)
                starts, P = _tag_probs(m, w)
                arrs[name] = P[:, keep].astype(np.float16)
                if name == "mix":
                    mix = P.astype(np.float16)
            dst = os.path.join(it.work, "tags.npz")
            np.savez_compressed(
                dst + ".part.npz", starts=starts, classes=np.array([m["labels"][i] for i in keep]), **arrs
            )
            os.replace(dst + ".part.npz", dst)
            dst = os.path.join(it.work, "tagall.npz")
            np.savez_compressed(dst + ".part.npz", starts=starts, labels=np.array(m["labels"]), mix=mix)
            os.replace(dst + ".part.npz", dst)

        todo = [it for it in items if os.path.exists(os.path.join(it.work, "other.flac"))]
        self._each("tags", todo, one)
        del m

    def _struct(self, items: list[Item]) -> None:
        import librosa
        import torch

        model = _load_songformer(os.path.join(self.models, "songformer"), self.device)

        def one(it: Item) -> None:
            wav = librosa.load(it.src, sr=24000, mono=True)[0]
            wav = wav.astype(np.float16) if self.device == "cuda" else wav
            segs = None
            # memory grows with the window: 240 s holds a 4-minute song in ~4.7 GB, longer songs go
            # in two windows; 180 s / 120 s if even that does not fit
            for win in (240, 180, 120):
                model.config.win_size = model.config.hop_size = win
                # SongFormer's window loop never ends when the last window would hold <= 1024
                # samples (it `continue`s without advancing): drop that sliver of a tail
                rem = len(wav) % (win * 24000)
                x = wav[: len(wav) - rem] if 0 < rem <= 2048 and len(wav) > win * 24000 else wav
                try:
                    with torch.no_grad():
                        segs = model(x)
                    break
                except torch.OutOfMemoryError:
                    torch.cuda.empty_cache()
                    log.warning("struct %s: out of memory at a %s s window, trying smaller", it.id, win)
            torch.cuda.empty_cache()
            if segs is None:
                raise RuntimeError("SongFormer did not fit even at a 120 s window")
            _atomic_json(
                [dict(label=s["label"], start=round(float(s["start"]), 2), end=round(float(s["end"]), 2))
                 for s in segs],
                os.path.join(it.work, "struct.json"),
            )  # fmt: skip

        self._each("struct", items, one)
        del model


def vocal_windows(v: np.ndarray, win: float = 8.0, every: float = 16.0) -> list[tuple[float, float]]:
    """8 s windows where the voice is on for >= 70 % of the time, one per 16 s."""
    e = (v**2).mean(0)
    n = len(e) // SR
    sec = 10 * np.log10(e[: n * SR].reshape(n, SR).mean(1) + 1e-12)
    on = sec > np.percentile(sec, 95) - 25
    wins, t = [], 0.0
    while t + win <= n:
        if on[int(t) : int(t + win)].mean() >= 0.7:
            wins.append((t, t + win))
            t += every
        else:
            t += 2.0
    return wins


def _save_wav(x: np.ndarray, path: str) -> None:
    pcm = np.clip(x.T, -1, 1).astype(np.float32).tobytes()
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-", path],
        input=pcm,
        check=True,
    )


def _load_efficientat(root: str, device: str) -> dict[str, Any]:
    """tag3.load: the repo's own loader, run from its dir (it reads resources/ and metadata/)."""
    cwd = os.getcwd()
    sys.path.insert(0, root)
    os.chdir(root)
    try:
        from helpers.utils import NAME_TO_WIDTH, labels  # type: ignore[import-not-found]
        from models.mn.model import get_model  # type: ignore[import-not-found]
        from models.preprocess import AugmentMelSTFT  # type: ignore[import-not-found]

        model = get_model(width_mult=NAME_TO_WIDTH("mn10_as"), pretrained_name="mn10_as").to(device).eval()
        mel = AugmentMelSTFT(n_mels=128, sr=TAG_SR, win_length=800, hopsize=320).to(device).eval()
    finally:
        os.chdir(cwd)
    return dict(model=model, mel=mel, labels=list(labels), device=device)


def _tag_probs(m: dict[str, Any], wave: np.ndarray, win: float = 10.0, hop: float = 2.5, batch: int = 16) -> tuple[np.ndarray, np.ndarray]:
    """tag3.probs: (window starts, P[windows, 527]) on 10 s windows, hop 2.5 s (the model is
    trained on 10 s clips: on 3 s windows it returns noise)."""
    import torch

    w, h = int(win * TAG_SR), int(hop * TAG_SR)
    x = torch.from_numpy(wave.astype(np.float32)).to(m["device"])
    n = max(1, int(np.ceil((len(x) - w) / h)) + 1)
    x = torch.nn.functional.pad(x, (0, max(0, (n - 1) * h + w - len(x))))
    starts, out = [i * hop for i in range(n)], []
    with torch.no_grad(), torch.autocast("cuda", enabled=m["device"] == "cuda"):
        for a in range(0, n, batch):
            chunk = torch.stack([x[i * h : i * h + w] for i in range(a, min(n, a + batch))])
            spec = m["mel"](chunk)
            y, _ = m["model"](spec.unsqueeze(1))
            out.append(torch.sigmoid(y.float()).cpu().numpy())
    return np.array(starts), np.concatenate(out, 0)


def _load_songformer(root: str, device: str) -> Any:
    """gpu3.stage_struct's loader: the checkpoint has no safetensors metadata, which
    transformers 4.46 from_pretrained refuses, so the weights load by hand; fp16 (fp32 and
    bf16 autocast ran out of memory beside the owner's llama-server)."""
    os.environ["SONGFORMER_LOCAL_DIR"] = root
    sys.path.insert(0, root)
    # msaf is only used by the training-time evaluation; inference never calls it
    sys.modules.setdefault("msaf", type(sys)("msaf"))
    ev = type(sys)("msaf.eval")
    ev.compute_results = None  # type: ignore[attr-defined]
    sys.modules["msaf.eval"] = ev
    from configuration_songformer import SongFormerConfig  # type: ignore[import-not-found]
    from modeling_songformer import SongFormerModel  # type: ignore[import-not-found]
    from safetensors.torch import load_file

    model = SongFormerModel(SongFormerConfig.from_pretrained(root))
    sd = load_file(os.path.join(root, "model.safetensors"))
    missing, unexpected = model.load_state_dict(sd, strict=False)
    if missing or unexpected:
        log.info("songformer weights: missing %s unexpected %s", missing[:3], unexpected[:3])
    del sd
    # fp16 on the card; the CPU (tests, a GPU-less host) has no half kernels for all its ops
    return (model.half() if device == "cuda" else model).to(device).eval()
