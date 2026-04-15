import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { WorkspaceService } from './workspace.service';
import { AuthService } from '../auth/auth.service';
import { BroadcastService } from '../core/broadcast.service';
import { TabIdentityService } from '../core/tab-identity.service';
import { PrefsService } from '../core/prefs.service';
import { CanvasComponent } from '../canvas/canvas.component';
import { ChatPanelComponent } from '../chat/chat-panel.component';
import type { Workspace } from '../core/types';

@Component({
  selector: 'app-workspace-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, CanvasComponent, ChatPanelComponent],
  template: `
    <div class="workspace-shell" [attr.data-workspace-id]="workspaceId()">

      <!-- ── Header ───────────────────────────────────────────── -->
      <header class="ws-header">
        <a routerLink="/workspaces" class="ws-back" aria-label="Back to workspaces">←</a>
        <span class="ws-title">{{ workspace()?.name ?? 'Loading…' }}</span>

        <!-- Avatar bar (Phase 7 will populate peers) -->
        <div class="avatar-bar" aria-label="Active collaborators" role="list">
          <div
            class="avatar"
            [style.background]="tab.color"
            [title]="auth.currentProfile?.username + ' (you)'"
            role="listitem"
          >
            {{ initials() }}
          </div>
        </div>

        <!-- Inbox badge placeholder (Phase 5) -->
        <button class="inbox-btn" aria-label="Inbox">
          <span aria-hidden="true">📥</span>
        </button>
      </header>

      <!-- ── Main content area ─────────────────────────────────── -->
      <div class="ws-body">

        <!-- Main canvas (includes its own toolbar) -->
        <main class="ws-canvas-area" aria-label="Canvas">
          <app-canvas [workspaceId]="workspaceId()" />
        </main>

        <!-- Right chat panel -->
        <aside class="ws-chat-panel" aria-label="Chat">
          <app-chat-panel [workspaceId]="workspaceId()" />
        </aside>
      </div>

      <!-- ── Footer status bar ─────────────────────────────────── -->
      <footer class="ws-footer">
        <span class="offline-badge" aria-label="App offline ready">Offline ready ✓</span>
        <span class="tab-badge" [style.background]="tab.color">Tab {{ tab.tabId.slice(0, 6) }}</span>
      </footer>
    </div>
  `,
  styleUrl: './workspace-layout.component.scss',
})
export class WorkspaceLayoutComponent implements OnInit, OnDestroy {
  protected workspace = signal<Workspace | null>(null);
  protected workspaceId = signal('');
  protected initials = computed(() => {
    const name = this.auth.currentProfile?.username ?? '?';
    return name.slice(0, 2).toUpperCase();
  });

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

    // Announce presence (Phase 7 will handle the full heartbeat loop)
    const profile = this.auth.currentProfile;
    if (profile) {
      this.broadcast.publishPresence({
        kind: 'presence',
        profileId: profile.id,
        role: profile.role as 'Admin' | 'Academic Affairs' | 'Teacher',
        color: this.tab.color,
        status: 'online',
      });
    }
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }
}
