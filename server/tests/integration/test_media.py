"""Renditions with real ffmpeg, and signed URLs verified by real nginx + njs."""

import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from testcontainers.core.container import DockerContainer

from musix.contexts.library import ingest
from musix.contexts.library.models import renditions
from musix.contexts.media import delivery
from musix.contexts.media.process import process_media
from musix.infra import db
from musix.settings import Settings

pytestmark = pytest.mark.integration
AUDIO = Path(__file__).resolve().parents[1] / "fixtures" / "audio"
NGINX = Path(__file__).resolve().parents[3] / "deploy" / "nginx"


@pytest.fixture
async def sm(settings: Settings):  # type: ignore[no-untyped-def]
    engine = db.make_engine(settings)
    yield db.make_sessionmaker(engine)
    await engine.dispose()


def codec(p: Path) -> str:
    return subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "stream=codec_name", "-of", "csv=p=0", str(p)],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


async def _tiers(sm, settings: Settings, src: Path, owner: dict[str, str]) -> dict[str, str]:  # type: ignore[no-untyped-def]
    got: list[uuid.UUID] = []

    async def hook(mf: uuid.UUID) -> None:
        got.append(mf)

    await ingest.ingest_file(sm, uuid.UUID(owner["accountId"]), src, on_registered=hook)
    await process_media(sm, Path(settings.media_dir), got[0])
    async with sm() as s:
        return {
            r.tier: r.path
            for r in await s.execute(
                sa.select(renditions).where(renditions.c.media_file_id == got[0])
            )
        }


async def test_flac_gets_aac_high_and_economy(
    sm, settings: Settings, tmp_path: Path, owner: dict[str, str]
) -> None:  # type: ignore[no-untyped-def]
    src = tmp_path / "long.flac"  # 5 s of tone: long enough for real AAC frames
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=5",
            "-c:a",
            "flac",
            str(src),
        ],
        check=True,
    )
    tiers = await _tiers(sm, settings, src, owner)
    assert set(tiers) == {"high", "economy"}
    assert codec(Path(tiers["high"])) == "aac"
    assert Path(tiers["high"]).stat().st_size > Path(tiers["economy"]).stat().st_size


async def test_alac_gets_a_flac_compat_rendition(
    sm, settings: Settings, tmp_path: Path, owner: dict[str, str]
) -> None:  # type: ignore[no-untyped-def]
    src = tmp_path / "alac.m4a"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=330:duration=3",
            "-c:a",
            "alac",
            str(src),
        ],
        check=True,
    )
    tiers = await _tiers(sm, settings, src, owner)
    assert codec(Path(tiers["lossless_compat"])) == "flac"


def test_signed_url_through_nginx(tmp_path: Path) -> None:
    secret = b"test-secret"
    media = tmp_path / "media"
    sha = "ab" + "c" * 62
    (media / "m" / "ab" / sha).mkdir(parents=True)
    (media / "m" / "ab" / sha / "high.m4a").write_bytes(b"0123456789" * 100)
    (tmp_path / "secrets").mkdir()
    (tmp_path / "secrets" / "media_hmac.key").write_bytes(secret)
    (tmp_path / "conf.d").mkdir()
    (tmp_path / "conf.d" / "t.conf").write_text(
        "server { listen 80; include /etc/nginx/media.conf; }\n"
    )
    for d in (tmp_path, media):
        d.chmod(0o755)
    shutil.copytree(NGINX / "njs", tmp_path / "njs")
    c = (
        DockerContainer("nginx:1.29-alpine")
        .with_volume_mapping(str(NGINX / "nginx.conf"), "/etc/nginx/nginx.conf")
        .with_volume_mapping(str(NGINX / "media.conf"), "/etc/nginx/media.conf")
        .with_volume_mapping(str(tmp_path / "conf.d"), "/etc/nginx/conf.d")
        .with_volume_mapping(str(tmp_path / "njs"), "/etc/nginx/njs")
        .with_volume_mapping(str(tmp_path / "secrets"), "/etc/nginx/secrets")
        .with_volume_mapping(str(media), "/mnt/data/musix-v2-media")
        .with_exposed_ports(80)
    )
    with c:
        base = f"http://{c.get_container_host_ip()}:{c.get_exposed_port(80)}"
        path = f"/m/{sha}/high.m4a"
        good = base + delivery.sign(secret, path, 60)

        def status(url: str, rng: str | None = None) -> int:
            req = urllib.request.Request(url, headers={"Range": rng} if rng else {})
            for _ in range(40):
                try:
                    return int(urllib.request.urlopen(req).status)
                except urllib.error.HTTPError as e:
                    return e.code
                except (ConnectionError, urllib.error.URLError):
                    time.sleep(0.25)
            raise AssertionError("nginx did not come up")

        assert status(good, "bytes=0-9") == 206
        assert status(base + delivery.sign(secret, path, -10)) == 403  # expired
        assert (
            status(good.replace("high.m4a", "economy.m4a")) == 403
        )  # signature is for another path
        assert status(base + path) == 403  # unsigned
