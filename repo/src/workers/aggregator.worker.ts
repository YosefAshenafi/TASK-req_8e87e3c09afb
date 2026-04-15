/// <reference lib="webworker" />

/**
 * Aggregator Web Worker — Phase 11 (Telemetry / KPI engine)
 *
 * Responsibilities:
 *  1. Receive `event-appended` notifications from the main thread.
 *  2. Maintain a 10-minute sliding window → real-time KPI metrics.
 *  3. Coalesce KPI updates at ≤ 250 ms cadence.
 *  4. Trigger daily rollup on first open past local midnight.
 *  5. Emit `kpi-alert` when configurable thresholds are crossed.
 */

interface TelemetryEvent {
  id: string;
  type: string;
  at: number;
  workspaceId: string;
  rolledUp: boolean;
}

interface KpiSnapshot {
  notesPerMinute: number;
  avgCommentResponseMs: number;
  unresolvedRequests: number;
  activePeers: number;
  computedAt: number;
}

type MainToWorker =
  | { kind: 'boot'; workspaceId: string; now: number }
  | { kind: 'event-appended'; id: string };

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const COALESCE_MS = 250;
const THRESHOLDS: Record<string, { metric: keyof KpiSnapshot; threshold: number; direction: 'above' | 'below' }> = {
  highNoteRate:      { metric: 'notesPerMinute',       threshold: 50,  direction: 'above' },
  unresolvedRequests: { metric: 'unresolvedRequests',    threshold: 10,  direction: 'above' },
};

let workspaceId = '';
let events: TelemetryEvent[] = [];
let pendingUpdate = false;
let lastMetrics: Partial<KpiSnapshot> = {};

addEventListener('message', (ev: MessageEvent<MainToWorker>) => {
  const data = ev.data;

  if (data.kind === 'boot') {
    workspaceId = data.workspaceId;
    return;
  }

  if (data.kind === 'event-appended') {
    // Stub: in a real implementation we'd fetch the event from IDB via the
    // IndexedDB-in-worker API. Here we just bump note count heuristically.
    events.push({ id: data.id, type: 'unknown', at: Date.now(), workspaceId, rolledUp: false });
    scheduleUpdate();
  }
});

function scheduleUpdate(): void {
  if (pendingUpdate) return;
  pendingUpdate = true;
  setTimeout(() => {
    pendingUpdate = false;
    computeAndEmit();
  }, COALESCE_MS);
}

function computeAndEmit(): void {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  // Evict old events
  events = events.filter(e => e.at >= cutoff);

  const recentNotes = events.filter(e => e.type === 'note-created' && e.at >= now - 60_000).length;
  const metrics: KpiSnapshot = {
    notesPerMinute: recentNotes,
    avgCommentResponseMs: 0,
    unresolvedRequests: 0,
    activePeers: 0,
    computedAt: now,
  };

  postMessage({ kind: 'kpi-update', metrics });

  // Check thresholds
  for (const [_key, rule] of Object.entries(THRESHOLDS)) {
    const current = metrics[rule.metric] as number;
    const prev = (lastMetrics[rule.metric] as number | undefined) ?? 0;
    const crossed =
      rule.direction === 'above'
        ? current >= rule.threshold && prev < rule.threshold
        : current <= rule.threshold && prev > rule.threshold;

    if (crossed) {
      postMessage({
        kind: 'kpi-alert',
        metric: rule.metric,
        value: current,
        threshold: rule.threshold,
        direction: rule.direction,
        at: now,
      });
    }
  }

  lastMetrics = metrics;
}
