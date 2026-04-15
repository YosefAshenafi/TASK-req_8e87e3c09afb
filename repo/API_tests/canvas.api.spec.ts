/**
 * CANVAS API TESTS
 * Tests the complete canvas object lifecycle — adding, patching, text updates,
 * version conflict detection, and deletion — using real IndexedDB.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeFullContext, signUp } from './helpers';
import type { FullContext } from './helpers';
import type { CanvasObject } from '../src/app/core/types';

const WS = 'ws-canvas-api';

function makeStickyPartial(text = 'Test note'): Omit<CanvasObject, 'id' | 'version' | 'updatedAt' | 'lastEditedBy'> {
  return {
    workspaceId: WS,
    type: 'sticky-note',
    x: 50, y: 50, width: 160, height: 120,
    text,
    zIndex: 0,
    createdAt: Date.now(),
  };
}

describe('Canvas API — full lifecycle', () => {
  let ctx: FullContext;

  beforeEach(async () => {
    ctx = makeFullContext();
    await signUp(ctx.auth, 'alice');
  });

  it('add → patch position → set text → delete', async () => {
    // Add
    const obj = await ctx.canvas.addObject(makeStickyPartial('Original'));
    expect(obj.id).toBeTruthy();
    expect(obj.version).toBe(1);
    expect(obj.text).toBe('Original');

    // Patch position
    const patched = await ctx.canvas.patchObject(obj.id, { x: 300, y: 400 }, 1);
    expect(patched.x).toBe(300);
    expect(patched.y).toBe(400);
    expect(patched.version).toBe(2);

    // Set text
    const withNewText = await ctx.canvas.setNoteText(obj.id, 'Updated text', 2);
    expect(withNewText.text).toBe('Updated text');
    expect(withNewText.version).toBe(3);

    // Delete
    await ctx.canvas.deleteObject(obj.id, 3);
    const objects = await firstValueFrom(ctx.canvas.objects$);
    expect(objects.find(o => o.id === obj.id)).toBeUndefined();
  });

  it('adds multiple objects and loads all for workspace', async () => {
    for (let i = 0; i < 5; i++) {
      await ctx.canvas.addObject(makeStickyPartial(`Note ${i}`));
    }

    // New instance reads from same IDB
    const canvas2 = makeFullContext().canvas;
    await canvas2.loadForWorkspace(WS);
    const objects = await firstValueFrom(canvas2.objects$);
    expect(objects).toHaveLength(5);
  });

  it('version conflict detection — rejects stale patch', async () => {
    const obj = await ctx.canvas.addObject(makeStickyPartial());

    // First patch succeeds (baseVersion=1)
    await ctx.canvas.patchObject(obj.id, { x: 100 }, 1);

    // Second patch with old baseVersion fails
    await expect(
      ctx.canvas.patchObject(obj.id, { x: 200 }, 1), // stale
    ).rejects.toSatisfy(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.error?.code === 'VersionConflict',
    );
  });

  it('adds non-sticky objects without text restriction', async () => {
    const rect = await ctx.canvas.addObject({
      workspaceId: WS,
      type: 'rectangle',
      x: 0, y: 0, width: 200, height: 100,
      zIndex: 0,
      createdAt: Date.now(),
    });
    expect(rect.type).toBe('rectangle');

    const circle = await ctx.canvas.addObject({
      workspaceId: WS,
      type: 'circle',
      x: 10, y: 10, width: 80, height: 80,
      zIndex: 1,
      createdAt: Date.now(),
    });
    expect(circle.type).toBe('circle');
  });

  it('objects are scoped to their workspace', async () => {
    await ctx.canvas.addObject(makeStickyPartial('In WS'));
    await ctx.canvas.addObject({
      workspaceId: 'other-ws',
      type: 'sticky-note',
      x: 0, y: 0, width: 160, height: 120,
      text: 'In other WS',
      zIndex: 0,
      createdAt: Date.now(),
    });

    await ctx.canvas.loadForWorkspace(WS);
    const objects = await firstValueFrom(ctx.canvas.objects$);
    expect(objects.every(o => o.workspaceId === WS)).toBe(true);
  });

  it('lastEditedBy is the tabId of the editing service', async () => {
    const obj = await ctx.canvas.addObject(makeStickyPartial());
    expect(obj.lastEditedBy).toBe(ctx.tab.tabId);
  });

  it('sticky note text limit enforced at 80 characters', async () => {
    // 80 chars — OK
    const ok = await ctx.canvas.addObject(makeStickyPartial('A'.repeat(80)));
    expect(ok.text?.length).toBe(80);

    // 81 chars — throws
    await expect(
      ctx.canvas.addObject(makeStickyPartial('A'.repeat(81))),
    ).rejects.toSatisfy(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.error?.code === 'Validation',
    );
  });

  it('setNoteText enforces 80 character limit', async () => {
    const obj = await ctx.canvas.addObject(makeStickyPartial('Short text'));
    await expect(
      ctx.canvas.setNoteText(obj.id, 'B'.repeat(81), obj.version),
    ).rejects.toSatisfy(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.error?.code === 'Validation' && e.error?.field === 'text',
    );
  });

  it('deleteObject rejects stale baseVersion', async () => {
    const obj = await ctx.canvas.addObject(makeStickyPartial('Delete me'));
    await ctx.canvas.patchObject(obj.id, { x: 120 }, obj.version);

    await expect(
      ctx.canvas.deleteObject(obj.id, obj.version), // stale, latest is obj.version + 1
    ).rejects.toSatisfy(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.error?.code === 'VersionConflict',
    );
  });

  it('applies incoming broadcast edit when baseVersion matches', async () => {
    const obj = await ctx.canvas.addObject(makeStickyPartial('From broadcast'));

    // Simulate another tab publishing an edit event.
    const otherCtx = makeFullContext();
    otherCtx.broadcast.openForWorkspace(WS);
    ctx.broadcast.openForWorkspace(WS);

    otherCtx.broadcast.publish({
      kind: 'edit',
      objectId: obj.id,
      baseVersion: 1,
      patch: [{ op: 'replace', path: '/text', value: 'Patched via broadcast' }],
    });

    await new Promise(resolve => setTimeout(resolve, 20));
    await ctx.canvas.loadForWorkspace(WS);
    const objects = await firstValueFrom(ctx.canvas.objects$);
    expect(objects.find(o => o.id === obj.id)?.text).toBe('Patched via broadcast');
  });
});
