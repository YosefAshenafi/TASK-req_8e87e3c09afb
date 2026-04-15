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
docker compose --profile dev up dev
```

Open `http://localhost:4200` in your browser.

> **No default credentials required.** The app will walk you through creating a profile on first launch.

> **Production build:** `docker compose up` builds and serves the compiled bundle on `:8080`.

---

## Running tests

A single script runs the full test suite (unit, API, and E2E) inside Docker — no local binaries required:

```bash
./run_tests.sh
```


