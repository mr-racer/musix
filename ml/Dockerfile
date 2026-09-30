# The model host (v2/ml): Python 3.11 like v1, torch CPU in dev (the GPU is prod's).
FROM python:3.11-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.26 /uv /bin/uv
# ffmpeg: librosa decodes m4a/alac through it
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --group models --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --group models
# weights are mounted read-only (models/hf = v1's HF cache, models/weights = the CLAP ckpt);
# nothing is downloaded, and remote-code modules are copied to a writable dir
ENV PATH="/app/.venv/bin:$PATH" HF_HOME=/models/hf HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
    HF_MODULES_CACHE=/tmp/hf-modules NUMBA_CACHE_DIR=/tmp/numba
ARG UID=1000
RUN useradd --system --uid ${UID} musix
USER musix
EXPOSE 8002
CMD ["uvicorn", "musix_ml.app:app", "--host", "0.0.0.0", "--port", "8002"]
