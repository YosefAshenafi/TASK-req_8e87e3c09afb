import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable, Subscription } from 'rxjs';
import { throttleTime, debounceTime, filter } from 'rxjs/operators';
import { TabIdentityService } from './tab-identity.service';
import type { PersonaRole, ActivityEntry, ChatMessage, Reply, JsonPatch, CanvasObject } from './types';

// ── Message types ────────────────────────────────────────────────────────────

interface BaseMsg {
  tabId: string;
  seq: number;
  at: number;
}

interface PresenceMsg extends BaseMsg {
  kind: 'presence';
  profileId: string;
  role: PersonaRole;
  color: string;
  status: 'online' | 'away' | 'leaving';
}

interface CursorMsg extends BaseMsg {
  kind: 'cursor';
  x: number;
  y: number;
}

interface ChatMsg extends BaseMsg {
  kind: 'chat';
  message: ChatMessage;
}

interface EditMsg extends BaseMsg {
  kind: 'edit';
  objectId: string;
  baseVersion: number;
  patch: JsonPatch;
}

interface CommentMsg extends BaseMsg {
  kind: 'comment';
  threadId: string;
  reply: Reply;
  mentions: string[]; // usernames (@alice → 'alice') for cross-tab inbox delivery
}

interface SystemMsg extends BaseMsg {
  kind: 'system';
  text: string;
}

interface ActivityMsg extends BaseMsg {
  kind: 'activity';
  entry: ActivityEntry;
}

interface CanvasAddMsg extends BaseMsg {
  kind: 'canvas-add';
  object: CanvasObject;
}

interface CanvasDeleteMsg extends BaseMsg {
  kind: 'canvas-delete';
  objectId: string;
}

interface CanvasReloadMsg extends BaseMsg {
  kind: 'canvas-reload';
  workspaceId: string;
}

export type BroadcastEnvelope =
  | PresenceMsg
  | CursorMsg
  | ChatMsg
  | EditMsg
  | CommentMsg
  | SystemMsg
  | ActivityMsg
  | CanvasAddMsg
  | CanvasDeleteMsg
  | CanvasReloadMsg;

export type BroadcastKind = BroadcastEnvelope['kind'];

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class BroadcastService implements OnDestroy {
  private _channel: BroadcastChannel | null = null;
  private _workspaceId: string | null = null;
  private _seqByKind = new Map<BroadcastKind, number>();

  private readonly _incoming$ = new Subject<BroadcastEnvelope>();
  private _cursorOutbox$ = new Subject<CursorMsg>();
  private _presenceOutbox$ = new Subject<PresenceMsg>();
  private _subs = new Subscription();

  constructor(private readonly tab: TabIdentityService) {
    // Cursor: throttle to ~20 Hz
    this._subs.add(
      this._cursorOutbox$
        .pipe(throttleTime(50))
        .subscribe(msg => this._send(msg)),
    );

    // Presence heartbeat: debounce to avoid rapid bursts
    this._subs.add(
      this._presenceOutbox$
        .pipe(debounceTime(100))
        .subscribe(msg => this._send(msg)),
    );
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  openForWorkspace(workspaceId: string): void {
    if (this._workspaceId === workspaceId) return;
    this.close();
    this._workspaceId = workspaceId;

    if (typeof BroadcastChannel === 'undefined') return;

    this._channel = new BroadcastChannel(`secureroom-workspace-${workspaceId}`);
    this._channel.onmessage = (ev: MessageEvent<BroadcastEnvelope>) => {
      if (ev.data?.tabId !== this.tab.tabId) {
        this._incoming$.next(ev.data);
      }
    };
  }

  close(): void {
    this._channel?.close();
    this._channel = null;
    this._workspaceId = null;
  }

  // ── Publish ────────────────────────────────────────────────────────────────

  publishPresence(payload: Omit<PresenceMsg, keyof BaseMsg>): void {
    const p = payload as { kind: BroadcastKind } & Record<string, unknown>;
    this._presenceOutbox$.next(this._envelope(p) as PresenceMsg);
  }

  publishCursor(x: number, y: number): void {
    this._cursorOutbox$.next(
      this._envelope({ kind: 'cursor', x, y }) as CursorMsg,
    );
  }

  publish(payload: { kind: BroadcastKind } & Record<string, unknown>): void {
    this._send(this._envelope(payload));
  }

  // ── Subscribe ──────────────────────────────────────────────────────────────

  on<K extends BroadcastKind>(
    kind: K,
  ): Observable<Extract<BroadcastEnvelope, { kind: K }>> {
    return this._incoming$.pipe(
      filter((m): m is Extract<BroadcastEnvelope, { kind: K }> => m.kind === kind),
    );
  }

  get all$(): Observable<BroadcastEnvelope> {
    return this._incoming$.asObservable();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _envelope(payload: { kind: BroadcastKind } & Record<string, unknown>): BroadcastEnvelope {
    const kind = payload.kind;
    const seq = (this._seqByKind.get(kind) ?? 0) + 1;
    this._seqByKind.set(kind, seq);
    return { ...payload, tabId: this.tab.tabId, seq, at: Date.now() } as BroadcastEnvelope;
  }

  private _send(msg: BroadcastEnvelope): void {
    this._channel?.postMessage(msg);
  }

  ngOnDestroy(): void {
    this.close();
    this._subs.unsubscribe();
  }
}
