#!/usr/bin/env bash
# A throwaway, never-set-up instance for the web's first-run/admin flow (e2e/admin.spec.ts):
# database `musix_web` recreated at Alembic head, an api on 127.0.0.1:18020 (one process) and
# a worker on it. Library roots: /mnt/data/musix-v2-media/test-library only — fresh test files,
# so the shared Qdrant `tracks` collection never re-owns migrated or dev points.
# `fresh-instance.sh down` stops it. The dev api/worker are paused meanwhile (Postgres has 100
# connections; api-snap and the dev api hold ~45 each) and restarted by `down`.
set -euo pipefail
cd "$(dirname "$0")/../.."
C="docker compose -f deploy/compose.dev.yml"
DB=musix_web
E=(-e "MUSIX_DATABASE_URL=postgresql://musix:musix@postgres:5432/$DB" -e 'MUSIX_LIBRARY_ROOTS=["/mnt/data/musix-v2-media/test-library"]')
down() { docker stop musix-v2-web-api musix-v2-web-worker >/dev/null 2>&1 || true; }
if [ "${1:-up}" = down ]; then down; $C start api worker >/dev/null; echo "dev api back"; exit 0; fi
down
$C stop api worker >/dev/null
docker exec musix-v2-dev-postgres-1 dropdb -U musix --if-exists "$DB"
docker exec musix-v2-dev-postgres-1 createdb -U musix "$DB"
$C run --rm --no-deps "${E[@]}" migrate >/dev/null
$C run -d --rm --no-deps "${E[@]}" -p 127.0.0.1:18020:8000 --name musix-v2-web-api api \
  sh -c "mkdir -p /tmp/prom && exec uvicorn musix.api.app:create_app --factory --host 0.0.0.0 --port 8000" >/dev/null
$C run -d --rm --no-deps "${E[@]}" --name musix-v2-web-worker worker >/dev/null
for _ in $(seq 1 30); do curl -sf http://127.0.0.1:18020/api/v2/instance >/dev/null && { echo "fresh instance on :18020"; exit 0; }; sleep 2; done
echo "api did not come up" >&2; exit 1
