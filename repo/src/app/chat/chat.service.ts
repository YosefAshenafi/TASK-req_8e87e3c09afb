import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from '../core/db.service';
import { BroadcastService } from '../core/broadcast.service';
import { TabIdentityService } from '../core/tab-identity.service';
import { AuthService } from '../auth/auth.service';
import type { ChatMessage } from '../core/types';

const ROLLING_WINDOW = 500;

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly _messages$ = new BehaviorSubject<ChatMessage[]>([]);
  private _workspaceId = '';
  private _index = new Map<string, string>(); // word → message IDs (comma-sep)

  get messages$(): Observable<ChatMessage[]> {
    return this._messages$.asObservable();
  }

  constructor(
    private readonly db: DbService,
    private readonly broadcast: BroadcastService,
    private readonly tab: TabIdentityService,
    private readonly auth: AuthService,
  ) {
    this._listenForChat();
  }

  async loadForWorkspace(workspaceId: string): Promise<void> {
    this._workspaceId = workspaceId;
    const idb = await this.db.open();
    const range = IDBKeyRange.bound(
      [workspaceId, 0],
      [workspaceId, Number.MAX_SAFE_INTEGER],
    );
    const all = await idb.getAllFromIndex('chat', 'by_workspace_createdAt', range);
    const last500 = all.slice(-ROLLING_WINDOW) as ChatMessage[];
    this._messages$.next(last500);
    this._rebuildIndex(last500);
  }

  async send(body: string): Promise<ChatMessage> {
    return this._writeMessage({ type: 'user', body });
  }

  async postSystem(body: string): Promise<ChatMessage> {
    return this._writeMessage({ type: 'system', body });
  }

  async search(query: string): Promise<ChatMessage[]> {
    if (!query.trim()) return [];
    const lower = query.toLowerCase();
    const matchIds = new Set<string>();

    // In-memory index lookup first
    for (const [word, ids] of this._index) {
      if (word.includes(lower)) {
        for (const id of ids.split(',')) matchIds.add(id);
      }
    }

    if (matchIds.size > 0) {
      return this._messages$.value.filter(m => matchIds.has(m.id));
    }

    // Fallback: scan IndexedDB
    const idb = await this.db.open();
    const range = IDBKeyRange.bound(
      [this._workspaceId, 0],
      [this._workspaceId, Number.MAX_SAFE_INTEGER],
    );
    const all = (await idb.getAllFromIndex('chat', 'by_workspace_createdAt', range)) as ChatMessage[];
    return all.filter(m => m.body.toLowerCase().includes(lower));
  }

  private async _writeMessage(partial: Pick<ChatMessage, 'type' | 'body'>): Promise<ChatMessage> {
    const idb = await this.db.open();
    const profile = this.auth.currentProfile;
    const message: ChatMessage = {
      id: uuidv4(),
      workspaceId: this._workspaceId,
      type: partial.type,
      ...(partial.type === 'user' && profile
        ? { authorId: profile.id, authorName: profile.username }
        : {}),
      body: partial.body,
      createdAt: Date.now(),
    };
    await idb.put('chat', message);
    this._appendToWindow(message);
    this.broadcast.publish({ kind: 'chat', message });
    return message;
  }

  private _appendToWindow(msg: ChatMessage): void {
    const current = [...this._messages$.value, msg];
    const trimmed = current.slice(-ROLLING_WINDOW);
    this._messages$.next(trimmed);
    this._indexMessage(msg);
  }

  private _rebuildIndex(messages: ChatMessage[]): void {
    this._index.clear();
    for (const msg of messages) this._indexMessage(msg);
  }

  private _indexMessage(msg: ChatMessage): void {
    const words = msg.body.toLowerCase().match(/\w+/g) ?? [];
    for (const word of words) {
      const existing = this._index.get(word);
      this._index.set(word, existing ? `${existing},${msg.id}` : msg.id);
    }
  }

  private _listenForChat(): void {
    this.broadcast.on('chat').subscribe(msg => {
      this._appendToWindow(msg.message);
    });
  }
}
