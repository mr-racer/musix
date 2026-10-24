# The sound analysis host (sound/): Python 3.11 like ml, torch CPU in the image; the GPU
# compose override puts the cu124 overlay first on PYTHONPATH (spec sound-engine §6.1).
# builder: diffq (audio-separator's) has no wheel and compiles; the runtime gets the venv only
FROM python:3.11-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.26 /uv /bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ \
    && rm -rf /var/lib/apt/lists/*
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --group models --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --group models

FROM python:3.11-slim
# ffmpeg: measure() decodes every format through it, librosa m4a/alac too
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY --from=build /app /app
# weights are mounted read-only at /models: sep/ (SW, DrumSep, anvuew dereverb + their yaml and
# audio-separator's download_checks.json, so it never reaches GitHub), beat_this/, efficientat/
# and songformer/ (code next to weights), hf/ (the one config MuQ builds its conformer from).
# EfficientAT chdirs into its own dir and SongFormer imports its modules from there, so their
# __pycache__ goes to /tmp instead of the read-only mount.
ENV PATH="/app/.venv/bin:$PATH" HF_HOME=/models/hf HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
    HF_MODULES_CACHE=/tmp/hf-modules NUMBA_CACHE_DIR=/tmp/numba PYTHONPYCACHEPREFIX=/tmp/pycache \
    MPLCONFIGDIR=/tmp/mpl SOUND_MODELS=/models SOUND_SCRATCH=/scratch SOUND_EXPORT=/export
ARG UID=1000
RUN useradd --system --uid ${UID} musix
USER musix
EXPOSE 8004
CMD ["uvicorn", "musix_sound.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8004"]
