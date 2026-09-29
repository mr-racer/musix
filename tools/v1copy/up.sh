#!/usr/bin/env bash
# A throwaway COPY of v1 prod on a snapshot, shared by the gates, the benches and
# the golden screenshots. Never touches prod:
#   - the prod IMAGE, with its model cache, weights, music, media and covers
#     mounted read-only;
#   - the snapshot's working-copy SQLite and an empty cache dir;
#   - the dev Qdrant holding the restored snapshot;
#   - its own JWT secret (prod's is never read), CPU only (the GPU belongs to prod);
#   - no prod .env: LLM settings come from the snapshot DB's instance_settings.
# Usage: up.sh <snapshot-date>     → http://127.0.0.1:18800
set -euo pipefail
SNAP=${1:?usage: up.sh <snapshot-date>}
ROOT=${MUSIX_SNAPSHOTS:-/mnt/data/musix-snapshots}
WORK=$ROOT/$SNAP/work
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
[ -f "$WORK/metadata.db" ] || { echo "no $WORK/metadata.db: run make snapshot-restore SNAP=$SNAP" >&2; exit 1; }
mkdir -p "$WORK/cache" "$WORK/diag"
docker rm -f musix-v1copy >/dev/null 2>&1 || true
SECRET=$(openssl rand -hex 32)
umask 077 && echo "$SECRET" > "$WORK/jwt_secret"
docker run -d --name musix-v1copy --network musix-v2-dev_default \
  --user "$(id -u):$(id -g)" -p 127.0.0.1:18800:8000 \
  --add-host host.docker.internal:host-gateway \
  -e FORCE_CPU=1 -e QDRANT_URL=http://qdrant:6333 -e MUSIX_METADATA_DB=/work/metadata.db \
  -e MUSIX_JWT_SECRET="$SECRET" -e MUSIX_DIAG_DIR=/work/diag \
  -e HF_HOME=/app/.hf-cache -e HF_HUB_OFFLINE=1 -e TRANSFORMERS_OFFLINE=1 \
  -e SEARXNG_URL=http://127.0.0.1:1 -e HTTP_PROXY= -e HTTPS_PROXY= -e http_proxy= -e https_proxy= \
  -e HOME=/work \
  -v "$WORK:/work" -v "$WORK/cache:/app/cache" \
  -v lyrics-search_hf-cache:/app/.hf-cache:ro -v "$REPO/weights:/app/weights:ro" \
  -v /mnt/data/music:/music:ro -v "$REPO/media:/app/media:ro" \
  -v "$REPO/frontend/covers:/app/frontend/covers:ro" -v "$REPO/tests:/app/tests:ro" \
  lyrics-search-musix >/dev/null
for _ in $(seq 120); do
  curl -sf http://127.0.0.1:18800/api/v1/instance/config >/dev/null && { echo "v1 copy up: http://127.0.0.1:18800"; exit 0; }
  sleep 2
done
docker logs --tail 30 musix-v1copy >&2; exit 1
