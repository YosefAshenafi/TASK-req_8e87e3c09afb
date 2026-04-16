/**
 * WorkspacesListComponent — logic unit tests.
 * Uses runInInjectionContext so that inject() class-field initialisers
 * (PersonaService, PrefsService) resolve without Angular TestBed.
 * Services are real instances backed by fake-indexeddb.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { DbService } from '../src/app/core/db.service';
import { PrefsService } from '../src/app/core/prefs.service';
import { TabIdentityService } from '../src/app/core/tab-identity.service';
import { BroadcastService } from '../src/app/core/broadcast.service';
import { AuthService } from '../src/app/auth/auth.service';
import { WorkspaceService } from '../src/app/workspace/workspace.service';
import { PersonaService } from '../src/app/auth/persona.service';
import { WorkspacesListComponent } from '../src/app/workspace/workspaces-list.component';
import { createAndSignIn } from './helpers';
import type { PersonaRole, WorkspaceSummary } from '../src/app/core/types';

function makeRouter(): Router {
  return { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router;
}

async function setup(role: PersonaRole = 'Admin') {
  const db = new DbService();
  const prefs = new PrefsService();
  const tab = new TabIdentityService();
  const broadcast = new BroadcastService(tab);
  const auth = new AuthService(db, prefs);
  const ws = new WorkspaceService(db, prefs, broadcast, auth);
  const persona = new PersonaService(prefs);
  const router = makeRouter();

  await createAndSignIn(auth, 'alice', 'password123', role);
  persona.setRole(role);

  const injector = Injector.create({
    providers: [
      { provide: PersonaService, useValue: persona },
      { provide: PrefsService, useValue: prefs },
    ],
  });

  let component!: WorkspacesListComponent;
  runInInjectionContext(injector, () => {
    component = new WorkspacesListComponent(auth, ws, router);
  });

  // Access protected/private members via cast
  type Internals = {
    workspaces: () => WorkspaceSummary[];
    newName: string;
    renaming: { (): WorkspaceSummary | null; set: (v: WorkspaceSummary | null) => void };
    renameValue: string;
    canDelete: () => boolean;
    createWorkspace: () => Promise<void>;
    openWorkspace: (id: string) => Promise<void>;
    startRename: (ws: WorkspaceSummary) => void;
    confirmRename: () => Promise<void>;
    deleteWorkspace: (id: string) => Promise<void>;
  };

  return { component: component as typeof component & Internals, auth, ws, router, persona, prefs };
}

describe('WorkspacesListComponent', () => {
  // ── ngOnInit ───────────────────────────────────────────────────────────────

  describe('ngOnInit()', () => {
    it('populates the workspaces signal from WorkspaceService', async () => {
      const { component, ws } = await setup();
      await ws.create('Alpha');
      await ws.create('Beta');

      await component.ngOnInit();

      const list = component.workspaces();
      expect(list).toHaveLength(2);
      expect(list.map(w => w.name)).toContain('Alpha');
      expect(list.map(w => w.name)).toContain('Beta');
    });

    it('workspaces signal is empty when no workspaces exist', async () => {
      const { component } = await setup();
      await component.ngOnInit();
      expect(component.workspaces()).toEqual([]);
    });

    it('navigates to lastOpenedWorkspaceId when it exists in the list', async () => {
      const { component, ws, prefs, router } = await setup();
      const workspace = await ws.create('My Workspace');
      prefs.set('lastOpenedWorkspaceId', workspace.id);

      await component.ngOnInit();

      expect(router.navigate).toHaveBeenCalledWith(['/w', workspace.id]);
    });

    it('does NOT navigate when lastOpenedWorkspaceId is not in the current list', async () => {
      const { component, prefs, router } = await setup();
      prefs.set('lastOpenedWorkspaceId', 'non-existent-id');

      await component.ngOnInit();

      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('does NOT navigate when lastOpenedWorkspaceId is not set', async () => {
      const { component, ws, router } = await setup();
      await ws.create('Workspace');

      await component.ngOnInit();

      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  // ── createWorkspace() ──────────────────────────────────────────────────────

  describe('createWorkspace()', () => {
    it('creates a workspace and refreshes the list', async () => {
      const { component } = await setup();
      await component.ngOnInit();

      component.newName = 'My New Workspace';
      await component.createWorkspace();

      expect(component.workspaces()).toHaveLength(1);
      expect(component.workspaces()[0].name).toBe('My New Workspace');
    });

    it('clears newName after creation', async () => {
      const { component } = await setup();
      await component.ngOnInit();

      component.newName = 'Test Workspace';
      await component.createWorkspace();

      expect(component.newName).toBe('');
    });

    it('does nothing when newName is empty', async () => {
      const { component } = await setup();
      await component.ngOnInit();

      component.newName = '';
      await component.createWorkspace();

      expect(component.workspaces()).toHaveLength(0);
    });

    it('does nothing when newName is whitespace only', async () => {
      const { component } = await setup();
      await component.ngOnInit();

      component.newName = '   ';
      await component.createWorkspace();

      expect(component.workspaces()).toHaveLength(0);
    });

    it('creates multiple workspaces correctly', async () => {
      const { component } = await setup();
      await component.ngOnInit();

      component.newName = 'First';
      await component.createWorkspace();
      component.newName = 'Second';
      await component.createWorkspace();

      expect(component.workspaces()).toHaveLength(2);
    });
  });

  // ── openWorkspace() ────────────────────────────────────────────────────────

  describe('openWorkspace()', () => {
    it('navigates to /w/:id', async () => {
      const { component, ws, router } = await setup();
      const workspace = await ws.create('Test');
      await component.ngOnInit();

      await component.openWorkspace(workspace.id);

      expect(router.navigate).toHaveBeenCalledWith(['/w', workspace.id]);
    });
  });

  // ── startRename() / confirmRename() ───────────────────────────────────────

  describe('startRename()', () => {
    it('sets renaming signal to the target workspace', async () => {
      const { component, ws } = await setup();
      const workspace = await ws.create('Original');
      await component.ngOnInit();
      const summary = component.workspaces()[0];

      component.startRename(summary);

      expect(component.renaming()).toEqual(summary);
    });

    it('sets renameValue to the current workspace name', async () => {
      const { component, ws } = await setup();
      await ws.create('Original Name');
      await component.ngOnInit();

      component.startRename(component.workspaces()[0]);

      expect(component.renameValue).toBe('Original Name');
    });
  });

  describe('confirmRename()', () => {
    it('renames the workspace and refreshes the list', async () => {
      const { component, ws } = await setup();
      await ws.create('Old Name');
      await component.ngOnInit();

      component.startRename(component.workspaces()[0]);
      component.renameValue = 'New Name';
      await component.confirmRename();

      expect(component.workspaces()[0].name).toBe('New Name');
    });

    it('clears renaming signal after confirm', async () => {
      const { component, ws } = await setup();
      await ws.create('Workspace');
      await component.ngOnInit();

      component.startRename(component.workspaces()[0]);
      await component.confirmRename();

      expect(component.renaming()).toBeNull();
    });

    it('is a no-op when renaming signal is null', async () => {
      const { component } = await setup();
      await component.ngOnInit();

      // Should not throw
      await expect(component.confirmRename()).resolves.toBeUndefined();
    });
  });

  // ── canDelete() ────────────────────────────────────────────────────────────

  describe('canDelete()', () => {
    it('returns true for Admin role', async () => {
      const { component } = await setup('Admin');
      expect(component.canDelete()).toBe(true);
    });

    it('returns false for Teacher role', async () => {
      const { component } = await setup('Teacher');
      expect(component.canDelete()).toBe(false);
    });

    it('returns false for Academic Affairs role', async () => {
      const { component } = await setup('Academic Affairs');
      expect(component.canDelete()).toBe(false);
    });
  });

  // ── deleteWorkspace() ──────────────────────────────────────────────────────

  describe('deleteWorkspace()', () => {
    it('deletes the workspace when Admin confirms', async () => {
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      const { component, ws } = await setup('Admin');
      const workspace = await ws.create('ToDelete');
      await component.ngOnInit();

      await component.deleteWorkspace(workspace.id);

      expect(component.workspaces()).toHaveLength(0);
      vi.restoreAllMocks();
    });

    it('does NOT delete when the user cancels the confirm dialog', async () => {
      vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
      const { component, ws } = await setup('Admin');
      const workspace = await ws.create('Kept');
      await component.ngOnInit();

      await component.deleteWorkspace(workspace.id);

      expect(component.workspaces()).toHaveLength(1);
      vi.restoreAllMocks();
    });

    it('does NOT delete when role is Teacher (no capability)', async () => {
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      const { component, ws } = await setup('Teacher');
      const workspace = await ws.create('Protected');
      await component.ngOnInit();

      await component.deleteWorkspace(workspace.id);

      // canDelete() returns false → method returns early without calling confirm or deleting
      expect(component.workspaces()).toHaveLength(1);
      vi.restoreAllMocks();
    });

    it('refreshes the list after successful deletion', async () => {
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      const { component, ws } = await setup('Admin');
      await ws.create('A');
      await ws.create('B');
      await component.ngOnInit();
      expect(component.workspaces()).toHaveLength(2);

      await component.deleteWorkspace(component.workspaces()[0].id);

      expect(component.workspaces()).toHaveLength(1);
      vi.restoreAllMocks();
    });
  });
});
