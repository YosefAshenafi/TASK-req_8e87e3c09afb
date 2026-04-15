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
docker compose up dev
```

Open `http://localhost:4200` in your browser.

---

## All developer commands

| Task | Command |
|---|---|
| Start dev server | `make dev` or `docker compose up dev` |
| Run unit tests | `make test` |
| Run e2e tests | `make e2e` |
| Production build | `make build` |
| Serve production build | `make prod` |
| Lint + format check | `make lint` |
| Open shell in dev container | `make shell` |
| Destroy volumes (fresh install) | `make clean` |

All `make` targets map directly to `docker compose run --rm <service> ...`.

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

---

## Project structure

```
repo/
├── src/
│   ├── app/
│   │   ├── core/          # DB, prefs, broadcast, tab-identity services
│   │   ├── auth/          # Profile management, PBKDF2, lockout
│   │   ├── workspace/     # Workspace shell and routing
│   │   ├── canvas/        # Drawing surface, sticky notes
│   │   ├── comments/      # Threaded comment drawer
│   │   ├── chat/          # Chat panel (500-message window)
│   │   ├── presence/      # Avatar bar, cursors, activity feed
│   │   ├── mutual-help/   # Request/offer board
│   │   ├── import-export/ # CSV/JSON import, workspace packages
│   │   ├── snapshot/      # Auto-save + rollback
│   │   ├── telemetry/     # Events, KPIs, daily warehouse
│   │   └── reporting/     # Daily warehouse view
│   ├── environments/      # Feature flags (enableServiceWorker, enableFSAccess)
│   └── workers/           # aggregator.worker.ts (Web Worker)
├── e2e/                   # Playwright multi-tab specs
├── Dockerfile.dev
├── Dockerfile.e2e
├── Dockerfile.prod
├── docker-compose.yml
├── Makefile
└── nginx.conf
```
