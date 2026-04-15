import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  AfterViewChecked,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { CommentService } from './comment.service';
import { ToastService } from '../core/toast.service';
import type { CommentThread, Reply } from '../core/types';

const AVATAR_COLORS = [
  '#1e88e5', '#43a047', '#e53935', '#8e24aa',
  '#f57c00', '#00897b', '#6d4c41', '#546e7a',
];

@Component({
  selector: 'app-comment-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="drawer">
      <div class="drawer-header">
        <span class="drawer-title">Comments ({{ replies.length }})</span>
        <button class="drawer-close" (click)="closed.emit()" aria-label="Close">×</button>
      </div>

      <div class="reply-list" #replyList>
        @if (replies.length === 0) {
          <div class="empty-state">No comments yet. Be the first!</div>
        }
        @for (reply of replies; track reply.id) {
          <div class="reply-row">
            <div class="reply-avatar" [style.background]="avatarColor(reply.authorId)">
              {{ initials(reply.authorId) }}
            </div>
            <div class="reply-content">
              <div class="reply-meta">
                <span class="reply-author">{{ reply.authorId.slice(0, 8) }}</span>
                <span class="reply-time">{{ reply.createdAt | date:'HH:mm' }}</span>
              </div>
              <div class="reply-body">{{ reply.body }}</div>
            </div>
          </div>
        }
      </div>

      <div class="reply-input-area">
        <textarea
          [(ngModel)]="draft"
          placeholder="Write a comment... (@mention users)"
          maxlength="500"
          (keydown.enter)="onEnter($event)">
        </textarea>
        <div class="reply-actions">
          <span class="char-count">{{ draft.length }}/500</span>
          <button
            class="reply-btn"
            (click)="submit()"
            [disabled]="!draft.trim() || submitting">
            Reply
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .drawer { position:absolute; top:0; right:0; width:300px; height:100%; background:#fff; box-shadow:-4px 0 16px rgba(0,0,0,0.12); display:flex; flex-direction:column; z-index:100; }
    .drawer-header { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid #eee; flex-shrink:0; }
    .drawer-title { font-weight:600; font-size:0.9rem; }
    .drawer-close { background:none; border:none; font-size:1.4rem; cursor:pointer; color:#888; padding:0; }
    .reply-list { flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
    .empty-state { color:#bbb; font-size:0.8rem; text-align:center; margin:auto; }
    .reply-row { display:flex; gap:8px; align-items:flex-start; }
    .reply-avatar { width:28px; height:28px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:0.65rem; font-weight:700; color:#fff; }
    .reply-content { flex:1; min-width:0; }
    .reply-meta { display:flex; gap:6px; align-items:baseline; margin-bottom:2px; }
    .reply-author { font-size:0.72rem; font-weight:600; color:#555; }
    .reply-time { font-size:0.65rem; color:#bbb; }
    .reply-body { font-size:0.82rem; line-height:1.4; word-break:break-word; color:#333; }
    .reply-input-area { border-top:1px solid #eee; padding:10px 12px; flex-shrink:0; display:flex; flex-direction:column; gap:6px; }
    .reply-input-area textarea { width:100%; height:64px; resize:none; border:1px solid #e0e0e0; border-radius:8px; padding:7px 10px; font-size:0.84rem; font-family:inherit; outline:none; box-sizing:border-box; }
    .reply-input-area textarea:focus { border-color:#1e88e5; }
    .reply-actions { display:flex; align-items:center; justify-content:space-between; }
    .char-count { font-size:0.68rem; color:#bbb; }
    .reply-btn { padding:6px 16px; background:#1e88e5; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:0.84rem; font-weight:600; }
    .reply-btn:disabled { opacity:0.4; cursor:not-allowed; }
  `],
})
export class CommentDrawerComponent implements OnInit, OnDestroy, AfterViewChecked {
  @Input() targetId = '';
  @Input() workspaceId = '';
  @Input() profileId = '';
  @Input() username = '';
  @Output() closed = new EventEmitter<void>();

  @ViewChild('replyList') private replyListRef!: ElementRef<HTMLDivElement>;

  protected replies: Reply[] = [];
  protected draft = '';
  protected submitting = false;

  private thread: CommentThread | null = null;
  private subscription: Subscription | null = null;
  private shouldScrollToBottom = false;

  constructor(
    private readonly commentService: CommentService,
    private readonly toastService: ToastService,
  ) {}

  ngOnInit(): void {
    this.subscription = this.commentService.threadsByTarget$(this.targetId).subscribe(thread => {
      const prevCount = this.replies.length;
      this.thread = thread;
      this.replies = thread?.replies ?? [];
      if (this.replies.length !== prevCount) {
        this.shouldScrollToBottom = true;
      }
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  protected onEnter(event: Event): void {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.shiftKey) return;
    keyEvent.preventDefault();
    this.submit();
  }

  protected async submit(): Promise<void> {
    const body = this.draft.trim();
    if (!body || this.submitting) return;

    this.submitting = true;
    try {
      let thread = this.thread;
      if (!thread) {
        thread = await this.commentService.openOrCreateThread(this.targetId);
      }

      const mentions = this.parseMentions(body);
      await this.commentService.reply(thread.id, body, mentions);
      this.draft = '';
      this.toastService.show('Reply posted', 'success');
    } catch {
      this.toastService.show('Failed to post reply', 'error');
    } finally {
      this.submitting = false;
    }
  }

  protected avatarColor(authorId: string): string {
    const code = authorId.charCodeAt(0) || 0;
    return AVATAR_COLORS[code % AVATAR_COLORS.length];
  }

  protected initials(authorId: string): string {
    return authorId ? authorId.slice(0, 2).toUpperCase() : '?';
  }

  private parseMentions(body: string): string[] {
    const matches = body.match(/@(\w+)/g);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.slice(1)))];
  }

  private scrollToBottom(): void {
    if (this.replyListRef) {
      const el = this.replyListRef.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }
}
