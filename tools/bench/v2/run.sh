#!/usr/bin/env bash
# make bench-v2: the phase-1 exit bench (spec §10) on the dev stack.
#   1. synthetic data (idempotent): bench@ with 6000 tracks for the read shapes, and
#      bench-01..20@ with 300 each, so the 20 writers are 20 people, not 20 devices;
#   2. HTTP load, 20 users per route, through nginx; api RSS; pg_stat_statements top 10;
#   3. stream start in Chrome, LAN and LTE.
# Results land in .run/*.json; the report is written from them by hand.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../../../server"
export MUSIX_DATABASE_URL=${MUSIX_DATABASE_URL:-postgresql://musix:musix@127.0.0.1:18432/musix}
mkdir -p "$here/.run"
uv run python "$here/synth.py" --tracks 6000
for i in $(seq -w 1 20); do
  uv run python "$here/synth.py" --email "bench-$i@example.com" --tracks 300 --listens 1000
done
uv run python "$here/load.py" --seconds "${SECONDS_PER_ROUTE:-20}" --out "$here/.run/load.json"
/mnt/data/envs/musix-e2e/bin/python "$here/stream.py" --runs 10 --out "$here/.run/stream.json"
