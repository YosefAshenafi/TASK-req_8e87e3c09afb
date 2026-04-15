# SecureRoom Brainstorm Studio — Design Document

## 1. Overview

SecureRoom Brainstorm Studio is an Angular + TypeScript single-page application that runs **fully offline** in the browser. It lets up to 12 tabs/windows on the same machine collaborate on shared workspaces (canvas, sticky notes, comments, chat, Mutual-Help board) by synchronising state over `BroadcastChannel`. All persistence is local: IndexedDB for workspace data, LocalStorage for lightweight preferences, the File API / File System Access API for USB package transfer, and an optional Service Worker for installable offline launches.

There is no network dependency, no remote backend, and no authentication server. Persona roles (Admin, Academic Affairs, Teacher) and the sign-in flow are UX safeguards for a shared local machine, not cryptographic security boundaries.

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Browser Tab (one of ≤12)                   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                 Angular SPA (main thread)                │    │
│  │                                                          │    │
│  │  Feature Modules                                         │    │
│  │    ├─ auth/           (profile, sign-in, lockout)        │    │
│  │    ├─ workspace/      (canvas, notes, toolbar)           │    │
│  │    ├─ comments/       (threaded drawer, @mentions)       │    │
│  │    ├─ chat/           (500-msg rolling panel)            │    │
│  │    ├─ presence/       (avatars, cursors, activity feed)  │    │
│  │    ├─ mutual-help/    (requests/offers board)            │    │
│  │    ├─ import-export/  (CSV/JSON, workspace packages)     │    │
│  │    └─ reporting/      (KPIs, daily warehouse)            │    │
│  │                                                          │    │
│  │  Core Services (singletons)                              │    │
│  │    ├─ DbService            (IndexedDB via idb)           │    │
│  │    ├─ PrefsService         (LocalStorage)                │    │
│  │    ├─ BroadcastService     (cross-tab pub/sub)           │    │
│  │    ├─ PresenceService      (tab identity, avatar, cursor)│    │
│  │    ├─ WorkspaceStore       (RxJS BehaviorSubject)        │    │
│  │    ├─ CommentStore, ChatStore, MutualHelpStore           │    │
│  │    ├─ SnapshotService      (auto-save, rollback)         │    │
│  │    ├─ TelemetryService     (event logger)                │    │
│  │    ├─ KpiService           (bridge to Web Worker)        │    │
│  │    └─ PackageService       (import/export)               │    │
│  │                                                          │    │
│  └──────────────────────────────────────────────────────────┘    │
│        │                │                        │              │
│        ▼                ▼                        ▼              │
│  ┌───────────┐   ┌──────────────┐      ┌─────────────────┐      │
│  │ IndexedDB │   │ LocalStorage │      │  Web Worker     │      │
│  │           │   │              │      │  (aggregation)  │      │
│  └───────────┘   └──────────────┘      └─────────────────┘      │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ Service Worker (asset precache + PWA installability)   │     │
│  └────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
        ▲                                            ▲
        │                BroadcastChannel            │
        └────────────── (presence, cursors, ─────────┘
                         chat, edit events)
```

---

## 3. Module Structure

| Module           | Responsibility                                                                 |
|------------------|---------------------------------------------------------------------------------|
| `core/`          | DI-provided singletons (services, stores, interceptors where relevant).         |
| `shared/`        | Reusable UI primitives: Modal, Drawer, Toast, Table, Form controls, Avatar.     |
| `auth/`          | Profile list, create-profile, sign-in with lockout, auto-signout watchdog.      |
| `workspace/`     | Canvas renderer, shape toolbar, sticky-note mode, selection, snapping.          |
| `comments/`      | Comment Drawer, thread list, @mention picker, inbox badge.                      |
| `chat/`          | Chat panel, message search, system-message formatter.                           |
| `presence/`      | Avatar bar, coloured cursor layer, activity feed.                               |
| `mutual-help/`   | Board, post form, pinning, expiration sweeper.                                  |
| `import-export/` | CSV/JSON note import wizard, workspace package export/import.                   |
| `reporting/`     | KPI dashboard, threshold Toasts, daily warehouse view.                          |
| `platform/`      | Web Worker bootstrap, Service Worker registration, feature detection.           |

---

## 4. Data Model (Domain Entities)

```ts
Profile {
  id: string;               // uuid
  username: string;
  passwordHash: string;     // PBKDF2(SHA-256, ≥100k iters)
  salt: string;             // base64
  failedAttempts: number;
  lockoutUntil?: number;    // epoch ms
  lastSignInAt?: number;    // epoch ms — drives 7-day auto-signout
  createdAt: number;
}

Workspace {
  id: string;
  name: string;
  ownerProfileId: string;
  createdAt: number;
  updatedAt: number;
  version: number;          // monotonic per workspace
  settings: { maxNoteLength: 80; defaultHelpExpiryHours: 72; /* ... */ };
}

CanvasObject {
  id: string;
  workspaceId: string;
  kind: 'rectangle' | 'circle' | 'arrow' | 'connector' | 'pen' | 'note';
  x: number; y: number; w: number; h: number; rotation: number;
  style: { stroke: string; fill: string; strokeWidth: number; };
  text?: string;            // notes: ≤ 80 chars, enforced at write-time
  points?: Point[];         // freehand pen
  connectorFrom?: string;   // objectId endpoints for connector/arrow
  connectorTo?: string;
  version: number;
  lastEditedBy: string;     // tabId
  updatedAt: number;
}

CommentThread {
  id: string;
  targetId: string;         // canvas object or note id
  workspaceId: string;
  replies: Reply[];         // ≤ 50
  version: number;
}

Reply {
  id: string;
  authorProfileId: string;
  body: string;
  mentions: string[];       // profileIds
  createdAt: number;
}

ChatMessage {
  id: string;
  workspaceId: string;
  authorProfileId?: string; // undefined for system messages
  kind: 'user' | 'system';
  body: string;
  createdAt: number;
}

MutualHelpPost {
  id: string;
  workspaceId: string;
  authorProfileId: string;
  type: 'request' | 'offer';
  category: string; tags: string[];
  timeWindow?: { start: number; end: number };
  budget?: { amount: number; currency: string };
  urgency: 'low' | 'med' | 'high';
  attachments: AttachmentRef[];
  status: 'draft' | 'active' | 'expired' | 'withdrawn';
  pinned: boolean;
  createdAt: number;
  expiresAt: number;        // default createdAt + 72h
  version: number;
}

AttachmentBlob {
  id: string;
  mime: string;
  sizeBytes: number;        // ≤ 20_000_000
  blob: Blob;
}

Snapshot {
  workspaceId: string;
  seq: number;              // 1..200 ring buffer
  takenAt: number;
  kind: 'checkpoint' | 'patch';
  payload: unknown;         // full doc or RFC 6902 patch
}

TelemetryEvent {
  id: string;
  workspaceId: string;
  profileId?: string;
  kind: 'view' | 'click' | 'create' | 'edit' | 'delete' | 'import' | 'export';
  target: string;           // e.g. 'note', 'comment', 'chat'
  at: number;
  rolledUp: boolean;        // consumed by daily warehouse rollup
}

WarehouseDaily {
  date: string;             // YYYY-MM-DD
  workspaceId: string;
  metrics: Record<string, number>;
}
```

---

## 5. Storage Strategy

### 5.1 IndexedDB (via `idb`)

Database: `secureroom`, version bumped on schema change.

| Store            | Key            | Indices                               |
|------------------|----------------|----------------------------------------|
| `profiles`       | `id`           | `by_username` (unique)                 |
| `workspaces`     | `id`           | `by_name`, `by_owner`                  |
| `canvas_objects` | `id`           | `by_workspace`                         |
| `comments`       | `id`           | `by_workspace`, `by_target`            |
| `chat`           | `id`           | `by_workspace` + `createdAt`           |
| `mutual_help`    | `id`           | `by_workspace`, `by_status`            |
| `attachments`    | `id`           | —                                      |
| `snapshots`      | `[wsId, seq]`  | `by_workspace`                         |
| `events`         | `id`           | `by_workspace`, `by_rolledUp`          |
| `warehouse_daily`| `[date, wsId]` | `by_workspace`                         |
| `kv`             | `key`          | generic key/value for small metadata   |

### 5.2 LocalStorage

Small, synchronous prefs only:
`theme`, `lastOpenedWorkspaceId`, `activeProfileId`, `personaRole`, `privacyMaskingEnabled`, `lastImportMapping_<workspaceId>`.

### 5.3 File API / File System Access API

Used exclusively for workspace package transfer (≤ 200 MB). Packages are structured ZIPs with a `manifest.json`, per-store JSON arrays, and a `blobs/` directory.

---

## 6. State Management

Each domain area exposes an RxJS store built on `BehaviorSubject<State>` with:

- `state$: Observable<T>` — hot, replayable.
- `select<U>(fn): Observable<U>` — memoised via `distinctUntilChanged`.
- `dispatch(action)` — reducer-style mutation that also writes through to IndexedDB and, for shared entities, broadcasts an `edit` event over `BroadcastChannel`.

Cross-store derivations (e.g., inbox badge count = unread @mentions + new comment notifications) use plain `combineLatest` pipelines inside presentational services.

---

## 7. Cross-Tab Collaboration

### 7.1 Tab Identity

On boot, each tab generates a `tabId` (uuid), picks a stable colour from a 12-slot palette, and registers its presence. The PresenceService heartbeats every 3 s; tabs missing 2 heartbeats are treated as gone.

### 7.2 Message Envelope

```ts
type BroadcastEnvelope =
  | { kind: 'presence';  tabId; profileId; role; color; seq; at }
  | { kind: 'cursor';    tabId; workspaceId; x; y; at }
  | { kind: 'chat';      tabId; message: ChatMessage }
  | { kind: 'edit';      tabId; workspaceId; objectId; baseVersion; patch }
  | { kind: 'comment';   tabId; threadId; reply: Reply }
  | { kind: 'system';    tabId; text; at }
  | { kind: 'activity';  tabId; entry: ActivityEntry };
```

- Cursors are throttled to ~20 Hz (50 ms).
- Presence heartbeats are debounced to 3 s.
- `edit` / `chat` / `comment` are sent immediately with per-tab monotonic `seq`.

### 7.3 Conflict Resolution

Every mutable object carries a `version`. An edit broadcasts `{ objectId, baseVersion, patch }`. A receiver whose local `version > baseVersion` opens a Conflict Drawer with *Keep Mine / Accept Incoming / Merge Manually*. Resolution commits `version + 1` and rebroadcasts. Transient state (cursors, presence) is not versioned.

---

## 8. Auto-Save, Snapshots, and Rollback

- Auto-save tick every 10 s; writes only if the workspace is dirty.
- Snapshots stored as a 200-entry ring buffer per workspace.
- Every 20th snapshot is a **checkpoint** (full serialised doc); the other 19 are RFC 6902 patches against the prior snapshot.
- One-click rollback selects a snapshot, walks back to the nearest checkpoint, replays patches forward, and writes the result as the new head (also broadcasting a `system` message).

---

## 9. Canvas & Sticky Notes

- Renderer: HTML Canvas for shapes/pen; absolutely-positioned DOM elements for notes and text editing (cheaper hit-testing, better input handling).
- Shape toolbar: rectangle, circle, arrow, connector, freehand pen, sticky-note.
- Notes hard-capped at 80 characters at the input layer; server-side (store-side) re-validation rejects any patch that would exceed.
- Selection, multi-select (marquee), z-ordering, alignment guides, snap-to-grid.

---

## 10. Comments, Chat, Presence

- **Comments**: Drawer anchored to the selected object; thread shows up to 50 replies, then disables the composer. `@mention` picker filters the workspace roster; mentioning produces an Inbox item (badge + Toast).
- **Chat**: right-side panel, rolling window of last 500 messages (older pruned from the store but kept in IndexedDB for audit). Keyword search uses an in-memory inverted index rebuilt lazily. System messages are emitted for: profile sign-in, workspace open, bulk import, snapshot rollback, package export/import.
- **Presence**: avatar bar across the top, coloured cursors overlay, activity feed panel with timestamps and object links.

---

## 11. Mutual-Help Board

- Configurable form schema stored per workspace.
- Draft → Active → (Expired | Withdrawn). Pinning bypasses expiration.
- Lazy expiration sweeper runs on workspace open, board render, and every 60 s while the tab is visible.
- Attachments flow through the same `attachments` store with the 20 MB per-file cap.

---

## 12. Import / Export

### 12.1 CSV/JSON Note Import

Three-step modal: **Upload & parse** (Web Worker) → **Map columns** (persisted per workspace) → **Validate & preview** (row-level errors in a Table with downloadable CSV of rejects). Max 1,000 rows. Commit writes through a single IndexedDB transaction and emits a `bulk-import` system chat message.

### 12.2 Workspace Packages

ZIP layout:

```
manifest.json           { workspaceId, name, createdAt, appVersion, counts }
workspace.json          Workspace record
canvas.json             CanvasObject[]
comments.json           CommentThread[]
chat.json               ChatMessage[]
mutual_help.json        MutualHelpPost[]
snapshots.json          Snapshot[] (latest checkpoint chain)
blobs/<attachmentId>    raw files referenced by AttachmentRef
```

- Export prefers `showSaveFilePicker`; falls back to `<a download>` with a Blob URL.
- Import validates the manifest, checks the 200 MB size ceiling before writes, then on same-name collision opens the **Overwrite / Create Copy / Cancel** modal.

---

## 13. Telemetry, KPIs, and Daily Warehouse

- `TelemetryService.log(event)` appends to `events` store and posts `{ kind: 'event-appended', id }` to the Web Worker.
- Worker maintains a 10-minute in-memory sliding window for real-time metrics: *notes per minute*, *comment response time*, *unresolved Mutual-Help requests*, *active collaborators*.
- Worker posts `{ kind: 'kpi-update', metrics }` back to the main thread, which updates the dashboard and fires threshold Toasts.
- Daily rollup: on first open past local midnight (tracked via `kv.lastRollupDate`), the worker scans `events` where `rolledUp = false`, writes `warehouse_daily` rows, and marks events as rolled-up.

---

## 14. Auth & Local Safeguards

- Profiles list + Create Profile screen.
- Sign-in: fetch profile by username, derive PBKDF2 hash with stored salt, constant-time compare.
- On 3 consecutive failures: set `lockoutUntil = now + 15 min`; UI blocks attempts until then.
- Auto-signout: on app boot and on profile switch, if `now - lastSignInAt > 7 days`, force re-authentication.
- Persona role gates menu visibility via a `*hasCap` structural directive; explicitly documented as UX-only.

---

## 15. Service Worker & PWA

- Precaches the Angular build (hashed JS/CSS, fonts, icons, `index.html`).
- Cache-first for app shell; network-only (but there is no network) for app data.
- Web App Manifest enables install to Desktop/Home Screen.
- A visible "Offline ready ✓" indicator confirms precache completion.

---

## 16. Security & Privacy Posture

- No data leaves the browser. No third-party requests (Service Worker enforces this by returning `Response.error()` for unexpected origins in dev builds).
- Passwords stored only as PBKDF2 hashes with per-profile salts.
- Privacy masking toggle (LocalStorage pref) blurs author names and note content in presenter/screenshare mode.
- All sign-in/lockout behaviours are acknowledged as resettable via "clear browser data"; this is surfaced in the UI to avoid overpromising.

---

## 17. Performance Budget

| Surface                           | Budget                                        |
|-----------------------------------|-----------------------------------------------|
| First load (cached)               | < 1.5 s to interactive                        |
| Canvas frame                      | 60 fps with ≤ 2,000 objects                   |
| BroadcastChannel cursor rate      | ≤ 20 Hz per tab                               |
| IndexedDB write (auto-save)       | < 50 ms median                                |
| Web Worker KPI update             | ≤ 250 ms after event append                   |
| Package export (200 MB)           | streamed, < 8 s on local SSD                  |

---

## 18. Testing Strategy

- **Unit**: services, reducers, validators, expiration sweeper, conflict resolver.
- **Component**: canvas interactions, comment drawer, import wizard, chat search.
- **Integration**: multi-tab via Playwright with 4+ browser contexts sharing BroadcastChannel.
- **Property**: snapshot/patch round-trip (apply + reverse = identity).
- **Manual smoke**: package export → reimport → equality of all stores.
