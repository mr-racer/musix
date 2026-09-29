# Source from v2/tools/e2e-v1/. Everything the run writes lives in .run/ (gitignored).
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RUN=$HERE/.run
export E2E_DIST=$RUN/dist
export E2E_MUSIC=$RUN/music
export QDRANT_URL=http://127.0.0.1:6399
export MUSIX_METADATA_DB=$RUN/e2e.db
export MUSIX_DIAG_DIR=$RUN/diag
export MUSIX_JWT_SECRET=e2e-secret-e2e-secret-e2e-secret-e2e-secret
export FORCE_CPU=1
export SEARXNG_URL=http://127.0.0.1:1
export HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy=
PY=/mnt/data/envs/musix-e2e/bin/python        # pytest + playwright
V1PY=/home/ivan/miniconda3/bin/python        # has v1's requirements (runs seed/serve)
