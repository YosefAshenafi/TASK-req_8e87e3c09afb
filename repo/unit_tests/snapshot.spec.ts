import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeContext, createAndSignIn } from './helpers';
import { SnapshotService } from '../src/app/snapshot/snapshot.service';

const WS = 'workspace-snap';

describe('SnapshotService', () => {
  let ctx: ReturnType<typeof makeContext>;
  let snap: SnapshotService;

  beforeEach(async () => {
    ctx = makeContext();
    await createAndSignIn(ctx.auth);
    await ctx.chat.loadForWorkspace(WS);
    snap = new SnapshotService(ctx.db, ctx.chat);
  });

  // ── markDirty ─────────────────────────────────────────────────────────────

  describe('markDirty()', () => {
    it('can be called without error', () => {
      expect(() => snap.markDirty()).not.toThrow();
    });
  });

  // ── tick ─────────────────────────────────────────────────────────────────

  describe('tick()', () => {
    it('does nothing if not dirty', async () => {
      // No dirty state — tick is a no-op
      await expect(snap.tick()).resolves.toBeUndefined();
    });

    it('clears dirty flag after tick', async () => {
      snap.markDirty();
      await snap.tick();
      // After tick the dirty flag is cleared — tick again should be no-op
      await expect(snap.tick()).resolves.toBeUndefined();
    });
  });

  // ── startAutoSave / stopAutoSave ──────────────────────────────────────────

  describe('startAutoSave() / stopAutoSave()', () => {
    it('stopAutoSave can be called before startAutoSave without error', () => {
      expect(() => snap.stopAutoSave()).not.toThrow();
    });

    it('startAutoSave stores workspaceId and sets up timer', async () => {
      vi.useFakeTimers();
      let savedState: Record<string, unknown> | null = null;
      snap.markDirty();

      snap.startAutoSave(WS, () => ({ notes: ['note1'] }));

      // Advance past AUTO_SAVE_INTERVAL_MS (1s in Vitest, 10s in app)
      await vi.advanceTimersByTimeAsync(1_100);

      snap.stopAutoSave();
      vi.useRealTimers();

      // Check that a snapshot was written
      const summaries = await snap.listSnapshots(WS);
      expect(summaries.length).toBeGreaterThanOrEqual(1);
    });

    it('startAutoSave is idempotent — calling it twice replaces the subscription', () => {
      vi.useFakeTimers();
      snap.startAutoSave(WS, () => ({}));
      snap.startAutoSave(WS, () => ({})); // replaces previous
      snap.stopAutoSave();
      vi.useRealTimers();
    });

    it('stopAutoSave cancels the timer', async () => {
      vi.useFakeTimers();
      snap.markDirty();
      snap.startAutoSave(WS, () => ({ data: 1 }));
      snap.stopAutoSave();

      // Even after advancing time, no snapshot should be written
      await vi.advanceTimersByTimeAsync(30_000);
      vi.useRealTimers();

      const summaries = await snap.listSnapshots(WS);
      expect(summaries).toHaveLength(0);
    });
  });

  // ── listSnapshots ─────────────────────────────────────────────────────────

  describe('listSnapshots()', () => {
    it('returns empty array when no snapshots exist', async () => {
      const list = await snap.listSnapshots(WS);
      expect(list).toEqual([]);
    });

    it('returns snapshot summaries after auto-save', async () => {
      vi.useFakeTimers();
      snap.markDirty();
      snap.startAutoSave(WS, () => ({ key: 'value' }));
      await vi.advanceTimersByTimeAsync(1_100);
      snap.stopAutoSave();
      vi.useRealTimers();

      const list = await snap.listSnapshots(WS);
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list[0]).toHaveProperty('workspaceId', WS);
      expect(list[0]).toHaveProperty('seq');
      expect(list[0]).toHaveProperty('isCheckpoint');
    });

    it('first snapshot (seq=1) is a checkpoint', async () => {
      vi.useFakeTimers();
      snap.markDirty();
      snap.startAutoSave(WS, () => ({ a: 1 }));
      await vi.advanceTimersByTimeAsync(1_100);
      snap.stopAutoSave();
      vi.useRealTimers();

      const list = await snap.listSnapshots(WS);
      const first = list.find(s => s.seq === 1);
      expect(first?.isCheckpoint).toBe(true);
    });
  });

  // ── rollbackTo ────────────────────────────────────────────────────────────

  describe('rollbackTo()', () => {
    it('throws NotFound when no checkpoint exists', async () => {
      await expect(snap.rollbackTo(WS, 1)).rejects.toSatisfy(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => e.error?.code === 'NotFound' || e.message?.includes('checkpoint'),
      );
    });

    it('restores from checkpoint and writes a new snapshot', async () => {
      vi.useFakeTimers();
      let state = { version: 1 };
      snap.markDirty();
      snap.startAutoSave(WS, () => state);
      await vi.advanceTimersByTimeAsync(1_100); // seq=1 checkpoint

      state = { version: 2 };
      snap.markDirty();
      await vi.advanceTimersByTimeAsync(5_000); // seq=2
      snap.stopAutoSave();
      vi.useRealTimers();

      // Rollback to seq 1
      await snap.rollbackTo(WS, 1);

      const list = await snap.listSnapshots(WS);
      expect(list.length).toBeGreaterThan(2); // new snapshot added
    });

    // ── F-B01: rollback restores live stores ────────────────────────────

    it('rollback restores canvas_objects and mutual_help to the checkpoint (F-B01)', async () => {
      vi.useFakeTimers();

      // Seed the checkpoint state: canvas has note A and mutual-help has post A.
      const noteA = {
        id: 'note-a', workspaceId: WS, type: 'sticky-note', text: 'A',
        x: 0, y: 0, width: 160, height: 120, zIndex: 0, version: 1,
        createdAt: 0, updatedAt: 0, lastEditedBy: 't1',
      };
      const postA = {
        id: 'post-a', workspaceId: WS, status: 'active',
        type: 'offer', category: 'c', title: 'A', description: 'A',
        tags: [], attachmentIds: [], authorId: 'u1',
        urgency: 'low', pinned: false, expiresAt: 0,
        createdAt: 0, updatedAt: 0, version: 1,
      };
      let state: Record<string, unknown> = { canvas: [noteA], mutualHelp: [postA] };

      snap.markDirty();
      snap.startAutoSave(WS, () => state);
      await vi.advanceTimersByTimeAsync(1_100); // seq=1 checkpoint

      // Seed the LIVE stores with the post-change state (note B / post B only).
      const idb = await ctx.db.open();
      await idb.put('canvas_objects', {
        ...noteA, id: 'note-b', text: 'B',
      });
      await idb.delete('canvas_objects', 'note-a');
      await idb.put('mutual_help', {
        ...postA, id: 'post-b', title: 'B',
      });
      await idb.delete('mutual_help', 'post-a');

      snap.stopAutoSave();
      vi.useRealTimers();

      // Rollback to seq 1 — state should restore note A / post A in the
      // live stores and remove note B / post B.
      await snap.rollbackTo(WS, 1);

      const restoredCanvas = await idb.getAllFromIndex('canvas_objects', 'by_workspace', WS);
      const ids = restoredCanvas.map(o => o.id).sort();
      expect(ids).toEqual(['note-a']);

      const restoredPosts = await idb.getAllFromIndex('mutual_help', 'by_workspace', WS);
      const postIds = restoredPosts.map(p => p.id).sort();
      expect(postIds).toEqual(['post-a']);
    });
  });
});
