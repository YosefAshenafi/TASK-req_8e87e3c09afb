/**
 * SnapshotPanelComponent — deep behavioural unit tests.
 *
 * Covers:
 *   • ngOnInit → refresh() loads snapshots (newest first)
 *   • ngOnChanges['workspaceId'] triggers refresh; other changes don't
 *   • refresh() swallows listSnapshots errors and resets to []
 *   • refresh() is a no-op when workspaceId is empty
 *   • rollback() guards against concurrent invocation
 *   • rollback() happy path: toast success, emit rolledBack(seq), refresh
 *   • rollback() error path: toast error with service-thrown message
 *   • timeLabel() boundaries: just now / Nm ago / Nh ago / Nd ago
 *   • closed emitter propagates
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { SnapshotPanelComponent } from '../src/app/snapshot/snapshot-panel.component';
import { SnapshotService } from '../src/app/snapshot/snapshot.service';
import { ToastService } from '../src/app/core/toast.service';
import type { SnapshotSummary } from '../src/app/core/types';

const NOW = 1_700_000_000_000;

function summary(seq: number, isCheckpoint = false, createdAt = NOW - 1000): SnapshotSummary {
  return { workspaceId: 'ws-1', seq, isCheckpoint, createdAt };
}

function makePanel(opts: {
  workspaceId?: string;
  list?: SnapshotSummary[];
  listRejects?: unknown;
  rollbackRejects?: unknown;
} = {}) {
  const snapshotService = {
    listSnapshots: vi.fn().mockImplementation(() =>
      'listRejects' in opts
        ? Promise.reject(opts.listRejects)
        : Promise.resolve(opts.list ?? []),
    ),
    rollbackTo: vi.fn().mockImplementation(() =>
      'rollbackRejects' in opts
        ? Promise.reject(opts.rollbackRejects)
        : Promise.resolve(),
    ),
  };
  const toast = { show: vi.fn() };
  const injector = Injector.create({
    providers: [
      { provide: SnapshotService, useValue: snapshotService },
      { provide: ToastService, useValue: toast },
    ],
  });
  let component!: SnapshotPanelComponent;
  runInInjectionContext(injector, () => {
    component = new SnapshotPanelComponent();
  });
  component.workspaceId = opts.workspaceId ?? 'ws-1';
  return { component: component as SnapshotPanelComponent & Record<string, any>, snapshotService, toast };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe('SnapshotPanelComponent — refresh()', () => {
  it('ngOnInit calls listSnapshots and stores newest-first', async () => {
    const { component, snapshotService } = makePanel({
      list: [summary(1), summary(3), summary(2)],
    });
    await component.ngOnInit();
    expect(snapshotService.listSnapshots).toHaveBeenCalledWith('ws-1');
    const seqs = (component as any).snapshots().map((s: SnapshotSummary) => s.seq);
    expect(seqs).toEqual([3, 2, 1]);
  });

  it('is a no-op when workspaceId is empty', async () => {
    const { component, snapshotService } = makePanel({ workspaceId: '' });
    await component.ngOnInit();
    expect(snapshotService.listSnapshots).not.toHaveBeenCalled();
  });

  it('swallows listSnapshots errors and resets snapshots to []', async () => {
    const { component } = makePanel({ listRejects: new Error('db-down') });
    const c = component as any;
    c.snapshots.set([summary(9)]);
    await c.refresh();
    expect(c.snapshots()).toEqual([]);
  });

  it('ngOnChanges["workspaceId"] re-fetches the list', async () => {
    const { component, snapshotService } = makePanel({ list: [summary(1)] });
    await component.ngOnInit();
    snapshotService.listSnapshots.mockClear();
    component.workspaceId = 'ws-2';
    await component.ngOnChanges({
      workspaceId: {
        currentValue: 'ws-2',
        previousValue: 'ws-1',
        firstChange: false,
        isFirstChange: () => false,
      },
    });
    expect(snapshotService.listSnapshots).toHaveBeenCalledWith('ws-2');
  });

  it('ngOnChanges without a workspaceId change does not re-fetch', async () => {
    const { component, snapshotService } = makePanel({ list: [] });
    await component.ngOnInit();
    snapshotService.listSnapshots.mockClear();
    await component.ngOnChanges({
      unrelated: { currentValue: 1, previousValue: 0, firstChange: false, isFirstChange: () => false },
    });
    expect(snapshotService.listSnapshots).not.toHaveBeenCalled();
  });
});

describe('SnapshotPanelComponent — rollback()', () => {
  it('happy path: toasts success, emits rolledBack, and refreshes', async () => {
    const { component, snapshotService, toast } = makePanel({
      list: [summary(1), summary(2)],
    });
    await component.ngOnInit();
    const emitted: number[] = [];
    component.rolledBack.subscribe(v => emitted.push(v));

    snapshotService.listSnapshots.mockClear();
    snapshotService.listSnapshots.mockResolvedValue([summary(1), summary(2), summary(3)]);

    await (component as any).rollback(summary(1));

    expect(snapshotService.rollbackTo).toHaveBeenCalledWith('ws-1', 1);
    expect(toast.show).toHaveBeenCalledWith('Rolled back to snapshot #1.', 'success');
    expect(emitted).toEqual([1]);
    // refresh was triggered after rollback
    expect(snapshotService.listSnapshots).toHaveBeenCalledTimes(1);
    // rolling indicator reset
    expect((component as any).rolling()).toBeNull();
  });

  it('concurrent rollback calls short-circuit the second one', async () => {
    const { component, snapshotService } = makePanel({ list: [] });
    let resolveFirst: (() => void) | null = null;
    snapshotService.rollbackTo.mockImplementationOnce(
      () => new Promise<void>(res => { resolveFirst = res; }),
    );
    const c = component as any;
    const p1 = c.rollback(summary(1));
    const p2 = c.rollback(summary(2));
    await p2; // second call resolves synchronously (short-circuit)
    expect(snapshotService.rollbackTo).toHaveBeenCalledTimes(1);
    resolveFirst?.();
    await p1;
  });

  it('surfaces Error.message via toast when rollback rejects', async () => {
    const { component, toast } = makePanel({
      rollbackRejects: new Error('storage full'),
    });
    await component.ngOnInit();
    await (component as any).rollback(summary(9));
    expect(toast.show).toHaveBeenCalledWith('storage full', 'error');
    expect((component as any).rolling()).toBeNull();
  });

  it('falls back to a generic message when rollback rejects with a non-Error', async () => {
    const { component, toast } = makePanel({ rollbackRejects: 'weird' });
    await component.ngOnInit();
    await (component as any).rollback(summary(2));
    expect(toast.show).toHaveBeenCalledWith('Rollback failed', 'error');
  });

  it('sets rolling(seq) during the async call and clears afterwards', async () => {
    const { component, snapshotService } = makePanel({ list: [summary(5)] });
    await component.ngOnInit();
    let duringValue: number | null = -1;
    snapshotService.rollbackTo.mockImplementation(async () => {
      duringValue = (component as any).rolling();
    });
    await (component as any).rollback(summary(5));
    expect(duringValue).toBe(5);
    expect((component as any).rolling()).toBeNull();
  });
});

describe('SnapshotPanelComponent — timeLabel()', () => {
  it('returns "just now" under a minute', () => {
    const { component } = makePanel();
    expect((component as any).timeLabel(NOW - 30_000)).toBe('just now');
  });

  it('returns "Nm ago" for minutes', () => {
    const { component } = makePanel();
    expect((component as any).timeLabel(NOW - 45 * 60_000)).toBe('45m ago');
  });

  it('returns "Nh ago" for hours under a day', () => {
    const { component } = makePanel();
    expect((component as any).timeLabel(NOW - 5 * 3600_000)).toBe('5h ago');
  });

  it('returns "Nd ago" for days', () => {
    const { component } = makePanel();
    expect((component as any).timeLabel(NOW - 3 * 24 * 3600_000)).toBe('3d ago');
  });
});

describe('SnapshotPanelComponent — closed emitter', () => {
  it('propagates close events to subscribers', () => {
    const { component } = makePanel();
    let fired = 0;
    component.closed.subscribe(() => fired++);
    component.closed.emit();
    expect(fired).toBe(1);
  });
});
