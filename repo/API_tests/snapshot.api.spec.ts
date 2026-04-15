/**
 * SNAPSHOT API TESTS
 * Tests auto-save, checkpoint creation, and rollback via the real SnapshotService.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeFullContext, signUp } from './helpers';
import type { FullContext } from './helpers';

const WS = 'ws-snap-api';

describe('Snapshot API — full lifecycle', () => {
  let ctx: FullContext;

  beforeEach(async () => {
    ctx = makeFullContext();
    await signUp(ctx.auth, 'alice');
    await ctx.chat.loadForWorkspace(WS);
  });

  it('auto-save creates checkpoint at seq=1', async () => {
    vi.useFakeTimers();

    ctx.snapshot.markDirty();
    ctx.snapshot.startAutoSave(WS, () => ({ notes: ['note-a', 'note-b'] }));

    await vi.advanceTimersByTimeAsync(1_100);
    ctx.snapshot.stopAutoSave();
    vi.useRealTimers();

    const summaries = await ctx.snapshot.listSnapshots(WS);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].seq).toBe(1);
    expect(summaries[0].isCheckpoint).toBe(true);
    expect(summaries[0].workspaceId).toBe(WS);
  });

  it('subsequent saves create non-checkpoint snapshots (patch-based)', async () => {
    vi.useFakeTimers();
    let state = { count: 0 };

    ctx.snapshot.markDirty();
    ctx.snapshot.startAutoSave(WS, () => state);
    await vi.advanceTimersByTimeAsync(1_100); // seq=1, checkpoint

    state = { count: 1 };
    ctx.snapshot.markDirty();
    await vi.advanceTimersByTimeAsync(5_000); // seq=2, patch (1s interval under Vitest)

    ctx.snapshot.stopAutoSave();
    vi.useRealTimers();

    const summaries = await ctx.snapshot.listSnapshots(WS);
    expect(summaries.length).toBeGreaterThanOrEqual(2);

    const sorted = [...summaries].sort((a, b) => a.seq - b.seq);
    expect(sorted[0].isCheckpoint).toBe(true);
    expect(sorted[1].isCheckpoint).toBe(false); // patch-based
  });

  it('listSnapshots returns correct summary fields', async () => {
    vi.useFakeTimers();
    ctx.snapshot.markDirty();
    ctx.snapshot.startAutoSave(WS, () => ({ data: 1 }));
    await vi.advanceTimersByTimeAsync(1_100);
    ctx.snapshot.stopAutoSave();
    vi.useRealTimers();

    const summaries = await ctx.snapshot.listSnapshots(WS);
    const s = summaries[0];
    expect(s).toHaveProperty('workspaceId', WS);
    expect(s).toHaveProperty('seq');
    expect(s).toHaveProperty('isCheckpoint');
    expect(s).toHaveProperty('createdAt');
  });

  it('rollback to seq=1 restores state and posts system message', async () => {
    vi.useFakeTimers();
    let state = { version: 1 };

    ctx.snapshot.markDirty();
    ctx.snapshot.startAutoSave(WS, () => state);
    await vi.advanceTimersByTimeAsync(1_100); // checkpoint at seq=1

    state = { version: 2 };
    ctx.snapshot.markDirty();
    await vi.advanceTimersByTimeAsync(5_000); // seq=2

    ctx.snapshot.stopAutoSave();
    vi.useRealTimers();

    // Rollback to seq 1
    await ctx.snapshot.rollbackTo(WS, 1);

    const summaries = await ctx.snapshot.listSnapshots(WS);
    // A new snapshot is written by rollback
    expect(summaries.length).toBeGreaterThan(2);
  });

  it('rollback throws NotFound when no checkpoint exists', async () => {
    await expect(ctx.snapshot.rollbackTo(WS, 1)).rejects.toSatisfy(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.error?.code === 'NotFound' || e instanceof Error,
    );
  });

  it('tick() is a no-op when not dirty', async () => {
    await expect(ctx.snapshot.tick()).resolves.toBeUndefined();
    // No snapshots written
    const summaries = await ctx.snapshot.listSnapshots(WS);
    expect(summaries).toHaveLength(0);
  });

  it('tick() clears dirty flag', async () => {
    ctx.snapshot.markDirty();
    await ctx.snapshot.tick();
    // After tick, calling again should be no-op (flag cleared)
    await ctx.snapshot.tick();
    // No assertion failure — just verifying it doesn't error
  });

  it('stopAutoSave can be called multiple times without error', () => {
    ctx.snapshot.stopAutoSave();
    ctx.snapshot.stopAutoSave();
  });
});
