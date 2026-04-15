# SecureRoom Brainstorm Studio — Phase-by-Phase Project Plan

> **Source of truth.** This plan is derived from `metadata.json`, `docs/design.md`, `docs/questions.md`, and `docs/api-spec.md`. Every prompt-level requirement is mapped to a phase and an acceptance check at the bottom of this document (see §15 "Requirements Traceability Matrix"). Nothing is left as "future work."
>
> **Stack (fixed by `metadata.json`):** Angular + TypeScript SPA, IndexedDB (primary) + LocalStorage (secondary), no backend.
>
> **Docker-first mandate.** Every step of this project — initial scaffolding, dependency install, local dev, test runs, production build, and multi-tab integration tests — runs **inside Docker**. No engineer ever runs `npm install`, `ng ...`, `node`, or `playwright` directly on the host. There is no "install Node.js on your Mac" step anywhere in this plan. The very first command a new contributor runs is `docker compose up dev`. This is enforced by tasks in Phase 0 and verified in §15 row #0 and §18 Done Definition criterion #0.

---

## Docker Architecture (applies to every phase)

Before any Angular code is written, Phase 0 stands up the container topology below. Every subsequent phase uses it — there is no host-side Node toolchain.

```
┌──────────────────────────────── Host machine ─────────────────────────────────┐
│                                                                               │
│   docker compose up dev         (default dev loop)                            │
│   docker compose run --rm test  (Karma/Jasmine unit + component)              │
│   docker compose run --rm e2e   (Playwright multi-tab, headless Chromium)     │
│   docker compose run --rm build (production bundle → ./dist)                  │
│   docker compose run --rm lint                                                │
│                                                                               │
│   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────────┐  │
│   │ dev service      │   │ test service     │   │ e2e service              │  │
│   │ Dockerfile.dev   │   │ Dockerfile.dev   │   │ Dockerfile.e2e           │  │
│   │ node:20-alpine   │   │ node:20-alpine   │   │ mcr.../playwright:v1.x   │  │
│   │ ng serve :4200   │   │ ng test --ci     │   │ playwright test          │  │
│   └──────────────────┘   └──────────────────┘   └──────────────────────────┘  │
│                                                                               │
│   ┌──────────────────┐   ┌──────────────────────────────────────────────┐     │
│   │ build service    │   │ prod service (smoke-check the shipped PWA)   │     │
│   │ multi-stage:     │   │ nginx:alpine serving /usr/share/nginx/html   │     │
│   │  1) node builder │   │ from the build stage output, :8080           │     │
│   │  2) artifact-only│   │                                              │     │
│   └──────────────────┘   └──────────────────────────────────────────────┘     │
│                                                                               │
│   Shared: named volume `node_modules` (never host-mounted), bind-mount of     │
│   ./src, ./angular.json, ./package*.json, ./tsconfig*.json. `.dockerignore`   │
│   excludes host `node_modules`, `dist`, `.git`.                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Files produced in Phase 0** (all checked into `repo/`):

- `Dockerfile.dev` — `node:20-alpine`, installs deps into a named volume, entrypoint `ng serve --host 0.0.0.0 --poll 1000`.
- `Dockerfile.e2e` — `mcr.microsoft.com/playwright:v1.x-jammy` with Playwright browsers preinstalled.
- `Dockerfile.prod` — multi-stage: **stage 1** `node:20-alpine` runs `ng build --configuration production`; **stage 2** `nginx:alpine` copies `dist/` and serves on `:8080` with an `nginx.conf` that sets long-cache for hashed assets and no-cache for `index.html` + `ngsw.json` (correct SW behaviour).
- `docker-compose.yml` — services: `dev`, `test`, `e2e`, `build`, `prod`, `lint`.
- `.dockerignore` — excludes host `node_modules`, `dist`, `.git`, `*.log`.
- `Makefile` — thin convenience wrappers: `make dev`, `make test`, `make e2e`, `make build`, `make prod`, `make lint`, `make shell`.
- `scripts/docker-entrypoint-dev.sh` — installs deps on first boot if the `node_modules` volume is empty.

**Rules that apply to every phase below**

1. Any command that begins with `ng`, `npm`, `node`, `npx`, `playwright`, or `karma` runs via `docker compose run --rm <service> <cmd>` or inside the running `dev` container via `docker compose exec dev <cmd>`. Phase descriptions list commands as `ng ...`; read them as `docker compose exec dev ng ...`.
2. CI (Phase 0 task list) uses the **same** Dockerfiles — no parallel "native" install path.
3. IndexedDB, LocalStorage, BroadcastChannel, Service Worker, and File System Access APIs are all browser-native, so they work unchanged whether the app is served from the `dev` or `prod` container.
4. The `prod` service exists specifically so that Phase 12 (Service Worker / PWA) and Phase 14 (release smoke) can validate the installable offline launch against the same artifact that would ship.

---

## Phase 0 — Docker-First Scaffolding & Toolchain

**Goal.** Stand up the Docker topology described above **before any Angular code exists**, then use it to scaffold a clean Angular workspace with strict TypeScript, a Web Worker build target, Service Worker support, linting, formatting, testing, and CI hooks. No feature code yet. No host-side Node install.

### 0.A — Docker foundation (do this first)

**Tasks**
- Write `Dockerfile.dev` (`node:20-alpine`; installs `git`, `bash`; creates non-root `app` user; `WORKDIR /workspace`; exposes `4200` and `9876`; `CMD ["ng","serve","--host","0.0.0.0","--poll","1000"]`).
- Write `Dockerfile.e2e` based on `mcr.microsoft.com/playwright:v1.47.0-jammy`.
- Write `Dockerfile.prod` as a multi-stage build: stage 1 builds with `node:20-alpine`, stage 2 is `nginx:alpine` serving `dist/` on `:8080` with correct Service Worker caching headers.
- Write `docker-compose.yml` with services `dev`, `test`, `e2e`, `build`, `prod`, `lint`, plus a named volume `node_modules` and bind-mounts for `./` (minus `.dockerignore` exclusions).
- Write `.dockerignore` (excludes host `node_modules`, `dist`, `.git`, `*.log`, `coverage`, `.env*`).
- Write `Makefile` with `dev`, `test`, `e2e`, `build`, `prod`, `lint`, `shell`, `clean` targets.
- Write `scripts/docker-entrypoint-dev.sh` that runs `npm ci` on first boot if the `node_modules` volume is empty, then `exec "$@"`.
- Write `README.md` in `repo/` whose **first command** is `docker compose up dev` and which explicitly forbids host-side `npm`/`ng` invocations.
- Verify the dev image builds: `docker compose build dev`.

**Acceptance for 0.A**
- `docker compose build dev test e2e build prod` succeeds on a fresh clone.
- No `node_modules/` appears on the host; `docker compose exec dev ls node_modules` does.

### 0.B — Angular scaffolding (inside the container)

All commands below run **inside Docker**, e.g. `docker compose run --rm dev ng new secureroom ...`.

**Tasks**
- `docker compose run --rm --no-deps dev sh -c "cd /workspace && npx -p @angular/cli@latest ng new secureroom --strict --routing --style=scss --ssr=false --skip-git --directory=."`.
- `docker compose run --rm dev npm install @angular/service-worker idb jszip papaparse fast-json-patch uuid rxjs`.
- `docker compose run --rm dev npm install -D @angular-eslint/schematics eslint prettier husky lint-staged @playwright/test`.
- `docker compose run --rm dev npx ng add @angular/service-worker` (generates `ngsw-config.json`).
- Enable standalone components + signals-capable build (`provideRouter`, `provideHttpClient`-free setup since fully offline).
- Configure Angular build: `webWorkerTsConfig` for aggregator worker; tune `ngsw-config.json` precache for app shell.
- Feature flag scaffolding: `environment.ts` flags for `enableServiceWorker`, `enableFSAccess`.
- Husky `pre-commit` hook invokes `docker compose run --rm lint` (no host Node required on contributor machines).

### 0.C — CI

**Tasks**
- Single GitHub Actions workflow that runs inside the same Dockerfiles:
  - `docker compose run --rm lint`
  - `docker compose run --rm test -- --watch=false --browsers=ChromeHeadlessCI`
  - `docker compose run --rm e2e`
  - `docker compose run --rm build`
- No `actions/setup-node` — the CI runner only needs Docker.

**Deliverables**
- Docker files: `Dockerfile.dev`, `Dockerfile.e2e`, `Dockerfile.prod`, `docker-compose.yml`, `.dockerignore`, `Makefile`, `scripts/docker-entrypoint-dev.sh`, `nginx.conf`.
- Angular workspace: `src/app/`, `src/assets/`, `src/workers/aggregator.worker.ts`, `ngsw-config.json`, `.eslintrc.json`, `.prettierrc`, `playwright.config.ts`.
- `README.md` documenting the container-only workflow.
- A passing `make build` + `make test` on an empty shell.

**Acceptance**
- `docker compose up dev` serves the app at `http://localhost:4200` on a fresh clone with no host-side Node installed.
- `docker compose run --rm build` produces a hashed production bundle into `./dist/`.
- `docker compose run --rm test` runs a placeholder spec to green.
- `docker compose run --rm e2e` opens two Playwright browser contexts against the `prod` service and confirms cross-context BroadcastChannel plumbing (placeholder test is fine at this phase).
- Running any of `npm install`, `ng serve`, or `playwright test` directly on the host is explicitly unnecessary and documented as forbidden in `README.md`.

---

## Phase 1 — Core Platform Services

**Goal.** Build the platform-level singletons that every feature will depend on: IndexedDB wrapper, preferences, feature detection, tab identity, and the BroadcastChannel hub.

**Tasks**
- `core/db.service.ts` — `idb` wrapper with versioned `upgrade` handler; opens `secureroom` DB with the 11 stores defined in §3 of `api-spec.md` (`profiles`, `workspaces`, `canvas_objects`, `comments`, `chat`, `mutual_help`, `attachments`, `snapshots`, `events`, `warehouse_daily`, `kv`) and their indices.
- `core/prefs.service.ts` — typed LocalStorage accessor for `theme`, `lastOpenedWorkspaceId`, `activeProfileId`, `personaRole`, `privacyMaskingEnabled`, `lastImportMapping_<workspaceId>` with a `changes$` observable.
- `core/platform.service.ts` — feature detection (`showSaveFilePicker`, `BroadcastChannel`, `ServiceWorker`, `indexedDB`, `crypto.subtle`).
- `core/broadcast.service.ts` — typed envelope publish/subscribe; one channel per open workspace (`secureroom-workspace-${id}`); per-kind throttle/debounce rules (cursor 50 ms, presence 3 s, edit/chat/comment immediate).
- `core/tab-identity.service.ts` — generates a `tabId` (UUID) on boot, assigns a colour from a 12-slot palette, exposes `tabId`, `color`.
- `core/error.ts` — typed `AppError` union (see §1 of `api-spec.md`).
- `core/store-base.ts` — generic RxJS `BehaviorSubject` store with `select`, `dispatch`, IndexedDB write-through.

**Acceptance**
- Unit tests: DB schema upgrade from v0→current; prefs round-trip; broadcast envelopes serialise; cursor throttling verified with fake timers.
- Two tabs see each other's `presence` heartbeat within 4 seconds.

---

## Phase 2 — Auth & Local Safeguards

**Goal.** Implement the local-only profile experience: create profile, list profiles, sign-in with PBKDF2, 3-strike 15-minute lockout, 7-day auto-signout. Persona role selection after sign-in.

**Tasks**
- `auth/profile.model.ts` — `Profile` (hash + salt + `failedAttempts` + `lockoutUntil` + `lastSignInAt`).
- `auth/crypto.ts` — PBKDF2(SHA-256, ≥100k iters) using Web Crypto; random salt; base64 encode.
- `auth/auth.service.ts` — `listProfiles`, `createProfile`, `signIn`, `signOut`, `enforceAutoSignOut`, `currentProfile$`.
  - On 3 consecutive bad passwords: set `lockoutUntil = now + 15min`.
  - On boot: if `now - lastSignInAt > 7d`, force sign-out.
- `auth/persona.service.ts` — sets/reads `personaRole` pref; role-to-capability map; `*hasCap` structural directive (UI only; explicitly not a security boundary).
- Pages: `ProfilesListPage`, `CreateProfilePage`, `SignInPage` (shows lockout countdown banner), `PersonaSelectPage`.
- Auth route guard redirects unauthenticated users to `/profiles`.

**Acceptance**
- Three wrong passwords → 15-minute lockout banner; fourth attempt blocked; clearing browser data unlocks.
- Profile with `lastSignInAt` older than 7 days is forced back to sign-in on next open.
- Persona switch changes visible menu items without mutating workspace data.
- UI copy explicitly states safeguards are local/UX-only.

---

## Phase 3 — Workspace Shell & Routing

**Goal.** The navigable shell that hosts every feature: workspace list, create/rename/delete, open → workspace layout with right-side Chat panel, top Avatar bar, main Canvas, left toolbar, Inbox badge in header, Activity Feed drawer.

**Tasks**
- Routing: `/profiles` → `/sign-in/:profileId` → `/persona` → `/workspaces` → `/w/:id`.
- `workspace/workspace.service.ts` — CRUD + `active$`.
- `WorkspaceLayoutComponent`: persistent chrome (header with avatar bar + inbox badge, right Chat panel, left Toolbar, footer status bar with "Offline ready ✓").
- Wire `PrefsService.lastOpenedWorkspaceId` so reopening the app restores the active workspace.
- Populate BroadcastChannel instance for the active workspace; tear down on workspace change.

**Acceptance**
- Reload preserves active workspace.
- Opening the same workspace in 2 tabs shows 2 avatars in the top bar within ≤ 4 s.

---

## Phase 4 — Canvas & Sticky Notes

**Goal.** Ship the drawing surface with the full shape toolbar and Sticky Note mode with the 80-char cap.

**Tasks**
- `canvas/canvas.component.ts` — HTML Canvas renderer for shapes + freehand pen; absolutely-positioned DOM for notes/text editing.
- Shape toolbar: `rectangle`, `circle`, `arrow`, `connector`, `freehand pen`, `sticky-note`.
- `canvas/canvas.service.ts` — `addObject`, `patchObject(id, patch, baseVersion)`, `deleteObject`, `setNoteText` (hard-enforces ≤ 80 chars at store layer).
- Selection, marquee multi-select, z-ordering, snap-to-grid, alignment guides.
- Per-object `version` counter; every mutation broadcasts `{ kind: 'edit', objectId, baseVersion, patch }`.
- Conflict Drawer: triggered when incoming `baseVersion < local.version`; three actions — *Keep Mine*, *Accept Incoming*, *Merge Manually*.

**Acceptance**
- 80-char cap enforced in input + rejected at store layer (`Validation('text')` if bypassed).
- Two tabs editing the same note independently → Conflict Drawer appears and resolves correctly.
- Canvas holds 60 fps at 2,000 objects.

---

## Phase 5 — Comments, Inbox & @Mentions

**Goal.** Threaded Comment Drawer with 50-reply cap, @mention picker from the workspace roster, Inbox items with badge + Toast.

**Tasks**
- `comments/comment.service.ts` — `openOrCreateThread(targetId)`, `reply(threadId, body, mentions)` (rejects when `replies.length >= 50`), `markThreadRead`.
- `comments/comment-drawer.component.ts` — anchored to selected canvas object/note.
- `@mention` picker: typeahead filtering against the workspace roster (all profiles who have ever signed in to this workspace).
- Inbox: `inbox$`, `unreadCount$`, badge in header, Toast on new mention.
- Comment mutations broadcast `{ kind: 'comment', threadId, reply }`.

**Acceptance**
- 51st reply blocked with inline validation.
- @mentioning a roster member produces an Inbox item + Toast in the mentioned tab only.
- Marking a thread as read clears the badge without affecting other threads.

---

## Phase 6 — Chat Panel

**Goal.** Right-side Chat panel with 500-message rolling window, keyword search, and system messages for key actions.

**Tasks**
- `chat/chat.service.ts` — `send`, `postSystem`, `messages$` (last 500), `search(query)`.
- Rolling window: older messages retained in IndexedDB but not in the live `messages$` slice.
- System-message emitters across the app: profile sign-in, workspace open, bulk import, snapshot rollback, package export/import, Mutual-Help expiration batch.
- Keyword search: in-memory inverted index rebuilt lazily from the IndexedDB-backed tail.
- Chat mutations broadcast `{ kind: 'chat', message }`.

**Acceptance**
- Message #501 pushes the oldest out of the live view but remains queryable via search.
- Sign-in from Tab A posts a system message visible in Tab B within 2 s.

---

## Phase 7 — Presence, Cursors, Activity Feed

**Goal.** Real-time sense of "who's here" + what they're doing.

**Tasks**
- `presence/presence.service.ts`:
  - Heartbeat every 3 s; peer considered gone after 2 missed beats (6 s).
  - Cursor broadcast throttled to 20 Hz (50 ms) via `throttleTime`.
  - `activity$` — most recent 200 entries with timestamps and object links.
- `AvatarBarComponent` — coloured avatars, 12-slot palette; shows active peers.
- `CursorLayerComponent` — absolutely-positioned overlay, one cursor per peer.
- `ActivityFeedDrawerComponent` — chronological list; clicking an entry selects/pans to the referenced object.

**Acceptance**
- 12 tabs concurrently: avatar bar shows all 12; cursor layer shows 11 remote cursors in the active tab without dropped edit/chat events.
- Closing a tab removes its avatar + cursor within 7 s.

---

## Phase 8 — Mutual-Help Board

**Goal.** Requests/offers board with configurable forms, lifecycle, pinning, and lazy 72-hour expiration.

**Tasks**
- `mutual-help/mutual-help.model.ts` — `MutualHelpPost` with `status`, `pinned`, `expiresAt`.
- `mutual-help/mutual-help.service.ts` — `createDraft`, `publish`, `edit` (with `baseVersion`), `withdraw`, `pin`, `sweepExpired`.
- `PostFormComponent` — configurable fields: category, tags, time window, budget/compensation, urgency, attachments.
- Attachment pipeline reuses the `attachments` store with the 20 MB per-file cap and `QuotaExceeded` Toast.
- Lifecycle transitions: `draft → active → (expired | withdrawn)`; pinning bypasses expiration.
- Lazy sweeper runs on: workspace open, board render, every 60 s while tab visible (`document.visibilityState === 'visible'`).

**Acceptance**
- A post with `expiresAt < now` flips to `expired` the next time the board is rendered.
- Pinned posts never auto-expire until unpinned.
- Posts broadcast edits with the version-counter conflict flow.

---

## Phase 9 — Import / Export

**Goal.** CSV/JSON bulk note import (≤1,000 rows) with column mapping + row validation, and Workspace Package export/import (≤200 MB) with same-name conflict prompt.

### 9.1 CSV/JSON Note Import

**Tasks**
- `import-export/note-import.worker.ts` — PapaParse streaming + JSON parse off the main thread.
- Three-step modal:
  1. **Upload & parse.** Reject file outright if it would yield >1,000 rows.
  2. **Map columns.** Detect headers; map to `{ text (required), color, tags, author }`; persist last mapping per workspace in LocalStorage.
  3. **Validate & preview.** Per-row rules: `text-missing`, `text-too-long`, `unknown-author`, `invalid-color`, `tag-not-allowed`.
- Error Table with `{ rowIndex, rawValues, reasons[] }` + "Download rejected rows as CSV".
- Commit in a single IndexedDB transaction; emit `bulk-import` system chat message.

### 9.2 Workspace Packages (≤ 200 MB, USB transfer)

**Tasks**
- `import-export/package.service.ts`:
  - **Export.** Build ZIP (`jszip`) with the layout from §7.2 of `api-spec.md` (`manifest.json`, per-store JSON arrays, `blobs/<attachmentId>`). Prefer `showSaveFilePicker` when available; fall back to `<a download>` + Blob URL. Refuse if assembled package >200 MB (`QuotaExceeded`).
  - **Import.** Validate manifest (`schemaVersion`, `workspaceId`, `counts`). Enforce 200 MB ceiling before writes. On same-name collision, open the **Overwrite / Create Copy / Cancel** modal. Write through a single IndexedDB transaction.

**Acceptance**
- 1,001-row CSV rejected before mapping; 999-row CSV with 3 invalid rows yields 996 notes committed and 3 error-table rows.
- Export → wipe DB → import round-trip reproduces the workspace byte-for-byte across canvas, comments, chat, Mutual-Help, snapshots, attachments.
- Overwrite keeps the same `workspaceId` so comments/mentions remain linked; Create Copy assigns a new ID with `(imported YYYY-MM-DD)` suffix.

---

## Phase 10 — Snapshots, Auto-Save & Rollback

**Goal.** Every 10 s auto-save, 200-snapshot ring buffer, one-click rollback.

**Tasks**
- `snapshot/snapshot.service.ts`:
  - `tick()` — invoked on a 10 s RxJS interval while a workspace is open + dirty.
  - Ring buffer of 200 snapshots keyed `[workspaceId, seq]`.
  - Every 20th snapshot is a **full checkpoint**; the other 19 are RFC 6902 patches against the prior snapshot.
  - `listSnapshots(workspaceId)` returns summaries.
  - `rollbackTo(workspaceId, seq)` walks back to the nearest checkpoint, replays patches forward, writes the resulting doc as new head, and emits a `system` chat message.
- UI: Snapshots Drawer with chronological list + "Restore" button → confirm Modal.

**Acceptance**
- Snapshot #201 evicts snapshot #1 (ring semantics).
- Rollback to snapshot N produces byte-identical state to the one captured at snapshot N.
- Property test: apply patch + reverse = identity.

---

## Phase 11 — Telemetry, KPIs & Daily Warehouse (Web Worker)

**Goal.** Record local interaction events, compute real-time KPIs, show threshold Toasts, and build a daily warehouse for the reporting view.

**Tasks**
- `telemetry/telemetry.service.ts` — fire-and-forget `log(event)`; appends to `events` store; posts `{ kind: 'event-appended', id }` to aggregator worker.
- `src/workers/aggregator.worker.ts`:
  - Ingests event notifications, de-dups by id.
  - Maintains a 10-minute sliding window → real-time metrics: *notes/min*, *avg comment response time*, *unresolved Mutual-Help requests*, *active peers*.
  - Posts `{ kind: 'kpi-update', metrics }` coalesced ≤ every 250 ms.
  - Emits `{ kind: 'kpi-alert' }` when configurable thresholds cross.
  - Daily rollup: on first open past local midnight (guarded by `kv.lastRollupDate`), scans `events` where `rolledUp=false`, writes `warehouse_daily`, marks rolled-up.
- `kpi/kpi.service.ts` — main-thread bridge (`metrics$`, `alerts$`, `dailyReport(range)`).
- `reporting/report.page.ts` — reads exclusively from `warehouse_daily`.
- Toast threshold wiring.

**Acceptance**
- A burst of note creations pushes `notesPerMinute` within 250 ms.
- Crossing the "unresolved requests > 10" threshold triggers a single Toast (not a storm).
- Daily rollup runs exactly once per local date, even across multiple tabs (BroadcastChannel advisory lock).

---

## Phase 12 — Service Worker & PWA

**Goal.** Installable, reliable offline launches.

**Tasks**
- `ngsw-config.json` precache: hashed JS/CSS, fonts, icons, `index.html`.
- Web App Manifest: `display: standalone`, `start_url: "/"`, theme/background colours, icon set.
- Activation cleanup by build-hash cache prefix.
- `Response.error()` for unexpected origins in dev builds (enforces "no network" posture).
- Status indicator: "Offline ready ✓" once precache completes; "Update available" banner on new build with a *Reload* button.
- Feature-flagged so non-PWA browsers degrade to a normal tab.

**Acceptance**
- Cold reload with devtools "Offline" checked launches the app fully.
- Install-to-desktop (Chromium) works; launched PWA opens the last workspace.
- Validation is performed against the **`prod` Docker service** (`docker compose up prod` → `http://localhost:8080`), not an `ng serve` dev server — because the Service Worker behaves correctly only against the shipped build + `nginx.conf` cache headers.

---

## Phase 13 — Polish, Accessibility, Privacy Masking

**Goal.** Remove rough edges before Phase 14 test hardening.

**Tasks**
- Keyboard shortcuts: canvas tools (R/C/A/L/P/N), toggle chat (⌘/), snapshot drawer (⌘Z for undo, ⌘⇧Z for redo if trivially mapped to snapshot step).
- WCAG AA: focus rings, colour contrast, `aria-live` for Toasts, keyboard-navigable Comment Drawer and Modals.
- Privacy Masking toggle (`privacyMaskingEnabled` pref) blurs author names and note text for presenter/screenshare mode.
- Empty states + error states for every list/feature.
- Consistent copy for "this is a local-machine convenience, not security."

**Acceptance**
- Lighthouse accessibility ≥ 95.
- Axe-core reports 0 serious issues.
- Privacy masking applies within 1 frame of toggle.

---

## Phase 14 — Testing, Hardening, Release

**Goal.** Freeze behaviour with layered tests; ship.

**Tasks**
- **Unit**: services, reducers, validators, expiration sweeper, conflict resolver, snapshot patcher, crypto wrapper.
- **Component**: canvas interactions, comment drawer, import wizard, chat search, package export/import modal.
- **Integration (Playwright, multi-tab)**:
  - 4 tabs create/edit the same note — conflict prompts resolve deterministically.
  - 12 tabs join — no dropped edits or chat messages under cursor-broadcast load.
  - Sign-in lockout + unlock (clear browser data) flow.
  - Export on Tab A → Import on Tab B (same profile) → Overwrite vs Create Copy.
- **Property**: snapshot patch + inverse = identity; ring-buffer eviction correctness.
- **Manual smoke checklist**: each line item in §15 traced to a test or smoke step.
- Build & tag v1.0.0.

**Acceptance**
- CI green on unit + component + Playwright — all three jobs run via `docker compose run --rm ...` on GitHub Actions; no `setup-node`.
- Manual smoke checklist signed off, executed against `docker compose up prod`.
- `docker compose run --rm build` (equivalent to `ng build --configuration production` inside the container) size budget within plan (§17 of `design.md`).
- A fresh machine with **only Docker installed** can run `git clone && docker compose up dev`, reach `http://localhost:4200`, and use every feature. This is the canonical contributor onboarding and the release sanity check.

---

## 15. Requirements Traceability Matrix

Every requirement from the prompt is mapped to a phase and verified in Phase 14's smoke checklist.

| # | Requirement (from `metadata.json` prompt + Docker-first mandate)                           | Covered in Phase | Design Ref        |
|---|--------------------------------------------------------------------------------------------|------------------|-------------------|
| 0 | Docker-first: every build/install/test/run step executes inside a container                | 0 (0.A–0.C), 12, 14 | plan §"Docker Architecture" |
| 1 | Offline-only browser app                                                                   | 0, 12            | design §1, §15    |
| 2 | Up to 12 tabs/windows as collaborators                                                     | 1, 7             | design §7, §17    |
| 3 | Local username + password profile screen                                                   | 2                | design §14        |
| 4 | Persona roles (Admin / Academic Affairs / Teacher) — UX-only menu gating                   | 2                | design §14; Q-removed but retained in design |
| 5 | 15-minute lockout after 3 wrong passwords (per profile, resettable by clearing data)       | 2                | design §14; Q1    |
| 6 | 7-day auto-signout based on local timestamp                                                | 2                | design §14        |
| 7 | Canvas shape toolbar (rectangle, circle, arrow, connector, freehand pen)                   | 4                | design §9         |
| 8 | Sticky Note mode with 80-char cap                                                          | 4                | design §9; api §2.3 |
| 9 | Bulk import up to 1,000 notes from CSV/JSON                                                | 9.1              | design §12.1; Q3  |
| 10| Column-mapping Modal                                                                       | 9.1              | design §12.1      |
| 11| Row-level validation + error Table for rejected rows                                       | 9.1              | design §12.1      |
| 12| Threaded comment Drawer with ≤ 50 replies per thread                                       | 5                | design §10; api §2.4 |
| 13| @mentions from the workspace roster                                                        | 5                | design §10        |
| 14| Inbox badge + Toast for mentions                                                           | 5                | design §10        |
| 15| Right-side Chat panel, 500-message rolling window                                          | 6                | design §10        |
| 16| Chat keyword search                                                                        | 6                | design §10        |
| 17| System messages for key actions                                                            | 6 (emitters in 2,9,10) | design §10  |
| 18| Presence via avatar bar                                                                    | 7                | design §10        |
| 19| Colored cursors                                                                            | 7                | design §7, §10    |
| 20| "Recent action" activity feed with timestamps + object links                               | 7                | design §10        |
| 21| Mutual-Help board: request/offer posts with configurable forms                             | 8                | design §11        |
| 22| Fields: category, tags, time window, budget/compensation, urgency, attachments             | 8                | design §11        |
| 23| Draft / edit / withdraw / pin                                                              | 8                | design §11        |
| 24| 72-hour expiration, applied when the app is open (lazy sweeper)                            | 8                | design §11; Q5    |
| 25| Angular + TypeScript SPA                                                                   | 0                | metadata.json     |
| 26| RxJS stores for UI state                                                                   | 1                | design §6         |
| 27| BroadcastChannel for presence/cursor/chat/edit sync                                        | 1, 4, 5, 6, 7    | design §7; api §4 |
| 28| Simple version counters + conflict prompts                                                 | 4                | design §7.3; Q2   |
| 29| LocalStorage for lightweight prefs (theme, last workspace, persona, privacy toggle)        | 1                | design §5.2       |
| 30| IndexedDB for workspaces/canvas/comments/chat/telemetry/attachments                        | 1                | design §5.1; api §3 |
| 31| Single attachment ≤ 20 MB                                                                  | 8, 9.2           | design §11; api §2 |
| 32| Record local interaction events (views, clicks, creates/edits)                             | 11               | design §13        |
| 33| Real-time KPIs (notes/min, comment response time, unresolved requests)                     | 11               | design §13        |
| 34| Threshold alert Toasts                                                                     | 11               | design §13        |
| 35| Web Worker aggregation + daily warehouse                                                   | 11               | design §13; Q6    |
| 36| Simple reporting view from warehouse                                                       | 11               | design §13        |
| 37| Auto-save every 10 s                                                                       | 10               | design §8         |
| 38| 200 snapshots + one-click rollback                                                         | 10               | design §8         |
| 39| Workspace package export/import ≤ 200 MB (attachments + snapshots)                         | 9.2              | design §12.2; Q4  |
| 40| File API + File System Access API (when available)                                         | 9.2              | design §12.2      |
| 41| Same-name conflict → overwrite / create copy prompt                                        | 9.2              | design §12.2      |
| 42| Service Worker for asset caching + installable offline launches                            | 12               | design §15; Q7    |
| 43| Privacy masking toggle                                                                     | 13               | design §16        |

If a requirement is not in this matrix, it is not in the plan — report it and we will fold it in.

---

## 16. Dependency Graph (Phases)

```
P0 Scaffolding
 └─ P1 Core Platform
     ├─ P2 Auth
     │   └─ P3 Workspace Shell
     │       ├─ P4 Canvas
     │       │   ├─ P5 Comments
     │       │   ├─ P6 Chat
     │       │   ├─ P7 Presence
     │       │   ├─ P8 Mutual-Help
     │       │   ├─ P9 Import/Export  ── depends on P4+P5+P6+P8 stores
     │       │   ├─ P10 Snapshots     ── depends on full workspace state
     │       │   └─ P11 Telemetry/KPI ── depends on event emitters in P4..P8
     │       └─ P12 Service Worker    ── can start as early as P1; hardens in P12
     └─ P13 Polish ── after all features land
         └─ P14 Testing & Release
```

Phases P4–P11 can be parallelised across engineers once P3 is green, because each one owns its own IndexedDB store and feature module. P9 (Import/Export) and P10 (Snapshots) should land **after** their data sources are stable to avoid rework on serialisation formats.

---

## 17. Risk Register

| Risk                                                                                     | Mitigation                                                                                         | Owner Phase |
|------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|-------------|
| BroadcastChannel cursor flood starves edit events                                        | Per-kind throttling (see api-spec §4.2); prioritise edit/chat with separate microtask queues.      | P1, P7      |
| IndexedDB quota exceeded on large packages                                               | Size-precheck on export + import; explicit `QuotaExceeded` Toast; 200 MB package ceiling.          | P9.2        |
| Snapshot bloat                                                                            | Ring buffer of 200 + checkpoint-every-20 + external blob store (no attachment duplication).        | P10         |
| File System Access API unavailable on Safari/Firefox                                     | Feature-detect + Blob-download fallback.                                                           | P9.2        |
| Daily rollup runs multiple times across tabs                                             | `kv.lastRollupDate` advisory lock + BroadcastChannel "rollup claim" message.                       | P11         |
| Users over-trust persona role as security                                                | Explicit UI copy; role enforcement is UI-only; no store-layer gating.                              | P2          |
| Lockout/auto-signout perceived as tamper-proof                                           | Explicit UI copy; acknowledge "resettable by clearing browser data."                               | P2          |
| CSV/JSON malformed files crash parser                                                    | Parse in Web Worker; hard row-count ceiling; graceful `Validation` error per row.                  | P9.1        |

---

## 18. Done Definition

The project is "done" when:

0. **Docker-first is truly enforced.** A fresh machine with only Docker installed (no Node, no npm, no global Angular CLI) can `git clone` and run `docker compose up dev` to develop, `docker compose run --rm test` to test, `docker compose run --rm e2e` to run multi-tab integration tests, and `docker compose up prod` to validate the shipped PWA. No step in any phase, task, or CI job shells out to the host toolchain.
1. All 44 rows in §15 pass their smoke checks.
2. CI is green: lint + unit + component + Playwright multi-tab — all via `docker compose run --rm ...`.
3. `docs/design.md` and `docs/api-spec.md` match the shipped behaviour (no drift).
4. `docs/questions.md` assumptions are either still valid or have been explicitly re-confirmed with the user and the code + docs updated.
5. A fresh machine can: install the PWA (from the `prod` container) → create a profile → create a workspace → use every feature → export a package → import it on a second machine with no network present at any step.
