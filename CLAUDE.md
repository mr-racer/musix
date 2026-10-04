# CLAUDE.md

MusiX v2: a self-hosted music player. One repo, several clients on one API.

| Path | What |
|---|---|
| `server/` | Python API and workers (`musix.contexts.*`), Postgres + Qdrant |
| `ml/` | the model service (embeddings, reranker, CLAP) |
| `web/` | Vite + React 19 + TanStack, CSS Modules |
| `android/` | Kotlin + Compose, Now-in-Android modules |
| `windows/` | C# + WinUI 3 |
| `design/` | tokens, the generated themes, **the design code**, approved mocks |
| `deploy/`, `tools/`, `contracts/` | compose files, scripts, the OpenAPI contract and codegen |
| `docs/superpowers/` | specs and plans |

## Design: read before any UI work

- **`design/code/README.md`** and the files it lists are the design rules of v2.
- **Mock first.** No global screen is implemented or restyled before the owner has approved
  a preliminary mock of it in this style. Approved mocks live in `design/reference/<screen>/`
  and the screen is ported from them as they are.
- Tokens: edit `design/tokens/*.json`, then `make design` (CI runs `make design-check`).

## Commands

```bash
make dev            # the dev stack (deploy/compose.dev.yml)
make test lint      # server and ml
make web            # npm ci + build;  make web-dev  for Vite;  make web-check  for types and tests
make android        # assembleDebug;   make android-check  for unit tests
make design         # regenerate design/gen from design/tokens
make openapi codegen   # after an API change: the contract, then the three generated clients
```

## Production

- Prod's nginx serves `web/dist` of the deployed checkout through a bind mount. **Never run
  a web build in the deployed checkout**; work in another worktree.
- Deploys, migrations and backfills on prod need the owner's go.
- A response whose shape changes without its data changing needs `etag.REV` bumped
  (`server/src/musix/api/etag.py`), or cached clients keep the old body.
