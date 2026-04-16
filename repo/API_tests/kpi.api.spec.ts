/**
 * KPI API TESTS
 * Full integration tests for KpiService.dailyReport() with real IndexedDB data.
 * Tests the complete data pipeline: seed warehouse_daily rows → query → verify.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeFullContext, signUp } from './helpers';
import type { FullContext } from './helpers';

describe('KpiService API — dailyReport() integration', () => {
  let ctx: FullContext;

  beforeEach(async () => {
    ctx = makeFullContext();
    await signUp(ctx.auth, 'reporter', 'reportpass1', 'Admin');
  });

  // ── Empty state ────────────────────────────────────────────────────────────

  it('returns empty array when warehouse is empty', async () => {
    const rows = await ctx.kpi.dailyReport({ from: '2026-01-01', to: '2026-12-31' });
    expect(rows).toEqual([]);
  });

  // ── Single row retrieval ───────────────────────────────────────────────────

  it('retrieves a single seeded row within range', async () => {
    const idb = await ctx.db.open();
    await idb.put('warehouse_daily', {
      date: '2026-04-10',
      workspaceId: 'ws-report-1',
      notesCreated: 8,
      commentsAdded: 3,
      chatMessagesSent: 25,
      mutualHelpPublished: 2,
      activeProfiles: ['p1', 'p2'],
      computedAt: Date.now(),
    });

    const rows = await ctx.kpi.dailyReport({ from: '2026-04-01', to: '2026-04-30' });
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2026-04-10');
    expect(rows[0].notesCreated).toBe(8);
    expect(rows[0].commentsAdded).toBe(3);
    expect(rows[0].chatMessagesSent).toBe(25);
    expect(rows[0].mutualHelpPublished).toBe(2);
  });

  // ── Multi-row retrieval ────────────────────────────────────────────────────

  it('retrieves multiple rows across the requested date range', async () => {
    const idb = await ctx.db.open();
    const rows = [
      { date: '2026-04-01', notesCreated: 1 },
      { date: '2026-04-05', notesCreated: 5 },
      { date: '2026-04-10', notesCreated: 10 },
      { date: '2026-04-15', notesCreated: 15 },
    ];
    for (const row of rows) {
      await idb.put('warehouse_daily', {
        ...row,
        workspaceId: 'ws-1',
        commentsAdded: 0,
        chatMessagesSent: 0,
        mutualHelpPublished: 0,
        activeProfiles: [],
        computedAt: Date.now(),
      });
    }

    const result = await ctx.kpi.dailyReport({ from: '2026-04-01', to: '2026-04-15' });
    expect(result).toHaveLength(4);
    const dates = result.map(r => r.date);
    expect(dates).toContain('2026-04-01');
    expect(dates).toContain('2026-04-15');
  });

  // ── Range exclusion ────────────────────────────────────────────────────────

  it('excludes rows strictly before the from date', async () => {
    const idb = await ctx.db.open();
    await idb.put('warehouse_daily', {
      date: '2025-12-31',
      workspaceId: 'ws-1',
      notesCreated: 99,
      commentsAdded: 0,
      chatMessagesSent: 0,
      mutualHelpPublished: 0,
      activeProfiles: [],
      computedAt: Date.now(),
    });

    const result = await ctx.kpi.dailyReport({ from: '2026-01-01', to: '2026-12-31' });
    expect(result.find(r => r.date === '2025-12-31')).toBeUndefined();
  });

  it('excludes rows strictly after the to date', async () => {
    const idb = await ctx.db.open();
    await idb.put('warehouse_daily', {
      date: '2027-01-01',
      workspaceId: 'ws-1',
      notesCreated: 42,
      commentsAdded: 0,
      chatMessagesSent: 0,
      mutualHelpPublished: 0,
      activeProfiles: [],
      computedAt: Date.now(),
    });

    const result = await ctx.kpi.dailyReport({ from: '2026-01-01', to: '2026-12-31' });
    expect(result.find(r => r.date === '2027-01-01')).toBeUndefined();
  });

  // ── Boundary inclusivity ───────────────────────────────────────────────────

  it('includes rows on the exact from and to boundary dates', async () => {
    const idb = await ctx.db.open();
    for (const date of ['2026-03-01', '2026-03-31']) {
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

    const result = await ctx.kpi.dailyReport({ from: '2026-03-01', to: '2026-03-31' });
    expect(result).toHaveLength(2);
    const dates = result.map(r => r.date);
    expect(dates).toContain('2026-03-01');
    expect(dates).toContain('2026-03-31');
  });

  // ── Multi-workspace data ───────────────────────────────────────────────────

  it('returns rows from multiple workspaces within the range', async () => {
    const idb = await ctx.db.open();
    await idb.put('warehouse_daily', {
      date: '2026-04-10',
      workspaceId: 'ws-alpha',
      notesCreated: 3,
      commentsAdded: 1,
      chatMessagesSent: 5,
      mutualHelpPublished: 0,
      activeProfiles: ['p1'],
      computedAt: Date.now(),
    });
    await idb.put('warehouse_daily', {
      date: '2026-04-11',
      workspaceId: 'ws-beta',
      notesCreated: 7,
      commentsAdded: 2,
      chatMessagesSent: 12,
      mutualHelpPublished: 1,
      activeProfiles: ['p2'],
      computedAt: Date.now(),
    });

    const result = await ctx.kpi.dailyReport({ from: '2026-04-01', to: '2026-04-30' });
    expect(result).toHaveLength(2);
    const wsIds = result.map(r => r.workspaceId);
    expect(wsIds).toContain('ws-alpha');
    expect(wsIds).toContain('ws-beta');
  });

  // ── Single-day range ──────────────────────────────────────────────────────

  it('handles a single-day range correctly', async () => {
    const idb = await ctx.db.open();
    await idb.put('warehouse_daily', {
      date: '2026-05-20',
      workspaceId: 'ws-1',
      notesCreated: 1,
      commentsAdded: 0,
      chatMessagesSent: 0,
      mutualHelpPublished: 0,
      activeProfiles: [],
      computedAt: Date.now(),
    });

    const result = await ctx.kpi.dailyReport({ from: '2026-05-20', to: '2026-05-20' });
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-05-20');
  });

  // ── metrics$ and alerts$ initial state ────────────────────────────────────

  it('metrics$ emits default zeroed snapshot initially', async () => {
    const metrics = await firstValueFrom(ctx.kpi.metrics$);
    expect(metrics.notesPerMinute).toBe(0);
    expect(metrics.avgCommentResponseMs).toBe(0);
    expect(metrics.unresolvedRequests).toBe(0);
    expect(metrics.activePeers).toBe(0);
  });

  it('alerts$ emits empty array initially', async () => {
    const alerts = await firstValueFrom(ctx.kpi.alerts$);
    expect(alerts).toEqual([]);
  });
});
