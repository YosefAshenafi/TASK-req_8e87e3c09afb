/**
 * PRESENCE API TESTS
 * Full integration tests for PresenceService using real BroadcastService
 * and real AuthService. Tests cross-tab messaging and activity feed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeFullContext, signUp } from './helpers';
import { PresenceService } from '../src/app/presence/presence.service';
import { TabIdentityService } from '../src/app/core/tab-identity.service';
import { BroadcastService } from '../src/app/core/broadcast.service';
import type { FullContext } from './helpers';

describe('PresenceService API — cross-tab integration', () => {
  let ctx: FullContext;
  let presence: PresenceService;

  beforeEach(async () => {
    ctx = makeFullContext();
    presence = new PresenceService(ctx.broadcast, ctx.tab, ctx.auth);
    await signUp(ctx.auth, 'alice', 'alicepass1', 'Teacher');
  });

  // ── Peer tracking ──────────────────────────────────────────────────────────

  it('peers$ starts empty', async () => {
    const peers = await firstValueFrom(presence.peers$);
    expect(peers).toEqual([]);
  });

  it('adds a peer when an online presence broadcast arrives from another tab', async () => {
    const tab2 = new TabIdentityService();
    const broadcast2 = new BroadcastService(tab2);

    ctx.broadcast.openForWorkspace('ws-peer-test');
    broadcast2.openForWorkspace('ws-peer-test');

    broadcast2.publish({
      kind: 'presence',
      profileId: 'peer-profile-1',
      role: 'Admin',
      color: '#ff0000',
      status: 'online',
    });

    const peers = await firstValueFrom(presence.peers$);
    expect(peers.some(p => p.profileId === 'peer-profile-1')).toBe(true);
    expect(peers[0].role).toBe('Admin');
    expect(peers[0].status).toBe('online');

    ctx.broadcast.close();
    broadcast2.close();
  });

  it('removes a peer when a leaving message arrives', async () => {
    const tab2 = new TabIdentityService();
    const broadcast2 = new BroadcastService(tab2);

    ctx.broadcast.openForWorkspace('ws-leaving-test');
    broadcast2.openForWorkspace('ws-leaving-test');

    // Join
    broadcast2.publish({
      kind: 'presence',
      profileId: 'peer-leave',
      role: 'Teacher',
      color: '#0000ff',
      status: 'online',
    });
    let peers = await firstValueFrom(presence.peers$);
    expect(peers.some(p => p.profileId === 'peer-leave')).toBe(true);

    // Leave
    broadcast2.publish({
      kind: 'presence',
      profileId: 'peer-leave',
      role: 'Teacher',
      color: '#0000ff',
      status: 'leaving',
    });
    peers = await firstValueFrom(presence.peers$);
    expect(peers.some(p => p.profileId === 'peer-leave')).toBe(false);

    ctx.broadcast.close();
    broadcast2.close();
  });

  it('tracks multiple peers simultaneously', async () => {
    const tab2 = new TabIdentityService();
    const tab3 = new TabIdentityService();
    const broadcast2 = new BroadcastService(tab2);
    const broadcast3 = new BroadcastService(tab3);

    ctx.broadcast.openForWorkspace('ws-multi-peer');
    broadcast2.openForWorkspace('ws-multi-peer');
    broadcast3.openForWorkspace('ws-multi-peer');

    broadcast2.publish({
      kind: 'presence', profileId: 'peer-A', role: 'Admin', color: '#f00', status: 'online',
    });
    broadcast3.publish({
      kind: 'presence', profileId: 'peer-B', role: 'Teacher', color: '#00f', status: 'online',
    });

    const peers = await firstValueFrom(presence.peers$);
    expect(peers).toHaveLength(2);
    const ids = peers.map(p => p.profileId);
    expect(ids).toContain('peer-A');
    expect(ids).toContain('peer-B');

    ctx.broadcast.close();
    broadcast2.close();
    broadcast3.close();
  });

  // ── Cursor tracking ────────────────────────────────────────────────────────

  it('cursors$ starts empty', async () => {
    const cursors = await firstValueFrom(presence.cursors$);
    expect(cursors).toEqual([]);
  });

  it('receives cursor positions from another tab', async () => {
    const tab2 = new TabIdentityService();
    const broadcast2 = new BroadcastService(tab2);

    ctx.broadcast.openForWorkspace('ws-cursor-test');
    broadcast2.openForWorkspace('ws-cursor-test');

    broadcast2.publish({ kind: 'cursor', x: 300, y: 450 });

    const cursors = await firstValueFrom(presence.cursors$);
    expect(cursors).toHaveLength(1);
    expect(cursors[0].x).toBe(300);
    expect(cursors[0].y).toBe(450);
    expect(cursors[0].tabId).toBe(tab2.tabId);

    ctx.broadcast.close();
    broadcast2.close();
  });

  // ── Activity feed ──────────────────────────────────────────────────────────

  it('activity$ starts empty', async () => {
    const activity = await firstValueFrom(presence.activity$);
    expect(activity).toEqual([]);
  });

  it('logActivity() records entry with full auth context (F-H04)', async () => {
    // Alice is signed in from beforeEach
    presence.logActivity('note.created', 'obj-123', 'sticky-note');

    const activity = await firstValueFrom(presence.activity$);
    expect(activity).toHaveLength(1);
    expect(activity[0].action).toBe('note.created');
    expect(activity[0].objectId).toBe('obj-123');
    expect(activity[0].objectType).toBe('sticky-note');
    expect(activity[0].profileId).toBe(ctx.auth.currentProfile!.id);
    expect(activity[0].tabId).toBe(ctx.tab.tabId);
    expect(activity[0].id).toBeTruthy();
    expect(activity[0].at).toBeGreaterThan(0);
  });

  it('logActivity() is a no-op when no user is signed in', async () => {
    await ctx.auth.signOut();
    presence.logActivity('should-be-ignored');
    const activity = await firstValueFrom(presence.activity$);
    expect(activity).toEqual([]);
  });

  it('logActivity() entries are prepended (most recent first)', async () => {
    presence.logActivity('first');
    presence.logActivity('second');
    presence.logActivity('third');

    const activity = await firstValueFrom(presence.activity$);
    expect(activity[0].action).toBe('third');
    expect(activity[1].action).toBe('second');
    expect(activity[2].action).toBe('first');
  });

  it('recordActivity() broadcasts the entry to other tabs', async () => {
    const tab2 = new TabIdentityService();
    const broadcast2 = new BroadcastService(tab2);
    const presence2 = new PresenceService(broadcast2, tab2, ctx.auth);

    ctx.broadcast.openForWorkspace('ws-activity-test');
    broadcast2.openForWorkspace('ws-activity-test');

    presence.recordActivity({
      id: 'act-broadcast',
      tabId: ctx.tab.tabId,
      profileId: ctx.auth.currentProfile!.id,
      action: 'shared.action',
    });

    const activity2 = await firstValueFrom(presence2.activity$);
    expect(activity2.some(e => e.action === 'shared.action')).toBe(true);

    ctx.broadcast.close();
    broadcast2.close();
  });

  // ── Channel isolation ─────────────────────────────────────────────────────

  it('presence events are workspace-scoped — cross-workspace messages are not received', async () => {
    const tab2 = new TabIdentityService();
    const broadcast2 = new BroadcastService(tab2);

    ctx.broadcast.openForWorkspace('ws-alpha');
    broadcast2.openForWorkspace('ws-beta'); // different workspace

    broadcast2.publish({
      kind: 'presence', profileId: 'isolated-peer', role: 'Admin', color: '#aaa', status: 'online',
    });

    const peers = await firstValueFrom(presence.peers$);
    expect(peers.some(p => p.profileId === 'isolated-peer')).toBe(false);

    ctx.broadcast.close();
    broadcast2.close();
  });
});
