import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from '../core/db.service';
import { BroadcastService } from '../core/broadcast.service';
import { TabIdentityService } from '../core/tab-identity.service';
import { AuthService } from '../auth/auth.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { ToastService } from '../core/toast.service';
import { AppException } from '../core/error';
import type { CommentThread, InboxItem, Reply } from '../core/types';

const MAX_REPLIES = 50;

@Injectable({ providedIn: 'root' })
export class CommentService {
  private readonly _inbox$ = new BehaviorSubject<InboxItem[]>([]);
  private readonly _threads$ = new Map<string, BehaviorSubject<CommentThread | null>>();

  get inbox$(): Observable<InboxItem[]> {
    return this._inbox$.asObservable();
  }

  get unreadCount$(): Observable<number> {
    return new Observable(sub => {
      this._inbox$.subscribe(items => sub.next(items.filter(i => !i.read).length));
    });
  }

  constructor(
    private readonly db: DbService,
    private readonly broadcast: BroadcastService,
    private readonly tab: TabIdentityService,
    private readonly auth: AuthService,
    private readonly telemetry: TelemetryService,
    private readonly toast: ToastService,
  ) {
    this._listenForComments();
  }

  threadsByTarget$(targetId: string): Observable<CommentThread | null> {
    if (!this._threads$.has(targetId)) {
      this._threads$.set(targetId, new BehaviorSubject<CommentThread | null>(null));
      this._loadThread(targetId);
    }
    return this._threads$.get(targetId)!.asObservable();
  }

  async openOrCreateThread(targetId: string, workspaceId = ''): Promise<CommentThread> {
    // Ensure a subject exists so _updateThreadSubject can emit (threadsByTarget$ may not be subscribed yet).
    if (!this._threads$.has(targetId)) {
      this._threads$.set(targetId, new BehaviorSubject<CommentThread | null>(null));
    }
    const idb = await this.db.open();
    const existing = await idb.getFromIndex('comments', 'by_target', targetId);
    if (existing) {
      this._updateThreadSubject(existing as CommentThread);
      return existing as CommentThread;
    }

    const now = Date.now();
    const thread: CommentThread = {
      id: uuidv4(),
      workspaceId,
      targetId,
      replies: [],
      readBy: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await idb.put('comments', thread);
    this._updateThreadSubject(thread);
    return thread;
  }

  async reply(threadId: string, body: string, mentions: string[]): Promise<Reply> {
    const idb = await this.db.open();
    const thread = await idb.get('comments', threadId);
    if (!thread) throw new AppException({ code: 'NotFound', detail: `Thread ${threadId} not found` });
    if (thread.replies.length >= MAX_REPLIES) {
      throw new AppException({
        code: 'Validation',
        detail: `Thread has reached the maximum of ${MAX_REPLIES} replies`,
        field: 'replies',
      });
    }

    const profile = this.auth.currentProfile;
    const reply: Reply = {
      id: uuidv4(),
      authorId: profile?.id ?? this.tab.tabId,
      authorName: profile?.username,
      body,
      mentions,
      createdAt: Date.now(),
    };
    const updated: CommentThread = {
      ...thread as CommentThread,
      replies: [...thread.replies, reply],
      updatedAt: Date.now(),
      version: thread.version + 1,
    };
    await idb.put('comments', updated);
    this._updateThreadSubject(updated);

    // Add inbox item if the current user's username was @mentioned
    const currentUsername = this.auth.currentProfile?.username;
    const currentProfileId = this.auth.currentProfile?.id;
    const selfMentioned = currentUsername && mentions.includes(currentUsername);
    if (selfMentioned && currentProfileId) {
      this._addInboxItem({
        id: uuidv4(),
        threadId,
        workspaceId: thread.workspaceId,
        targetId: thread.targetId,
        mentionedBy: profile?.username ?? this.tab.tabId,
        body,
        at: Date.now(),
        read: false,
      });
    }

    // Broadcast so other tabs can check if their user was mentioned
    this.broadcast.publish({ kind: 'comment', threadId, reply, mentions });

    // H-05: emit telemetry for KPI aggregation
    this.telemetry.log({
      workspaceId: thread.workspaceId,
      type: 'comment-added',
      payload: { profileId: currentProfileId, threadId, replyId: reply.id },
    });

    return reply;
  }

  async markThreadRead(threadId: string, profileId: string): Promise<void> {
    const idb = await this.db.open();
    const thread = await idb.get('comments', threadId);
    if (!thread) return;
    if (thread.readBy.includes(profileId)) return;
    const updated: CommentThread = {
      ...thread as CommentThread,
      readBy: [...thread.readBy, profileId],
      version: thread.version + 1,
    };
    await idb.put('comments', updated);
    this._updateThreadSubject(updated);

    // Mark inbox items as read
    const items = this._inbox$.value.map(i =>
      i.threadId === threadId ? { ...i, read: true } : i,
    );
    this._inbox$.next(items);
  }

  private async _loadThread(targetId: string): Promise<void> {
    const idb = await this.db.open();
    const thread = await idb.getFromIndex('comments', 'by_target', targetId);
    const subject = this._threads$.get(targetId);
    if (subject) subject.next(thread as CommentThread ?? null);
  }

  private _updateThreadSubject(thread: CommentThread): void {
    const subject = this._threads$.get(thread.targetId);
    if (subject) subject.next(thread);
  }

  private _addInboxItem(item: InboxItem): void {
    this._inbox$.next([item, ...this._inbox$.value]);
  }

  private _listenForComments(): void {
    this.broadcast.on('comment').subscribe(async msg => {
      const idb = await this.db.open();
      const thread = await idb.get('comments', msg.threadId);
      if (!thread) return;
      if (thread.replies.some((r: Reply) => r.id === msg.reply.id)) return;
      const updated: CommentThread = {
        ...thread as CommentThread,
        replies: [...thread.replies, msg.reply],
        version: thread.version + 1,
      };
      await idb.put('comments', updated);
      this._updateThreadSubject(updated);

      // Check if the current user was mentioned in this incoming reply
      const currentUsername = this.auth.currentProfile?.username;
      const mentions: string[] = msg.mentions ?? [];
      if (currentUsername && mentions.includes(currentUsername)) {
        const mentionedBy = msg.reply.authorName ?? msg.reply.authorId;
        this._addInboxItem({
          id: uuidv4(),
          threadId: msg.threadId,
          workspaceId: thread.workspaceId,
          targetId: thread.targetId,
          mentionedBy,
          body: msg.reply.body,
          at: Date.now(),
          read: false,
        });
        // Medium: surface a toast in the receiving tab so the mention is visible immediately.
        this.toast.show(`@${mentionedBy} mentioned you in a comment`, 'info', 5000);
      }
    });
  }
}
