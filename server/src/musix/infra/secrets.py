"""Process secrets, generated on first start into MUSIX_SECRETS_DIR (mode 0600).
Never in the database, never in git, never logged.

- jwt_ed25519.pem: the access-token signing key (EdDSA);
- media_hmac.key:  the signed-URL secret nginx verifies with njs (0644, see below);
- fernet.key:      encrypts secrets kept in instance_settings (the LLM API key).
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


@dataclass(frozen=True)
class Secrets:
    jwt_private: Ed25519PrivateKey
    jwt_public: Ed25519PublicKey
    media_hmac: bytes
    fernet: Fernet


def _write(path: Path, data: bytes, mode: int = 0o600) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, "wb") as f:
        f.write(data)


def load_or_create(directory: str) -> Secrets:
    d = Path(directory)
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    pem, hmac_path, fernet_path = d / "jwt_ed25519.pem", d / "media_hmac.key", d / "fernet.key"
    if not pem.exists():
        key = Ed25519PrivateKey.generate()
        _write(
            pem,
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            ),
        )
    if not hmac_path.exists():
        # 0644: nginx (another uid) verifies signed URLs with it; the volume is mounted
        # only into api and nginx. The signing key and the Fernet key stay 0600.
        _write(hmac_path, secrets.token_hex(32).encode(), 0o644)
    if not fernet_path.exists():
        _write(fernet_path, Fernet.generate_key())
    private = serialization.load_pem_private_key(pem.read_bytes(), password=None)
    assert isinstance(private, Ed25519PrivateKey)
    return Secrets(
        private,
        private.public_key(),
        hmac_path.read_bytes().strip(),
        Fernet(fernet_path.read_bytes().strip()),
    )


def fernet_only(directory: str) -> Fernet | None:
    """The workers' read-only view: only the Fernet key (for the LLM API key), and none
    when the api has not created the secrets yet."""
    p = Path(directory) / "fernet.key"
    try:
        return Fernet(p.read_bytes().strip())
    except OSError:
        return None
