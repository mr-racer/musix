#!/usr/bin/env bash
# make bench SNAP=<date>: the v1 performance baselines (phase 0 §5) on a v1 COPY.
set -euo pipefail
cd "$(dirname "$0")"
SNAP=${1:?usage: run.sh <snapshot-date> [minutes]}
MIN=${2:-5}
ROOT=${MUSIX_SNAPSHOTS:-/mnt/data/musix-snapshots}
mkdir -p .run report
docker inspect musix-v1copy >/dev/null 2>&1 || ../v1copy/up.sh "$SNAP"
# the owner's token and a stream token, from the copy's own secret
docker exec -i musix-v1copy python - < ../v1copy/mint_token.py > .run/tokens-all.json
python3 - <<'PY'
import json, urllib.request
t = json.load(open(".run/tokens-all.json"))["c2b5b12d55d341feb0940929e5a12c0d"]
r = urllib.request.Request("http://127.0.0.1:18800/api/v1/auth/stream-token", method="POST",
                           headers={"Authorization": f"Bearer {t}"})
json.dump({"token": t, "st": json.load(urllib.request.urlopen(r))["token"]}, open(".run/tokens.json", "w"))
PY
# footprint sampled during the load run
( while true; do docker stats --no-stream --format '{{.MemUsage}}' musix-v1copy; sleep 5; done ) > .run/rss.txt &
SAMPLER=$!
uv run --project ../../server python load.py "$ROOT/$SNAP" --minutes "$MIN"
kill $SAMPLER
# After the 20-user level the copy (one uvicorn worker) is still draining queued work;
# wait until it answers fast again before the browser probes.
for _ in $(seq 60); do
  t=$(curl -s -o /dev/null -w '%{time_total}' http://127.0.0.1:18800/api/v1/instance/config || echo 9)
  python3 -c "import sys; sys.exit(0 if float('$t') < 0.1 else 1)" && break
  sleep 2
done
sleep 10
/mnt/data/envs/musix-e2e/bin/python browser.py "$ROOT/$SNAP" .run/tokens.json
ADB=/mnt/data/android/sdk/platform-tools/adb
( $ADB devices 2>/dev/null | grep -w device >/dev/null && echo attached || echo "not on the LAN" ) > .run/android.txt
python3 report.py "$SNAP" "$MIN"
