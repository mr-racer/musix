"""Passwords (argon2id) and tokens: 15-min EdDSA access JWTs, opaque rotating refresh
tokens stored as sha256 (spec §4)."""

from __future__ import annotations

import datetime as dt
import hashlib
import secrets
import uuid
from dataclasses import dataclass

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError

from musix.errors import Unauthorized
from musix.infra.secrets import Secrets

ACCESS_TTL = dt.timedelta(minutes=15)
REFRESH_TTL = dt.timedelta(days=60)
# argon2-cffi defaults (t=3, m=64 MiB, p=4): ~50 ms per hash on this box — slow enough
# for offline guessing, fast enough for login. /auth is rate-limited at nginx as well.
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerificationError:
        return False


@dataclass(frozen=True)
class Principal:
    account_id: uuid.UUID
    device_id: uuid.UUID
    role: str
    expires_at: int = 0  # unix seconds; long-lived sockets close when it passes


def issue_access(sec: Secrets, p: Principal, now: dt.datetime | None = None) -> str:
    now = now or dt.datetime.now(dt.UTC)
    return jwt.encode(
        {
            "sub": str(p.account_id),
            "dev": str(p.device_id),
            "role": p.role,
            "scope": "all",
            "iat": int(now.timestamp()),
            "exp": int((now + ACCESS_TTL).timestamp()),
        },
        sec.jwt_private,
        algorithm="EdDSA",
    )


def verify_access(sec: Secrets, token: str) -> Principal:
    try:
        c = jwt.decode(token, sec.jwt_public, algorithms=["EdDSA"])
    except jwt.ExpiredSignatureError as e:
        raise Unauthorized("access token expired") from e
    except jwt.PyJWTError as e:
        raise Unauthorized("invalid access token") from e
    return Principal(uuid.UUID(c["sub"]), uuid.UUID(c["dev"]), c["role"], int(c["exp"]))


def new_refresh() -> tuple[str, bytes]:
    token = secrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode()).digest()


def refresh_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()
