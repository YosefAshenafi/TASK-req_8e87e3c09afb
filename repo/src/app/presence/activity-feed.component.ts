import {
  Component,
  Output,
  EventEmitter,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { PresenceService } from './presence.service';
import type { ActivityEntry } from '../core/types';

const DOT_COLORS = [
  '#1e88e5',
  '#43a047',
  '#e53935',
  '#8e24aa',
  '#f57c00',
  '#00897b',
];

function profileColor(profileId: string): string {
  let h = 0;
  for (let i = 0; i < profileId.length; i++) {
    h = (Math.imul(31, h) + profileId.charCodeAt(i)) | 0;
  }
  return DOT_COLORS[Math.abs(h) % DOT_COLORS.length];
}

function relativeTime(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60000) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

@Component({
  selector: 'app-activity-feed',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="activity-panel">
      <div class="activity-header">
        <span class="activity-title">Activity</span>
        <button class="close-btn" (click)="closed.emit()" aria-label="Close activity feed">×</button>
      </div>

      <div class="feed-list" role="log" aria-live="polite" aria-label="Activity feed">
        @if (recentActivity().length === 0) {
          <div class="empty-state">No recent activity.</div>
        }
        @for (entry of recentActivity(); track entry.id) {
          <div class="feed-entry">
            <div
              class="profile-dot"
              [style.background]="dotColor(entry.profileId)"
              [title]="entry.profileId"
            ></div>
            <div class="entry-content">
              <div class="entry-action">
                {{ entry.action }}
                @if (entry.objectType) {
                  <span class="object-type">{{ entry.objectType }}</span>
                }
              </div>
              <div class="entry-time">{{ timeLabel(entry.at) }}</div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .activity-panel { width:280px; max-height:420px; background:#fff; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.15); border:1px solid #e8e8e8; display:flex; flex-direction:column; overflow:hidden; }
    .activity-header { display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-bottom:1px solid #eee; flex-shrink:0; }
    .activity-title { font-weight:600; font-size:0.9rem; color:#333; }
    .close-btn { background:none; border:none; font-size:1.4rem; cursor:pointer; color:#888; padding:0; line-height:1; }
    .close-btn:hover { color:#333; }
    .feed-list { flex:1; overflow-y:auto; padding:8px; display:flex; flex-direction:column; }
    .feed-entry { display:flex; gap:8px; padding:8px 6px; border-bottom:1px solid #f5f5f5; align-items:flex-start; }
    .profile-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-top:5px; }
    .entry-content { flex:1; min-width:0; }
    .entry-action { font-size:0.82rem; color:#333; line-height:1.3; word-break:break-word; }
    .object-type { font-size:0.78rem; color:#aaa; margin-left:4px; font-style:italic; }
    .entry-time { font-size:0.68rem; color:#aaa; margin-top:2px; }
    .empty-state { color:#bbb; text-align:center; padding:24px; font-size:0.84rem; margin:auto; }
  `],
})
export class ActivityFeedComponent {
  @Output() closed = new EventEmitter<void>();

  private readonly presenceService = inject(PresenceService);
  private readonly allActivity = toSignal(this.presenceService.activity$, { initialValue: [] as ActivityEntry[] });

  protected readonly recentActivity = computed(() => this.allActivity().slice(0, 50));

  protected dotColor(profileId: string): string {
    return profileColor(profileId);
  }

  protected timeLabel(at: number): string {
    return relativeTime(at);
  }
}
