#!/usr/bin/env bash
# The cutover runbook (phase 6 spec §3), one step per call, each timed into
# /mnt/data/musix-v2-prod/cutover.log. Steps that touch v1 prod or what users receive need
# `--yes`, and are run only on the owner's go for THAT step.
#
#   run.sh plan                          the order, with the rehearsed budgets
#   run.sh prebuild                      T−1 d: renditions on the staging stack (most played first)
#   run.sh stop-v1 --yes                 T−0: v1 `musix` stops (downtime starts; its Qdrant stays up)
#   run.sh carry-week SINCE --yes        the owner's staging activity since SINCE → v1's SQLite
#   run.sh snapshot                      the final snapshot (read-only; v1 stopped = consistent)
#   run.sh migrate SNAP                  → the prod stack (as root: hardlinks; else COPY=1)
#   run.sh gate SNAP                     counts, checksums, search, «Поток»
#   run.sh switch --yes                  v2 takes 127.0.0.1:8000 (the existing tunnel), ml on the GPU, AI on
#   run.sh smoke                         health, login page, the 426 for 1.0.0, one manifest
#   run.sh publish-apk APK --yes         downloads/musix.apk = v2 (1.0.0 kept), manifest.json
#   run.sh rollback SINCE --yes          v2 → :18090, v1 back, v2's rows since SINCE → v1
set -euo pipefail
cd "$(dirname "$0")/../.."
PROD_DIR=/mnt/data/musix-v2-prod
V1_COMPOSE=/mnt/data/lyrics-search/docker-compose.prod.yml
V1_DB=${MUSIX_PROD_DB:-/home/ivan/musix-db/metadata.db}
P=(docker compose --env-file "$PROD_DIR/prod.env" -f deploy/compose.prod.yml)
step=${1:-plan}; shift || true
yes() { [[ " $* " == *" --yes "* ]] || { echo "refused: '$step' touches prod — add --yes (only on the owner's go)" >&2; exit 2; }; }
t0=$(date +%s)
done_() { echo "$(date -u +%FT%TZ) $step $* $(( $(date +%s) - t0 ))s" | tee -a "$PROD_DIR/cutover.log"; }
pg_dsn() { set -a; . "$PROD_DIR/prod.env"; set +a; echo "postgresql://musix:$MUSIX_PG_PASSWORD@127.0.0.1:18532/${MUSIX_DB:-musix}"; }

case "$step" in
  plan) sed -n '/^## The run/,/^## After/p' tools/cutover/README.md ;;
  prebuild)
    "${P[@]}" exec -T worker procrastinate --app=musix.workers.app.app defer media:backfill '{}'
    done_ "queued" ;;
  stop-v1) yes "$@"
    docker compose -f "$V1_COMPOSE" stop musix
    done_ "v1 musix stopped" ;;
  carry-week) yes "$@"; SINCE=${1:?SINCE (ISO, with a zone)}
    docker compose -f "$V1_COMPOSE" ps --status running musix | grep -q musix && { echo "v1 is running: stop it first" >&2; exit 1; }
    cp -p "$V1_DB" "$PROD_DIR/v1-metadata.before-carry.db"
    (cd tools/migrate && ../../server/.venv/bin/python reverse.py --dsn "$(pg_dsn)" --since "$SINCE" --v1 "$V1_DB")
    done_ "carried (backup: v1-metadata.before-carry.db)" ;;
  snapshot)
    (cd tools/snapshot && uv run --project ../../server python take.py --force)
    done_ ;;
  migrate) SNAP=${1:?SNAP}
    if [ "$(id -u)" = 0 ]; then make prod-migrate SNAP="$SNAP"; else make prod-migrate SNAP="$SNAP" COPY=1; fi
    done_ "$SNAP" ;;
  gate) SNAP=${1:?SNAP}
    "${P[@]}" up -d --wait api worker
    make prod-gates SNAP="$SNAP"
    done_ "$SNAP" ;;
  switch) yes "$@"
    docker compose -f "$V1_COMPOSE" ps --status running musix | grep -q musix && { echo "v1 still holds the GPU: stop-v1 first" >&2; exit 1; }
    MUSIX_EDGE_PORT=8000 "${P[@]}" -f deploy/compose.prod.gpu.yml --profile ai --profile staging up -d --wait
    done_ "edge on :8000, ml on the GPU" ;;
  smoke)
    E=${MUSIX_EDGE_URL:-http://127.0.0.1:8000}
    curl -sf "$E/api/v2/ready" >/dev/null && curl -sf "$E/" | grep -q '<div id="root">' \
      && [ "$(curl -s -o /dev/null -w '%{http_code}' "$E/api/v1/instance/config")" = 426 ] && echo smoke ok
    done_ ;;
  publish-apk) yes "$@"; APK=${1:?APK}
    D=$PROD_DIR/media/downloads; mkdir -p "$D"
    [ -f "$D/musix-1.0.0.apk" ] || cp -p /mnt/data/lyrics-search/downloads/musix.apk "$D/musix-1.0.0.apk"
    cp "$APK" "$D/musix.apk"
    SHA=$(sha256sum "$D/musix.apk" | cut -d' ' -f1)
    # the version comes from the APK itself (the in-app updater compares versionCode)
    BADGE=$(. /mnt/data/android/env.sh >/dev/null 2>&1; "$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)/aapt2" dump badging "$D/musix.apk" | sed -n 1p)
    VC=$(echo "$BADGE" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p"); VN=$(echo "$BADGE" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p")
    [ -n "$VC" ] || { echo "no versionCode in the APK" >&2; exit 1; }
    # merge: the windows entry (tools/windows/publish.sh) stays
    python3 -c 'import json,pathlib,sys; p=pathlib.Path(sys.argv[1]); m=json.loads(p.read_text()) if p.exists() else {}; m["android"]={"versionCode":int(sys.argv[3]),"versionName":sys.argv[4],"url":"/download/musix.apk","sha256":sys.argv[2],"notes":"MusiX 2"}; p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+"\n")' "$D/manifest.json" "$SHA" "$VC" "$VN"
    done_ "published" ;;
  rollback) yes "$@"; SINCE=${1:?SINCE (the switch time)}
    "${P[@]}" stop nginx ml worker-ai
    MUSIX_EDGE_PORT=18090 "${P[@]}" up -d --wait nginx ml
    cp -p "$V1_DB" "$PROD_DIR/v1-metadata.before-rollback.db"
    (cd tools/migrate && ../../server/.venv/bin/python reverse.py --dsn "$(pg_dsn)" --since "$SINCE" --v1 "$V1_DB")
    docker compose -f "$V1_COMPOSE" start musix
    done_ "v1 back on :8000 with v2's rows since $SINCE" ;;
  *) echo "unknown step: $step (run.sh plan)" >&2; exit 2 ;;
esac
