import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeContext, createAndSignIn } from './helpers';
import { ChatService } from '../src/app/chat/chat.service';

const WS = 'workspace-chat';

describe('ChatService', () => {
  let ctx: ReturnType<typeof makeContext>;
  let chat: ChatService;

  beforeEach(async () => {
    ctx = makeContext();
    chat = ctx.chat;
    await createAndSignIn(ctx.auth);
  });

  // ── loadForWorkspace ───────────────────────────────────────────────────────

  describe('loadForWorkspace()', () => {
    it('starts with empty messages$', async () => {
      await chat.loadForWorkspace(WS);
      const msgs = await firstValueFrom(chat.messages$);
      expect(msgs).toEqual([]);
    });

    it('loads previously persisted messages', async () => {
      await chat.loadForWorkspace(WS);
      await chat.send('Hello');
      // New service instance reads from same IDB
      const chat2 = new ChatService(ctx.db, ctx.broadcast, ctx.tab, ctx.auth);
      await chat2.loadForWorkspace(WS);
      const msgs = await firstValueFrom(chat2.messages$);
      expect(msgs).toHaveLength(1);
    });

    it('isolates messages by workspace', async () => {
      await chat.loadForWorkspace('ws-a');
      await chat.send('In A');
      await chat.loadForWorkspace('ws-b');
      const msgs = await firstValueFrom(chat.messages$);
      expect(msgs).toHaveLength(0);
    });
  });

  // ── send ──────────────────────────────────────────────────────────────────

  describe('send()', () => {
    beforeEach(() => chat.loadForWorkspace(WS));

    it('creates a user message', async () => {
      const msg = await chat.send('Hello world');
      expect(msg.type).toBe('user');
      expect(msg.body).toBe('Hello world');
      expect(msg.id).toBeTruthy();
    });

    it('sets authorId to the signed-in profile', async () => {
      const msg = await chat.send('Hi');
      expect(msg.authorId).toBe(ctx.auth.currentProfile?.id);
    });

    it('sets authorName to the signed-in profile username', async () => {
      const msg = await chat.send('Hi');
      expect(msg.authorName).toBe(ctx.auth.currentProfile?.username);
    });

    it('appends message to messages$', async () => {
      await chat.send('First');
      const msgs = await firstValueFrom(chat.messages$);
      expect(msgs).toHaveLength(1);
    });

    it('timestamps each message', async () => {
      const before = Date.now();
      const msg = await chat.send('Timed');
      expect(msg.createdAt).toBeGreaterThanOrEqual(before);
    });
  });

  // ── postSystem ────────────────────────────────────────────────────────────

  describe('postSystem()', () => {
    beforeEach(() => chat.loadForWorkspace(WS));

    it('creates a system message', async () => {
      const msg = await chat.postSystem('System event occurred');
      expect(msg.type).toBe('system');
      expect(msg.body).toBe('System event occurred');
    });

    it('system message has no authorId', async () => {
      const msg = await chat.postSystem('System');
      expect(msg.authorId).toBeUndefined();
    });

    it('system message has no authorName', async () => {
      const msg = await chat.postSystem('System');
      expect(msg.authorName).toBeUndefined();
    });

    it('system messages mix with user messages in messages$', async () => {
      await chat.send('User msg');
      await chat.postSystem('System msg');
      const msgs = await firstValueFrom(chat.messages$);
      expect(msgs).toHaveLength(2);
      expect(msgs.some(m => m.type === 'system')).toBe(true);
      expect(msgs.some(m => m.type === 'user')).toBe(true);
    });
  });

  // ── search ────────────────────────────────────────────────────────────────

  describe('search()', () => {
    beforeEach(async () => {
      await chat.loadForWorkspace(WS);
      await chat.send('Hello world');
      await chat.send('Goodbye world');
      await chat.send('Completely different');
    });

    it('returns matching messages by keyword', async () => {
      const results = await chat.search('hello');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(m => m.body.toLowerCase().includes('hello'))).toBe(true);
    });

    it('returns empty array for empty query', async () => {
      const results = await chat.search('');
      expect(results).toEqual([]);
    });

    it('returns empty array for whitespace-only query', async () => {
      const results = await chat.search('   ');
      expect(results).toEqual([]);
    });

    it('returns multiple matching messages', async () => {
      const results = await chat.search('world');
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('is case-insensitive', async () => {
      const lower = await chat.search('hello');
      const upper = await chat.search('HELLO');
      expect(lower.length).toBe(upper.length);
    });

    it('returns empty for no match', async () => {
      const results = await chat.search('zzz-no-match-xyz');
      expect(results).toEqual([]);
    });
  });

  // ── rolling window ────────────────────────────────────────────────────────

  describe('rolling window (500 messages)', () => {
    it('trims messages to 500 in-memory', async () => {
      await chat.loadForWorkspace(WS);
      for (let i = 0; i < 502; i++) {
        await chat.send(`Message ${i}`);
      }
      const msgs = await firstValueFrom(chat.messages$);
      expect(msgs.length).toBe(500);
    });

    it('keeps the most recent 500 messages', async () => {
      await chat.loadForWorkspace(WS);
      for (let i = 0; i < 505; i++) {
        await chat.send(`Msg ${i}`);
      }
      const msgs = await firstValueFrom(chat.messages$);
      // Last message should be in the window
      expect(msgs.some(m => m.body === 'Msg 504')).toBe(true);
    });
  });
});
