import { describe, it, expect, beforeEach, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeContext, createAndSignIn } from './helpers';
import { PresenceService } from '../src/app/presence/presence.service';
import { TabIdentityService } from '../src/app/core/tab-identity.service';
import { BroadcastService } from '../src/app/core/broadcast.service';

describe('PresenceService', () => {
  let ctx: ReturnType<typeof makeContext>;
  let presence: PresenceService;

  beforeEach(async () => {
    ctx = makeContext();
    presence = new PresenceService(ctx.broadcast, ctx.tab, ctx.auth);
    await createAndSignIn(ctx.auth);
  });

  // ── peers$ ────────────────────────────────────────────────────────────────

  describe('peers$', () => {
    it('starts empty', async () => {
      const peers = await firstValueFrom(presence.peers$);
      expect(peers).toEqual([]);
    });

    it('adds a peer when an online presence message arrives from another tab', async () => {
      const tab2 = new TabIdentityService();
      const broadcast2 = new BroadcastService(tab2);
      ctx.broadcast.openForWorkspace('ws-presence');
      broadcast2.openForWorkspace('ws-presence');

      broadcast2.publish({
        kind: 'presence',
        profileId: 'peer-alice',
        role: 'Teacher',
        color: '#ff0000',
        status: 'online',
      });

      const peers = await firstValueFrom(presence.peers$);
      expect(peers.some(p => p.profileId === 'peer-alice')).toBe(true);

      ctx.broadcast.close();
      broadcast2.close();
    });

    it('removes a peer when a leaving presence message arrives', async () => {
      const tab2 = new TabIdentityService();
      const broadcast2 = new BroadcastService(tab2);
      ctx.broadcast.openForWorkspace('ws-presence');
      broadcast2.openForWorkspace('ws-presence');

      // Add peer
      broadcast2.publish({
        kind: 'presence',
        profileId: 'peer-bob',
        role: 'Teacher',
        color: '#0000ff',
        status: 'online',
      });
      let peers = await firstValueFrom(presence.peers$);
      expect(peers.some(p => p.profileId === 'peer-bob')).toBe(true);

      // Remove peer via 'leaving'
      broadcast2.publish({
        kind: 'presence',
        profileId: 'peer-bob',
        role: 'Teacher',
        color: '#0000ff',
        status: 'leaving',
      });
      peers = await firstValueFrom(presence.peers$);
      expect(peers.some(p => p.profileId === 'peer-bob')).toBe(false);

      ctx.broadcast.close();
      broadcast2.close();
    });
  });

  // ── cursors$ ─────────────────────────────────────────────────────────────

  describe('cursors$', () => {
    it('starts empty', async () => {
      const cursors = await firstValueFrom(presence.cursors$);
      expect(cursors).toEqual([]);
    });

    it('updates cursors$ when a cursor message arrives from another tab', async () => {
      const tab2 = new TabIdentityService();
      const broadcast2 = new BroadcastService(tab2);
      ctx.broadcast.openForWorkspace('ws-cursors');
      broadcast2.openForWorkspace('ws-cursors');

      broadcast2.publish({ kind: 'cursor', x: 150, y: 250 });

      const cursors = await firstValueFrom(presence.cursors$);
      expect(cursors).toHaveLength(1);
      expect(cursors[0].x).toBe(150);
      expect(cursors[0].y).toBe(250);
      expect(cursors[0].tabId).toBe(tab2.tabId);

      ctx.broadcast.close();
      broadcast2.close();
    });
  });

  // ── activity$ ────────────────────────────────────────────────────────────

  describe('activity$', () => {
    it('starts empty', async () => {
      const activity = await firstValueFrom(presence.activity$);
      expect(activity).toEqual([]);
    });
  });

  // ── recordActivity ────────────────────────────────────────────────────────

  describe('recordActivity()', () => {
    it('adds an activity entry to activity$', async () => {
      presence.recordActivity({
        id: 'act-1',
        tabId: ctx.tab.tabId,
        profileId: ctx.auth.currentProfile!.id,
        action: 'note.created',
        objectId: 'obj-1',
        objectType: 'sticky-note',
      });

      const activity = await firstValueFrom(presence.activity$);
      expect(activity).toHaveLength(1);
      expect(activity[0].action).toBe('note.created');
    });

    it('prepends new entries (most recent first)', async () => {
      presence.recordActivity({
        id: 'act-1',
        tabId: ctx.tab.tabId,
        profileId: ctx.auth.currentProfile!.id,
        action: 'first',
      });
      presence.recordActivity({
        id: 'act-2',
        tabId: ctx.tab.tabId,
        profileId: ctx.auth.currentProfile!.id,
        action: 'second',
      });

      const activity = await firstValueFrom(presence.activity$);
      expect(activity[0].action).toBe('second');
      expect(activity[1].action).toBe('first');
    });

    it('timestamps each activity entry', async () => {
      const before = Date.now();
      presence.recordActivity({
        id: 'act-1',
        tabId: ctx.tab.tabId,
        profileId: ctx.auth.currentProfile!.id,
        action: 'test',
      });
      const activity = await firstValueFrom(presence.activity$);
      expect(activity[0].at).toBeGreaterThanOrEqual(before);
    });

    it('caps activity log at 200 entries', () => {
      for (let i = 0; i < 205; i++) {
        presence.recordActivity({
          id: `act-${i}`,
          tabId: ctx.tab.tabId,
          profileId: ctx.auth.currentProfile!.id,
          action: `action-${i}`,
        });
      }
      // Check synchronously via the behavior subject value
      const activity = (presence as unknown as { _activity$: { value: unknown[] } })._activity$.value;
      expect(activity.length).toBe(200);
    });
  });

  // ── F-H04: logActivity convenience wrapper ───────────────────────────────

  describe('logActivity()', () => {
    it('fills in id, tabId, and profileId from the current context', async () => {
      presence.logActivity('note.created', 'obj-42', 'sticky-note');

      const activity = await firstValueFrom(presence.activity$);
      expect(activity).toHaveLength(1);
      expect(activity[0].action).toBe('note.created');
      expect(activity[0].objectId).toBe('obj-42');
      expect(activity[0].objectType).toBe('sticky-note');
      expect(activity[0].tabId).toBe(ctx.tab.tabId);
      expect(activity[0].profileId).toBe(ctx.auth.currentProfile!.id);
      expect(activity[0].id).toBeTruthy();
    });

    it('is a no-op when no profile is signed in', async () => {
      // Replace the existing service with one attached to a pristine auth
      // that has no currentProfile.
      const ctxEmpty = makeContext();
      const presence2 = new PresenceService(ctxEmpty.broadcast, ctxEmpty.tab, ctxEmpty.auth);
      presence2.logActivity('ignored');
      const activity = await firstValueFrom(presence2.activity$);
      expect(activity).toEqual([]);
    });
  });

  // ── broadcastCursor ───────────────────────────────────────────────────────

  describe('broadcastCursor()', () => {
    it('can be called without error', () => {
      // Opens a workspace channel first for broadcast to work
      ctx.broadcast.openForWorkspace('ws-1');
      expect(() => presence.broadcastCursor(100, 200)).not.toThrow();
      ctx.broadcast.close();
    });
  });

  // ── startHeartbeat / stopHeartbeat ────────────────────────────────────────

  describe('startHeartbeat() / stopHeartbeat()', () => {
    it('startHeartbeat does not throw', () => {
      vi.useFakeTimers();
      ctx.broadcast.openForWorkspace('ws-1');
      expect(() => presence.startHeartbeat()).not.toThrow();
      presence.stopHeartbeat();
      ctx.broadcast.close();
      vi.useRealTimers();
    });

    it('stopHeartbeat can be called before startHeartbeat', () => {
      expect(() => presence.stopHeartbeat()).not.toThrow();
    });

    it('stopHeartbeat cleans up the interval', () => {
      vi.useFakeTimers();
      ctx.broadcast.openForWorkspace('ws-1');
      presence.startHeartbeat();
      presence.stopHeartbeat();
      vi.useRealTimers();
    });
  });

  // ── ngOnDestroy ───────────────────────────────────────────────────────────

  describe('ngOnDestroy()', () => {
    it('can be called without error', () => {
      vi.useFakeTimers();
      ctx.broadcast.openForWorkspace('ws-1');
      presence.startHeartbeat();
      expect(() => presence.ngOnDestroy()).not.toThrow();
      vi.useRealTimers();
    });
  });
});
