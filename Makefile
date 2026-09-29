# MusiX v2 — run from v2/.
export UV_CACHE_DIR ?= /mnt/data/.cache/uv
export PIP_CACHE_DIR ?= /mnt/data/.cache/pip
export UV_LINK_MODE ?= copy
COMPOSE = docker compose -f deploy/compose.dev.yml $(if $(GPU),-f deploy/compose.dev.gpu.yml)

.PHONY: dev down logs test lint openapi check
dev:
	$(COMPOSE) up -d --build --wait
down:
	$(COMPOSE) down
logs:
	$(COMPOSE) logs -f --tail=100
test:
	cd server && uv run pytest -q
lint:
	cd server && uv run ruff check . && uv run ruff format --check . && uv run mypy
openapi:
	cd server && uv run python -m musix.api.openapi_export > ../contracts/openapi.json
check: lint test

# ── prod snapshot (tools/snapshot) ──────────────────────────────────────────
.PHONY: snapshot snapshot-restore
snapshot:
	cd tools/snapshot && uv run --project ../../server python take.py $(if $(FORCE),--force)
snapshot-restore:
	cd tools/snapshot && uv run --project ../../server python restore.py $(SNAP)

# ── quality gates (tools/gates + tools/recsys-eval) on a v1 copy ────────────
.PHONY: v1copy-up v1copy-down gates recsys-eval
v1copy-up:
	tools/v1copy/up.sh $(SNAP)
v1copy-down:
	tools/v1copy/down.sh
recsys-eval:
	cd tools/recsys-eval && uv run python -m recsys_eval /mnt/data/musix-snapshots/$(SNAP)
gates:
	@test -n "$(SNAP)" || (echo "usage: make gates SNAP=<date> [TARGET=v1]"; exit 1)
	$(if $(filter v2,$(TARGET)),,tools/v1copy/up.sh $(SNAP))
	cd tools/gates && uv run --project ../../server python run.py --target $(or $(TARGET),v1) --snap $(SNAP) $(GATES_ARGS)
	$(MAKE) recsys-eval SNAP=$(SNAP)

# ── design tokens → CSS / Compose / XAML (design/) ──────────────────────────
.PHONY: design design-check
design:
	node design/extract.mjs && python3 design/gen/build.py
design-check:
	python3 design/gen/build.py --check

# ── v1 performance baselines (tools/bench) ──────────────────────────────────
.PHONY: bench
bench:
	@test -n "$(SNAP)" || (echo "usage: make bench SNAP=<date> [MIN=5]"; exit 1)
	tools/bench/run.sh $(SNAP) $(or $(MIN),5)

# ── golden screenshots (design/golden) ──────────────────────────────────────
.PHONY: golden golden-fixture
golden:
	design/golden/real.sh $(SNAP)
golden-fixture:
	tools/e2e-v1/run.sh --golden
