import { describe, it, expect, beforeEach } from 'vitest';
import { filter, firstValueFrom, take } from 'rxjs';
import { DbService } from '../src/app/core/db.service';
import { PrefsService } from '../src/app/core/prefs.service';
import { TabIdentityService } from '../src/app/core/tab-identity.service';
import { BroadcastService } from '../src/app/core/broadcast.service';
import { AuthService } from '../src/app/auth/auth.service';
import { WorkspaceService } from '../src/app/workspace/workspace.service';
import { AppException } from '../src/app/core/error';
import { makeContext, createAndSignIn } from './helpers';

describe('WorkspaceService', () => {
  let db: DbService;
  let prefs: PrefsService;
  let tab: TabIdentityService;
  let broadcast: BroadcastService;
  let auth: AuthService;
  let workspace: WorkspaceService;

  beforeEach(async () => {
    const ctx = makeContext();
    db = ctx.db;
    prefs = ctx.prefs;
    tab = ctx.tab;
    broadcast = ctx.broadcast;
    auth = ctx.auth;
    workspace = new WorkspaceService(db, prefs, broadcast, auth);
    // Sign in so workspace.create() works
    await createAndSignIn(auth);
  });

  // ── list ───────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns empty array when no workspaces exist', async () => {
      const list = await workspace.list();
      expect(list).toEqual([]);
    });

    it('returns summaries of all created workspaces', async () => {
      await workspace.create('Alpha');
      await workspace.create('Beta');
      const list = await workspace.list();
      expect(list).toHaveLength(2);
      const names = list.map(w => w.name);
      expect(names).toContain('Alpha');
      expect(names).toContain('Beta');
    });

    it('summary contains id, name, ownerProfileId, updatedAt', async () => {
      await workspace.create('Test');
      const [w] = await workspace.list();
      expect(w).toHaveProperty('id');
      expect(w).toHaveProperty('name', 'Test');
      expect(w).toHaveProperty('ownerProfileId');
      expect(w).toHaveProperty('updatedAt');
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates a workspace with the given name', async () => {
      const ws = await workspace.create('My Workspace');
      expect(ws.name).toBe('My Workspace');
      expect(ws.id).toBeTruthy();
      expect(ws.version).toBe(1);
    });

    it('sets ownerProfileId to the signed-in profile', async () => {
      const ws = await workspace.create('Owned');
      expect(ws.ownerProfileId).toBe(auth.currentProfile?.id);
    });

    it('throws NotFound when no profile is signed in', async () => {
      await auth.signOut();
      await expect(workspace.create('Fail')).rejects.toSatisfy(
        (e: AppException) => e.error.code === 'NotFound',
      );
    });

    it('assigns unique ids to each workspace', async () => {
      const ws1 = await workspace.create('A');
      const ws2 = await workspace.create('B');
      expect(ws1.id).not.toBe(ws2.id);
    });
  });

  // ── open ───────────────────────────────────────────────────────────────────

  describe('open()', () => {
    it('sets the active workspace', async () => {
      const ws = await workspace.create('MyWS');
      await workspace.open(ws.id);
      expect(workspace.active?.id).toBe(ws.id);
    });

    it('stores lastOpenedWorkspaceId in prefs', async () => {
      const ws = await workspace.create('MyWS');
      await workspace.open(ws.id);
      expect(prefs.get('lastOpenedWorkspaceId')).toBe(ws.id);
    });

    it('throws NotFound for unknown id', async () => {
      await expect(workspace.open('no-such-id')).rejects.toSatisfy(
        (e: AppException) => e.error.code === 'NotFound',
      );
    });
  });

  // ── rename ─────────────────────────────────────────────────────────────────

  describe('rename()', () => {
    it('updates the workspace name', async () => {
      const ws = await workspace.create('Old Name');
      await workspace.rename(ws.id, 'New Name');
      const list = await workspace.list();
      const updated = list.find(w => w.id === ws.id);
      expect(updated?.name).toBe('New Name');
    });

    it('increments version on rename', async () => {
      const ws = await workspace.create('Original');
      await workspace.open(ws.id);
      await workspace.rename(ws.id, 'Renamed');
      expect(workspace.active?.version).toBe(2);
    });

    it('updates active$ if the renamed workspace is currently active', async () => {
      const ws = await workspace.create('Active');
      await workspace.open(ws.id);
      await workspace.rename(ws.id, 'Updated');
      expect(workspace.active?.name).toBe('Updated');
    });

    it('throws NotFound for unknown id', async () => {
      await expect(workspace.rename('ghost', 'Fail')).rejects.toSatisfy(
        (e: AppException) => e.error.code === 'NotFound',
      );
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('removes the workspace from storage', async () => {
      const ws = await workspace.create('DeleteMe');
      await workspace.delete(ws.id);
      const list = await workspace.list();
      expect(list.find(w => w.id === ws.id)).toBeUndefined();
    });

    it('clears active$ when deleting the active workspace', async () => {
      const ws = await workspace.create('Active');
      await workspace.open(ws.id);
      await workspace.delete(ws.id);
      expect(workspace.active).toBeNull();
    });

    it('does not affect active$ when deleting a non-active workspace', async () => {
      const ws1 = await workspace.create('Active');
      const ws2 = await workspace.create('Other');
      await workspace.open(ws1.id);
      await workspace.delete(ws2.id);
      expect(workspace.active?.id).toBe(ws1.id);
    });
  });

  // ── active$ observable ─────────────────────────────────────────────────────

  describe('active$', () => {
    it('emits null initially', async () => {
      const v = await firstValueFrom(workspace.active$);
      expect(v).toBeNull();
    });

    it('emits the workspace after open()', async () => {
      const ws = await workspace.create('Observable');
      await workspace.open(ws.id);
      const active = await firstValueFrom(
        workspace.active$.pipe(filter((a): a is NonNullable<typeof a> => a !== null), take(1)),
      );
      expect(active.id).toBe(ws.id);
    });
  });
});
