import { describe, it, expect, beforeEach, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeContext } from './helpers';
import { TelemetryService } from '../src/app/telemetry/telemetry.service';
import { KpiService } from '../src/app/kpi/kpi.service';
import { ToastService } from '../src/app/core/toast.service';
import { computeAvgCommentResponseMs, computeUnresolvedFromEvents } from '../src/workers/kpi-compute';
import type { KpiBufferEntry } from '../src/workers/kpi-compute';

describe('KpiService', () => {
  let ctx: ReturnType<typeof makeContext>;
  let telemetry: TelemetryService;
  let kpi: KpiService;

  beforeEach(() => {
    ctx = makeContext();
    telemetry = new TelemetryService(ctx.db);
    kpi = new KpiService(ctx.db, telemetry);
  });

  // ── metrics$ ──────────────────────────────────────────────────────────────

  describe('metrics$', () => {
    it('emits default snapshot initially', async () => {
      const metrics = await firstValueFrom(kpi.metrics$);
      expect(metrics.notesPerMinute).toBe(0);
      expect(metrics.avgCommentResponseMs).toBe(0);
      expect(metrics.unresolvedRequests).toBe(0);
      expect(metrics.activePeers).toBe(0);
      expect(metrics.computedAt).toBe(0);
    });
  });

  // ── alerts$ ───────────────────────────────────────────────────────────────

  describe('alerts$', () => {
    it('emits empty alerts initially', async () => {
      const alerts = await firstValueFrom(kpi.alerts$);
      expect(alerts).toEqual([]);
    });
  });

  // ── dailyReport ───────────────────────────────────────────────────────────

  describe('dailyReport()', () => {
    it('returns empty array when no data exists', async () => {
      const report = await kpi.dailyReport({ from: '2026-01-01', to: '2026-12-31' });
      expect(report).toEqual([]);
    });

    it('returns rows within the date range', async () => {
      const idb = await ctx.db.open();
      await idb.put('warehouse_daily', {
        date: '2026-03-15',
        workspaceId: 'ws-1',
        notesCreated: 5,
        commentsAdded: 2,
        chatMessagesSent: 10,
        mutualHelpPublished: 1,
        activeProfiles: ['profile-1'],
        computedAt: Date.now(),
      });

      const report = await kpi.dailyReport({ from: '2026-03-01', to: '2026-03-31' });
      expect(report).toHaveLength(1);
      expect(report[0].date).toBe('2026-03-15');
      expect(report[0].notesCreated).toBe(5);
    });

    it('excludes rows outside the date range', async () => {
      const idb = await ctx.db.open();
      await idb.put('warehouse_daily', {
        date: '2025-12-31',
        workspaceId: 'ws-1',
        notesCreated: 3,
        commentsAdded: 0,
        chatMessagesSent: 0,
        mutualHelpPublished: 0,
        activeProfiles: [],
        computedAt: Date.now(),
      });

      const report = await kpi.dailyReport({ from: '2026-01-01', to: '2026-12-31' });
      expect(report).toHaveLength(0);
    });

    it('returns multiple rows within range', async () => {
      const idb = await ctx.db.open();
      const dates = ['2026-04-01', '2026-04-02', '2026-04-03'];
      for (const date of dates) {
        await idb.put('warehouse_daily', {
          date,
          workspaceId: 'ws-1',
          notesCreated: 1,
          commentsAdded: 0,
          chatMessagesSent: 0,
          mutualHelpPublished: 0,
          activeProfiles: [],
          computedAt: Date.now(),
        });
      }

      const report = await kpi.dailyReport({ from: '2026-04-01', to: '2026-04-03' });
      expect(report).toHaveLength(3);
    });

    it('returns boundary dates inclusively', async () => {
      const idb = await ctx.db.open();
      await idb.put('warehouse_daily', {
        date: '2026-04-01',
        workspaceId: 'ws-1',
        notesCreated: 1,
        commentsAdded: 0,
        chatMessagesSent: 0,
        mutualHelpPublished: 0,
        activeProfiles: [],
        computedAt: Date.now(),
      });

      const report = await kpi.dailyReport({ from: '2026-04-01', to: '2026-04-01' });
      expect(report).toHaveLength(1);
    });
  });

  // ── KPI metric semantics (H-01) ───────────────────────────────────────────

  describe('KPI metric semantics', () => {
    it('avgCommentResponseMs: returns mean delta for comment-created → comment-reply pairs', () => {
      const now = Date.now();
      const buffer: KpiBufferEntry[] = [
        { type: 'comment-created', at: now - 5000, threadId: 't1' },
        { type: 'comment-reply',   at: now,         threadId: 't1' },
      ];
      expect(computeAvgCommentResponseMs(buffer)).toBeCloseTo(5000, 0);
      // No pairs → 0
      expect(computeAvgCommentResponseMs([])).toBe(0);
    });

    it('unresolvedRequests: counts mutual-help-published minus mutual-help-resolved', () => {
      const events = [
        { type: 'mutual-help-published' },
        { type: 'mutual-help-published' },
        { type: 'mutual-help-published' },
        { type: 'mutual-help-resolved' },
      ];
      expect(computeUnresolvedFromEvents(events)).toBe(2);
    });

    it('avgCommentResponseMs: 10-minute window filter excludes stale pairs', () => {
      const now = Date.now();
      const WINDOW_10_MIN = 10 * 60_000;

      const allEntries: KpiBufferEntry[] = [
        // Outside window — should be excluded after worker eviction
        { type: 'comment-created', at: now - WINDOW_10_MIN - 5000, threadId: 'old-t' },
        { type: 'comment-reply',   at: now - WINDOW_10_MIN - 1000, threadId: 'old-t' },
        // Inside window
        { type: 'comment-created', at: now - 3000, threadId: 'new-t' },
        { type: 'comment-reply',   at: now,        threadId: 'new-t' },
      ];

      // Without filter: both pairs contribute — avg = (4000 + 3000) / 2 = 3500
      expect(computeAvgCommentResponseMs(allEntries)).toBeCloseTo(3500, 0);

      // Apply the same filter the worker applies before calling the function
      const windowed = allEntries.filter(e => e.at >= now - WINDOW_10_MIN);
      // Only the recent pair remains — avg = 3000
      expect(computeAvgCommentResponseMs(windowed)).toBeCloseTo(3000, 0);
    });

    it('unresolvedRequests: floors at 0 — never goes negative', () => {
      const events = [
        { type: 'mutual-help-resolved' }, // resolved with no prior publish
      ];
      expect(computeUnresolvedFromEvents(events)).toBe(0);
    });
  });

  // ── F-H05: reactive worker binding + toast routing ────────────────────────

  describe('worker binding (F-H05)', () => {
    it('binds onmessage after telemetry.boot() and forwards kpi-update to metrics$', async () => {
      const toast = new ToastService();
      const kpi2 = new KpiService(ctx.db, telemetry, toast);

      telemetry.boot('ws-kpi');
      // The FakeWorker exposed through telemetry.workerMessages$ lets us
      // simulate an inbound message by invoking its onmessage handler.
      const worker = telemetry.workerMessages$!;
      expect(typeof worker.onmessage).toBe('function');

      const snapshot = {
        notesPerMinute: 7,
        avgCommentResponseMs: 120,
        unresolvedRequests: 2,
        activePeers: 3,
        computedAt: 0,
      };
      worker.onmessage!(new MessageEvent('message', {
        data: { kind: 'kpi-update', metrics: snapshot },
      }));

      const metrics = await firstValueFrom(kpi2.metrics$);
      expect(metrics.notesPerMinute).toBe(7);
      expect(metrics.activePeers).toBe(3);

      telemetry.terminate();
    });

    it('routes kpi-alert messages through ToastService (F-H05)', async () => {
      const toast = new ToastService();
      const showSpy = vi.spyOn(toast, 'show');
      const kpi2 = new KpiService(ctx.db, telemetry, toast);

      telemetry.boot('ws-kpi');
      const worker = telemetry.workerMessages$!;

      worker.onmessage!(new MessageEvent('message', {
        data: {
          kind: 'kpi-alert',
          metric: 'notesPerMinute',
          value: 12,
          threshold: 10,
          direction: 'above',
        },
      }));

      expect(showSpy).toHaveBeenCalled();
      const call = showSpy.mock.calls[0];
      expect(String(call[0])).toContain('KPI alert');
      expect(call[1]).toBe('warning');

      const alerts = await firstValueFrom(kpi2.alerts$);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].metric).toBe('notesPerMinute');

      telemetry.terminate();
    });

    it('rebinds when a new worker boots (late subscribers)', async () => {
      const toast = new ToastService();
      const kpi2 = new KpiService(ctx.db, telemetry, toast);

      // First boot
      telemetry.boot('ws-a');
      const w1 = telemetry.workerMessages$!;
      expect(typeof w1.onmessage).toBe('function');
      telemetry.terminate();

      // Second boot — a fresh worker should get its onmessage wired too.
      telemetry.boot('ws-b');
      const w2 = telemetry.workerMessages$!;
      expect(typeof w2.onmessage).toBe('function');
      expect(w2).not.toBe(w1);

      // Confirm alerts still surface through toast on the new worker.
      const showSpy = vi.spyOn(toast, 'show');
      w2.onmessage!(new MessageEvent('message', {
        data: {
          kind: 'kpi-alert',
          metric: 'activePeers',
          value: 0,
          threshold: 1,
          direction: 'below',
        },
      }));
      expect(showSpy).toHaveBeenCalled();

      // Avoid unused-variable lint on kpi2.
      expect(await firstValueFrom(kpi2.metrics$)).toBeTruthy();
      telemetry.terminate();
    });
  });
});
