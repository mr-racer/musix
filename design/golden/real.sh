#!/usr/bin/env bash
# Golden screenshots of the owner's REAL library on the v1 copy (tools/v1copy must be up).
# They show the library, so they go next to the snapshot, never into git.
set -euo pipefail
SNAP=${1:?usage: real.sh <snapshot-date>}
cd "$(dirname "$0")"
OWNER=c2b5b12d55d341feb0940929e5a12c0d
TOKEN=$(docker exec -i musix-v1copy python - < ../../tools/v1copy/mint_token.py | python3 -c "import json,sys; print(json.load(sys.stdin)['$OWNER'])")
OUT=/mnt/data/musix-snapshots/golden/$SNAP
/mnt/data/envs/musix-e2e/bin/python capture.py --base http://127.0.0.1:18800 --token "$TOKEN" \
  --user-id "$OWNER" --out "$OUT" --artist jay-z --role member
/home/ivan/miniconda3/bin/python to_webp.py "$OUT"
