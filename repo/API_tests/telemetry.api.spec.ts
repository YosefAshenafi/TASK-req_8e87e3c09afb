/**
 * TELEMETRY API TESTS
 * Full integration tests for TelemetryService: event persistence to IndexedDB,
 * event structure verification, multi-event batching, and boot/terminate lifecycle.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeFullContext, signUp } from './helpers';
import type { FullContext } from './helpers';

describe('TelemetryService API — event persistence integration', () => {
  let ctx: FullContext;

  beforeEach(async () => {
    ctx = makeFullContext();
    await signUp(ctx.auth, 'teluser', 'telpass12', 'Admin');
  });

  // ── log() — event persistence ─────────────────────────────────────────────

  it('log() persists an event to IndexedDB events store', async () => {
    const wsId = (await ctx.workspace.create('TelWS')).id;

    ctx.telemetry.log({
      type: 'note.created',
      workspaceId: wsId,
      payload: { objectId: 'obj-1' },
    });

    // Brief wait for the async fire-and-forget persist
    await new Promise(r => setTimeout(r, 50));

    const idb = await ctx.db.open();
    const allEvents = await idb.getAll('events');
    const event = allEvents.find(e => e.type === 'note.created');
    expect(event).toBeDefined();
    expect(event!.type).toBe('note.created');
    expect(event!.workspaceId).toBe(wsId);
    expect(event!.id).toBeTruthy();
    expect(event!.at).toBeGreaterThan(0);
    expect(event!.rolledUp).toBe(false);
  });

  it('each log() call generates a unique event id', async () => {
    const wsId = (await ctx.workspace.create('UniqueId WS')).id;

    ctx.telemetry.log({ type: 'chat.message', workspaceId: wsId, payload: {} });
    ctx.telemetry.log({ type: 'chat.message', workspaceId: wsId, payload: {} });

    await new Promise(r => setTimeout(r, 50));

    const idb = await ctx.db.open();
    const events = await idb.getAll('events');
    const chatEvents = events.filter(e => e.type === 'chat.message');
    expect(chatEvents).toHaveLength(2);
    expect(chatEvents[0].id).not.toBe(chatEvents[1].id);
  });

  it('log() records a timestamp close to Date.now()', async () => {
    const wsId = (await ctx.workspace.create('TsWS')).id;
    const before = Date.now();

    ctx.telemetry.log({ type: 'workspace.opened', workspaceId: wsId, payload: {} });
    await new Promise(r => setTimeout(r, 50));

    const idb = await ctx.db.open();
    const events = await idb.getAll('events');
    const e = events.find(ev => ev.type === 'workspace.opened');
    expect(e).toBeDefined();
    expect(e!.at).toBeGreaterThanOrEqual(before);
    expect(e!.at).toBeLessThanOrEqual(Date.now());
  });

  it('log() persists multiple event types independently', async () => {
    const wsId = (await ctx.workspace.create('MultiType WS')).id;

    ctx.telemetry.log({ type: 'note.created', workspaceId: wsId, payload: {} });
    ctx.telemetry.log({ type: 'comment.created', workspaceId: wsId, payload: {} });
    ctx.telemetry.log({ type: 'mutual-help-published', workspaceId: wsId, payload: {} });

    await new Promise(r => setTimeout(r, 50));

    const idb = await ctx.db.open();
    const events = await idb.getAll('events');
    const types = events.map(e => e.type);
    expect(types).toContain('note.created');
    expect(types).toContain('comment.created');
    expect(types).toContain('mutual-help-published');
  });

  it('log() stores events scoped to the correct workspace', async () => {
    const ws1 = await ctx.workspace.create('WS-A');
    const ws2 = await ctx.workspace.create('WS-B');

    ctx.telemetry.log({ type: 'note.created', workspaceId: ws1.id, payload: {} });
    ctx.telemetry.log({ type: 'note.created', workspaceId: ws2.id, payload: {} });

    await new Promise(r => setTimeout(r, 50));

    const idb = await ctx.db.open();
    const allEvents = await idb.getAll('events');
    const wsA = allEvents.filter(e => e.workspaceId === ws1.id);
    const wsB = allEvents.filter(e => e.workspaceId === ws2.id);
    expect(wsA).toHaveLength(1);
    expect(wsB).toHaveLength(1);
  });

  it('log() includes profileId from payload when present', async () => {
    const wsId = (await ctx.workspace.create('ProfilePayload WS')).id;
    const profileId = ctx.auth.currentProfile!.id;

    ctx.telemetry.log({
      type: 'comment.created',
      workspaceId: wsId,
      payload: { profileId, threadId: 'thread-1' },
    });

    await new Promise(r => setTimeout(r, 50));

    const idb = await ctx.db.open();
    const events = await idb.getAll('events');
    const e = events.find(ev => ev.type === 'comment.created');
    expect(e).toBeDefined();
    const payload = e!.payload as Record<string, unknown>;
    expect(payload['profileId']).toBe(profileId);
    expect(payload['threadId']).toBe('thread-1');
  });

  // ── Boot / terminate lifecycle ─────────────────────────────────────────────

  it('workerMessages$ returns null before boot()', () => {
    expect(ctx.telemetry.workerMessages$).toBeNull();
  });

  it('boot() sets workerMessages$ to a non-null worker instance', () => {
    ctx.telemetry.boot('ws-boot');
    expect(ctx.telemetry.workerMessages$).not.toBeNull();
    ctx.telemetry.terminate();
  });

  it('terminate() resets workerMessages$ to null', () => {
    ctx.telemetry.boot('ws-terminate');
    expect(ctx.telemetry.workerMessages$).not.toBeNull();
    ctx.telemetry.terminate();
    expect(ctx.telemetry.workerMessages$).toBeNull();
  });

  it('can boot() a second workspace after terminate()', () => {
    ctx.telemetry.boot('ws-first');
    ctx.telemetry.terminate();
    ctx.telemetry.boot('ws-second');
    expect(ctx.telemetry.workerMessages$).not.toBeNull();
    ctx.telemetry.terminate();
  });

  // ── rolledUp flag ─────────────────────────────────────────────────────────

  it('events are persisted with rolledUp: false', async () => {
    const wsId = (await ctx.workspace.create('RolledUp WS')).id;

    ctx.telemetry.log({ type: 'note.created', workspaceId: wsId, payload: {} });
    await new Promise(r => setTimeout(r, 50));

    const idb = await ctx.db.open();
    const events = await idb.getAll('events');
    const e = events.find(ev => ev.type === 'note.created');
    expect(e?.rolledUp).toBe(false);
  });
});
