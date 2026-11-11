"""The resident models (a port of v1 `ModelRegistry`): loaded lazily, once, by the one
executor thread, so no locks are needed around them.

The encode logic is v1's, line for line where it matters for vector parity:
- Octen's own `query`/`document` prompts;
- max_seq 2048, left padding;
- MILCO `encode_query`/`encode_document` with source_view, max_length 512, and
  length-sorted batches permuted back;
- bge-reranker sigmoid over the 1-logit head;
- CLAP at 48 kHz mono, the first 300 s in 10 s chunks (≥ 5 s tails padded), the mean
  and the chunks unit-normalised.

Heavy imports stay inside the loaders: `import musix_ml.models` is cheap."""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

from musix_ml.breaker import CircuitBreaker
from musix_ml.errors import ModelEncodeFailed, ModelGpuLent, ModelOOM, ModelUnavailable

log = logging.getLogger("musix_ml")

TEXT_MODEL = "Octen/Octen-Embedding-0.6B"
TEXT_DIM, TEXT_MAX_SEQ, TEXT_BATCH = 1024, 2048, 8
QUERY_PREFIX = "Instruct: Given a statement about music, retrieve passages that explain it\nQuery: "
SPARSE_MODEL = "omai-research/milco-650m"
SPARSE_MAX_LEN, SPARSE_BATCH = 512, 4
RERANK_MODEL = "BAAI/bge-reranker-v2-m3"
RERANK_MAX_LEN, RERANK_BATCH = 512, 8
CLAP_WEIGHTS = Path(
    os.environ.get("CLAP_WEIGHTS", "/models/weights/music_audioset_epoch_15_esc_90.14.pt")
)
CLAP_SR, CLAP_CHUNK_S, CLAP_MAX_S = 48_000, 10, 300

breaker = CircuitBreaker()
_loaded: dict[str, Any] = {}
# The GPU lease (spec sound-engine §4): while new songs get their sound analysis the card is
# lent to ml-sound. Interactive requests reload the search models on the CPU until the
# card comes back; bulk text indexing still waits. Only the executor touches this state.
_lent = False
GPU_LEGS = ("dense", "sparse", "cross_encoder")
# what a leg needs free on the card to load and run (fp16 weights + activations): a restart
# while ml-sound holds the card must not load into a full card
NEED_MB = {"dense": 1600, "sparse": 1800, "cross_encoder": 1500}


# CLAP always runs on the CPU, as in v1 (the owner's rule). The interactive trio (dense,
# sparse, reranker) takes ~5 GB in fp16, which is what llama-server leaves of the 3090's
# 24 GB; CLAP on top runs the card out of memory (2026-10-01). Its audio leg is bulk
# (ingest), and its text leg encodes one short query, so the CPU costs nobody a wait.
CPU_LEGS = frozenset({"clap"})


def device(leg: str | None = None) -> str:
    if leg in CPU_LEGS or _lent:
        return "cpu"
    want = os.environ.get("ML_DEVICE", "cpu")
    if want == "cuda":
        import torch

        if torch.cuda.is_available():
            return "cuda"
        log.warning("ML_DEVICE=cuda but no CUDA device: falling back to the CPU")
    return "cpu"


def _configure_torch() -> None:
    import torch

    # the dev box is shared with prod: cap the CPU threads (ML_THREADS, default 4)
    torch.set_num_threads(int(os.environ.get("ML_THREADS", "4")))


def _load(leg: str, name: str, loader: Callable[[], Any]) -> Any:
    if leg in _loaded:
        return _loaded[leg]
    if device(leg) == "cuda":
        import torch

        free_mb = torch.cuda.mem_get_info()[0] // 2**20
        if free_mb < NEED_MB.get(leg, 1024):
            raise ModelUnavailable(leg, "load", f"{name}: {free_mb} MB free on the card")
    if breaker.is_open(leg):
        raise ModelUnavailable(leg, "load", f"{name}: {breaker.reason(leg)} (not retried yet)")
    if not _loaded:
        _configure_torch()
    try:
        _loaded[leg] = loader()
    except Exception as e:
        breaker.trip(leg, f"{type(e).__name__}: {e}")
        log.exception("model %s would not load", name)
        raise ModelUnavailable(leg, "load", f"{name}: {e}") from e
    log.info("loaded %s (%s) on %s", leg, name, device(leg))
    return _loaded[leg]


def _guard(leg: str, op: str, fn: Callable[[], Any], small: Callable[[], Any] | None = None) -> Any:
    """Run one encode. On a CUDA OOM, free the allocator's cache and, when [small] is given,
    run the same work one item at a time before giving up. llama-server holds ~19 of the
    card's 24 GB, so a batch of long passages can find no room: 144 web passages came back
    503 and the retrieval ranked without vectors (2026-10-02)."""
    import torch

    try:
        return fn()
    except torch.OutOfMemoryError as e:
        torch.cuda.empty_cache()
        if small is not None:
            try:
                log.warning("%s %s: out of memory, retrying one item at a time", leg, op)
                return small()
            except torch.OutOfMemoryError:
                torch.cuda.empty_cache()
        raise ModelOOM(leg, op, str(e)) from e
    except (ModelUnavailable, ModelOOM):
        raise
    except Exception as e:
        log.exception("%s %s failed", leg, op)
        raise ModelEncodeFailed(leg, op, str(e)) from e


def loaded() -> dict[str, Any]:
    gpu = "lent" if _lent else "loaded" if any(g in _loaded for g in GPU_LEGS) else "empty"
    return {
        "device": device(),
        "loaded": sorted(_loaded),
        "failed": breaker.open_legs(),
        "gpu": gpu,
    }


def require_gpu(leg: str, op: str) -> None:
    """Bulk text indexing waits for the card instead of competing with sound's CPU work."""
    if _lent:
        raise ModelGpuLent(leg, op, "the GPU is lent to ml-sound")


def _drop_search_models() -> None:
    """Discard weights before changing devices; cached CPU models must not stay on acquire."""
    for leg in GPU_LEGS:
        _loaded.pop(leg, None)
    import gc

    gc.collect()
    import torch

    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def release() -> dict[str, Any]:
    """Free the card for sound; subsequent interactive requests load CPU weights lazily."""
    global _lent
    if _lent:
        return loaded()
    _lent = True
    _drop_search_models()
    log.info("GPU released to ml-sound")
    return loaded()


def acquire() -> dict[str, Any]:
    """Discard CPU fallback weights and let the caller warm the GPU models in the background."""
    global _lent
    if _lent:
        _drop_search_models()
    _lent = False
    log.info("GPU acquired back from ml-sound")
    return loaded()


def warm() -> None:
    """Load the GPU trio now, so the first query after a lease doesn't pay the load."""
    for load in (_text_model, _sparse_model, _reranker):
        try:
            load()
        except Exception:  # a refusal is logged by _load; the next real call retries
            log.warning("warm-up after the lease: a model would not load", exc_info=True)


# ── dense text ────────────────────────────────────────────────────────────────


def _text_model() -> Any:
    def load() -> Any:
        import torch
        from sentence_transformers import SentenceTransformer

        kwargs: dict[str, Any] = {"tokenizer_kwargs": {"padding_side": "left"}}
        if device() == "cuda":
            kwargs["model_kwargs"] = {"torch_dtype": torch.float16}
        m = SentenceTransformer(TEXT_MODEL, device=device(), **kwargs)
        m.max_seq_length = TEXT_MAX_SEQ
        return m

    return _load("dense", TEXT_MODEL, load)


def embed_text(texts: list[str], is_query: bool) -> np.ndarray:
    m = _text_model()
    prompts = getattr(m, "prompts", None) or {}
    name = "query" if is_query else "document"

    def run(bs: int = TEXT_BATCH) -> np.ndarray:
        if name in prompts:
            out = m.encode(texts, prompt_name=name, batch_size=bs, convert_to_numpy=True)
        else:  # a model without prompts: the instruction on the query side only
            batch = [QUERY_PREFIX + t for t in texts] if is_query else texts
            out = m.encode(batch, batch_size=bs, convert_to_numpy=True)
        return np.asarray(out, dtype=np.float32)

    return _guard("dense", "encode", run, small=lambda: run(1))  # type: ignore[no-any-return]


# ── learned sparse ────────────────────────────────────────────────────────────


def _sparse_model() -> Any:
    def load() -> Any:
        import torch
        from transformers import AutoModel

        kwargs: dict[str, Any] = {"trust_remote_code": True}
        if device() == "cuda":
            kwargs["torch_dtype"] = torch.float16
        return AutoModel.from_pretrained(SPARSE_MODEL, **kwargs).to(device()).eval()

    return _load("sparse", SPARSE_MODEL, load)


def embed_sparse(texts: list[str], is_query: bool) -> list[tuple[list[int], list[float]]]:
    """One (indices, values) per text, in the caller's order."""
    m = _sparse_model()
    encode = m.encode_query if is_query else m.encode_document

    def run(bs: int = SPARSE_BATCH) -> list[tuple[list[int], list[float]]]:
        import torch

        order = sorted(range(len(texts)), key=lambda i: -len(texts[i]))  # MILCO pads per batch
        out: list[tuple[list[int], list[float]]] = [([], [])] * len(texts)
        for s in range(0, len(order), bs):
            idx = order[s : s + bs]
            with torch.no_grad():
                rep = encode([texts[i] for i in idx], max_length=SPARSE_MAX_LEN, source_view=True)
            rep = rep.coalesce()
            ind = rep.indices().cpu().numpy()
            val = rep.values().float().cpu().numpy()
            for row, i in enumerate(idx):
                sel = ind[0] == row
                out[i] = (ind[1][sel].astype(int).tolist(), val[sel].tolist())
        return out

    return _guard("sparse", "encode", run, small=lambda: run(1))  # type: ignore[no-any-return]


# ── cross-encoder ─────────────────────────────────────────────────────────────


def _reranker() -> Any:
    def load() -> Any:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        tok = AutoTokenizer.from_pretrained(RERANK_MODEL, trust_remote_code=True)
        dtype = torch.float16 if device() == "cuda" else torch.float32
        model = AutoModelForSequenceClassification.from_pretrained(
            RERANK_MODEL, trust_remote_code=True, torch_dtype=dtype
        )
        return tok, model.to(device()).eval()

    return _load("cross_encoder", RERANK_MODEL, load)


def rerank(query: str, docs: list[str]) -> list[float]:
    """sigmoid(logit) per pair: every assistant threshold is one of these."""
    if not docs:
        return []
    tok, model = _reranker()

    def run() -> list[float]:
        import torch

        out: list[float] = []
        with torch.inference_mode():
            for i in range(0, len(docs), RERANK_BATCH):
                batch = docs[i : i + RERANK_BATCH]
                enc = tok(
                    [query] * len(batch),
                    batch,
                    padding=True,
                    truncation=True,
                    max_length=RERANK_MAX_LEN,
                    return_tensors="pt",
                ).to(device())
                logits = model(**enc).logits.float()
                col = logits[:, 0] if logits.shape[-1] == 1 else logits[:, -1]
                out.extend(torch.sigmoid(col).cpu().tolist())
        return out

    return _guard("cross_encoder", "score", run)  # type: ignore[no-any-return]


# ── CLAP ──────────────────────────────────────────────────────────────────────


def _clap() -> Any:
    def load() -> Any:
        import laion_clap

        # device passed to the constructor: it runs .to(device) inside it
        m = laion_clap.CLAP_Module(enable_fusion=False, amodel="HTSAT-base", device=device("clap"))
        m.load_ckpt(str(CLAP_WEIGHTS))
        return m.eval()

    return _load("clap", CLAP_WEIGHTS.name, load)


def _unit(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return np.asarray(v / np.where(n == 0, 1, n), dtype=np.float32)


def clap_text(texts: list[str]) -> np.ndarray:
    m = _clap()
    return _guard(  # type: ignore[no-any-return]
        "clap", "text", lambda: _unit(np.asarray(m.get_text_embedding(texts, use_tensor=False)))
    )


def clap_audio(path: str) -> tuple[np.ndarray, np.ndarray] | None:
    """(unit mean vector, unit chunk vectors) — None for audio under 5 s."""
    m = _clap()

    def run() -> tuple[np.ndarray, np.ndarray] | None:
        import librosa
        import torch

        y, sr = librosa.load(path, duration=CLAP_MAX_S, sr=CLAP_SR, mono=True)
        n = sr * CLAP_CHUNK_S
        chunks = []
        for s in range(0, len(y), n):
            c = y[s : s + n]
            if len(c) < sr * 5:
                continue
            chunks.append(np.pad(c, (0, n - len(c))) if len(c) < n else c)
        if not chunks:
            return None
        dev = next(m.parameters()).device
        with torch.no_grad():
            emb = m.get_audio_embedding_from_data(
                x=torch.from_numpy(np.stack(chunks)).to(dev), use_tensor=True
            )
        e = emb.cpu().numpy().astype(np.float32)
        return _unit(e.mean(axis=0)), _unit(e)

    return _guard("clap", "audio", run)  # type: ignore[no-any-return]
