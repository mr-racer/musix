# MusiX v2 — run from v2/.
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
