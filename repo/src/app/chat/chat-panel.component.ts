import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  signal,
  ViewChild,
  ElementRef,
  AfterViewChecked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ChatService } from './chat.service';
import { AuthService } from '../auth/auth.service';
import type { ChatMessage } from '../core/types';

// Derive a consistent avatar background colour from any string (profile ID).
const AVATAR_PALETTE = [
  '#1e88e5', '#43a047', '#e53935', '#8e24aa',
  '#f57c00', '#00897b', '#6d4c41', '#546e7a',
  '#3949ab', '#00acc1', '#d81b60', '#7cb342',
];

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(31, h) + id.charCodeAt(i) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

/** A message row annotated with grouping metadata for compact rendering. */
interface MsgRow {
  msg: ChatMessage;
  isOwn: boolean;
  showAvatar: boolean;   // first message in a run from this sender
  showName: boolean;     // show sender name above bubble
}

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="chat-panel">

      <!-- Header -->
      <header class="chat-header">
        <span class="chat-title">Chat</span>
        <button
          class="search-toggle"
          [class.active]="showSearch()"
          (click)="toggleSearch()"
          [attr.aria-pressed]="showSearch()"
          aria-label="Toggle search"
        >Search</button>
      </header>

      <!-- Search bar -->
      @if (showSearch()) {
        <div class="search-bar">
          <input
            [(ngModel)]="searchQuery"
            placeholder="Search messages…"
            (input)="onSearch()"
            aria-label="Search chat messages"
          />
          @if (searchQuery && searchResults().length > 0) {
            <span class="search-count">{{ searchResults().length }} result(s)</span>
          }
        </div>
      }

      <!-- Message list -->
      <div
        class="message-list"
        #messageList
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        @if (showSearch() && searchQuery) {
          <!-- Search results -->
          @if (searchResults().length === 0) {
            <div class="empty-state">No results for "{{ searchQuery }}"</div>
          }
          @for (row of searchRows(); track row.msg.id) {
            <ng-container *ngTemplateOutlet="rowTpl; context: { row: row }"/>
          }
        } @else {
          <!-- Normal message list -->
          @if (rows().length === 0) {
            <div class="empty-state">No messages yet. Say hello!</div>
          }
          @for (row of rows(); track row.msg.id) {
            <ng-container *ngTemplateOutlet="rowTpl; context: { row: row }"/>
          }
        }
      </div>

      <!-- Input -->
      <div class="chat-input-area">
        <input
          class="chat-input"
          [(ngModel)]="draft"
          placeholder="Type a message…"
          (keydown.enter)="send()"
          [disabled]="sending()"
          aria-label="Chat message input"
          maxlength="2000"
        />
        <button
          class="send-btn"
          (click)="send()"
          [disabled]="!draft.trim() || sending()"
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- ── Row template ── -->
    <ng-template #rowTpl let-row="row">

      @if (row.msg.type === 'system') {
        <!-- System notice -->
        <div class="system-row">
          <span class="system-text">{{ row.msg.body }}</span>
        </div>

      } @else if (row.isOwn) {
        <!-- Own message — bubble right, avatar right -->
        <div class="msg-row own" [class.no-avatar]="!row.showAvatar">
          <div class="bubble-col">
            <div class="bubble own-bubble">{{ row.msg.body }}</div>
            @if (row.showAvatar) {
              <span class="msg-meta own-meta">{{ row.msg.createdAt | date:'HH:mm' }}</span>
            }
          </div>
          @if (row.showAvatar) {
            <div class="avatar" [style.background]="ownColor" [title]="ownName">
              {{ ownInitials }}
            </div>
          } @else {
            <div class="avatar-gap"></div>
          }
        </div>

      } @else {
        <!-- Other's message — avatar left, bubble right -->
        <div class="msg-row other" [class.no-avatar]="!row.showAvatar">
          @if (row.showAvatar) {
            <div class="avatar"
                 [style.background]="avatarColor(row.msg.authorId)"
                 [title]="row.msg.authorName">
              {{ initials(row.msg.authorName) }}
            </div>
          } @else {
            <div class="avatar-gap"></div>
          }
          <div class="bubble-col">
            @if (row.showName) {
              <span class="sender-name">{{ row.msg.authorName || 'Unknown' }}</span>
            }
            <div class="bubble other-bubble">{{ row.msg.body }}</div>
            @if (row.showAvatar) {
              <span class="msg-meta other-meta">{{ row.msg.createdAt | date:'HH:mm' }}</span>
            }
          </div>
        </div>
      }
    </ng-template>
  `,
  styleUrl: './chat-panel.component.scss',
})
export class ChatPanelComponent implements OnInit, OnDestroy, AfterViewChecked {
  @Input() workspaceId = '';
  @ViewChild('messageList') messageListRef!: ElementRef<HTMLDivElement>;

  protected messages    = signal<ChatMessage[]>([]);
  protected searchResults = signal<ChatMessage[]>([]);
  protected showSearch  = signal(false);
  protected sending     = signal(false);
  protected draft       = '';
  protected searchQuery = '';

  // Derived rows with grouping for the main list and search results
  protected rows       = signal<MsgRow[]>([]);
  protected searchRows = signal<MsgRow[]>([]);

  // Current user info for own-message rendering
  protected readonly ownColor;
  protected readonly ownInitials;
  protected readonly ownName;

  // Expose helpers to the template
  protected readonly avatarColor = avatarColor;
  protected readonly initials    = initials;

  private _subs        = new Subscription();
  private _shouldScroll = false;

  constructor(
    private readonly chatService: ChatService,
    private readonly auth: AuthService,
  ) {
    const profile = auth.currentProfile;
    this.ownName     = profile?.username ?? 'Me';
    this.ownInitials = initials(profile?.username);
    this.ownColor    = profile ? avatarColor(profile.id) : '#90a4ae';
  }

  async ngOnInit(): Promise<void> {
    await this.chatService.loadForWorkspace(this.workspaceId);
    this._subs.add(
      this.chatService.messages$.subscribe(msgs => {
        this.messages.set(msgs);
        this.rows.set(this._buildRows(msgs));
        this._shouldScroll = true;
      }),
    );
  }

  ngAfterViewChecked(): void {
    if (this._shouldScroll) {
      this._scrollToBottom();
      this._shouldScroll = false;
    }
  }

  ngOnDestroy(): void { this._subs.unsubscribe(); }

  protected toggleSearch(): void {
    this.showSearch.update(v => !v);
    if (!this.showSearch()) { this.searchQuery = ''; this.searchResults.set([]); this.searchRows.set([]); }
  }

  async onSearch(): Promise<void> {
    if (!this.searchQuery.trim()) { this.searchResults.set([]); this.searchRows.set([]); return; }
    const results = await this.chatService.search(this.searchQuery);
    this.searchResults.set(results);
    this.searchRows.set(this._buildRows(results));
  }

  async send(): Promise<void> {
    const body = this.draft.trim();
    if (!body) return;
    this.sending.set(true);
    this.draft = '';
    try { await this.chatService.send(body); }
    finally { this.sending.set(false); }
  }

  // ── Grouping logic ─────────────────────────────────────────────────────────

  private _buildRows(msgs: ChatMessage[]): MsgRow[] {
    const myId = this.auth.currentProfile?.id;
    return msgs.map((msg, i) => {
      if (msg.type === 'system') return { msg, isOwn: false, showAvatar: true, showName: false };
      const isOwn = msg.authorId === myId;
      const prev  = msgs[i - 1];
      // A new "group" starts when the sender changes, or the previous was a system message
      const newGroup = !prev || prev.type === 'system' || prev.authorId !== msg.authorId;
      return { msg, isOwn, showAvatar: newGroup, showName: !isOwn && newGroup };
    });
  }

  private _scrollToBottom(): void {
    const el = this.messageListRef?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }
}
