import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CommentService } from '../comments/comment.service';
import type { InboxItem } from '../core/types';

@Component({
  selector: 'app-inbox-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="inbox-panel">
      <div class="inbox-header">
        <span class="inbox-title">
          Inbox
          @if (unreadCount > 0) {
            <span class="unread-badge">{{ unreadCount }}</span>
          }
        </span>
        <button class="inbox-close" (click)="closed.emit()" aria-label="Close inbox">×</button>
      </div>

      @if (items.length === 0) {
        <div class="inbox-empty">No notifications yet.</div>
      }

      @for (item of items; track item.id) {
        <div
          class="inbox-item"
          [class.unread]="!item.read"
          (click)="onItemClick(item)"
          role="button"
          tabindex="0"
          (keydown.enter)="onItemClick(item)">
          @if (!item.read) {
            <div class="unread-dot"></div>
          } @else {
            <div style="width:8px; flex-shrink:0;"></div>
          }
          <div class="inbox-item-content">
            <div class="inbox-mention">@{{ item.mentionedBy }}</div>
            <div class="inbox-body">{{ truncate(item.body) }}</div>
            <div class="inbox-time">{{ relTime(item.at) }}</div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .inbox-panel { position:absolute; top:calc(100% + 8px); right:0; width:320px; max-height:400px; overflow-y:auto; background:#fff; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.15); z-index:200; border:1px solid #e8e8e8; }
    .inbox-header { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid #eee; position:sticky; top:0; background:#fff; }
    .inbox-title { font-weight:600; font-size:0.875rem; display:flex; align-items:center; gap:6px; }
    .unread-badge { background:#e53935; color:#fff; border-radius:10px; font-size:0.68rem; font-weight:700; padding:2px 7px; }
    .inbox-close { background:none; border:none; font-size:1.2rem; cursor:pointer; color:#888; }
    .inbox-item { display:flex; gap:10px; align-items:flex-start; padding:10px 14px; cursor:pointer; border-bottom:1px solid #f5f5f5; }
    .inbox-item:hover { background:#f9f9f9; }
    .inbox-item.unread { background:#f0f7ff; }
    .unread-dot { width:8px; height:8px; border-radius:50%; background:#1e88e5; flex-shrink:0; margin-top:5px; }
    .inbox-item-content { flex:1; min-width:0; }
    .inbox-mention { font-size:0.72rem; font-weight:600; color:#555; }
    .inbox-body { font-size:0.82rem; color:#333; margin:2px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .inbox-time { font-size:0.68rem; color:#aaa; }
    .inbox-empty { padding:24px; text-align:center; color:#bbb; font-size:0.85rem; }
  `],
})
export class InboxPanelComponent implements OnInit, OnDestroy {
  @Input() profileId = '';
  @Output() closed = new EventEmitter<void>();

  protected items: InboxItem[] = [];
  protected unreadCount = 0;

  private subscription: Subscription | null = null;

  constructor(private readonly commentService: CommentService) {}

  ngOnInit(): void {
    this.subscription = this.commentService.inbox$.subscribe(items => {
      this.items = items;
      this.unreadCount = items.filter(i => !i.read).length;
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  protected onItemClick(item: InboxItem): void {
    if (!item.read) {
      this.commentService.markThreadRead(item.threadId, this.profileId);
    }
  }

  protected truncate(body: string): string {
    return body.length > 60 ? body.slice(0, 60) + '…' : body;
  }

  protected relTime(at: number): string {
    const diffMs = Date.now() - at;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;

    return new Date(at).toLocaleDateString();
  }
}
