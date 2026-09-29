#!/usr/bin/env bash
# The v1 Playwright e2e suite against an isolated v1 stack: a throwaway Qdrant on
# 127.0.0.1:6399, a fresh SQLite, 3 generated 150 s tones, v1 served on :8011 from
# the repo (imported, never edited). Env: /mnt/data/envs/musix-e2e (v1 deps +
# playwright, system Chrome).
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh
REPO=$(cd ../../.. && pwd)
rm -rf "$RUN" && mkdir -p "$RUN" "$E2E_MUSIC" "$MUSIX_DIAG_DIR"
cleanup() { [ -n "${SERVE_PID:-}" ] && kill "$SERVE_PID" 2>/dev/null || true
            docker rm -f musix-e2e-qdrant >/dev/null 2>&1 || true; }
trap cleanup EXIT

# v1's bundle, built from its sources into OUR dir (v1's frontend/dist is untouched).
(cd "$REPO/frontend" && npx vite build --outDir "$E2E_DIST" --emptyOutDir --logLevel warn)
for i in 1 2 3; do
  ffmpeg -v quiet -f lavfi -i "sine=frequency=$((220 * i)):duration=150" -b:a 320k "$E2E_MUSIC/track$i.mp3"
done
docker run -d --rm --name musix-e2e-qdrant -p 127.0.0.1:6399:6333 qdrant/qdrant:v1.18.2 >/dev/null
until curl -sf http://127.0.0.1:6399/ >/dev/null; do sleep 1; done

"$V1PY" seed.py
"$V1PY" serve.py > "$RUN/serve.log" 2>&1 & SERVE_PID=$!
until curl -sf http://127.0.0.1:8011/api/v1/instance/config >/dev/null; do sleep 1; done
"$PY" -m pytest -q -p no:cacheprovider test_playback_e2e.py "$@"
