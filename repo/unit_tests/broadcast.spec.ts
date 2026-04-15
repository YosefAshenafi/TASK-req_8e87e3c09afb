import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { take, filter, toArray } from 'rxjs/operators';
import { TabIdentityService } from '../src/app/core/tab-identity.service';
import { BroadcastService } from '../src/app/core/broadcast.service';

describe('BroadcastService', () => {
  let tab: TabIdentityService;
  let service: BroadcastService;

  beforeEach(() => {
    tab = new TabIdentityService();
    service = new BroadcastService(tab);
  });

  // ── openForWorkspace / close ───────────────────────────────────────────────

  describe('openForWorkspace()', () => {
    it('opens a channel for the workspace', () => {
      expect(() => service.openForWorkspace('ws-1')).not.toThrow();
    });

    it('is idempotent for the same workspace', () => {
      service.openForWorkspace('ws-1');
      expect(() => service.openForWorkspace('ws-1')).not.toThrow();
    });

    it('switches workspace cleanly', () => {
      service.openForWorkspace('ws-1');
      expect(() => service.openForWorkspace('ws-2')).not.toThrow();
    });
  });

  describe('close()', () => {
    it('can be called before openForWorkspace', () => {
      expect(() => service.close()).not.toThrow();
    });

    it('closes after opening', () => {
      service.openForWorkspace('ws-1');
      expect(() => service.close()).not.toThrow();
    });
  });

  // ── publish / on ──────────────────────────────────────────────────────────

  describe('publish() / on()', () => {
    it('does not error when no channel is open', () => {
      expect(() =>
        service.publish({ kind: 'system', text: 'test' }),
      ).not.toThrow();
    });

    it('on() returns an observable filtered by kind', async () => {
      const tab2 = new TabIdentityService();
      const svc2 = new BroadcastService(tab2);

      // Both services share the same BroadcastChannel for ws-1
      service.openForWorkspace('ws-1');
      svc2.openForWorkspace('ws-1');

      const msgPromise = firstValueFrom(svc2.on('system').pipe(take(1)));
      service.publish({ kind: 'system', text: 'hello from service' });
      const msg = await msgPromise;
      expect(msg.kind).toBe('system');
      expect((msg as { text: string }).text).toBe('hello from service');
      svc2.close();
    });

    it('on() filters by kind — does not receive other kinds', async () => {
      const tab2 = new TabIdentityService();
      const svc2 = new BroadcastService(tab2);

      service.openForWorkspace('ws-1');
      svc2.openForWorkspace('ws-1');

      let chatReceived = false;
      const sub = svc2.on('chat').pipe(take(1)).subscribe(() => {
        chatReceived = true;
      });

      // Publish a system message — chat observer should not fire
      service.publish({ kind: 'system', text: 'system only' });

      await new Promise<void>(resolve => setTimeout(resolve, 50));
      expect(chatReceived).toBe(false);
      sub.unsubscribe();
      svc2.close();
    });
  });

  // ── publishPresence ───────────────────────────────────────────────────────

  describe('publishPresence()', () => {
    it('can be called without error', () => {
      service.openForWorkspace('ws-1');
      expect(() =>
        service.publishPresence({
          kind: 'presence',
          profileId: 'p1',
          role: 'Admin',
          color: '#E53935',
          status: 'online',
        }),
      ).not.toThrow();
    });
  });

  // ── publishCursor ─────────────────────────────────────────────────────────

  describe('publishCursor()', () => {
    it('can be called without error', () => {
      service.openForWorkspace('ws-1');
      expect(() => service.publishCursor(100, 200)).not.toThrow();
    });
  });

  // ── all$ ──────────────────────────────────────────────────────────────────

  describe('all$', () => {
    it('emits all incoming messages', async () => {
      const tab2 = new TabIdentityService();
      const svc2 = new BroadcastService(tab2);

      service.openForWorkspace('ws-1');
      svc2.openForWorkspace('ws-1');

      const msgPromise = firstValueFrom(svc2.all$.pipe(
        filter(m => m.kind === 'system'),
        take(1),
      ));
      service.publish({ kind: 'system', text: 'broadcast-all' });
      const msg = await msgPromise;
      expect(msg.kind).toBe('system');
      svc2.close();
    });
  });

  // ── sequence numbers ──────────────────────────────────────────────────────

  describe('sequence numbers', () => {
    it('increments seq for each published message of the same kind', async () => {
      const tab2 = new TabIdentityService();
      const svc2 = new BroadcastService(tab2);
      service.openForWorkspace('ws-1');
      svc2.openForWorkspace('ws-1');

      const msgsPromise = firstValueFrom(svc2.on('system').pipe(take(2), toArray()));
      service.publish({ kind: 'system', text: 'first' });
      service.publish({ kind: 'system', text: 'second' });
      const msgs = await msgsPromise;
      expect(msgs[0].seq).toBe(1);
      expect(msgs[1].seq).toBe(2);
      svc2.close();
    });
  });

  // ── ngOnDestroy ───────────────────────────────────────────────────────────

  describe('ngOnDestroy()', () => {
    it('closes the channel and cleans up subscriptions', () => {
      service.openForWorkspace('ws-1');
      expect(() => service.ngOnDestroy()).not.toThrow();
    });
  });
});
