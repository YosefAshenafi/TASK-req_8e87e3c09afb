# SecureRoom Brainstorm Studio — API Specification

> **Context.** SecureRoom is a fully offline browser application with **no network or server APIs**. This document therefore specifies the *internal* contracts that make the app work: Angular service interfaces, the IndexedDB schema, `BroadcastChannel` message protocol, Web Worker / main-thread protocol, Service Worker lifecycle, and the on-disk format for CSV/JSON imports and workspace packages.
>
> All types are TypeScript. Error behaviour is described per operation.

---

## 1. Conventions

- **IDs** are `string` UUIDv4 unless otherwise noted.
- **Timestamps** are `number` = milliseconds since Unix epoch (local clock).
- **Versioning**: mutable entities carry `version: number`, monotonically incremented on each successful write.
- **Errors**: services throw typed errors; stores surface them via `error$: Observable<AppError>`.

```ts
type AppError =
  | { code: 'NotFound';       detail: string }
  | { code: 'Validation';     detail: string; field?: string }
  | { code: 'VersionConflict';objectId: string; local: number; incoming: number }
  | { code: 'LockedOut';      until: number }
  | { code: 'QuotaExceeded';  sizeBytes: number; limitBytes: number }
  | { code: 'NotSupported';   feature: string };
```

---

## 2. Angular Service APIs

### 2.1 `AuthService`

```ts
interface AuthService {
  listProfiles(): Promise<ProfileSummary[]>;

  createProfile(input: {
    username: string;
    password: string;
    role: 'Admin' | 'Academic Affairs' | 'Teacher';
  }): Promise<Profile>;
  // Validation: username unique, password ≥ 8 chars.

  signIn(username: string, password: string): Promise<SignInResult>;
  // Emits: LockedOut when lockoutUntil > now
  //        Validation('password') on mismatch (increments failedAttempts)
  //        On success: resets failedAttempts, sets lastSignInAt = now.

  signOut(): Promise<void>;

  currentProfile$: Observable<Profile | null>;

  /** Fired on app boot; signs out stale profiles (lastSignInAt older than 7d). */
  enforceAutoSignOut(): Promise<void>;
}

type SignInResult =
  | { ok: true;  profile: Profile }
  | { ok: false; reason: 'BadCredentials'; attemptsRemaining: number }
  | { ok: false; reason: 'LockedOut'; until: number };
```

### 2.2 `WorkspaceService`

```ts
interface WorkspaceService {
  list(): Promise<WorkspaceSummary[]>;
  create(name: string): Promise<Workspace>;
  open(id: string): Promise<void>;           // emits on active$
  rename(id: string, name: string): Promise<void>;
  delete(id: string): Promise<void>;

  active$: Observable<Workspace | null>;
}
```

### 2.3 `CanvasService`

```ts
interface CanvasService {
  objects$: Observable<CanvasObject[]>;

  addObject(partial: Omit<CanvasObject, 'id' | 'version' | 'updatedAt' | 'lastEditedBy'>):
    Promise<CanvasObject>;

  patchObject(id: string, patch: Partial<CanvasObject>, baseVersion: number):
    Promise<CanvasObject>;
  // Emits VersionConflict if local.version !== baseVersion.

  deleteObject(id: string, baseVersion: number): Promise<void>;

  /** Sticky note text — hard-enforced ≤ 80 chars. */
  setNoteText(id: string, text: string, baseVersion: number): Promise<CanvasObject>;
  // Emits Validation('text') if text.length > 80.
}
```

### 2.4 `CommentService`

```ts
interface CommentService {
  threadsByTarget$(targetId: string): Observable<CommentThread | null>;

  openOrCreateThread(targetId: string): Promise<CommentThread>;

  reply(threadId: string, body: string, mentions: string[]): Promise<Reply>;
  // Emits Validation('replies') if existing replies.length >= 50.

  markThreadRead(threadId: string, profileId: string): Promise<void>;

  inbox$: Observable<InboxItem[]>;   // @mentions + thread updates
  unreadCount$: Observable<number>;  // drives badge
}
```

### 2.5 `ChatService`

```ts
interface ChatService {
  messages$: Observable<ChatMessage[]>;       // rolling 500

  send(body: string): Promise<ChatMessage>;
  postSystem(body: string): Promise<ChatMessage>;

  search(query: string): Promise<ChatMessage[]>;  // keyword, ranks by recency
}
```

### 2.6 `PresenceService`

```ts
interface PresenceService {
  tabId: string;               // assigned on boot
  color: string;               // from 12-slot palette

  peers$: Observable<PeerPresence[]>;
  cursors$: Observable<CursorPosition[]>;
  activity$: Observable<ActivityEntry[]>;  // most recent 200

  broadcastCursor(x: number, y: number): void;   // throttled 50 ms
  recordActivity(entry: Omit<ActivityEntry, 'at'>): void;
}
```

### 2.7 `MutualHelpService`

```ts
interface MutualHelpService {
  posts$: Observable<MutualHelpPost[]>;

  createDraft(input: NewPostInput): Promise<MutualHelpPost>;
  publish(postId: string): Promise<MutualHelpPost>;     // status: draft → active
  edit(postId: string, patch: Partial<MutualHelpPost>, baseVersion: number):
    Promise<MutualHelpPost>;
  withdraw(postId: string): Promise<void>;
  pin(postId: string, pinned: boolean): Promise<void>;

  /** Invoked by the expiration sweeper (open, render, 60s tick). */
  sweepExpired(): Promise<number>;                      // returns count expired
}
```

### 2.8 `SnapshotService`

```ts
interface SnapshotService {
  /** Auto-save tick — no-op if workspace is not dirty. */
  tick(): Promise<void>;

  listSnapshots(workspaceId: string): Promise<SnapshotSummary[]>;  // ≤ 200

  rollbackTo(workspaceId: string, seq: number): Promise<void>;
  // Walks back to nearest checkpoint, replays patches, writes new head,
  // posts a system chat message.
}
```

### 2.9 `TelemetryService`

```ts
interface TelemetryService {
  log(event: Omit<TelemetryEvent, 'id' | 'at' | 'rolledUp'>): void;  // fire-and-forget
}
```

### 2.10 `KpiService`

```ts
interface KpiService {
  metrics$: Observable<KpiSnapshot>;
  alerts$: Observable<KpiAlert>;    // threshold crossings → Toasts
  dailyReport(dateRange: { from: string; to: string }): Promise<WarehouseDaily[]>;
}

interface KpiSnapshot {
  notesPerMinute: number;
  avgCommentResponseMs: number;
  unresolvedRequests: number;
  activePeers: number;
  computedAt: number;
}
```

### 2.11 `PackageService`

```ts
interface PackageService {
  export(workspaceId: string): Promise<ExportResult>;
  // Tries File System Access API; falls back to Blob download.
  // Emits QuotaExceeded if assembled package > 200 MB.

  import(file: File): Promise<ImportOutcome>;
  // Validates manifest, checks size, resolves same-name collision via prompt.
}

type ImportOutcome =
  | { ok: true;  workspaceId: string; action: 'created' | 'overwritten' | 'copied' }
  | { ok: false; reason: 'BadManifest' | 'TooLarge' | 'Cancelled' | 'Unsupported'; detail?: string };
```

### 2.12 `PrefsService`

```ts
interface PrefsService {
  get<K extends keyof Prefs>(key: K): Prefs[K] | undefined;
  set<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
  changes$: Observable<Partial<Prefs>>;
}

interface Prefs {
  theme: 'light' | 'dark' | 'system';
  lastOpenedWorkspaceId?: string;
  activeProfileId?: string;
  personaRole?: 'Admin' | 'Academic Affairs' | 'Teacher';
  privacyMaskingEnabled: boolean;
  lastImportMapping?: Record<string /* workspaceId */, ColumnMapping>;
}
```

---

## 3. IndexedDB Schema

Database: **`secureroom`** — opened by the `DbService` wrapper around [`idb`](https://github.com/jakearchibald/idb). Schema version is bumped on every store/index change; the `upgrade` callback handles forward migrations only (offline app; no rollback).

| Store              | KeyPath              | Indices                                                  | Notes                                       |
|--------------------|----------------------|----------------------------------------------------------|---------------------------------------------|
| `profiles`         | `id`                 | `by_username` (unique) on `username`                     |                                             |
| `workspaces`       | `id`                 | `by_name`, `by_owner` on `ownerProfileId`                |                                             |
| `canvas_objects`   | `id`                 | `by_workspace` on `workspaceId`                          |                                             |
| `comments`         | `id`                 | `by_workspace`, `by_target` on `targetId`                |                                             |
| `chat`             | `id`                 | `by_workspace_createdAt` on `[workspaceId, createdAt]`   | Range-scan for panel & search.              |
| `mutual_help`      | `id`                 | `by_workspace`, `by_status` on `status`                  |                                             |
| `attachments`      | `id`                 | —                                                        | `blob` field is a `Blob`. 20 MB per record. |
| `snapshots`        | `[workspaceId, seq]` | `by_workspace` on `workspaceId`                          | Ring buffer of 200; every 20th is full.     |
| `events`           | `id`                 | `by_workspace`, `by_rolledUp` on `rolledUp`              | Consumed by Web Worker.                     |
| `warehouse_daily`  | `[date, workspaceId]`| `by_workspace`                                           | One row per metric-day.                     |
| `kv`               | `key`                | —                                                        | `lastRollupDate`, schema version, etc.      |

All multi-write operations (bulk import, rollback, package import) run inside a **single versionchange or readwrite transaction** to preserve atomicity.

---

## 4. BroadcastChannel Protocol

Channel name: **`secureroom-workspace-${workspaceId}`** (one per open workspace).

### 4.1 Envelope

```ts
type BroadcastEnvelope =
  | PresenceMsg | CursorMsg | ChatMsg | EditMsg
  | CommentMsg | SystemMsg  | ActivityMsg;

interface BaseMsg {
  tabId: string;
  seq: number;          // monotonic per tab, per kind
  at: number;           // epoch ms, sender's clock
}

interface PresenceMsg extends BaseMsg {
  kind: 'presence';
  profileId: string;
  role: PersonaRole;
  color: string;
  status: 'online' | 'away' | 'leaving';
}

interface CursorMsg extends BaseMsg {
  kind: 'cursor';
  x: number; y: number;
}

interface ChatMsg extends BaseMsg {
  kind: 'chat';
  message: ChatMessage;
}

interface EditMsg extends BaseMsg {
  kind: 'edit';
  objectId: string;
  baseVersion: number;
  patch: JsonPatch;     // RFC 6902
}

interface CommentMsg extends BaseMsg {
  kind: 'comment';
  threadId: string;
  reply: Reply;
}

interface SystemMsg extends BaseMsg {
  kind: 'system';
  text: string;
}

interface ActivityMsg extends BaseMsg {
  kind: 'activity';
  entry: ActivityEntry;
}
```

### 4.2 Rate & Ordering Rules

| Kind        | Rate                           | Durable store? | Conflict handling                 |
|-------------|--------------------------------|----------------|-----------------------------------|
| `presence`  | heartbeat 3 s (debounced)      | No             | Last write wins.                  |
| `cursor`    | throttled 50 ms (~20 Hz)       | No             | Ignored if older than local.      |
| `chat`      | immediate                      | Yes            | Append-only; no conflicts.        |
| `edit`      | immediate                      | Yes            | Version-counter conflict prompt.  |
| `comment`   | immediate                      | Yes            | Thread cap 50 enforced server-side (store-side). |
| `system`    | immediate                      | Yes            | Append-only.                      |
| `activity`  | immediate, capped 200 in UI    | Partial        | Append-only.                      |

### 4.3 Peer Liveness

A tab is considered *offline* after missing **2 consecutive** presence heartbeats (≥ 6 s). On offline detection, its cursor is removed and a `system` message is posted: *"Tab #X disconnected."*

---

## 5. Web Worker Protocol

Worker entrypoint: `/assets/workers/aggregator.worker.js`. All messages are JSON-serialisable.

### 5.1 Main → Worker

```ts
type MainToWorker =
  | { kind: 'boot'; workspaceId: string; now: number }
  | { kind: 'event-appended'; id: string }
  | { kind: 'request-kpi-snapshot' }
  | { kind: 'request-daily-rollup'; forceDate?: string /* YYYY-MM-DD */ }
  | { kind: 'request-report'; from: string; to: string };
```

### 5.2 Worker → Main

```ts
type WorkerToMain =
  | { kind: 'kpi-update'; metrics: KpiSnapshot }
  | { kind: 'kpi-alert'; alert: KpiAlert }
  | { kind: 'rollup-complete'; date: string; rowsWritten: number }
  | { kind: 'report'; rows: WarehouseDaily[] }
  | { kind: 'error'; error: AppError };
```

### 5.3 Guarantees

- `event-appended` notifications are idempotent: the worker de-dups by event `id` before aggregation.
- Daily rollup is performed **once per local date** (guarded by `kv.lastRollupDate`) and marks events as `rolledUp = true` so they are never double-counted.
- KPI snapshots are posted at most every 250 ms (coalesced from bursts).

---

## 6. Service Worker Lifecycle

File: `/sw.js`. Registered by `PlatformService` on app bootstrap.

| Event      | Behaviour                                                                          |
|------------|------------------------------------------------------------------------------------|
| `install`  | Pre-caches the app shell: `index.html`, hashed JS/CSS, fonts, icons, manifest.     |
| `activate` | Deletes caches whose version prefix differs from the current build hash.           |
| `fetch`    | Cache-first for precached assets; `Response.error()` for unknown origins.          |
| `message`  | Accepts `{ kind: 'skip-waiting' }` to force update on user confirmation.           |

The Web App Manifest declares `display: standalone`, `start_url: "/"`, theme/background colours, and the icon set, enabling Desktop/Home-Screen install.

---

## 7. File Formats

### 7.1 CSV / JSON Note Import

Accepted files:

- **CSV**: UTF-8, RFC 4180; header row required.
- **JSON**: array of objects, or `{ notes: object[] }`.

Canonical target schema (filled via the Column-Mapping Modal):

```ts
interface NoteImportRow {
  text: string;       // required, 1..80 chars (post-trim)
  color?: string;     // CSS color; defaults to workspace palette
  tags?: string[];    // comma-separated in CSV, array in JSON
  author?: string;    // username (resolved to profileId; unresolved → null)
}
```

Rejection reasons (per row, surfaced in the error Table):

- `text-missing`, `text-too-long`, `unknown-author`, `invalid-color`, `tag-not-allowed`.

Import limit: **1,000 rows** per file. Files exceeding this are rejected outright before mapping.

### 7.2 Workspace Package (`.srbs.zip`)

ZIP (store or deflate) with the following layout:

```
/manifest.json
/workspace.json
/canvas.json
/comments.json
/chat.json
/mutual_help.json
/snapshots.json
/events.json            (optional; included only if "includeTelemetry" was chosen)
/blobs/<attachmentId>   (one file per attachment, original MIME preserved)
```

`manifest.json`:

```jsonc
{
  "appVersion": "1.0.0",
  "schemaVersion": 3,
  "workspaceId": "…uuid…",
  "name": "Q2 Product Brainstorm",
  "exportedAt": 1712000000000,
  "exportedBy": "…profileId…",
  "counts": {
    "canvasObjects": 412,
    "comments": 33,
    "chat": 218,
    "mutualHelp": 7,
    "snapshots": 200,
    "attachments": 12
  },
  "totalSizeBytes": 157286400
}
```

Constraints:

- Total package ≤ **200 MB**.
- Per-attachment ≤ **20 MB**.
- On import, if `schemaVersion` > current, refuse with `NotSupported`.
- On same-`name` collision, the import modal prompts **Overwrite / Create Copy / Cancel**.

---

## 8. Error Codes (Summary)

| Code              | Raised by                                                  | User-facing behaviour                       |
|-------------------|-----------------------------------------------------------|---------------------------------------------|
| `NotFound`        | Any service on missing entity.                            | Toast: "Item not found."                    |
| `Validation`      | Input validators (note length, form fields, CSV rows).    | Inline form error or row-level error Table. |
| `VersionConflict` | `CanvasService`, `CommentService`, `MutualHelpService`.   | Conflict Drawer.                            |
| `LockedOut`       | `AuthService.signIn`.                                     | Lockout banner with countdown.              |
| `QuotaExceeded`   | Attachment writes, package export.                        | Toast: "File too large."                    |
| `NotSupported`    | Feature-detect failures (FS Access, schema version).      | Toast explaining fallback or blocking.      |

---

## 9. Versioning & Migration

- **IndexedDB schema** is integer-versioned; `upgrade(db, oldVersion, newVersion)` applies additive transforms only. Any destructive migration runs only after an explicit user confirmation.
- **Package `schemaVersion`** is declared in each exported `manifest.json`; import supports *current* and one version behind, and refuses to import anything newer.
- **App version** is embedded at build time and surfaced via `kv.appVersion`; the Service Worker's activation step uses it as its cache-key prefix.
