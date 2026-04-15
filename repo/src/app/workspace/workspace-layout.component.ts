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
import { CanvasComponent } from '../canvas/canvas.component';
import { ChatPanelComponent } from '../chat/chat-panel.component';
import { CommentDrawerComponent } from '../comments/comment-drawer.component';
import { InboxPanelComponent } from '../inbox/inbox-panel.component';
import { MutualHelpBoardComponent } from '../mutual-help/mutual-help-board.component';
import { ActivityFeedComponent } from '../presence/activity-feed.component';
import type { Workspace } from '../core/types';

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

        <!-- Activity feed toggle -->
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

        <!-- Inbox button -->
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

      <!-- ── Inbox panel ────────────────────────────────────────── -->
      @if (showInbox()) {
        <div class="inbox-overlay">
          <app-inbox-panel
            [profileId]="profileId()"
            (closed)="showInbox.set(false)"
          />
        </div>
      }

      <!-- ── Activity feed panel ────────────────────────────────── -->
      @if (showActivityFeed()) {
        <div class="activity-overlay">
          <app-activity-feed (closed)="showActivityFeed.set(false)" />
        </div>
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

  private readonly presence       = inject(PresenceService);
  private readonly commentService = inject(CommentService);

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
  }

  ngOnDestroy(): void {
    this.presence.stopHeartbeat();
    this._subs.unsubscribe();
  }

  protected onOpenComments(targetId: string): void {
    this.commentTargetId.set(
      this.commentTargetId() === targetId ? null : targetId,
    );
  }
}
