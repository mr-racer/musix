#!/usr/bin/env bash
# Contract run against the dev api (not through nginx: its auth rate limit would answer
# 429 to the fuzzer). Usage: tools/contract/run.sh [extra schemathesis args]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
base="${MUSIX_CONTRACT_BASE:-http://127.0.0.1:18000}"
cd "$here/../../server"
PYTHONPATH="$here" SCHEMATHESIS_HOOKS=hooks exec uv run schemathesis --config-file "$here/schemathesis.toml" run "$base/api/v2/openapi.json" \
  --url "$base" --checks all --max-examples "${MAX_EXAMPLES:-25}" --seed 1 \
  --exclude-path /api/v2/auth/setup \
  --report junit --report-dir "$here/report" "$@"
