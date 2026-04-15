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
# Clone and start the dev server (Angular hot-reload on :4200)
git clone <repo-url>
cd repo
docker compose up
```

Open `http://localhost:4200` in your browser.

> **No default credentials required.** If no user profile exists yet, the app will walk you through creating one on first launch.

---

## All developer commands

| Task | Command |
|---|---|
| Start dev server | `make dev` or `docker compose up` |
| Run unit tests | `make test` |
| Run e2e tests | `make e2e` |
| Production build | `make build` |
| Serve production build | `make prod` |
| Lint + format check | `make lint` |
| Open shell in dev container | `make shell` |
| Destroy volumes (fresh install) | `make clean` |

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

## IMPORTANT: host-side tooling is forbidden

> Running `npm install`, `ng serve`, `node`, or `playwright test` directly on the host machine
> is explicitly **not supported** and will produce inconsistent results.
>
> Always use the Docker services above.

