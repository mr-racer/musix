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
	cd ml && uv run pytest -q
lint:
	cd server && uv run ruff check . && uv run ruff format --check . && uv run mypy
	cd ml && uv run ruff check . && uv run ruff format --check . && uv run mypy
openapi:
	cd server && uv run python -m musix.api.openapi_export > ../contracts/openapi.json
check: lint test

# ── contract: schemathesis against the dev api; the three generated clients ──
.PHONY: contract codegen codegen-check bench-v2 snap-load snap-api
contract:
	tools/contract/run.sh
codegen:
	contracts/codegen/run.sh gen
codegen-check:
	contracts/codegen/run.sh check
bench-v2:
	tools/bench/v2/run.sh
# the prod snapshot in a separate dev database (musix_mig: Qdrant holds one migrated copy) + an api on it at :18010
snap-load:
	cd tools/migrate && ../../server/.venv/bin/python migrate.py run /mnt/data/musix-snapshots/$(or $(SNAP),2026-09-29) --db $(or $(DB),musix_mig) $(if $(RESET),--reset) $(if $(COPY),--copy-foreign)
snap-api:
	MUSIX_SNAP_DB=$(or $(DB),musix_mig) $(COMPOSE) --profile snap up -d --build --wait api-snap

# ── v1 → v2 migration, gated (tools/migrate; phase 3). The cutover (phase 6) runs it as root
# (hardlinks to v1's root-owned files) with V1_YM_TOKEN_KEY or V1_JWT_SECRET in the env;
# a dev run passes COPY=1. Reports: tools/migrate/report/<snap>-<db>.md
.PHONY: migrate
MIG_DB = $(or $(DB),musix_mig)
MIG_SNAP = /mnt/data/musix-snapshots/$(or $(SNAP),2026-09-29)
migrate:
	cd tools/migrate && ../../server/.venv/bin/python migrate.py run $(MIG_SNAP) --db $(MIG_DB) --reset $(if $(COPY),--copy-foreign) \
		--stages accounts,library,vectors,knowledge,listening,misc,files,post
	MUSIX_SNAP_DB=$(MIG_DB) $(COMPOSE) --profile snap up -d --force-recreate --wait api-snap
	cd tools/gates && MUSIX_SNAP_DB=$(MIG_DB) uv run --project ../../server python run.py --target v2 --snap $(notdir $(MIG_SNAP)) --no-cache --runs 1
	cd tools/recsys-eval && MUSIX_SNAP_DB=$(MIG_DB) uv run python -m recsys_eval.v2 $(MIG_SNAP)
	cd tools/migrate && ../../server/.venv/bin/python migrate.py run $(MIG_SNAP) --db $(MIG_DB) --stages verify

# ── Android (android/; phase 4). The emulator runs in Docker (tools/android/emu.sh) ──
.PHONY: android android-check android-emu
ANDROID_ENV = . /mnt/data/android/env.sh && cd android
android:
	$(ANDROID_ENV) && ./gradlew -q :app:assembleDebug
android-check:
	$(ANDROID_ENV) && ./gradlew -q testDebugUnitTest
android-emu:
	tools/android/emu.sh up

# ── v2 prod stack (deploy/compose.prod.yml, phase 6). State in /mnt/data/musix-v2-prod.
.PHONY: prod-env prod-up prod-down prod-migrate prod-logs prod-gates
PROD_DIR = /mnt/data/musix-v2-prod
PROD = docker compose --env-file $(PROD_DIR)/prod.env -f deploy/compose.prod.yml $(if $(GPU),-f deploy/compose.prod.gpu.yml)
prod-env:  # once: the stack's interpolation secrets, never printed
	@mkdir -p $(PROD_DIR)/pg $(PROD_DIR)/qdrant $(PROD_DIR)/media/downloads $(PROD_DIR)/secrets
	@test -f $(PROD_DIR)/prod.env || (umask 077 && printf 'MUSIX_PG_PASSWORD=%s\nSEARXNG_SECRET=%s\n' \
	  "$$(openssl rand -hex 24)" "$$(openssl rand -hex 32)" > $(PROD_DIR)/prod.env && echo "prod.env created")
# the prod images are the dev images retagged: Docker's root is on the small system disk,
# and a separate build would duplicate gigabytes (`make dev` builds them first)
prod-up: prod-env web
	docker tag musix-v2-server:dev musix-v2-server:prod && docker tag musix-v2-ml:dev musix-v2-ml:prod
	$(PROD) up -d --wait $(if $(AI),--profile ai)
prod-down:
	$(PROD) down
prod-logs:
	$(PROD) logs --tail 100 -f api worker nginx
# the migration into the prod stack: its media dir, compose file, Postgres and Qdrant
prod-migrate:
	set -a && . $(PROD_DIR)/prod.env && set +a && cd tools/migrate && \
	MUSIX_MIGRATE_MEDIA=$(PROD_DIR)/media MUSIX_MIGRATE_COMPOSE=$(CURDIR)/deploy/compose.prod.yml \
	../../server/.venv/bin/python migrate.py run /mnt/data/musix-snapshots/$(SNAP) --db $(or $(DB),musix) --reset \
	  --admin-dsn "postgresql://musix:$$MUSIX_PG_PASSWORD@127.0.0.1:18532/postgres" --qdrant http://127.0.0.1:18533 $(if $(COPY),--copy-foreign)

# the gates and the verify report on the prod stack (after prod-migrate; the api must be up).
# Search runs the accepted baseline's fixtures (BASELINE, phase 2's snapshot): fixtures are
# seeded per snapshot, so only the same questions compare.
prod-gates:
	set -a && . $(PROD_DIR)/prod.env && set +a && export MUSIX_SNAP_DB=$(or $(DB),musix) && \
	(cd tools/gates && MUSIX_GATES_V2_URL=http://127.0.0.1:18090 MUSIX_GATES_PG=musix-v2-postgres-1 MUSIX_GATES_API=musix-v2-api-1 \
	  uv run --project ../../server python run.py --target v2 --snap $(or $(BASELINE),2026-09-29) --no-cache --runs 1) && \
	(cd tools/recsys-eval && MUSIX_SNAP_DSN="postgresql://musix:$$MUSIX_PG_PASSWORD@127.0.0.1:18532/$$MUSIX_SNAP_DB" \
	  uv run python -m recsys_eval.v2 /mnt/data/musix-snapshots/$(SNAP)) && \
	(cd tools/migrate && MUSIX_MIGRATE_MEDIA=$(PROD_DIR)/media ../../server/.venv/bin/python migrate.py run /mnt/data/musix-snapshots/$(SNAP) \
	  --db $$MUSIX_SNAP_DB --stages verify --admin-dsn "postgresql://musix:$$MUSIX_PG_PASSWORD@127.0.0.1:18532/postgres" --qdrant http://127.0.0.1:18533)

# ── web client (web/, phase 5): caches on /mnt/data (the system disk is small) ───
.PHONY: web web-dev web-check web-e2e
WEB_ENV = export npm_config_cache=/mnt/data/.cache/npm PLAYWRIGHT_BROWSERS_PATH=/mnt/data/.cache/ms-playwright && cd web
web:
	$(WEB_ENV) && npm ci --silent && npm run -s build
web-dev:  # Vite on :5173 → api-snap (the migrated data) and the dev nginx media
	$(WEB_ENV) && npm run dev
web-check:
	$(WEB_ENV) && npm run -s typecheck && npm test
web-e2e:
	$(WEB_ENV) && npm run -s e2e

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
