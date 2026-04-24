# SecureRoom Brainstorm Studio

**Project type:** Web — an offline-first, multi-tab collaborative brainstorm canvas, plus a companion HTTP API module used for strict endpoint coverage tests.

**Stack:** Angular 21 + TypeScript · IndexedDB · BroadcastChannel · Web Worker · Service Worker · PWA · Node.js HTTP API (test-covered)

---

## What the app does

- Local username + password profile screen (3-attempt lockout for 15 min, 7-day auto sign-out).
- Three persona roles — `Admin`, `Academic Affairs`, `Teacher` — that toggle visible menus and allowed actions.
- Workspace canvas with shape toolbar (rectangle, circle, arrow, connector, freehand pen) and sticky-note mode (80-char cap, CSV/JSON bulk import up to 1,000 notes with column-mapping and row-level validation).
- Threaded comments (≤ 50 replies), `@mentions`, in-app inbox badge and toast.
- Chat panel with last 500 messages, keyword search, system events.
- Presence via avatar bar, colored cursors, activity feed.
- Mutual-Help board (requests/offers, drafts, pin, 72-hour expiration).
- KPI warehouse and reporting page fed by a Web Worker; toast alerts on threshold breach.
- Auto-save every 10 s (200 snapshots, one-click rollback) and workspace package export/import (≤ 200 MB) for USB transfer.

---

## Prerequisites

**Docker (and Docker Compose) is the recommended approach.** Docker is the only supported toolchain for reviewers.
No Node.js, npm, ng, or Playwright installation on the host is needed or allowed.

Supported browsers: any modern Chromium (Chrome, Edge), Firefox, or Safari that supports `crypto.subtle`, IndexedDB, BroadcastChannel, and Web Workers. The app must be loaded over `http://localhost` or HTTPS — `crypto.subtle` (PBKDF2 password hashing) is not available on plain `http://` origins other than `localhost`.

---

## Getting started

```bash
docker compose up
# strict-audit equivalent command:
docker-compose up
```

- **Access URL:** open [http://localhost:8080](http://localhost:8080) in your browser.
- **Port:** 8080 (served by nginx from the `prod` container).
- Stop with `Ctrl+C` or `docker compose down`.

### Verification — what you should see

1. After `docker compose up`, wait for the log line `prod  | ... worker process 1` (nginx is ready).
2. Open [http://localhost:8080](http://localhost:8080) — you are redirected to `/profiles` and shown the **Profiles** page with a "Create your first profile" button.
3. Click **Create your first profile** and register three profiles, one per role:

   | Username | Password      | Role              |
   |----------|---------------|-------------------|
   | `admin`  | `password123` | Admin             |
   | `affairs`| `password123` | Academic Affairs  |
   | `teacher`| `password123` | Teacher           |

4. Sign in as `admin` → pick the **Admin** persona → you should land on `/workspaces`.
5. Create a workspace, open it, drop a sticky note on the canvas, type a chat message, open the mutual-help board, and switch to `/reporting` — all actions should persist across page reloads.
6. Open a second tab at the same URL → presence avatars and cursors should appear for both tabs within ~2 seconds (BroadcastChannel cross-tab sync).

### Curl smoke test

```bash
curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:8080/
# expected: 200
```

### Backend HTTP API surface (covered by true HTTP tests)

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/workspaces`
- `GET /api/workspaces/:id`

---

## Authentication / demo credentials

The app ships **no pre-seeded credentials** — profiles are created locally on first launch and stored in the browser's IndexedDB.

To exercise every persona-gated code path during review, create the three profiles listed in the verification table above (one per role). Clearing browser data resets all profiles and restores the first-launch flow.

Persona capability summary:

| Persona            | Create workspaces | Delete workspaces | Open reporting page |
|--------------------|:-----------------:|:-----------------:|:-------------------:|
| Admin              | ✓                 | ✓                 | ✓                   |
| Academic Affairs   | ✓                 | ✗                 | ✓                   |
| Teacher            | ✓                 | ✗                 | ✗                   |

---

## Running tests

A single script runs the full test suite (unit, service-contract API, backend HTTP API, and E2E) inside Docker — no local binaries required:

```bash
./run_tests.sh
```

What runs:

| Suite | Tool | Path | Count |
|-------|------|------|-------|
| Unit  | Vitest (jsdom + fake-indexeddb) | `unit_tests/` | 31 spec files |
| API (service-contract integration) | Vitest (jsdom + fake-indexeddb + BroadcastChannel polyfill) | `API_tests/` | 14 spec files |
| Backend HTTP API (real route handlers) | Vitest (node environment, live server + real HTTP requests) | `backend_tests/` | 1 spec file |
| E2E   | Playwright against the real `prod` container at `http://localhost:8080` | `e2e_tests/` | 6 spec files |

Coverage reports are written to `./coverage/{unit,api,backend-http,e2e}` on the host.

---

## Troubleshooting

- **Port 8080 already in use** → stop the other service or change the host port in `docker-compose.yml` (`ports: - "8081:8080"`).
- **`prod` never becomes healthy** → check `docker compose logs prod`; rebuild with `docker compose up --build prod`.
- **Password sign-in fails with a crypto error** → you are loading the app over a non-localhost `http://` origin; use `http://localhost:8080` or HTTPS.
- **Tests can't find Docker** → start Docker Desktop (macOS/Windows) or `sudo systemctl start docker` (Linux), then re-run `./run_tests.sh`.

---

## Repository layout

```
src/              Angular 21 app (components, services, workers)
API_tests/        Vitest service-contract integration tests
backend/          Node.js HTTP API routes/handlers
backend_tests/    True HTTP API tests against live route handlers
unit_tests/       Vitest unit tests
e2e_tests/        Playwright end-to-end tests
docker-compose.yml
Dockerfile.prod   Production nginx image served at :8080
Dockerfile.test   Vitest image used by unit/api/backend-http test services
Dockerfile.e2e.test  Playwright image used by e2e-test service
run_tests.sh      One-command test runner
```
