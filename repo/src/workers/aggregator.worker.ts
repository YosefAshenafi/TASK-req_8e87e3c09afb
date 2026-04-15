/// <reference lib="webworker" />

/**
 * Aggregator Web Worker — Phase 11 (Telemetry / KPI engine)
 *
 * Responsibilities:
 *  1. Receive `event-appended` notifications from the main thread.
 *  2. Maintain a sliding window → real-time KPI metrics.
 *  3. Coalesce KPI updates at ≤ 250 ms cadence.
 *  4. Trigger daily rollup on first open past local midnight.
 *  5. Emit `kpi-alert` when configurable thresholds are crossed.
 */

import { computeAvgCommentResponseMs, type KpiBufferEntry } from './kpi-compute';

interface KpiSnapshot {
  notesPerMinute: number;
  avgCommentResponseMs: number;
  unresolvedRequests: number;
  activePeers: number;
  computedAt: number;
}

/** Lightweight in-memory tuple stored in the ring buffer */
type BufferEntry = KpiBufferEntry;

type MainToWorker =
  | { kind: 'boot'; workspaceId: string; now: number }
  | { kind: 'event-appended'; id: string; type: string; workspaceId: string; profileId?: string; threadId?: string };

const RING_MAX = 5000;
const COALESCE_MS = 250;
const WINDOW_1_MIN = 60_000;
const WINDOW_5_MIN = 5 * 60_000;
const WINDOW_10_MIN = 10 * 60_000;

const NOTE_RATE_THRESHOLD = 20;

let currentWorkspaceId = '';
let ringBuffer: BufferEntry[] = [];
let pendingUpdate = false;
let lastMetrics: Partial<KpiSnapshot> = {};
/** Running tally for Option-B unresolved-request tracking (not evicted with ring buffer). */
let unresolvedCount = 0;

// ─── IDB helper ─────────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('secureroom', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Message handling ────────────────────────────────────────────────────────

addEventListener('message', (ev: MessageEvent<MainToWorker>) => {
  const data = ev.data;

  if (data.kind === 'boot') {
    currentWorkspaceId = data.workspaceId;
    checkYesterdayRollup().catch(err => console.error('[worker] boot rollup error', err));
    setTimeout(checkMidnight, msUntilMidnight());
    return;
  }

  if (data.kind === 'event-appended') {
    // Update running unresolved counter before pushing to ring buffer
    if (data.type === 'mutual-help-published') unresolvedCount++;
    else if (data.type === 'mutual-help-resolved') unresolvedCount = Math.max(0, unresolvedCount - 1);

    // Push to ring buffer, evict oldest if over capacity
    const entry: BufferEntry = {
      type: data.type,
      at: Date.now(),
      profileId: data.profileId,
      threadId: data.threadId,
    };
    ringBuffer.push(entry);
    if (ringBuffer.length > RING_MAX) {
      ringBuffer.shift();
    }
    scheduleUpdate();
  }
});

// ─── Midnight scheduler ──────────────────────────────────────────────────────

function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

function checkMidnight(): void {
  const yesterday = dateStrOffset(-1);
  doRollup(yesterday).catch(err => console.error('[worker] midnight rollup error', err));
  // Schedule next midnight check
  setTimeout(checkMidnight, msUntilMidnight());
}

async function checkYesterdayRollup(): Promise<void> {
  const yesterday = dateStrOffset(-1);
  try {
    const db = await openDb();
    const tx = db.transaction('warehouse_daily', 'readonly');
    const store = tx.objectStore('warehouse_daily');
    const key = IDBKeyRange.bound(
      [yesterday, currentWorkspaceId],
      [yesterday, currentWorkspaceId],
    );
    const existing = await idbRequest<unknown>(store.get(key));
    db.close();
    if (!existing) {
      await doRollup(yesterday);
    }
  } catch (err) {
    console.error('[worker] checkYesterdayRollup error', err);
  }
}

// ─── KPI computation ─────────────────────────────────────────────────────────

function scheduleUpdate(): void {
  if (pendingUpdate) return;
  pendingUpdate = true;
  setTimeout(() => {
    pendingUpdate = false;
    computeKpi();
  }, COALESCE_MS);
}

function computeKpi(): void {
  const now = Date.now();

  // Evict entries outside the largest window we care about (10 min)
  ringBuffer = ringBuffer.filter(e => e.at >= now - WINDOW_10_MIN);

  // notesPerMinute: note-created events in last 60 s
  const notesPerMinute = ringBuffer.filter(
    e => e.type === 'note-created' && e.at >= now - WINDOW_1_MIN,
  ).length;

  // avgCommentResponseMs: mean delta between comment-created and comment-reply pairs
  const avgCommentResponseMs = computeAvgCommentResponseMs(ringBuffer);

  // unresolvedRequests: running total of published minus resolved (not window-limited)
  const unresolvedRequests = unresolvedCount;

  // activePeers: distinct profileIds in last 5 min
  const recentProfiles = new Set<string>();
  for (const e of ringBuffer) {
    if (e.at >= now - WINDOW_5_MIN && e.profileId) {
      recentProfiles.add(e.profileId);
    }
  }
  const activePeers = recentProfiles.size;

  const metrics: KpiSnapshot = {
    notesPerMinute,
    avgCommentResponseMs,
    unresolvedRequests,
    activePeers,
    computedAt: now,
  };

  postMessage({ kind: 'kpi-update', metrics });

  // Threshold check: notesPerMinute >= 20 → alert 'highNoteRate'
  const prevNpm = (lastMetrics.notesPerMinute as number | undefined) ?? 0;
  if (notesPerMinute >= NOTE_RATE_THRESHOLD && prevNpm < NOTE_RATE_THRESHOLD) {
    postMessage({
      kind: 'kpi-alert',
      metric: 'highNoteRate',
      value: notesPerMinute,
      threshold: NOTE_RATE_THRESHOLD,
      direction: 'above',
      at: now,
    });
  }

  lastMetrics = metrics;
}

// ─── Daily rollup ─────────────────────────────────────────────────────────────

async function doRollup(dateStr: string): Promise<void> {
  try {
    const { startMs, endMs } = dayBounds(dateStr);

    const db = await openDb();
    const tx = db.transaction('events', 'readonly');
    const store = tx.objectStore('events');
    const allEvents = await idbRequest<IdbEvent[]>(store.getAll());
    db.close();

    // Filter to this workspace and date range in-memory (no at-based index)
    const dayEvents = allEvents.filter(
      e => e.workspaceId === currentWorkspaceId && e.at >= startMs && e.at < endMs,
    );

    let notesCreated = 0;
    let commentsAdded = 0;
    let chatMessagesSent = 0;
    let mutualHelpPublished = 0;
    const profileSet = new Set<string>();

    for (const e of dayEvents) {
      switch (e.type) {
        case 'note-created':        notesCreated++;         break;
        case 'comment-added':       commentsAdded++;        break;
        case 'chat-sent':           chatMessagesSent++;     break;
        case 'mutual-help-published': mutualHelpPublished++; break;
      }
      const p = e.payload as Record<string, unknown> | undefined;
      if (p?.['profileId']) profileSet.add(p['profileId'] as string);
    }

    const summary = {
      date: dateStr,
      workspaceId: currentWorkspaceId,
      notesCreated,
      commentsAdded,
      chatMessagesSent,
      mutualHelpPublished,
      activeProfiles: Array.from(profileSet),
      computedAt: Date.now(),
    };

    const db2 = await openDb();
    const tx2 = db2.transaction('warehouse_daily', 'readwrite');
    await idbRequest(tx2.objectStore('warehouse_daily').put(summary));
    db2.close();

    postMessage({ kind: 'rollup-complete', date: dateStr });
  } catch (err) {
    console.error('[worker] doRollup error', err);
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Promisify a single IDBRequest */
function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Return the ISO date string for today + offsetDays */
function dateStrOffset(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Return start/end unix-ms for a local calendar date string (YYYY-MM-DD) */
function dayBounds(dateStr: string): { startMs: number; endMs: number } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

// ─── IDB event shape (subset used here) ──────────────────────────────────────

interface IdbEvent {
  id: string;
  workspaceId: string;
  type: string;
  at: number;
  rolledUp: boolean;
  payload?: Record<string, unknown>;
}
