/**
 * WORKSPACE API TESTS
 * Tests the complete workspace lifecycle through the real service API.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeFullContext, signUp } from './helpers';
import type { FullContext } from './helpers';

describe('Workspace API — full lifecycle', () => {
  let ctx: FullContext;

  beforeEach(async () => {
    ctx = makeFullContext();
    await signUp(ctx.auth, 'alice');
  });

  it('create → list → open → rename → delete', async () => {
    // Create
    const ws = await ctx.workspace.create('Design Board');
    expect(ws.id).toBeTruthy();
    expect(ws.name).toBe('Design Board');
    expect(ws.version).toBe(1);
    expect(ws.ownerProfileId).toBe(ctx.auth.currentProfile?.id);

    // List
    const list = await ctx.workspace.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Design Board');

    // Open
    await ctx.workspace.open(ws.id);
    expect(ctx.workspace.active?.id).toBe(ws.id);
    expect(ctx.prefs.get('lastOpenedWorkspaceId')).toBe(ws.id);

    // Rename
    await ctx.workspace.rename(ws.id, 'Renamed Board');
    const updated = await ctx.workspace.list();
    expect(updated[0].name).toBe('Renamed Board');
    expect(ctx.workspace.active?.name).toBe('Renamed Board');
    expect(ctx.workspace.active?.version).toBe(2);

    // Delete
    await ctx.workspace.delete(ws.id);
    const afterDelete = await ctx.workspace.list();
    expect(afterDelete).toHaveLength(0);
    expect(ctx.workspace.active).toBeNull();
  });

  it('multiple workspaces — independent CRUD', async () => {
    const ws1 = await ctx.workspace.create('Alpha');
    const ws2 = await ctx.workspace.create('Beta');
    const ws3 = await ctx.workspace.create('Gamma');

    const list = await ctx.workspace.list();
    expect(list).toHaveLength(3);

    // Delete only ws2
    await ctx.workspace.delete(ws2.id);

    const afterDelete = await ctx.workspace.list();
    expect(afterDelete).toHaveLength(2);
    expect(afterDelete.map(w => w.name)).toContain('Alpha');
    expect(afterDelete.map(w => w.name)).toContain('Gamma');
    expect(afterDelete.map(w => w.name)).not.toContain('Beta');
  });

  it('open workspace updates lastOpenedWorkspaceId pref', async () => {
    const ws1 = await ctx.workspace.create('First');
    const ws2 = await ctx.workspace.create('Second');

    await ctx.workspace.open(ws1.id);
    expect(ctx.prefs.get('lastOpenedWorkspaceId')).toBe(ws1.id);

    await ctx.workspace.open(ws2.id);
    expect(ctx.prefs.get('lastOpenedWorkspaceId')).toBe(ws2.id);
  });

  it('active$ observable reflects open/delete state changes', async () => {
    const ws = await ctx.workspace.create('Observable WS');

    await ctx.workspace.open(ws.id);
    const active = await firstValueFrom(ctx.workspace.active$);
    expect(active?.id).toBe(ws.id);

    await ctx.workspace.delete(ws.id);
    const afterDelete = await firstValueFrom(ctx.workspace.active$);
    expect(afterDelete).toBeNull();
  });

  it('each profile owns their workspaces (ownerProfileId)', async () => {
    const aliceProfile = ctx.auth.currentProfile;
    const ws = await ctx.workspace.create('Alice WS');
    expect(ws.ownerProfileId).toBe(aliceProfile?.id);

    // Bob signs in on the same DB
    await ctx.auth.signOut();
    await signUp(ctx.auth, 'bob', 'bobpass12');

    const bobWs = await ctx.workspace.create('Bob WS');
    expect(bobWs.ownerProfileId).toBe(ctx.auth.currentProfile?.id);
    expect(bobWs.ownerProfileId).not.toBe(aliceProfile?.id);
  });
});
