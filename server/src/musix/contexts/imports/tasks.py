from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import procrastinate

from musix.workers.context import sessionmaker, settings


async def yandex_import(account_id: str, job: str, sources: list[Any]) -> dict[str, Any]:
    from musix.contexts.imports import yandex
    from musix.contexts.media.tasks import enqueue as media
    from musix.infra import secrets

    fernet = secrets.fernet_only(settings().secrets_dir)
    if fernet is None:
        raise RuntimeError("no Fernet key: the worker needs the secrets volume")
    return await yandex.run_import(
        sessionmaker(),
        fernet,
        Path(settings().media_dir),
        uuid.UUID(account_id),
        job,
        sources,
        on_registered=media,
    )


def register(app: procrastinate.App) -> None:
    app.task(name="imports:yandex", queue="net")(yandex_import)
