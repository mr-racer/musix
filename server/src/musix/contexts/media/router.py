import asyncio
import contextlib
import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Request

from musix.api.deps import Auth, Keys, Session
from musix.contexts.media import delivery
from musix.contexts.media import schemas as S
from musix.errors import NotFound

router = APIRouter(tags=["media"])


@router.post("/playback/manifest", response_model=S.ManifestOut)
async def manifest(
    body: S.ManifestIn, p: Auth, s: Session, k: Keys, request: Request
) -> S.ManifestOut:
    """Signed URLs for the current track and the next ones in the queue (clients prefetch)."""
    base = request.app.state.settings.public_base_url
    items = await delivery.manifest(
        s, base, k.media_hmac, p.account_id, p.device_id, body.track_ids, body.network
    )
    return S.ManifestOut(items=items)


@router.get("/app/{platform}/latest", response_model=S.AppRelease)
async def latest(platform: Literal["android", "windows"], request: Request) -> S.AppRelease:
    """Read from downloads/manifest.json; publishing a release = copying files + manifest."""
    d = Path(request.app.state.settings.media_dir) / "downloads"
    try:
        data = json.loads(await asyncio.to_thread((d / "manifest.json").read_text))[platform]
    except (FileNotFoundError, KeyError) as e:
        raise NotFound(f"no {platform} release") from e
    out = S.AppRelease.model_validate(data)
    if out.size_bytes is None:
        with contextlib.suppress(OSError):
            out.size_bytes = (await asyncio.to_thread((d / Path(out.url).name).stat)).st_size
    return out
