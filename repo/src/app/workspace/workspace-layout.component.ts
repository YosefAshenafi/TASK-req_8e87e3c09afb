import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { WorkspaceService } from './workspace.service';
import { AuthService } from '../auth/auth.service';
import { BroadcastService } from '../core/broadcast.service';
import { TabIdentityService } from '../core/tab-identity.service';
import { PrefsService } from '../core/prefs.service';
import { PresenceService } from '../presence/presence.service';
import { CommentService } from '../comments/comment.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { PersonaService } from '../auth/persona.service';
import { PackageService } from '../import-export/package.service';
import { ToastService } from '../core/toast.service';
import { CanvasComponent } from '../canvas/canvas.component';
import { ChatPanelComponent } from '../chat/chat-panel.component';
import { CommentDrawerComponent } from '../comments/comment-drawer.component';
import { InboxPanelComponent } from '../inbox/inbox-panel.component';
import { MutualHelpBoardComponent } from '../mutual-help/mutual-help-board.component';
import { ActivityFeedComponent } from '../presence/activity-feed.component';
import { NoteImportWizardComponent } from '../import-export/note-import-wizard.component';
import { PackageImportConflictDialogComponent } from '../import-export/package-import-conflict-dialog.component';
import { SnapshotPanelComponent } from '../snapshot/snapshot-panel.component';
import { SnapshotService } from '../snapshot/snapshot.service';
import { CanvasService } from '../canvas/canvas.service';
import { MutualHelpService } from '../mutual-help/mutual-help.service';
import type { Workspace } from '../core/types';
import type { ConflictChoice } from '../import-export/package.service';

type ActiveView = 'canvas' | 'mutual-help';

// Derive avatar colour from a string (same palette as chat)
const AVATAR_PALETTE = [
  '#1e88e5', '#43a047', '#e53935', '#8e24aa',
  '#f57c00', '#00897b', '#6d4c41', '#546e7a',
];
function peerColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(31, h) + id.charCodeAt(i) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}
function peerInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

@Component({
  selector: 'app-workspace-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    CanvasComponent,
    ChatPanelComponent,
    CommentDrawerComponent,
    InboxPanelComponent,
    MutualHelpBoardComponent,
    ActivityFeedComponent,
    NoteImportWizardComponent,
    PackageImportConflictDialogComponent,
    SnapshotPanelComponent,
  ],
  template: `
    <div class="workspace-shell" [attr.data-workspace-id]="workspaceId()">

      <!-- ── Header ─────────────────────────────────────────────── -->
      <header class="ws-header">
        <a routerLink="/workspaces" class="ws-back" aria-label="Back to workspaces">←</a>
        <span class="ws-title">{{ workspace()?.name ?? 'Loading…' }}</span>

        <!-- View tabs -->
        <div class="view-tabs" role="tablist">
          <button
            class="view-tab"
            [class.active]="activeView() === 'canvas'"
            (click)="activeView.set('canvas')"
            role="tab"
            [attr.aria-selected]="activeView() === 'canvas'"
          >Canvas</button>
          <button
            class="view-tab"
            [class.active]="activeView() === 'mutual-help'"
            (click)="activeView.set('mutual-help')"
            role="tab"
            [attr.aria-selected]="activeView() === 'mutual-help'"
          >Mutual Help</button>
        </div>

        <!-- Peer avatar bar -->
        <div class="avatar-bar" aria-label="Active collaborators" role="list">
          <!-- Own avatar -->
          <div
            class="avatar"
            [style.background]="tab.color"
            [title]="(auth.currentProfile?.username ?? 'Me') + ' (you)'"
            role="listitem"
          >{{ initials() }}</div>

          <!-- Peer avatars -->
          @for (peer of peers(); track peer.tabId) {
            <div
              class="avatar peer-avatar"
              [style.background]="peerColor(peer.profileId)"
              [style.border-color]="peer.color"
              [title]="peer.profileId + ' (' + peer.role + ')'"
              role="listitem"
            >{{ peerInitials(peer.profileId) }}</div>
          }
        </div>

        <!-- H-01 / H-02 / H-03: persona-gated import / export / reporting convenience actions -->
        @if (canImportNotes()) {
          <button
            class="header-btn"
            type="button"
            (click)="openNoteImport()"
            title="Bulk import notes (CSV / JSON)"
            aria-label="Bulk import notes"
          >📥 Notes</button>
        }
        @if (canImportPackage()) {
          <label class="header-btn" title="Import workspace package" aria-label="Import workspace package">
            📦 Import
            <input
              type="file"
              accept=".srpackage,.zip,application/zip"
              style="display:none"
              (change)="onPackageFileSelected($event)"
            />
          </label>
        }
        @if (canExport()) {
          <button
            class="header-btn"
            type="button"
            (click)="exportPackage()"
            [disabled]="exporting()"
            title="Export workspace package"
            aria-label="Export workspace package"
          >{{ exporting() ? '…' : '⬇ Export' }}</button>
        }
        @if (canViewReporting()) {
          <a
            class="header-btn"
            routerLink="/reporting"
            title="View KPIs & reports"
            aria-label="View reporting"
          >📊 Reports</a>
        }

        <!-- F-B01: Snapshots toggle + dropdown -->
        <div class="header-dropdown">
          <button
            class="header-btn"
            [class.active]="showSnapshots()"
            (click)="showSnapshots.update(v => !v)"
            aria-label="Toggle snapshots"
            title="Snapshots (autosave + one-click rollback)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                 stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"
                 style="width:16px;height:16px;display:block">
              <path d="M3 12a9 9 0 1 0 9-9"/>
              <polyline points="3 4 3 10 9 10"/>
              <polyline points="12 7 12 12 16 14"/>
            </svg>
          </button>
          @if (showSnapshots()) {
            <div class="header-panel">
              <app-snapshot-panel
                [workspaceId]="workspaceId()"
                (closed)="showSnapshots.set(false)"
                (rolledBack)="onRolledBack($event)"
              />
            </div>
          }
        </div>

        <!-- Activity feed toggle + dropdown -->
        <div class="header-dropdown">
          <button
            class="header-btn"
            [class.active]="showActivityFeed()"
            (click)="showActivityFeed.update(v => !v)"
            aria-label="Toggle activity feed"
            title="Activity feed"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                 stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"
                 style="width:16px;height:16px;display:block">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </button>
          @if (showActivityFeed()) {
            <div class="header-panel">
              <app-activity-feed
                (closed)="showActivityFeed.set(false)"
                (objectOpened)="onActivityObjectOpened($event)"
              />
            </div>
          }
        </div>

        <!-- Inbox toggle + dropdown -->
        <div class="header-dropdown">
          <button
            class="header-btn inbox-btn"
            [class.active]="showInbox()"
            (click)="showInbox.update(v => !v)"
            aria-label="Toggle inbox"
            title="Inbox"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                 stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"
                 style="width:16px;height:16px;display:block">
              <polyline points="22 13 16 13 14 16 10 16 8 13 2 13"/>
              <path d="M5.45 5.11 2 13v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-7.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
            </svg>
            @if (unreadCount() > 0) {
              <span class="inbox-badge">{{ unreadCount() }}</span>
            }
          </button>
          @if (showInbox()) {
            <div class="header-panel">
              <app-inbox-panel
                [profileId]="profileId()"
                (closed)="showInbox.set(false)"
              />
            </div>
          }
        </div>
      </header>

      <!-- ── Main content area ────────────────────────────────────── -->
      <div class="ws-body">

        <!-- Left/main panel -->
        <main class="ws-main-area" aria-label="Main content">

          <!-- Canvas view -->
          @if (activeView() === 'canvas') {
            <div class="ws-canvas-area" aria-label="Canvas">
              <app-canvas
                [workspaceId]="workspaceId()"
                (openComments)="onOpenComments($event)"
              />
            </div>
          }

          <!-- Mutual-help board view -->
          @if (activeView() === 'mutual-help') {
            <div class="ws-mutual-area" aria-label="Mutual Help Board">
              <app-mutual-help-board
                [workspaceId]="workspaceId()"
                [profileId]="profileId()"
              />
            </div>
          }
        </main>

        <!-- Right chat panel -->
        <aside class="ws-chat-panel" aria-label="Chat">
          <app-chat-panel [workspaceId]="workspaceId()" />
        </aside>
      </div>

      <!-- ── Comment drawer ─────────────────────────────────────── -->
      @if (commentTargetId()) {
        <app-comment-drawer
          [targetId]="commentTargetId()!"
          [workspaceId]="workspaceId()"
          [profileId]="profileId()"
          [username]="auth.currentProfile?.username ?? ''"
          (closed)="commentTargetId.set(null)"
        />
      }

      <!-- ── Note import wizard (H-02) ─────────────────────────── -->
      @if (showNoteImport()) {
        <app-note-import-wizard
          [workspaceId]="workspaceId()"
          (closed)="showNoteImport.set(false)"
          (imported)="onNotesImported($event)"
        />
      }

      <!-- ── Package import 3-way conflict dialog (H-03) ──────── -->
      @if (conflictPrompt(); as c) {
        <app-package-import-conflict-dialog
          [existingName]="c.name"
          (decide)="resolveConflict($event)"
        />
      }

      <!-- ── Footer status bar ──────────────────────────────────── -->
      <footer class="ws-footer">
        <span class="offline-badge" aria-label="App offline ready">Offline ready ✓</span>
        @if (peers().length > 0) {
          <span class="peers-badge">{{ peers().length }} peer{{ peers().length === 1 ? '' : 's' }} online</span>
        }
        <span class="tab-badge" [style.background]="tab.color">Tab {{ tab.tabId.slice(0, 6) }}</span>
      </footer>
    </div>
  `,
  styleUrl: './workspace-layout.component.scss',
})
export class WorkspaceLayoutComponent implements OnInit, OnDestroy {
  protected workspace     = signal<Workspace | null>(null);
  protected workspaceId   = signal('');
  protected activeView    = signal<ActiveView>('canvas');
  protected commentTargetId = signal<string | null>(null);
  protected showInbox     = signal(false);
  protected showActivityFeed = signal(false);
  protected showNoteImport = signal(false);
  protected exporting = signal(false);
  /** F-B01: controls the snapshot dropdown visibility. */
  protected showSnapshots = signal(false);

  /** H-03: pending conflict dialog state — resolved when the user picks a choice. */
  protected conflictPrompt = signal<{
    name: string;
    resolve: (choice: ConflictChoice) => void;
  } | null>(null);

  private readonly presence       = inject(PresenceService);
  private readonly commentService = inject(CommentService);
  private readonly telemetry      = inject(TelemetryService);
  private readonly persona        = inject(PersonaService);
  private readonly packageService = inject(PackageService);
  private readonly toast          = inject(ToastService);
  // F-B01: snapshot autosave + rollback lifecycle plumbing
  private readonly snapshotService = inject(SnapshotService);
  private readonly canvasService   = inject(CanvasService);
  private readonly mutualHelp      = inject(MutualHelpService);

  protected peers       = toSignal(this.presence.peers$, { initialValue: [] });
  protected unreadCount = toSignal(this.commentService.unreadCount$, { initialValue: 0 });

  protected profileId = computed(() => this.auth.currentProfile?.id ?? '');
  protected initials  = computed(() => {
    const name = this.auth.currentProfile?.username ?? '?';
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  });

  // Expose helpers to template
  protected readonly peerColor    = peerColor;
  protected readonly peerInitials = peerInitials;

  // H-01: persona-gated convenience actions exposed to the template
  protected canImportNotes   = computed(() => this.persona.hasCap('import-package'));
  protected canImportPackage = computed(() => this.persona.hasCap('import-package'));
  protected canExport        = computed(() => this.persona.hasCap('export-package'));
  protected canViewReporting = computed(() => this.persona.hasCap('view-reporting'));

  private _subs = new Subscription();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly wsService: WorkspaceService,
    protected readonly auth: AuthService,
    protected readonly tab: TabIdentityService,
    private readonly broadcast: BroadcastService,
    private readonly prefs: PrefsService,
  ) {}

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.workspaceId.set(id);

    try {
      await this.wsService.open(id);
    } catch {
      this.router.navigate(['/workspaces']);
      return;
    }

    this._subs.add(
      this.wsService.active$.subscribe(ws => this.workspace.set(ws)),
    );

    // Start presence heartbeat
    this.presence.startHeartbeat();

    // H-05: boot the telemetry aggregator worker for this workspace
    this.telemetry.boot(id);

    // F-B01: start snapshot autosave for this workspace. `getState()` is
    // called every tick when the workspace has been marked dirty; it
    // returns the full state payload that gets captured and (on rollback)
    // restored back to the live stores.
    this.snapshotService.startAutoSave(id, () => this._collectState());

    // Mark dirty on canvas / mutual-help mutations so autosave captures
    // them on the next tick. Chat and comments are intentionally excluded
    // from the snapshot payload (they have their own rolling history) but
    // still drive the dirty flag so snapshot cadence reflects real work.
    this._subs.add(
      this.canvasService.objects$.subscribe(() => this.snapshotService.markDirty()),
    );
    this._subs.add(
      this.mutualHelp.posts$.subscribe(() => this.snapshotService.markDirty()),
    );
  }

  ngOnDestroy(): void {
    this.presence.stopHeartbeat();
    this.telemetry.terminate();
    // F-B01: stop autosave on workspace close
    this.snapshotService.stopAutoSave();
    this._subs.unsubscribe();
  }

  /** F-B01: compose the state payload captured by SnapshotService. */
  private _collectState(): Record<string, unknown> {
    return {
      canvas: this.canvasService.objectsValue,
      mutualHelp: this.mutualHelp.postsValue,
    };
  }

  protected onOpenComments(targetId: string): void {
    this.commentTargetId.set(
      this.commentTargetId() === targetId ? null : targetId,
    );
  }

  /**
   * F-H04: when a user clicks an object link in the activity feed, open the
   * comment drawer for that object (works for any canvas object and for
   * mutual-help posts / chat targets since the drawer keys on an id).
   */
  protected onActivityObjectOpened(e: { objectId: string; objectType?: string }): void {
    this.showActivityFeed.set(false);
    this.commentTargetId.set(e.objectId);
  }

  /**
   * F-B01: after a rollback, reload the services that back the visible UI
   * so the canvas / mutual-help board reflect the restored state.
   */
  protected async onRolledBack(_seq: number): Promise<void> {
    const id = this.workspaceId();
    if (!id) return;
    try {
      await this.canvasService.loadForWorkspace(id);
      await this.mutualHelp.loadForWorkspace(id);
    } catch {
      // Services surface their own errors via toasts where appropriate.
    }
  }

  // ── H-02: bulk note import wizard entry ────────────────────────────────
  protected openNoteImport(): void {
    if (!this.canImportNotes()) return;
    this.showNoteImport.set(true);
  }

  protected onNotesImported(_count: number): void {
    // Wizard handles its own toast; nothing to do here right now.
  }

  // ── H-03: package import with 3-way conflict resolution ────────────────
  protected async onPackageFileSelected(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so selecting the same file again re-triggers the flow.
    input.value = '';
    if (!file || !this.canImportPackage()) return;

    try {
      const result = await this.packageService.import(file, (name) =>
        new Promise<ConflictChoice>((resolve) => {
          this.conflictPrompt.set({ name, resolve });
        }),
      );
      this.conflictPrompt.set(null);

      if (result.ok) {
        this.toast.show(
          `Workspace ${result.action} from package.`,
          'success',
        );
        // If this is the active workspace, navigate to refresh state.
        if (result.workspaceId === this.workspaceId()) {
          this.router.navigate(['/w', result.workspaceId]);
        } else if (result.action === 'copied' || result.action === 'created') {
          this.router.navigate(['/w', result.workspaceId]);
        }
      } else if (result.reason === 'Cancelled') {
        this.toast.show('Package import cancelled.', 'info');
      } else {
        this.toast.show(result.detail ?? `Import failed: ${result.reason}`, 'error');
      }
    } catch (err) {
      this.conflictPrompt.set(null);
      this.toast.show(
        err instanceof Error ? err.message : 'Package import failed',
        'error',
      );
    }
  }

  protected resolveConflict(choice: ConflictChoice): void {
    const pending = this.conflictPrompt();
    if (!pending) return;
    pending.resolve(choice);
    // PackageService.import() will set or clear the prompt when it returns;
    // hiding here would also work but let the importer's completion path drive it.
  }

  protected async exportPackage(): Promise<void> {
    if (!this.canExport() || this.exporting()) return;
    this.exporting.set(true);
    try {
      const result = await this.packageService.export(this.workspaceId());
      this.toast.show(
        result.ok ? 'Workspace exported.' : (result.detail ?? 'Export cancelled.'),
        result.ok ? 'success' : 'info',
      );
    } catch (err) {
      this.toast.show(
        err instanceof Error ? err.message : 'Export failed',
        'error',
      );
    } finally {
      this.exporting.set(false);
    }
  }
}
