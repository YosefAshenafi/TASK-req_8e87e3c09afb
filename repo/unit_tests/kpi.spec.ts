import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeContext } from './helpers';
import { TelemetryService } from '../src/app/telemetry/telemetry.service';
import { KpiService } from '../src/app/kpi/kpi.service';

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
});
