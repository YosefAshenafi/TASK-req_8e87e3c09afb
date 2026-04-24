/**
 * WorkspaceLayoutComponent — behavioral unit tests.
 * Uses runInInjectionContext so inject() class-field initialisers resolve
 * without Angular TestBed. All inject()-resolved services are provided as mocks.
 * Tests focus on logic methods: comment toggling, activity feed, conflict
 * resolution, persona-gated capabilities, note import guard, and export flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { WorkspaceLayoutComponent } from '../src/app/workspace/workspace-layout.component';
import { PresenceService } from '../src/app/presence/presence.service';
import { CommentService } from '../src/app/comments/comment.service';
import { TelemetryService } from '../src/app/telemetry/telemetry.service';
import { PersonaService } from '../src/app/auth/persona.service';
import { PackageService } from '../src/app/import-export/package.service';
import { ToastService } from '../src/app/core/toast.service';
import { SnapshotService } from '../src/app/snapshot/snapshot.service';
import { CanvasService } from '../src/app/canvas/canvas.service';
import { MutualHelpService } from '../src/app/mutual-help/mutual-help.service';
import type { ConflictChoice } from '../src/app/import-export/package.service';

// ─── setup helpers ────────────────────────────────────────────────────────────

function makeLayout(hapCap = false) {
  const presence = {
    peers$: new BehaviorSubject<unknown[]>([]),
    startHeartbeat: vi.fn(),
    stopHeartbeat: vi.fn(),
  };
  const commentService = {
    unreadCount$: new BehaviorSubject(0),
    inbox$: new BehaviorSubject<unknown[]>([]),
  };
  const telemetry = { boot: vi.fn(), terminate: vi.fn() };
  const persona = { hasCap: vi.fn().mockReturnValue(hapCap) };
  const packageService = {
    import: vi.fn(),
    export: vi.fn().mockResolvedValue({ ok: true }),
  };
  const toast = { show: vi.fn() };
  const snapshotService = {
    startAutoSave: vi.fn(),
    stopAutoSave: vi.fn(),
    markDirty: vi.fn(),
  };
  const canvasService = {
    objects$: new BehaviorSubject<unknown[]>([]),
    loadForWorkspace: vi.fn().mockResolvedValue(undefined),
    objectsValue: [],
  };
  const mutualHelp = {
    posts$: new BehaviorSubject<unknown[]>([]),
    loadForWorkspace: vi.fn().mockResolvedValue(undefined),
    postsValue: [],
  };

  const route = { snapshot: { paramMap: { get: vi.fn().mockReturnValue('ws-test-1') } } };
  const router = { navigate: vi.fn().mockResolvedValue(true) };
  const wsService = {
    open: vi.fn().mockResolvedValue(undefined),
    active$: new BehaviorSubject(null),
  };
  const auth = { currentProfile: { id: 'p1', username: 'alice', role: 'Teacher' } };
  const tab = { color: '#1e88e5', tabId: 'tab-abc123456789' };
  const broadcast = {};
  const prefs = {};

  const injector = Injector.create({
    providers: [
      { provide: PresenceService, useValue: presence },
      { provide: CommentService, useValue: commentService },
      { provide: TelemetryService, useValue: telemetry },
      { provide: PersonaService, useValue: persona },
      { provide: PackageService, useValue: packageService },
      { provide: ToastService, useValue: toast },
      { provide: SnapshotService, useValue: snapshotService },
      { provide: CanvasService, useValue: canvasService },
      { provide: MutualHelpService, useValue: mutualHelp },
    ],
  });

  let component!: WorkspaceLayoutComponent;
  runInInjectionContext(injector, () => {
    component = new WorkspaceLayoutComponent(
      route as never,
      router as never,
      wsService as never,
      auth as never,
      tab as never,
      broadcast as never,
      prefs as never,
    );
  });

  type C = WorkspaceLayoutComponent & {
    commentTargetId: ReturnType<typeof import('@angular/core').signal<string | null>>;
    showActivityFeed: ReturnType<typeof import('@angular/core').signal<boolean>>;
    showNoteImport: ReturnType<typeof import('@angular/core').signal<boolean>>;
    showSnapshots: ReturnType<typeof import('@angular/core').signal<boolean>>;
    showInbox: ReturnType<typeof import('@angular/core').signal<boolean>>;
    exporting: ReturnType<typeof import('@angular/core').signal<boolean>>;
    conflictPrompt: ReturnType<typeof import('@angular/core').signal<{ name: string; resolve: (c: ConflictChoice) => void } | null>>;
    workspaceId: ReturnType<typeof import('@angular/core').signal<string>>;
    canImportNotes: () => boolean;
    canImportPackage: () => boolean;
    canExport: () => boolean;
    canViewReporting: () => boolean;
    onOpenComments: (id: string) => void;
    onActivityObjectOpened: (e: { objectId: string }) => void;
    resolveConflict: (c: ConflictChoice) => void;
    openNoteImport: () => void;
    exportPackage: () => Promise<void>;
  };

  return {
    component: component as C,
    presence, commentService, telemetry, persona, packageService, toast,
    snapshotService, canvasService, mutualHelp, router, wsService,
  };
}

// ─── onOpenComments ───────────────────────────────────────────────────────────

describe('onOpenComments()', () => {
  it('sets commentTargetId when currently null', () => {
    const { component } = makeLayout();
    component.onOpenComments('obj-abc');
    expect(component.commentTargetId()).toBe('obj-abc');
  });

  it('clears commentTargetId when the same id is passed a second time (toggle)', () => {
    const { component } = makeLayout();
    component.onOpenComments('obj-abc');
    component.onOpenComments('obj-abc');
    expect(component.commentTargetId()).toBeNull();
  });

  it('switches to the new id when a different id is passed', () => {
    const { component } = makeLayout();
    component.onOpenComments('obj-1');
    component.onOpenComments('obj-2');
    expect(component.commentTargetId()).toBe('obj-2');
  });
});

// ─── onActivityObjectOpened ───────────────────────────────────────────────────

describe('onActivityObjectOpened()', () => {
  it('sets commentTargetId to the objectId', () => {
    const { component } = makeLayout();
    component.onActivityObjectOpened({ objectId: 'post-99' });
    expect(component.commentTargetId()).toBe('post-99');
  });

  it('closes the activity feed when an object is opened', () => {
    const { component } = makeLayout();
    component.showActivityFeed.set(true);
    component.onActivityObjectOpened({ objectId: 'post-99' });
    expect(component.showActivityFeed()).toBe(false);
  });
});

// ─── resolveConflict ──────────────────────────────────────────────────────────

describe('resolveConflict()', () => {
  it('calls the pending resolve function with "overwrite"', () => {
    const { component } = makeLayout();
    const resolve = vi.fn();
    component.conflictPrompt.set({ name: 'My WS', resolve });
    component.resolveConflict('overwrite');
    expect(resolve).toHaveBeenCalledWith('overwrite');
  });

  it('calls the pending resolve function with "copy"', () => {
    const { component } = makeLayout();
    const resolve = vi.fn();
    component.conflictPrompt.set({ name: 'My WS', resolve });
    component.resolveConflict('copy');
    expect(resolve).toHaveBeenCalledWith('copy');
  });

  it('calls the pending resolve function with "cancel"', () => {
    const { component } = makeLayout();
    const resolve = vi.fn();
    component.conflictPrompt.set({ name: 'My WS', resolve });
    component.resolveConflict('cancel');
    expect(resolve).toHaveBeenCalledWith('cancel');
  });

  it('is a no-op when conflictPrompt is null (no pending conflict)', () => {
    const { component } = makeLayout();
    expect(() => component.resolveConflict('cancel')).not.toThrow();
  });
});

// ─── persona-gated capabilities ───────────────────────────────────────────────

describe('persona-gated capability computed signals', () => {
  it('canImportNotes() returns false when persona lacks the capability', () => {
    const { component } = makeLayout(false);
    expect(component.canImportNotes()).toBe(false);
  });

  it('canImportNotes() returns true when persona has import-package capability', () => {
    const { component } = makeLayout(true);
    expect(component.canImportNotes()).toBe(true);
  });

  it('canImportPackage() returns false when persona lacks the capability', () => {
    const { component } = makeLayout(false);
    expect(component.canImportPackage()).toBe(false);
  });

  it('canExport() returns false when persona lacks the capability', () => {
    const { component } = makeLayout(false);
    expect(component.canExport()).toBe(false);
  });

  it('canExport() returns true when persona has export-package capability', () => {
    const { component, persona } = makeLayout(false);
    persona.hasCap.mockImplementation((cap: string) => cap === 'export-package');
    expect(component.canExport()).toBe(true);
    expect(component.canImportNotes()).toBe(false);
  });

  it('canViewReporting() returns false when persona lacks the capability', () => {
    const { component } = makeLayout(false);
    expect(component.canViewReporting()).toBe(false);
  });

  it('canViewReporting() returns true when persona has view-reporting capability', () => {
    const { component, persona } = makeLayout(false);
    persona.hasCap.mockImplementation((cap: string) => cap === 'view-reporting');
    expect(component.canViewReporting()).toBe(true);
  });
});

// ─── openNoteImport ───────────────────────────────────────────────────────────

describe('openNoteImport()', () => {
  it('sets showNoteImport to true when the user has import capability', () => {
    const { component } = makeLayout(true);
    component.openNoteImport();
    expect(component.showNoteImport()).toBe(true);
  });

  it('does NOT set showNoteImport when the user lacks import capability', () => {
    const { component } = makeLayout(false);
    component.openNoteImport();
    expect(component.showNoteImport()).toBe(false);
  });
});

// ─── exportPackage ────────────────────────────────────────────────────────────

describe('exportPackage()', () => {
  it('calls packageService.export with the current workspaceId', async () => {
    const { component, packageService } = makeLayout(true);
    component.workspaceId.set('ws-export-test');
    await component.exportPackage();
    expect(packageService.export).toHaveBeenCalledWith('ws-export-test');
  });

  it('shows a success toast when export returns ok: true', async () => {
    const { component, packageService, toast } = makeLayout(true);
    packageService.export.mockResolvedValue({ ok: true });
    await component.exportPackage();
    expect(toast.show).toHaveBeenCalledWith('Workspace exported.', 'success');
  });

  it('shows an info toast when export returns ok: false with a detail', async () => {
    const { component, packageService, toast } = makeLayout(true);
    packageService.export.mockResolvedValue({ ok: false, detail: 'Cancelled by user' });
    await component.exportPackage();
    expect(toast.show).toHaveBeenCalledWith('Cancelled by user', 'info');
  });

  it('shows an error toast when export throws', async () => {
    const { component, packageService, toast } = makeLayout(true);
    packageService.export.mockRejectedValue(new Error('Disk full'));
    await component.exportPackage();
    expect(toast.show).toHaveBeenCalledWith('Disk full', 'error');
  });

  it('resets exporting signal to false after a successful export', async () => {
    const { component } = makeLayout(true);
    await component.exportPackage();
    expect(component.exporting()).toBe(false);
  });

  it('resets exporting signal to false even when export throws', async () => {
    const { component, packageService } = makeLayout(true);
    packageService.export.mockRejectedValue(new Error('Network error'));
    await component.exportPackage();
    expect(component.exporting()).toBe(false);
  });

  it('does nothing when the user lacks export capability', async () => {
    const { component, packageService } = makeLayout(false);
    await component.exportPackage();
    expect(packageService.export).not.toHaveBeenCalled();
  });

  it('does nothing when already exporting (prevents double-submit)', async () => {
    const { component, packageService } = makeLayout(true);
    component.exporting.set(true);
    await component.exportPackage();
    expect(packageService.export).not.toHaveBeenCalled();
  });
});
