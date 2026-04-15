import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from '../core/db.service';
import { BroadcastService } from '../core/broadcast.service';
import { TabIdentityService } from '../core/tab-identity.service';
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

  async openOrCreateThread(targetId: string): Promise<CommentThread> {
    const idb = await this.db.open();
    const existing = await idb.getFromIndex('comments', 'by_target', targetId);
    if (existing) return existing as CommentThread;

    const now = Date.now();
    const thread: CommentThread = {
      id: uuidv4(),
      workspaceId: '', // set by caller when available
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

    const reply: Reply = {
      id: uuidv4(),
      authorId: this.tab.tabId,
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

    // Add inbox items for @mentions
    for (const mentionedId of mentions) {
      this._addInboxItem({
        id: uuidv4(),
        threadId,
        workspaceId: thread.workspaceId,
        targetId: thread.targetId,
        mentionedBy: this.tab.tabId,
        body,
        at: Date.now(),
        read: false,
      }, mentionedId);
    }

    this.broadcast.publish({ kind: 'comment', threadId, reply });
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

  private _addInboxItem(item: InboxItem, _mentionedProfileId: string): void {
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
    });
  }
}
