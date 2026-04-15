# SecureRoom Brainstorm Studio

An offline-first, multi-tab collaborative brainstorm canvas.  
**Stack:** Angular 21 + TypeScript · IndexedDB · BroadcastChannel · Service Worker · PWA

---

## Prerequisites

**Docker (and Docker Compose) only.**  
No Node.js, npm, ng, or Playwright installation on the host is needed or allowed.

---

## Getting started

```bash
# 1. One-time volume bootstrap (creates the named Docker volume for node_modules)
docker volume create secureroom_node_modules
docker compose --profile dev run --rm dev npm install

# 2. Start the Angular dev server (hot-reload on :4200)
make dev
# or: docker compose --profile dev up dev
```

Open `http://localhost:4200` in your browser.

> **No default credentials required.** The app will walk you through creating a profile on first launch.

> **Production build:** `make prod` (or `docker compose up`) builds and serves the compiled bundle on `:8080`.

---

## All developer commands

| Task | Command |
|---|---|
| Start dev server | `make dev` |
| Run full test suite (canonical) | `./run_tests.sh` |
| Run unit tests only | `make test` |
| Run e2e tests only | `make e2e` |
| Production build | `make build` |
| Serve production build | `make prod` |
| Lint + format check | `make lint` |
| Open shell in dev container | `make shell` |
| Destroy volumes (fresh install) | `make clean` |

> **Canonical test path:** Use `./run_tests.sh` to run the full suite (Vitest unit + API + Playwright E2E) inside Docker.
> `make test` runs the Vitest suites only. The legacy Karma/Jasmine runner is available as `make test-legacy` (deprecated).
> The legacy harness at `repo/e2e/` is deprecated; the primary E2E suite is in `repo/e2e_tests/`.

All `make` targets map directly to `docker compose run --rm <service> ...`.

---

## Running tests

A single script runs the full test suite (unit, API, and E2E) inside Docker — no local binaries required:

```bash
./run_tests.sh              # skips image build if all images are present
./run_tests.sh --rebuild    # forces a rebuild of all test images
REBUILD=1 ./run_tests.sh    # same, via env var
```

---

## Docker services

| Service | Image | Purpose |
|---|---|---|
| `dev` | `node:20-alpine` | `ng serve` with hot-reload |
| `test` | `node:20-alpine` | Vitest unit + component tests |
| `e2e` | `mcr.microsoft.com/playwright` | Multi-tab Playwright tests |
| `build` | `node:20-alpine` | `ng build --configuration production` |
| `prod` | `nginx:alpine` | Serve the production bundle on :8080 |
| `lint` | `node:20-alpine` | ESLint + Prettier check |

`node_modules` lives in a **named Docker volume** (`secureroom_node_modules`).  
It is **never** host-mounted. If you run `ls node_modules` on your Mac, it will be empty — that is correct.

---

## IMPORTANT: Docker is the recommended development path

> Running `npm install`, `ng serve`, `node`, or `playwright test` directly on the host machine
> is not the recommended path and may produce inconsistent results.
>
> Use the Docker services above for the supported workflow.

