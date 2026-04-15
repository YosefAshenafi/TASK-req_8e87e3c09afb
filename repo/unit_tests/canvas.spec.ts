import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { DbService } from '../src/app/core/db.service';
import { TabIdentityService } from '../src/app/core/tab-identity.service';
import { BroadcastService } from '../src/app/core/broadcast.service';
import { CanvasService } from '../src/app/canvas/canvas.service';
import { AppException } from '../src/app/core/error';
import type { CanvasObject } from '../src/app/core/types';

const WS = 'workspace-1';

function makeStickyInput(overrides: Partial<CanvasObject> = {}): Omit<CanvasObject, 'id' | 'version' | 'updatedAt' | 'lastEditedBy'> {
  return {
    workspaceId: WS,
    type: 'sticky-note',
    x: 10, y: 10, width: 160, height: 120,
    text: 'Hello',
    zIndex: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('CanvasService', () => {
  let db: DbService;
  let tab: TabIdentityService;
  let broadcast: BroadcastService;
  let canvas: CanvasService;

  beforeEach(() => {
    db = new DbService();
    tab = new TabIdentityService();
    broadcast = new BroadcastService(tab);
    canvas = new CanvasService(db, broadcast, tab);
  });

  // ── loadForWorkspace ───────────────────────────────────────────────────────

  describe('loadForWorkspace()', () => {
    it('starts with empty objects$', async () => {
      await canvas.loadForWorkspace(WS);
      const objects = await firstValueFrom(canvas.objects$);
      expect(objects).toEqual([]);
    });

    it('loads persisted objects after add', async () => {
      await canvas.addObject(makeStickyInput());
      // New service instance reads from same IDB
      const canvas2 = new CanvasService(db, broadcast, tab);
      await canvas2.loadForWorkspace(WS);
      const objects = await firstValueFrom(canvas2.objects$);
      expect(objects).toHaveLength(1);
    });

    it('loads only objects for the specified workspace', async () => {
      await canvas.addObject(makeStickyInput({ workspaceId: WS }));
      await canvas.addObject(makeStickyInput({ workspaceId: 'other-ws' }));
      await canvas.loadForWorkspace(WS);
      const objects = await firstValueFrom(canvas.objects$);
      expect(objects).toHaveLength(1);
      expect(objects[0].workspaceId).toBe(WS);
    });
  });

  // ── addObject ─────────────────────────────────────────────────────────────

  describe('addObject()', () => {
    it('creates a canvas object with version=1', async () => {
      const obj = await canvas.addObject(makeStickyInput());
      expect(obj.id).toBeTruthy();
      expect(obj.version).toBe(1);
    });

    it('sets lastEditedBy to the current tabId', async () => {
      const obj = await canvas.addObject(makeStickyInput());
      expect(obj.lastEditedBy).toBe(tab.tabId);
    });

    it('adds the object to objects$', async () => {
      const obj = await canvas.addObject(makeStickyInput());
      const objects = await firstValueFrom(canvas.objects$);
      expect(objects.some(o => o.id === obj.id)).toBe(true);
    });

    it('throws Validation when sticky note text exceeds 80 chars', async () => {
      await expect(
        canvas.addObject(makeStickyInput({ text: 'A'.repeat(81) })),
      ).rejects.toSatisfy(
        (e: AppException) => e.error.code === 'Validation' && e.error.field === 'text',
      );
    });

    it('accepts sticky note with exactly 80 characters', async () => {
      const obj = await canvas.addObject(makeStickyInput({ text: 'A'.repeat(80) }));
      expect(obj.text).toHaveLength(80);
    });

    it('accepts non-sticky types without text length restriction', async () => {
      const obj = await canvas.addObject(makeStickyInput({ type: 'rectangle', text: undefined }));
      expect(obj.type).toBe('rectangle');
    });

    it('accumulates multiple objects in objects$', async () => {
      await canvas.addObject(makeStickyInput());
      await canvas.addObject(makeStickyInput({ text: 'Second' }));
      const objects = await firstValueFrom(canvas.objects$);
      expect(objects).toHaveLength(2);
    });
  });

  // ── patchObject ────────────────────────────────────────────────────────────

  describe('patchObject()', () => {
    it('updates specified fields', async () => {
      const obj = await canvas.addObject(makeStickyInput());
      const patched = await canvas.patchObject(obj.id, { x: 999, y: 888 }, 1);
      expect(patched.x).toBe(999);
      expect(patched.y).toBe(888);
    });

    it('increments version', async () => {
      const obj = await canvas.addObject(makeStickyInput());
      const patched = await canvas.patchObject(obj.id, { x: 50 }, 1);
      expect(patched.version).toBe(2);
    });

    it('updates lastEditedBy', async () => {
      const obj = await canvas.addObject(makeStickyInput());
      const patched = await canvas.patchObject(obj.id, { x: 50 }, 1);
      expect(patched.lastEditedBy).toBe(tab.tabId);
    });

    it('throws NotFound for unknown id', async () => {
      await expect(
        canvas.patchObject('no-such-id', { x: 1 }, 1),
      ).rejects.toSatisfy((e: AppException) => e.error.code === 'NotFound');
    });

    it('throws VersionConflict when baseVersion does not match', async () => {
      const obj = await canvas.addObject(makeStickyInput());
      await expect(
        canvas.patchObject(obj.id, { x: 1 }, 99), // wrong baseVersion
      ).rejects.toSatisfy((e: AppException) => e.error.code === 'VersionConflict');
    });

    it('updates objects$ with patched values', async () => {
      const obj = await canvas.addObject(makeStickyInput());
      await canvas.patchObject(obj.id, { x: 500 }, 1);
      const objects = await firstValueFrom(canvas.objects$);
      const updated = objects.find(o => o.id === obj.id);
      expect(updated?.x).toBe(500);
    });
  });

  // ── setNoteText ────────────────────────────────────────────────────────────

  describe('setNoteText()', () => {
    it('updates the note text', async () => {
      const obj = await canvas.addObject(makeStickyInput({ text: 'original' }));
      const updated = await canvas.setNoteText(obj.id, 'updated text', 1);
      expect(updated.text).toBe('updated text');
    });

    it('throws Validation when text exceeds 80 chars', async () => {
      const obj = await canvas.addObject(makeStickyInput());
      await expect(
        canvas.setNoteText(obj.id, 'X'.repeat(81), 1),
      ).rejects.toSatisfy(
        (e: AppException) => e.error.code === 'Validation' && e.error.field === 'text',
      );
    });

    it('accepts exactly 80 characters', async () => {
      const obj = await canvas.addObject(makeStickyInput());
      const updated = await canvas.setNoteText(obj.id, 'B'.repeat(80), 1);
      expect(updated.text).toHaveLength(80);
    });
  });

  // ── deleteObject ───────────────────────────────────────────────────────────

  describe('deleteObject()', () => {
    it('removes the object from objects$', async () => {
      const obj = await canvas.addObject(makeStickyInput());
      await canvas.deleteObject(obj.id, 1);
      const objects = await firstValueFrom(canvas.objects$);
      expect(objects.find(o => o.id === obj.id)).toBeUndefined();
    });

    it('does nothing for unknown id (no error)', async () => {
      await expect(canvas.deleteObject('ghost-id', 1)).resolves.toBeUndefined();
    });

    it('throws VersionConflict when baseVersion does not match', async () => {
      const obj = await canvas.addObject(makeStickyInput());
      await expect(
        canvas.deleteObject(obj.id, 99),
      ).rejects.toSatisfy((e: AppException) => e.error.code === 'VersionConflict');
    });

    it('removes only the targeted object', async () => {
      const obj1 = await canvas.addObject(makeStickyInput({ text: 'Keep' }));
      const obj2 = await canvas.addObject(makeStickyInput({ text: 'Remove' }));
      await canvas.deleteObject(obj2.id, 1);
      const objects = await firstValueFrom(canvas.objects$);
      expect(objects.find(o => o.id === obj1.id)).toBeDefined();
      expect(objects.find(o => o.id === obj2.id)).toBeUndefined();
    });
  });
});
