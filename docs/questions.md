# SecureRoom Brainstorm Studio — Major Scope Questions

---

## 1. How should local-only profile passwords be stored, given there is no backend?

**Assumption:** The prompt states that persona roles are "not a security boundary in a pure browser app" and that the lockout/auto-signout behaviors are "resettable by clearing browser data." This signals that the sign-in screen is a UX safeguard, not a cryptographic defense, and passwords only need to deter casual shoulder-surfing on a shared offline machine.

**Solution:** Store each profile as an IndexedDB record containing `{ username, salt, passwordHash, failedAttempts, lockoutUntil, lastSignInAt }`. Hash passwords with PBKDF2 (Web Crypto API, SHA-256, ≥100k iterations) using a per-profile random salt. Never store the plain password and never emit any network call. Document explicitly in the UI that this is a local-machine convenience, not a security boundary, so expectations stay aligned with the prompt's framing.

---

## 2. What does the "conflict prompt" look like when two tabs edit the same object using simple version counters?

**Assumption:** The prompt specifies "simple version counters and conflict prompts," so full CRDT-style auto-merge is out of scope. A last-writer-wins flow with explicit human arbitration is expected whenever two tabs race on the same object.

**Solution:** Every canvas object, note, comment thread, and Mutual-Help post carries a `version: number` and `lastEditedBy: tabId`. On each edit, a tab broadcasts `{ objectId, baseVersion, patch }` via BroadcastChannel. If a receiving tab has already advanced past `baseVersion`, it opens a Conflict Drawer showing the two candidate states side by side ("Your version" vs "Incoming from Tab #4") with `Keep Mine`, `Accept Incoming`, and `Merge Manually` actions. Resolution writes `version + 1` and rebroadcasts. For transient edits (cursor, presence), no versioning is applied — only object mutations.

---


## 3. How should the CSV/JSON bulk-import flow handle column mapping, row-level validation, and the 1,000-note / 80-character limits?

**Assumption:** The prompt requires a column-mapping Modal, row-level validation, and an error Table for rejected rows — implying a staged pipeline where mapping happens before validation, and the user always sees the outcome before anything is committed to IndexedDB.

**Solution:** Three-step modal flow:
1. **Upload & parse** — parse the file in a Web Worker (PapaParse-style streaming). Reject the file outright if it would produce more than 1,000 rows.
2. **Map columns** — present detected headers and let the user map them to `{ text (required), color, tags, author }`. Remember the last mapping per workspace in LocalStorage.
3. **Validate & preview** — run row-level checks (non-empty text, ≤ 80 characters, known tags). Valid rows go into a preview list; invalid rows populate an error Table with `{ rowIndex, rawValues, reasons[] }` and a "Download rejected rows as CSV" action. Only after the user clicks `Import N valid rows` are records written, inside a single IndexedDB transaction, and a single `bulk-import` system message is posted to the chat.

---


## 4. How should workspace package export/import handle the File System Access API fallback and the same-name conflict prompt on import?

**Assumption:** The prompt says File System Access API is used "when available" with the File API as the baseline, so the app must degrade gracefully on Safari/Firefox. Same-name conflict resolution happens at import time, not export time.

**Solution:** On export, feature-detect `window.showSaveFilePicker`. If present, stream the package directly to the chosen file handle. If absent, assemble the package in memory (or via `StreamSaver` with a Service Worker) and trigger an `<a download>` click with a Blob URL. On import, read the incoming package, parse its manifest (`workspaceId`, `name`, `createdAt`), and check for a same-`name` workspace already in IndexedDB. If one exists, open a Modal with three choices: `Overwrite` (replace in place, keeping the existing `workspaceId` so comments/mentions stay linked), `Create Copy` (assign a new `workspaceId` and suffix the name with `(imported YYYY-MM-DD)`), or `Cancel`. Enforce the 200 MB ceiling before any writes begin and surface a clear error Toast if exceeded.

---

## 5. What does "default 72 hours expiration applied when the app is open" mean operationally for Mutual-Help posts, given the app runs fully offline with no background scheduler?

**Assumption:** Because logic runs only while the SPA is loaded, there is no reliable wall-clock daemon. The prompt's phrasing — "applied when the app is open" — implies lazy expiration: posts are not actively deleted on a timer but are recomputed/filtered whenever the app is interacted with.

**Solution:** Store each post with `{ createdAt, expiresAt = createdAt + 72h (configurable), status: 'active' | 'expired' | 'withdrawn' }`. On every workspace open, on every Mutual-Help board render, and on a lightweight RxJS interval (60 s) while the tab is visible, run a sweeper that flips `active → expired` where `now >= expiresAt`. Expired posts remain in IndexedDB (not deleted) but drop out of the active list and stop generating inbox items. Pinning bypasses expiration until unpinned. The Web Worker aggregation pipeline treats `expired` posts as terminal for KPI purposes (e.g., "unresolved requests" excludes them).

---

## 6. How does the Web Worker aggregation pipeline compute real-time KPIs and the daily "warehouse" without blocking the main thread or double-counting events?

**Assumption:** Real-time KPIs (notes/min, comment response time, unresolved requests) must update live enough to trigger alert Toasts, while the daily summary is a coarser rollup suitable for the reporting view. Event telemetry is already stored in IndexedDB, so the worker is a consumer, not the system of record.

**Solution:** The main thread appends every interaction event to an `events` object store and posts a `{ kind: 'event-appended', id }` notification to the worker. The worker maintains an in-memory sliding window (e.g., last 10 minutes) for real-time KPIs and posts `{ kind: 'kpi-update', metrics }` back to the main thread, which drives the live dashboard and threshold Toasts. Once per day (on first open after midnight local time, tracked via a `lastRollupDate` key), the worker scans new events since the last rollup, writes one row per day per metric into a `warehouse_daily` store, and marks events as rolled-up so they are never double-counted. The reporting view reads exclusively from `warehouse_daily`.

---

## 7. Is the Service Worker required for the "installable, reliable offline launches" goal, or is it optional?

**Assumption:** The prompt says a Service Worker "may be used" — optional in literal reading, but the stated goal of "installable, reliable offline launches" and "all logic runs fully offline" is hard to meet reliably without one, especially after the first load when the browser's HTTP cache may have evicted assets.

**Solution:** Ship a Service Worker by default using a precache + runtime-cache strategy. Precache the Angular build output (hashed JS/CSS, fonts, icons, `index.html`) during `install` and serve them cache-first from `fetch`. On activation, clean up stale precaches by build hash. Add a Web App Manifest so the app is installable as a PWA. Never cache user data (workspaces, attachments) in the Service Worker — that remains exclusively in IndexedDB. Provide a visible "Offline ready ✓" indicator once precaching completes so users know the app can be launched without a network on subsequent visits.
