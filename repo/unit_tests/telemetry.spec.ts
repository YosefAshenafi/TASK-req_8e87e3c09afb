import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeContext } from './helpers';
import { TelemetryService } from '../src/app/telemetry/telemetry.service';

const WS = 'workspace-telemetry';

describe('TelemetryService', () => {
  let ctx: ReturnType<typeof makeContext>;
  let telemetry: TelemetryService;

  beforeEach(() => {
    ctx = makeContext();
    telemetry = new TelemetryService(ctx.db);
  });

  // ── boot ──────────────────────────────────────────────────────────────────

  describe('boot()', () => {
    it('stores the workspaceId', () => {
      telemetry.boot(WS);
      // Verify we can call terminate without error
      expect(() => telemetry.terminate()).not.toThrow();
    });

    it('does not throw when Worker is available', () => {
      expect(() => telemetry.boot(WS)).not.toThrow();
    });
  });

  // ── terminate ────────────────────────────────────────────────────────────

  describe('terminate()', () => {
    it('can be called before boot without error', () => {
      expect(() => telemetry.terminate()).not.toThrow();
    });

    it('can be called after boot without error', () => {
      telemetry.boot(WS);
      expect(() => telemetry.terminate()).not.toThrow();
    });

    it('sets workerMessages$ to null after terminate', () => {
      telemetry.boot(WS);
      telemetry.terminate();
      expect(telemetry.workerMessages$).toBeNull();
    });
  });

  // ── log ───────────────────────────────────────────────────────────────────

  describe('log()', () => {
    it('persists event to IndexedDB (fire-and-forget)', async () => {
      telemetry.log({
        workspaceId: WS,
        type: 'note.created',
        payload: { noteId: 'n1' },
      });

      // Wait for the async persist
      await new Promise(r => setTimeout(r, 50));

      const idb = await ctx.db.open();
      const events = await idb.getAllFromIndex('events', 'by_workspace', WS);
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it('assigns id and timestamp to each event', async () => {
      const before = Date.now();
      telemetry.log({
        workspaceId: WS,
        type: 'test.event',
        payload: {},
      });

      await new Promise(r => setTimeout(r, 50));

      const idb = await ctx.db.open();
      const events = await idb.getAllFromIndex('events', 'by_workspace', WS);
      expect(events[0].id).toBeTruthy();
      expect(events[0].at).toBeGreaterThanOrEqual(before);
    });

    it('sets rolledUp=false by default', async () => {
      telemetry.log({ workspaceId: WS, type: 'test', payload: null });
      await new Promise(r => setTimeout(r, 50));

      const idb = await ctx.db.open();
      const events = await idb.getAllFromIndex('events', 'by_workspace', WS);
      expect(events[0].rolledUp).toBe(false);
    });

    it('can log multiple events', async () => {
      telemetry.log({ workspaceId: WS, type: 'event.1', payload: {} });
      telemetry.log({ workspaceId: WS, type: 'event.2', payload: {} });
      telemetry.log({ workspaceId: WS, type: 'event.3', payload: {} });

      await new Promise(r => setTimeout(r, 100));

      const idb = await ctx.db.open();
      const events = await idb.getAllFromIndex('events', 'by_workspace', WS);
      expect(events.length).toBeGreaterThanOrEqual(3);
    });

    it('does not throw synchronously', () => {
      expect(() => telemetry.log({ workspaceId: WS, type: 'sync-test', payload: null })).not.toThrow();
    });
  });

  // ── workerMessages$ ───────────────────────────────────────────────────────

  describe('workerMessages$', () => {
    it('returns null before boot', () => {
      expect(telemetry.workerMessages$).toBeNull();
    });

    it('returns the worker after boot', () => {
      telemetry.boot(WS);
      // Worker is stubbed as FakeWorker in setup.ts
      expect(telemetry.workerMessages$).not.toBeNull();
      telemetry.terminate();
    });
  });

  // ── H-05: worker message contract ────────────────────────────────────────

  describe('worker message schema (H-05)', () => {
    it('posts event-appended messages with type, workspaceId, and profileId fields', async () => {
      telemetry.boot(WS);
      const worker = telemetry.workerMessages$!;
      const spy = vi.spyOn(worker, 'postMessage');

      telemetry.log({
        workspaceId: WS,
        type: 'note-created',
        payload: { profileId: 'profile-xyz', objectId: 'obj-1' },
      });

      // Wait for the fire-and-forget _persist to finish.
      await new Promise(r => setTimeout(r, 50));

      // Find the event-appended message among whatever the worker was sent.
      const eventMsg = spy.mock.calls
        .map(c => c[0] as Record<string, unknown>)
        .find(m => m?.['kind'] === 'event-appended');

      expect(eventMsg).toBeDefined();
      expect(eventMsg?.['type']).toBe('note-created');
      expect(eventMsg?.['workspaceId']).toBe(WS);
      expect(eventMsg?.['profileId']).toBe('profile-xyz');
      expect(typeof eventMsg?.['id']).toBe('string');

      telemetry.terminate();
    });

    it('omits profileId when payload does not carry one', async () => {
      telemetry.boot(WS);
      const worker = telemetry.workerMessages$!;
      const spy = vi.spyOn(worker, 'postMessage');

      telemetry.log({ workspaceId: WS, type: 'chat-sent', payload: {} });
      await new Promise(r => setTimeout(r, 50));

      const eventMsg = spy.mock.calls
        .map(c => c[0] as Record<string, unknown>)
        .find(m => m?.['kind'] === 'event-appended');

      expect(eventMsg).toBeDefined();
      expect(eventMsg?.['profileId']).toBeUndefined();
      telemetry.terminate();
    });
  });
});
