# One image, several commands (api / worker / ml / migrate) — see deploy/compose.dev.yml.
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.26 /uv /bin/uv
# ffmpeg/ffprobe for the media tasks, libvips for image variants (worker; the api never runs them)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libvips42t64 \
    && rm -rf /var/lib/apt/lists/*
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY alembic.ini ./
COPY migrations ./migrations
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:$PATH"
RUN useradd --system --uid 10001 musix && mkdir -p /var/lib/musix/secrets && chown -R musix /var/lib/musix
USER musix
EXPOSE 8000
CMD ["uvicorn", "musix.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
