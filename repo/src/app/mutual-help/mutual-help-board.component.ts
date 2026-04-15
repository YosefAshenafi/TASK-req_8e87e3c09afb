import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { MutualHelpService } from './mutual-help.service';
import { AuthService } from '../auth/auth.service';
import { MutualHelpFormComponent } from './mutual-help-form.component';
import type { MutualHelpPost } from '../core/types';

type FilterTab = 'all' | 'active' | 'draft' | 'closed';

@Component({
  selector: 'app-mutual-help-board',
  standalone: true,
  imports: [CommonModule, FormsModule, MutualHelpFormComponent],
  template: `
    <div class="mh-board">
      <div class="mh-header">
        <h3 class="mh-title">Mutual Help Board</h3>
        <button class="new-post-btn" (click)="showForm.set(true)">+ New Post</button>
      </div>

      <div class="mh-filters">
        @for (tab of filterTabs; track tab) {
          <button
            [class.active]="activeFilter() === tab"
            (click)="activeFilter.set(tab)"
          >{{ tabLabel(tab) }} ({{ countFor(tab) }})</button>
        }
      </div>

      <div class="mh-list">
        @for (post of filteredPosts(); track post.id) {
          <div class="post-card">
            <div class="post-card-header">
              <span class="type-badge" [class.type-request]="post.type === 'request'" [class.type-offer]="post.type === 'offer'">
                {{ post.type === 'request' ? 'REQUEST' : 'OFFER' }}
              </span>
              <span
                class="urgency-badge"
                [class.urgency-low]="post.urgency === 'low'"
                [class.urgency-medium]="post.urgency === 'medium'"
                [class.urgency-high]="post.urgency === 'high'"
              >{{ post.urgency | uppercase }}</span>
              <span class="post-title">{{ post.title }}</span>
              @if (post.authorId === profileId) {
                <span class="my-badge">My post</span>
              }
            </div>

            <div class="post-sub-header">
              <span class="category-label">{{ post.category }}</span>
            </div>

            <p class="post-desc">{{ truncate(post.description, 100) }}</p>

            @if (post.tags.length > 0) {
              <div class="tags">
                @for (tag of post.tags; track tag) {
                  <span class="tag">{{ tag }}</span>
                }
              </div>
            }

            <div class="post-meta">
              @if (post.timeWindow) {
                <span>&#128344; {{ post.timeWindow }}</span>
              }
              @if (post.budget) {
                <span>&#128176; {{ post.budget }}</span>
              }
              <span>{{ expiryLabel(post.expiresAt) }}</span>
            </div>

            <div class="post-actions">
              <button
                class="action-btn pin-btn"
                (click)="togglePin(post)"
                [title]="post.pinned ? 'Unpin' : 'Pin'"
              >{{ post.pinned ? '📌' : '📍' }}</button>

              @if ((post.status === 'active' || post.status === 'draft') && post.authorId === profileId) {
                <button class="action-btn withdraw-btn" (click)="withdrawPost(post)">Withdraw</button>
              }

              @if (post.status === 'draft' && post.authorId === profileId) {
                <button class="action-btn publish-btn" (click)="publishPost(post)">Publish</button>
              }
            </div>
          </div>
        } @empty {
          <div class="empty-state">No posts in this category.</div>
        }
      </div>

      @if (showForm()) {
        <app-mutual-help-form
          [workspaceId]="workspaceId"
          [profileId]="profileId"
          (saved)="onFormSaved()"
          (cancelled)="showForm.set(false)"
        />
      }
    </div>
  `,
  styles: [`
    .mh-board { height:100%; display:flex; flex-direction:column; background:#f8f8f8; position:relative; }
    .mh-header { display:flex; justify-content:space-between; align-items:center; padding:16px 20px; background:#fff; border-bottom:1px solid #eee; }
    .mh-title { font-size:1rem; font-weight:600; margin:0; }
    .new-post-btn { background:#1e88e5; color:#fff; border:none; border-radius:8px; padding:8px 16px; cursor:pointer; font-weight:600; }
    .new-post-btn:hover { background:#1565c0; }
    .mh-filters { display:flex; gap:4px; padding:10px 16px; background:#fff; border-bottom:1px solid #eee; overflow-x:auto; }
    .mh-filters button { padding:5px 14px; border:1px solid #ddd; border-radius:20px; cursor:pointer; font-size:0.82rem; background:#f5f5f5; white-space:nowrap; }
    .mh-filters button.active { background:#1e88e5; color:#fff; border-color:#1565c0; }
    .mh-list { flex:1; overflow-y:auto; padding:12px 16px; display:flex; flex-direction:column; gap:10px; }
    .post-card { background:#fff; border-radius:10px; padding:14px 16px; box-shadow:0 1px 4px rgba(0,0,0,0.08); }
    .post-card-header { display:flex; gap:8px; align-items:center; margin-bottom:4px; flex-wrap:wrap; }
    .type-badge { padding:2px 9px; border-radius:12px; font-size:0.7rem; font-weight:700; }
    .type-request { background:#e3f0fd; color:#1565c0; }
    .type-offer { background:#e8f5e9; color:#2e7d32; }
    .urgency-badge { padding:2px 9px; border-radius:12px; font-size:0.7rem; font-weight:700; }
    .urgency-low { background:#e8f5e9; color:#2e7d32; }
    .urgency-medium { background:#fff3e0; color:#e65100; }
    .urgency-high { background:#ffebee; color:#c62828; }
    .post-title { font-weight:600; font-size:0.95rem; flex:1; }
    .my-badge { font-size:0.65rem; background:#f3e5f5; color:#6a1b9a; padding:1px 7px; border-radius:10px; white-space:nowrap; }
    .post-sub-header { margin-bottom:4px; }
    .category-label { font-size:0.75rem; color:#888; font-style:italic; }
    .post-desc { font-size:0.82rem; color:#555; margin:4px 0; line-height:1.4; }
    .tags { display:flex; gap:4px; flex-wrap:wrap; margin:6px 0; }
    .tag { background:#f0f0f0; color:#555; border-radius:10px; padding:2px 8px; font-size:0.72rem; }
    .post-meta { display:flex; gap:12px; font-size:0.75rem; color:#888; margin-top:6px; flex-wrap:wrap; }
    .post-actions { display:flex; gap:6px; margin-top:10px; border-top:1px solid #f0f0f0; padding-top:8px; flex-wrap:wrap; }
    .action-btn { padding:4px 12px; border:1px solid #ddd; border-radius:6px; cursor:pointer; font-size:0.78rem; background:#fff; }
    .action-btn:hover { background:#f5f5f5; }
    .pin-btn { font-size:0.85rem; }
    .withdraw-btn { color:#c62828; border-color:#ffcdd2; }
    .withdraw-btn:hover { background:#ffebee; }
    .publish-btn { color:#1565c0; border-color:#bbdefb; font-weight:600; }
    .publish-btn:hover { background:#e3f0fd; }
    .empty-state { color:#bbb; text-align:center; padding:40px; font-size:0.9rem; }
  `],
})
export class MutualHelpBoardComponent implements OnInit, OnDestroy {
  @Input() workspaceId = '';
  @Input() profileId = '';

  protected readonly filterTabs: FilterTab[] = ['all', 'active', 'draft', 'closed'];
  protected readonly activeFilter = signal<FilterTab>('all');
  protected readonly showForm = signal(false);

  private readonly allPosts = signal<MutualHelpPost[]>([]);

  protected readonly filteredPosts = computed(() => {
    const filter = this.activeFilter();
    const posts = this.allPosts();
    if (filter === 'all') return posts;
    if (filter === 'active') return posts.filter(p => p.status === 'active');
    if (filter === 'draft') return posts.filter(p => p.status === 'draft');
    if (filter === 'closed') return posts.filter(p => p.status === 'expired' || p.status === 'withdrawn');
    return posts;
  });

  private _sub: Subscription | null = null;

  constructor(
    private readonly mutualHelpService: MutualHelpService,
    private readonly auth: AuthService,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.mutualHelpService.loadForWorkspace(this.workspaceId);
    this._sub = this.mutualHelpService.posts$.subscribe(posts => {
      this.allPosts.set(posts);
    });
  }

  ngOnDestroy(): void {
    this._sub?.unsubscribe();
  }

  protected tabLabel(tab: FilterTab): string {
    const labels: Record<FilterTab, string> = {
      all: 'All',
      active: 'Active',
      draft: 'Draft',
      closed: 'Expired/Withdrawn',
    };
    return labels[tab];
  }

  protected countFor(tab: FilterTab): number {
    const posts = this.allPosts();
    if (tab === 'all') return posts.length;
    if (tab === 'active') return posts.filter(p => p.status === 'active').length;
    if (tab === 'draft') return posts.filter(p => p.status === 'draft').length;
    if (tab === 'closed') return posts.filter(p => p.status === 'expired' || p.status === 'withdrawn').length;
    return 0;
  }

  protected truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '…';
  }

  protected expiryLabel(expiresAt: number): string {
    const diff = expiresAt - Date.now();
    if (diff <= 0) return 'Expired';
    const totalMinutes = Math.floor(diff / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `Expires in ${hours}h ${minutes}m`;
  }

  protected async togglePin(post: MutualHelpPost): Promise<void> {
    try {
      await this.mutualHelpService.pin(post.id, !post.pinned);
    } catch {
      // silently ignore pin errors
    }
  }

  protected async withdrawPost(post: MutualHelpPost): Promise<void> {
    try {
      await this.mutualHelpService.withdraw(post.id);
    } catch {
      // silently ignore withdraw errors
    }
  }

  protected async publishPost(post: MutualHelpPost): Promise<void> {
    try {
      await this.mutualHelpService.publish(post.id);
    } catch {
      // silently ignore publish errors
    }
  }

  protected onFormSaved(): void {
    this.showForm.set(false);
  }
}
