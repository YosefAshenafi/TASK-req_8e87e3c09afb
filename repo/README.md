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
docker compose up
```

Open `http://localhost:8080` in your browser.

> **No default credentials required.** The app will walk you through creating a profile on first launch.

---

## Running tests

A single script runs the full test suite (unit, API, and E2E) inside Docker — no local binaries required:

```bash
./run_tests.sh
```


