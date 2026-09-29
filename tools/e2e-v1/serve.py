"""Run the copied app for e2e checks.

* No background model preload — streaming and the player need no models, and
  this box's GPU belongs to prod.
* A fault-injection wrapper around the stream endpoint, switched over HTTP:
    GET /__e2e/mode?m=normal   pass-through
    GET /__e2e/mode?m=cut      the FIRST stream request after the switch is
                               cut after 1 MB (connection dropped mid-body);
                               every later request carrying that same ?st=
                               token gets 503 — only a fresh token gets through
    GET /__e2e/mode?m=expired  401 for any stream token minted before the switch
    GET /__e2e/log             the stream requests seen, as JSON
"""
import asyncio
import base64
import json
import os
import sys
import time
from urllib.parse import parse_qs

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))  # the repo root: v1 is imported where it lives, unedited
import app.api.main as m  # noqa: E402


async def _no_preload(db):
    return None


m._preload_models_in_background = _no_preload
# Serve the v1 bundle built by run.sh into .run/dist (never into v1's own frontend/dist).
from pathlib import Path  # noqa: E402
m.FRONTEND_DIST = Path(os.environ['E2E_DIST'])

MODE = {"m": "normal", "since": 0.0, "victim": None, "cut_done": False}
LOG = []
CUT_BYTES = 1024 * 1024


def _iat(token: str):
    try:
        p = token.split(".")[1]
        p += "=" * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p)).get("iat")
    except Exception:
        return None


async def _plain(send, status, body: bytes, ctype=b"application/json"):
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", ctype), (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})


class Faults:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]
        qs = parse_qs(scope["query_string"].decode())
        if path == "/__e2e/mode":
            MODE.update(m=qs["m"][0], since=time.time(), victim=None, cut_done=False)
            return await _plain(send, 200, b'{"ok":true}')
        if path == "/__e2e/log":
            return await _plain(send, 200, json.dumps(LOG).encode())
        if "/tracks/" not in path or not path.endswith("/stream"):
            return await self.app(scope, receive, send)

        tok = qs.get("st", [""])[0]
        headers = dict(scope["headers"])
        rng = headers.get(b"range", b"").decode()
        entry = {"t": time.time(), "tid": path.split("/")[-2][:8], "range": rng,
                 "tok": tok[-8:], "mode": MODE["m"], "outcome": "pass"}
        LOG.append(entry)

        if MODE["m"] == "expired":
            iat = _iat(tok)
            if iat is not None and iat < MODE["since"]:
                entry["outcome"] = "401"
                return await _plain(send, 401, b'{"detail":"stream token expired"}')

        if MODE["m"] == "cut":
            if MODE["victim"] is None:
                MODE["victim"] = tok
            if tok == MODE["victim"]:
                if MODE["cut_done"]:
                    entry["outcome"] = "503"
                    return await _plain(send, 503, b'{"detail":"e2e: link down"}')
                MODE["cut_done"] = True
                entry["outcome"] = "cut"
                sent = 0

                async def cutting_send(msg):
                    nonlocal sent
                    if msg["type"] == "http.response.body":
                        body = msg.get("body", b"")
                        if sent + len(body) > CUT_BYTES:
                            await send({"type": "http.response.body",
                                        "body": body[:max(0, CUT_BYTES - sent)], "more_body": True})
                            raise ConnectionResetError("e2e: stream cut mid-body")
                        sent += len(body)
                        await send(msg)
                        # A mobile-grade link: ~100 KB/s, so the cut lands
                        # ~10 s into the track rather than at its first second.
                        await asyncio.sleep(len(body) / 100_000)
                        return
                    await send(msg)

                return await self.app(scope, receive, cutting_send)

        return await self.app(scope, receive, send)


import uvicorn  # noqa: E402

uvicorn.run(Faults(m.app), host="127.0.0.1", port=8011, log_level="warning")
