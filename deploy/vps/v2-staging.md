# v2 staging on the same VPS (phase 6, the owner's week)

v1 stays exactly where it is (`musixai.ru/` → tunnel :8000 → v1). Only the paths v1 does not
use go to v2: `/api/v2/`, `/m/`, `/i/` → a second tunnel (VPS `127.0.0.1:8001` → home
`localhost:18090`, the v2 prod stack's edge). The v2 Android app needs nothing else. At the
switch (T+29) this goes away: v1 stops, v2 takes home :8000, the old tunnel carries v2.

Two edits on the VPS, as an admin user. Each one is reversible.

## 1. Let the tunnel user open port 8001 (sshd)

In `/etc/ssh/sshd_config` (or its `sshd_config.d/` drop-in), in the `Match User tunnel` block,
add the second port to `PermitListen`:

```
Match User tunnel
    PermitListen 127.0.0.1:8000 127.0.0.1:8001
```

```bash
sudo sshd -t && sudo systemctl reload ssh   # reload, not restart: live sessions stay up
```

The home side then starts `docker compose ... --profile staging up -d tunnel` (see
`deploy/compose.prod.yml`).

## 2. nginx: route the v2 paths

In the `musixai.ru` server block, **above** `location / {`:

```nginx
    # ── MusiX v2 staging: only the v2 app's paths (v1 has /api/v1 + its SPA) ──
    location ^~ /api/v2/auth/ {
        limit_req zone=musix_auth burst=5 nodelay;
        proxy_pass http://127.0.0.1:8001;
    }
    location = /api/v2/ws {
        # a location that sets headers drops the inherited ones: all of them again
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_pass http://127.0.0.1:8001;
    }
    location ^~ /api/v2/ { proxy_pass http://127.0.0.1:8001; }
    location ^~ /m/      { proxy_pass http://127.0.0.1:8001; }
    location ^~ /i/      { proxy_pass http://127.0.0.1:8001; }
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 3. Check (from anywhere)

```bash
curl -s https://musixai.ru/api/v2/health          # {"status":"ok",...}  ← v2
curl -s https://musixai.ru/api/v1/instance/config  # v1's answer, unchanged
curl -sI https://musixai.ru/ | head -1             # 200 ← v1's SPA
```

## Rollback

Delete the block from step 2, then `sudo nginx -t && sudo systemctl reload nginx`. The
PermitListen line can stay; nothing listens on 8001 once the tunnel container stops.
