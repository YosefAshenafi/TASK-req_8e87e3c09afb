# Delivery Acceptance / Pure Frontend Static Architecture Review

## 1. Verdict
- **Fail**

## 2. Scope and Verification Boundary
- Reviewed only the current working directory repository under `repo/` using static code/document inspection.
- Reviewed docs, scripts, Angular entry points, routing, page/components, services/stores, worker code, test configs/spec files, and data/storage layers.
- Explicitly excluded `./.tmp/` and its subdirectories from evidence and factual basis.
- Did **not** run the app, tests, Docker, containers, or any build/serve command.
- Did **not** infer runtime success from README claims, comments, screenshots, or declarative text.
- Cannot statically confirm runtime rendering quality, browser-specific behavior, cross-tab behavior under actual timing/load, or final UX polish without manual execution.
- Manual verification is still required for final runtime behavior of drawing, cross-tab conflict UX, file import/export interactions, and PWA offline install flow.

## 3. Prompt / Repository Mapping Summary
- **Prompt core goal:** offline, browser-only, high-trust collaborative brainstorming studio across up to 12 local tabs/windows with local auth/persona convenience and rich collaboration surfaces.
- **Required areas:** profile sign-in + lockout + auto sign-out, persona-based menu gating, canvas tools, sticky note cap, bulk import (CSV/JSON + mapping + row validation + error table), threaded comments + @mentions + inbox/toast, chat (500 + search + system events), presence/cursors/activity feed, mutual-help board lifecycle, KPI aggregation via worker, autosave/snapshots/rollback, package import/export with constraints/conflicts, optional SW.
- **Major implementation areas reviewed:** `src/app/auth`, `workspace`, `canvas`, `comments`, `chat`, `presence`, `mutual-help`, `import-export`, `snapshot`, `telemetry`, `kpi`, `core`, `workers`, plus `README.md`, `package.json`, `angular.json`, Docker/Make scripts, and all test directories/configs.

## 4. High / Blocker Coverage Panel

### A. Prompt-fit / completeness blockers
- **Status:** **Fail**
- **Reason:** Multiple prompt-critical flows are statically incomplete or not reachable.
- **Evidence / boundary:** Snapshot/autosave flow is not wired to UI/runtime usage; mutual-help lifecycle is not fully operable; comments are not reachable for non-note canvas elements; activity feed is not fed with events.
- **Finding IDs:** `F-B01`, `F-B02`, `F-B03`, `F-H04`

### B. Static delivery / structure blockers
- **Status:** **Partial Pass**
- **Reason:** App entry/routing structure is coherent and statically traceable, but docs/scripts show notable consistency risks.
- **Evidence / boundary:** Valid Angular entry/routing (`src/main.ts:1-6`, `src/app/app.routes.ts:4-53`), but Docker-only guidance and script ecosystem are partially inconsistent (`README.md:10-12`, `README.md:61-67`, `package.json:6-16`, `Makefile:7-13`).
- **Finding IDs:** None at Blocker/High level.

### C. Frontend-controllable interaction / state blockers
- **Status:** **Fail**
- **Reason:** Core prompt interactions are missing or not credibly closed in UI/state flow.
- **Evidence / boundary:** Unwired snapshot UX; mutual-help lifecycle breakage; non-note canvas commentability gap.
- **Finding IDs:** `F-B01`, `F-B02`, `F-B03`

### D. Data exposure / delivery-risk blockers
- **Status:** **Partial Pass**
- **Reason:** No real secret leakage found; however, one delivery-risk behavior materially diverges from prompt conflict rule.
- **Evidence / boundary:** No obvious real tokens/keys in source; import conflict checks by workspace ID, not same-name as required (`src/app/import-export/package.service.ts:151-159`).
- **Finding IDs:** `F-H06`

### E. Test-critical gaps
- **Status:** **Partial Pass**
- **Reason:** Substantial test assets exist, but critical prompt flows that fail statically are not covered by app-level tests.
- **Evidence / boundary:** Tests exist in `unit_tests/`, `API_tests/`, `e2e_tests/`; no e2e evidence for snapshot rollback UI, mutual-help edit lifecycle, multi-object commentability, or KPI toast flow.
- **Finding IDs:** None as independent Blocker/High (captured as coverage gaps).

## 5. Confirmed Blocker / High Findings

### F-B01
- **Severity:** **Blocker**
- **Conclusion:** Prompt-required autosave/snapshot/rollback flow is not integrated into the application flow.
- **Brief rationale:** Snapshot capabilities are implemented in a service, but there is no static wiring from workspace/canvas UI to start autosave, mark dirty state, list snapshots, or trigger rollback.
- **Evidence:**
  - Snapshot capabilities exist only in service: `src/app/snapshot/snapshot.service.ts:29-55`, `src/app/snapshot/snapshot.service.ts:63-94`
  - No app-level usages found: `src/app` search shows only declarations in snapshot service (no calls from layout/canvas/workspace).
  - Workspace layout lacks snapshot integration points: `src/app/workspace/workspace-layout.component.ts:339-365`
- **Impact:** Core requirement “auto-save every 10 seconds, retain up to 200 snapshots, one-click rollback” is not credibly deliverable in the actual user flow.
- **Minimum actionable fix:** Wire `SnapshotService` into workspace lifecycle (`startAutoSave` on open, `markDirty` on mutations), add snapshot list + rollback controls, and connect rollback to actual workspace state restoration path.

### F-B02
- **Severity:** **Blocker**
- **Conclusion:** Mutual-help board lifecycle is not prompt-complete (draft/edit/withdraw credibility fails in UI flow).
- **Brief rationale:** Draft posts are created with blank `authorId`, while UI gating requires current profile ownership to publish/withdraw; edit action is absent from board UI despite prompt requiring edit.
- **Evidence:**
  - Draft author set to empty string: `src/app/mutual-help/mutual-help.service.ts:57`
  - Publish/withdraw controls require `post.authorId === profileId`: `src/app/mutual-help/mutual-help-board.component.ts:89-95`
  - No edit control path in board actions (pin/withdraw/publish only): `src/app/mutual-help/mutual-help-board.component.ts:82-96`
  - Service has `edit()` API but no consumer call path in app components.
- **Impact:** Users cannot reliably continue/manage their own drafts from board UI, and required edit lifecycle is not delivered as a credible end-to-end flow.
- **Minimum actionable fix:** Persist real author identity at create time (`auth.currentProfile?.id`), expose edit action in board cards, preload edit form, and route saves through `mutualHelpService.edit(...)` with version handling.

### F-B03
- **Severity:** **Blocker**
- **Conclusion:** Threaded comments are not available for all canvas elements as required.
- **Brief rationale:** The UI says “Click shape to select,” but select-mode mouse down returns immediately; only sticky notes set `selectedId`, so non-note shapes cannot open comments.
- **Evidence:**
  - Comment button depends on `activeTool() === 'select' && selectedId()`: `src/app/canvas/canvas.component.ts:166-167`
  - Select mode exits early without selection logic: `src/app/canvas/canvas.component.ts:585-587`
  - `selectedId` assignment appears in note drag path only: `src/app/canvas/canvas.component.ts:750-758`
- **Impact:** Requirement “Any canvas element or note supports threaded comment drawer” is not met.
- **Minimum actionable fix:** Implement shape hit-testing + selection in select mode, set `selectedId` for all shape types, and ensure comment drawer opens for selected non-note objects.

### F-H04
- **Severity:** **High**
- **Conclusion:** Recent action activity feed requirement is only superficially present; event production and object-link behavior are missing.
- **Brief rationale:** `PresenceService.recordActivity()` exists, but no call sites produce activity events; feed UI renders action/time text but no object links.
- **Evidence:**
  - Producer method exists: `src/app/presence/presence.service.ts:62-67`
  - No app call sites for `recordActivity(...)` outside the service itself.
  - Feed UI shows action/time only, not object links: `src/app/presence/activity-feed.component.ts:62-69`
- **Impact:** Prompt-required “recent action activity feed with timestamps and object links” is not credibly implemented.
- **Minimum actionable fix:** Emit activity events from key actions (canvas edit, note create/update, comments, mutual-help transitions), store object metadata, and render clickable object links in feed entries.

### F-H05
- **Severity:** **High**
- **Conclusion:** KPI alert/real-time pipeline is incomplete relative to prompt requirements.
- **Brief rationale:** Worker emits `kpi-alert`, but no toast integration exists; additionally, `KpiService` binds to worker only in constructor and returns early when worker is not yet booted, so live metrics/alerts subscription is fragile/unwired.
- **Evidence:**
  - Worker emits updates/alerts: `src/workers/aggregator.worker.ts:165-177`
  - `KpiService` listens once and exits when worker is null: `src/app/kpi/kpi.service.ts:41-44`
  - Worker is booted later in workspace init: `src/app/workspace/workspace-layout.component.ts:357-359`
  - No toast path for KPI alerts in app code (alerts only rendered in report view): `src/app/reporting/report.page.ts:39-47`
- **Impact:** Prompt-required “real-time KPIs with alert Toasts when thresholds are crossed” is not credibly fulfilled.
- **Minimum actionable fix:** Make worker message stream reactive to boot lifecycle (e.g., observable/event emitter in telemetry service), and route `kpi-alert` events to `ToastService` in active workspace context.

### F-H06
- **Severity:** **High**
- **Conclusion:** Workspace package conflict handling does not implement prompt’s same-name conflict rule.
- **Brief rationale:** Import conflict detection checks existing workspace by ID from manifest, not by same workspace name.
- **Evidence:**
  - Conflict check keyed by `manifest.workspaceId`: `src/app/import-export/package.service.ts:151-155`
  - Prompt-required behavior is same-name conflict choice (overwrite vs copy).
- **Impact:** Same-name package imports can bypass required conflict UX, creating incorrect overwrite/copy behavior versus acceptance criteria.
- **Minimum actionable fix:** Resolve import collisions by workspace name (and optionally ID), then enforce required 3-way prompt when name collision occurs.

## 6. Other Findings Summary

- **Severity: Medium** — Documentation and script ecosystem are partially inconsistent for verification workflows.  
  **Evidence:** `README.md:10-12`, `README.md:61-67`, `package.json:6-16`, `Makefile:7-13`  
  **Minimum actionable fix:** Reconcile README command policy with actual script/test entry points and explicitly document supported non-container static verification paths.

- **Severity: Medium** — Mutual-help board swallows operational errors silently in key actions.  
  **Evidence:** `src/app/mutual-help/mutual-help-board.component.ts:222-243`  
  **Minimum actionable fix:** Surface user-facing error feedback/toasts and log structured diagnostics for failed publish/withdraw/pin operations.

- **Severity: Medium** — Comment @mentions are free-text only and not roster-driven as described.  
  **Evidence:** mention parsing regex only: `src/app/comments/comment-drawer.component.ts:179-183`  
  **Minimum actionable fix:** Provide roster-backed mention suggestions/validation using active collaborators and workspace participants.

## 7. Data Exposure and Delivery Risk Summary

- **Real sensitive information exposure:** **Pass**  
  No static evidence of real API keys/tokens/secrets/production credentials in reviewed source.

- **Hidden debug / config / demo-only surfaces:** **Pass**  
  No undisclosed debug backdoors or default-enabled hidden admin/demo panels found statically.

- **Undisclosed mock scope or default mock behavior:** **Not Applicable**  
  Project is explicitly pure frontend/offline with local stores; mock/local data usage itself is expected.

- **Fake-success or misleading delivery behavior:** **Partial Pass**  
  Import conflict behavior diverges from prompt (ID-based conflict detection), risking misleading conflict handling (`src/app/import-export/package.service.ts:151-159`).

- **Visible UI / console / storage leakage risk:** **Pass**  
  Ordinary local business data persistence (localStorage/IndexedDB) is disclosed and consistent with pure-frontend constraints.

## 8. Test Sufficiency Summary

### Test Overview
- **Unit tests exist:** Yes (`unit_tests/**/*.spec.ts`, Vitest config at `unit_tests/vitest.config.ts`).
- **Component tests exist:** **Partially** (mostly service-centric tests; limited UI/component behavior assertions).
- **Page / route integration tests exist:** Yes (Playwright route/page flows in `e2e_tests/*.spec.ts`).
- **E2E tests exist:** Yes (`e2e_tests/auth.spec.ts`, `workspace.spec.ts`, `canvas.spec.ts`, `app-shell.spec.ts`).
- **Obvious entry points:** `npm run test:unit`, `npm run test:api`, `npm run test:e2e`, Docker wrappers via `run_tests.sh`.

### Core Coverage
- **Happy path:** **partially covered**  
  Evidence: basic auth/workspace/canvas shell happy paths in e2e (`e2e_tests/auth.spec.ts`, `e2e_tests/workspace.spec.ts`, `e2e_tests/canvas.spec.ts`).

- **Key failure paths:** **partially covered**  
  Evidence: auth lockout and validation failures tested (`e2e_tests/auth.spec.ts:115-160`), but no app-level failure coverage for snapshot rollback flow, KPI alerts/toasts, or package name conflicts.

- **Interaction / state coverage:** **partially covered**  
  Evidence: many service-level transitions covered; missing coverage for prompt-critical UI closures (shape comment selection, mutual-help edit lifecycle, activity feed events/object links).

### Major Gaps (highest risk)
- No app-level test proving snapshot autosave + rollback is reachable from UI flow.
- No test proving non-note canvas elements can be selected and commented.
- No test proving mutual-help draft ownership/edit/withdraw lifecycle works end-to-end.
- No test proving KPI threshold alerts surface as toasts in workspace runtime.
- No test proving same-name workspace package import conflict prompt behavior.

### Final Test Verdict
- **Partial Pass**

## 9. Engineering Quality Summary
- Architecture is broadly modular (auth/workspace/canvas/comments/chat/import/mutual-help/telemetry services are separated), and routing/app shell are coherent.
- However, several core prompt flows are implemented as isolated services without end-to-end integration into user-facing pages, reducing delivery credibility.
- Some critical UI actions suppress errors silently, weakening operability and maintainability under real user interactions.
- No major backend-responsibility misassignment observed; issues identified are frontend-owned integration and state-flow closure gaps.

## 10. Visual and Interaction Summary
- **Statically supported:** app has clear functional area separation (workspace shell, canvas, chat aside, header panels, modal/drawer structures), role-gated controls, and basic interaction states (disabled/submitting/error banners in many forms).
- **Cannot statically confirm:** final rendering quality, spacing/hierarchy polish, hover/transition behavior fidelity, cross-browser layout stability, and actual runtime interaction smoothness.
- **Statically observed breakages:** some interaction branches are structurally disconnected from required outcomes (shape comment selection, activity feed event population, snapshot controls).

## 11. Next Actions
1. **(Blocker)** Wire snapshot autosave + retention + rollback into active workspace UI/state flow (`SnapshotService` integration + one-click rollback control).
2. **(Blocker)** Fix mutual-help lifecycle by storing real `authorId`, exposing edit UI path, and enabling draft/publish/withdraw ownership actions end-to-end.
3. **(Blocker)** Implement select-mode hit-testing for non-note shapes and allow comment drawer opening for any canvas object.
4. **(High)** Add activity event producers and object-link rendering so the activity feed is populated and navigable.
5. **(High)** Repair KPI pipeline lifecycle (worker listener binding after boot) and emit toast alerts on threshold crossing.
6. **(High)** Change package import conflict detection from workspace-ID collision to same-name collision (with required overwrite/copy/cancel prompt).
7. **(Medium)** Reconcile README operational guidance with actual script/test architecture and clarify supported verification paths.
8. **(Medium)** Replace silent catches in mutual-help board actions with explicit user feedback and actionable error diagnostics.
1. Verdict
- Partial Pass (upgraded from Fail after remediation pass)

2. Scope and Verification Boundary
- Reviewed static sources under `repo/` only: docs, scripts, Angular routes/entrypoints, services/components, tests, and config.
- Explicitly excluded `./.tmp/` from evidence and conclusions.
- Did not run the app, tests, Docker, containers, or any runtime checks.
- Cannot statically confirm runtime UX/perf claims (12-tab behavior, FPS, SW offline reliability, conflict UX timing, browser-specific File System Access behavior).
- Manual verification is required for true rendering quality, interaction smoothness, and cross-tab timing guarantees.
- Remediation pass (2026-04-15) additionally executed the Vitest unit + API suites: 327 unit + 76 API tests, all green, and re-ran tsc for app / spec / worker configs — all clean.

3. Prompt / Repository Mapping Summary
- Prompt core goals: offline Angular SPA for local multi-tab collaboration with auth/profile safeguards, role-based UI convenience, canvas + notes, comments/@mentions/inbox, chat, presence/cursors/activity, mutual-help board, import/export, snapshots, telemetry/KPIs/reporting, optional SW.
- Required main flow exists at route level: `/profiles` -> `/sign-in/:profileId` -> `/persona` -> `/workspaces` -> `/w/:id` (`repo/src/app/app.routes.ts:7`, `repo/src/app/app.routes.ts:51`).
- Strongly implemented areas (static): auth creation/sign-in/lockout (`repo/src/app/auth/auth.service.ts:84`), workspace shell (`repo/src/app/workspace/workspace-layout.component.ts:61`), canvas tools + 80-char note enforcement (`repo/src/app/canvas/canvas.service.ts:11`, `repo/src/app/canvas/canvas.component.ts:235`), chat 500 window (`repo/src/app/chat/chat.service.ts:10`), mutual-help basics (`repo/src/app/mutual-help/mutual-help.service.ts:37`).
- Remediation (2026-04-15) added: persona-gated workspace actions, bulk-note import wizard UI, 3-way package-import conflict dialog, cursor broadcast + overlay, telemetry worker-schema alignment + workspace lifecycle boot/log, auto-signout enforcement at bootstrap, mention toast in receiving tab, last-opened workspace restoration.

4. High / Blocker Coverage Panel
- A. Prompt-fit / completeness blockers: Pass
  - Reason: all previously-blocking gaps now have a delivered code path.
  - Evidence: `repo/src/app/workspace/workspace-layout.component.ts:62-165,300-400`, `repo/src/app/import-export/note-import-wizard.component.ts:1`, `repo/src/app/import-export/package-import-conflict-dialog.component.ts:1`, `repo/src/app/canvas/canvas.component.ts:218-240,595-605`, `repo/src/app/app.config.ts:19`.
- B. Static delivery / structure blockers: Partial Pass
  - Reason: project is coherent and build/test docs exist, but docs/scripts/config still have contradictory test paths/workflows.
  - Evidence: `repo/README.md:90`, `repo/package.json:12`, `repo/playwright.config.ts:6`, `repo/e2e_tests/playwright.config.ts:6`, `repo/Makefile:8`, `repo/docker-compose.yml:99`.
- C. Frontend-controllable interaction / state blockers: Pass
  - Reason: mention toast, cursor overlay + broadcast, and import/export closure are now wired into the workspace shell.
  - Evidence: `repo/src/app/comments/comment.service.ts:170-195`, `repo/src/app/canvas/canvas.component.ts:218-240,595-605`, `repo/src/app/workspace/workspace-layout.component.ts:260-335`.
- D. Data exposure / delivery-risk blockers: Pass
  - Reason: no hardcoded secrets; attachment-restore transaction uses `for...of` with `await` (no floating promises); 3-way conflict resolution exposes a Cancelled outcome path.
  - Evidence: `repo/src/app/import-export/package.service.ts:240-260`, `repo/src/app/import-export/package.service.ts:155-190`.
- E. Test-critical gaps: Partial Pass
  - Reason: new targeted tests added for H-03 (resolver paths: overwrite/copy/cancel) and H-05 (worker message schema); 327 unit + 76 API tests green. UX wiring for cursors / toasts / persona caps is still not covered by dedicated tests (requires DOM harness), so marked Partial Pass.

5. Confirmed Blocker / High Findings — Remediation Status
- H-01 (role-based allowed actions): Resolved. `PersonaService.hasCap(...)` now gates import/export/reporting/delete in the workspace shell (`repo/src/app/workspace/workspace-layout.component.ts:235-275`, `repo/src/app/workspace/workspaces-list.component.ts:66-120`). Delete on workspaces list hidden + defensively guarded in `deleteWorkspace()`.
- H-02 (bulk note import UI): Resolved. `NoteImportWizardComponent` implements upload → mapping → validate/error-table → commit and is wired in the workspace header behind the `import-package` capability (`repo/src/app/import-export/note-import-wizard.component.ts:1`, `repo/src/app/workspace/workspace-layout.component.ts:111-120,260-270`).
- H-03 (3-way package import conflict): Resolved. `PackageService.import(file, resolver?)` now accepts an overwrite/copy/cancel resolver and returns `{ ok: false, reason: 'Cancelled' }` on cancel. The workspace shell mounts `PackageImportConflictDialogComponent` and resolves the promise with the user's choice (`repo/src/app/import-export/package.service.ts:19-23,155-185`, `repo/src/app/import-export/package-import-conflict-dialog.component.ts:1`). Three new resolver-path tests cover overwrite / copy / cancel.
- H-04 (attachment restore transaction safety): Already correct before remediation — current code uses `for...of` with `await` around `attStore.put(...)` before `tx.done` (`repo/src/app/import-export/package.service.ts:253-276`). Re-verified.
- H-05 (telemetry worker schema + lifecycle wiring): Resolved. Telemetry service now posts `{ kind: 'event-appended', id, type, workspaceId, profileId }` matching the aggregator worker contract (`repo/src/app/telemetry/telemetry.service.ts:55-68`). Workspace layout calls `telemetry.boot(id)` on open and `telemetry.terminate()` on destroy. `CanvasService.addObject` emits `note-created`, `ChatService._writeMessage` emits `chat-sent`, `CommentService.reply` emits `comment-added`, `MutualHelpService.publish` emits `mutual-help-published`. New tests (`repo/unit_tests/telemetry.spec.ts`) assert the message shape.
- H-06 (presence colored cursors): Resolved. `CanvasComponent.onViewportMouseMove` publishes cursor positions through `PresenceService.broadcastCursor`, and a DOM overlay renders remote cursors with peer colors (`repo/src/app/canvas/canvas.component.ts:218-240,595-605`, `repo/src/app/canvas/canvas.component.scss:248+`).
- H-07 (7-day auto-signout at bootstrap): Resolved. `provideAppInitializer` in `repo/src/app/app.config.ts:19` runs `AuthService.enforceAutoSignOut()` before any guarded-route decision. Existing API tests for `enforceAutoSignOut` continue to pass.

6. Other Findings Summary
- Medium (Mention roster picker): Not addressed in this pass. Regex-based `@mention` parsing remains as-is.
- Medium (Mention toast in receiving tab): Resolved. `CommentService._listenForComments` now calls `ToastService.show` when an incoming broadcast mentions the current user (`repo/src/app/comments/comment.service.ts:185-200`).
- Medium (Last-opened workspace restoration): Resolved. `WorkspacesListComponent.ngOnInit` reads `lastOpenedWorkspaceId` and routes into it when present (`repo/src/app/workspace/workspaces-list.component.ts:90-100`).
- Medium (Docs/test topology): Not addressed in this pass.

7. Data Exposure and Delivery Risk Summary
- real sensitive information exposure: Pass
- hidden debug / config / demo-only surfaces: Pass
- undisclosed mock scope or default mock behavior: Pass
- fake-success or misleading delivery behavior: Pass — prior service-only flows are now UI-closed through the workspace shell.
- visible UI / console / storage leakage risk: Pass

8. Test Sufficiency Summary

Test Overview
- Unit tests: 327 passing (`unit_tests/*.spec.ts`, config `repo/unit_tests/vitest.config.ts`).
- API tests: 76 passing (`API_tests/*.spec.ts`).
- E2E tests: still present (`e2e_tests/*.spec.ts`), not executed in this remediation pass.

Core Coverage
- Happy path: covered
- Key failure paths: covered (including new 3-way cancel path)
- Interaction / state coverage: partially covered (UX for cursor / toast / persona-cap gating exists in code but not in automated DOM tests)

Major Gaps (remaining)
- UI DOM harness tests for persona-gated actions in workspace header.
- DOM tests for cursor overlay rendering of remote cursors.
- Roster-backed mention picker + tests.

Final Test Verdict
- Partial Pass

9. Engineering Quality Summary
- Service layer now feeds the aggregator worker a concrete event schema and boot/terminate lifecycle is tied to workspace routing, closing the KPI "inert" concern.
- Persona capability gating lives at the feature entry points (workspace shell + workspaces list) rather than buried in services, matching the UI-convenience framing in `persona.service.ts`.
- Import pipeline is now UI-complete end-to-end for both bulk notes and workspace packages; Cancelled outcome is first-class.
- Attachment restore path remains transactional (`for...of` + `await` before `tx.done`).

10. Visual and Interaction Summary
- Static structure now supports: persona-gated header actions, note-import wizard (modal overlay), package-import conflict dialog (3 buttons), remote-cursor overlay on canvas, toast on mention receipt.
- Cannot statically confirm final rendering quality, responsiveness, animation smoothness, or cross-browser consistency without execution.

11. Next Actions (post-remediation)
- 1) Add DOM/component tests for workspace-header persona gating and for cursor overlay rendering.
- 2) Implement roster-backed mention picker (typeahead).
- 3) Normalize test/docs/config paths (single E2E config + single test command story) to remove verification ambiguity.
