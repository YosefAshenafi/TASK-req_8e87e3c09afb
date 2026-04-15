import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { BroadcastService } from '../core/broadcast.service';
import { TabIdentityService } from '../core/tab-identity.service';
import { AuthService } from '../auth/auth.service';
import type { PeerPresence, CursorPosition, ActivityEntry } from '../core/types';

const HEARTBEAT_INTERVAL_MS = 3000;
const PEER_TIMEOUT_MS = 6000; // 2 missed beats
const MAX_ACTIVITY_ENTRIES = 200;

@Injectable({ providedIn: 'root' })
export class PresenceService implements OnDestroy {
  private readonly _peers$ = new BehaviorSubject<PeerPresence[]>([]);
  private readonly _cursors$ = new BehaviorSubject<CursorPosition[]>([]);
  private readonly _activity$ = new BehaviorSubject<ActivityEntry[]>([]);

  private _subs = new Subscription();
  private _heartbeatSub: Subscription | null = null;

  get peers$(): Observable<PeerPresence[]> {
    return this._peers$.asObservable();
  }

  get cursors$(): Observable<CursorPosition[]> {
    return this._cursors$.asObservable();
  }

  get activity$(): Observable<ActivityEntry[]> {
    return this._activity$.asObservable();
  }

  constructor(
    private readonly broadcast: BroadcastService,
    private readonly tab: TabIdentityService,
    private readonly auth: AuthService,
  ) {
    this._listenForPresence();
    this._listenForCursors();
    this._listenForActivity();
  }

  startHeartbeat(): void {
    this._sendPresence('online');

    this._heartbeatSub = interval(HEARTBEAT_INTERVAL_MS).subscribe(() => {
      this._sendPresence('online');
      this._evictStalePeers();
    });
  }

  stopHeartbeat(): void {
    this._sendPresence('leaving');
    this._heartbeatSub?.unsubscribe();
    this._heartbeatSub = null;
  }

  broadcastCursor(x: number, y: number): void {
    this.broadcast.publishCursor(x, y);
  }

  recordActivity(entry: Omit<ActivityEntry, 'at'>): void {
    const full: ActivityEntry = { ...entry, at: Date.now() };
    const current = [full, ...this._activity$.value].slice(0, MAX_ACTIVITY_ENTRIES);
    this._activity$.next(current);
    this.broadcast.publish({ kind: 'activity', entry: full });
  }

  /**
   * F-H04: convenience wrapper that fills in id/tabId/profileId so call sites
   * (CanvasService, CommentService, MutualHelpService) only need to supply the
   * user-meaningful fields (action + optional object link).
   */
  logActivity(action: string, objectId?: string, objectType?: string): void {
    const profile = this.auth.currentProfile;
    if (!profile) return;
    this.recordActivity({
      id: uuidv4(),
      tabId: this.tab.tabId,
      profileId: profile.id,
      action,
      objectId,
      objectType,
    });
  }

  private _sendPresence(status: 'online' | 'away' | 'leaving'): void {
    const profile = this.auth.currentProfile;
    if (!profile) return;
    this.broadcast.publishPresence({
      kind: 'presence',
      profileId: profile.id,
      role: profile.role as 'Admin' | 'Academic Affairs' | 'Teacher',
      color: this.tab.color,
      status,
    });
  }

  private _listenForPresence(): void {
    this._subs.add(
      this.broadcast.on('presence').subscribe(msg => {
        const now = Date.now();
        const existing = this._peers$.value.filter(p => p.tabId !== msg.tabId);
        if (msg.status === 'leaving') {
          this._peers$.next(existing);
          this._cursors$.next(this._cursors$.value.filter(c => c.tabId !== msg.tabId));
          return;
        }
        const peer: PeerPresence = {
          tabId: msg.tabId,
          profileId: msg.profileId,
          role: msg.role,
          color: msg.color,
          status: msg.status,
          lastHeartbeatAt: now,
        };
        this._peers$.next([...existing, peer]);
      }),
    );
  }

  private _listenForCursors(): void {
    this._subs.add(
      this.broadcast.on('cursor').subscribe(msg => {
        const peer = this._peers$.value.find(p => p.tabId === msg.tabId);
        const color = peer?.color ?? '#999';
        const updated = [
          ...this._cursors$.value.filter(c => c.tabId !== msg.tabId),
          { tabId: msg.tabId, x: msg.x, y: msg.y, color, at: msg.at },
        ];
        this._cursors$.next(updated);
      }),
    );
  }

  private _listenForActivity(): void {
    this._subs.add(
      this.broadcast.on('activity').subscribe(msg => {
        const current = [msg.entry, ...this._activity$.value].slice(0, MAX_ACTIVITY_ENTRIES);
        this._activity$.next(current);
      }),
    );
  }

  private _evictStalePeers(): void {
    const cutoff = Date.now() - PEER_TIMEOUT_MS;
    const active = this._peers$.value.filter(p => p.lastHeartbeatAt >= cutoff);
    if (active.length !== this._peers$.value.length) {
      this._peers$.next(active);
    }
  }

  ngOnDestroy(): void {
    this.stopHeartbeat();
    this._subs.unsubscribe();
  }
}
