/**
 * ReportPage — logic unit tests.
 * Uses runInInjectionContext + a stub DestroyRef so that inject() and
 * toSignal() class-field initialisers resolve without Angular TestBed.
 * KpiService is a real instance backed by fake-indexeddb.
 */
import { describe, it, expect } from 'vitest';
import { Injector, runInInjectionContext, DestroyRef } from '@angular/core';
import { DbService } from '../src/app/core/db.service';
import { TelemetryService } from '../src/app/telemetry/telemetry.service';
import { KpiService } from '../src/app/kpi/kpi.service';
import { ReportPage } from '../src/app/reporting/report.page';
import type { WarehouseDaily } from '../src/app/core/types';

// ── Minimal DestroyRef stub required by toSignal() ────────────────────────────

class TestDestroyRef extends DestroyRef {
  override onDestroy(_callback: () => void): () => void {
    return () => {};
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

function makeComponent() {
  const db = new DbService();
  const telemetry = new TelemetryService(db);
  const kpi = new KpiService(db, telemetry);
  const destroyRef = new TestDestroyRef();

  const injector = Injector.create({
    providers: [
      { provide: KpiService, useValue: kpi },
      { provide: DestroyRef, useValue: destroyRef },
    ],
  });

  let component!: ReportPage;
  runInInjectionContext(injector, () => {
    component = new ReportPage();
  });

  // Cast to access protected members
  type Internals = {
    rows: () => WarehouseDaily[];
    from: () => string;
    to: () => string;
    setFrom: (e: Event) => void;
    setTo: (e: Event) => void;
    load: () => Promise<void>;
  };

  return { component: component as typeof component & Internals, kpi, db };
}

function fakeInputEvent(value: string): Event {
  return { target: { value } } as unknown as Event;
}

describe('ReportPage', () => {
  // ── default signal state ───────────────────────────────────────────────────

  describe('initial state', () => {
    it('rows() is an empty array before load()', () => {
      const { component } = makeComponent();
      expect(component.rows()).toEqual([]);
    });

    it('to() defaults to today (YYYY-MM-DD)', () => {
      const { component } = makeComponent();
      const today = new Date().toISOString().slice(0, 10);
      expect(component.to()).toBe(today);
    });

    it('from() defaults to 30 days before today', () => {
      const { component } = makeComponent();
      const expected = new Date();
      expected.setDate(expected.getDate() - 30);
      expect(component.from()).toBe(expected.toISOString().slice(0, 10));
    });

    it('from() is strictly before to()', () => {
      const { component } = makeComponent();
      expect(component.from() < component.to()).toBe(true);
    });
  });

  // ── setFrom() / setTo() ───────────────────────────────────────────────────

  describe('setFrom()', () => {
    it('updates the from signal', () => {
      const { component } = makeComponent();
      component.setFrom(fakeInputEvent('2026-01-01'));
      expect(component.from()).toBe('2026-01-01');
    });

    it('reflects arbitrary date strings', () => {
      const { component } = makeComponent();
      component.setFrom(fakeInputEvent('2025-06-15'));
      expect(component.from()).toBe('2025-06-15');
    });
  });

  describe('setTo()', () => {
    it('updates the to signal', () => {
      const { component } = makeComponent();
      component.setTo(fakeInputEvent('2026-04-30'));
      expect(component.to()).toBe('2026-04-30');
    });

    it('reflects arbitrary date strings', () => {
      const { component } = makeComponent();
      component.setTo(fakeInputEvent('2025-12-31'));
      expect(component.to()).toBe('2025-12-31');
    });
  });

  // ── load() ─────────────────────────────────────────────────────────────────

  describe('load()', () => {
    it('sets rows to empty array when warehouse has no data', async () => {
      const { component } = makeComponent();
      await component.load();
      expect(component.rows()).toEqual([]);
    });

    it('populates rows from KpiService.dailyReport()', async () => {
      const { component, db } = makeComponent();
      // Seed one warehouse_daily row directly into IndexedDB
      const idb = await db.open();
      const row: WarehouseDaily = {
        date: new Date().toISOString().slice(0, 10),
        workspaceId: 'ws-1',
        notesCreated: 5,
        commentsAdded: 3,
        chatMessagesSent: 10,
        mutualHelpPublished: 1,
        activeProfiles: ['u1', 'u2'],
      };
      await idb.put('warehouse_daily', row);

      await component.load();

      expect(component.rows()).toHaveLength(1);
      expect(component.rows()[0].notesCreated).toBe(5);
      expect(component.rows()[0].chatMessagesSent).toBe(10);
    });

    it('respects the from/to date range', async () => {
      const { component, db } = makeComponent();
      const idb = await db.open();

      // In-range row
      await idb.put('warehouse_daily', {
        date: component.from(),
        workspaceId: 'ws-1',
        notesCreated: 1,
        commentsAdded: 0,
        chatMessagesSent: 0,
        mutualHelpPublished: 0,
        activeProfiles: [],
      } as WarehouseDaily);

      // Out-of-range row (future date beyond to())
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      await idb.put('warehouse_daily', {
        date: futureDate.toISOString().slice(0, 10),
        workspaceId: 'ws-1',
        notesCreated: 99,
        commentsAdded: 0,
        chatMessagesSent: 0,
        mutualHelpPublished: 0,
        activeProfiles: [],
      } as WarehouseDaily);

      await component.load();

      // Only the in-range row should appear
      expect(component.rows().every(r => r.date >= component.from() && r.date <= component.to())).toBe(true);
      expect(component.rows().some(r => r.notesCreated === 99)).toBe(false);
    });

    it('clears previous rows when load() is called with empty range', async () => {
      const { component, db } = makeComponent();
      const idb = await db.open();
      await idb.put('warehouse_daily', {
        date: component.from(),
        workspaceId: 'ws-1',
        notesCreated: 3,
        commentsAdded: 0,
        chatMessagesSent: 0,
        mutualHelpPublished: 0,
        activeProfiles: [],
      } as WarehouseDaily);
      await component.load();
      expect(component.rows().length).toBeGreaterThanOrEqual(1);

      // Now restrict range to the future — no rows should match
      const farFuture = '2099-01-01';
      component.setFrom(fakeInputEvent(farFuture));
      component.setTo(fakeInputEvent('2099-01-02'));
      await component.load();

      expect(component.rows()).toEqual([]);
    });
  });

  // ── ngOnInit() ─────────────────────────────────────────────────────────────

  describe('ngOnInit()', () => {
    it('calls load() on init so rows are populated on first render', async () => {
      const { component, db } = makeComponent();
      const idb = await db.open();
      await idb.put('warehouse_daily', {
        date: component.from(),
        workspaceId: 'ws-1',
        notesCreated: 7,
        commentsAdded: 0,
        chatMessagesSent: 0,
        mutualHelpPublished: 0,
        activeProfiles: [],
      } as WarehouseDaily);

      await component.ngOnInit();

      expect(component.rows()).toHaveLength(1);
      expect(component.rows()[0].notesCreated).toBe(7);
    });
  });
});
