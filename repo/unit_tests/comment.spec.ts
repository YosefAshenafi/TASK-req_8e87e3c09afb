import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeContext, createAndSignIn } from './helpers';
import { CommentService } from '../src/app/comments/comment.service';
import { ToastService } from '../src/app/core/toast.service';
import { AppException } from '../src/app/core/error';

const WS = 'workspace-comments';
const TARGET = 'canvas-object-1';

describe('CommentService', () => {
  let ctx: ReturnType<typeof makeContext>;
  let comments: CommentService;

  beforeEach(async () => {
    ctx = makeContext();
    comments = new CommentService(ctx.db, ctx.broadcast, ctx.tab, ctx.auth, ctx.telemetry, new ToastService());
    await createAndSignIn(ctx.auth, 'alice', 'password123');
  });

  // ── openOrCreateThread ─────────────────────────────────────────────────────

  describe('openOrCreateThread()', () => {
    it('creates a new thread for a target', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      expect(thread.id).toBeTruthy();
      expect(thread.targetId).toBe(TARGET);
      expect(thread.workspaceId).toBe(WS);
      expect(thread.replies).toEqual([]);
    });

    it('returns the existing thread on second call', async () => {
      const t1 = await comments.openOrCreateThread(TARGET, WS);
      const t2 = await comments.openOrCreateThread(TARGET, WS);
      expect(t1.id).toBe(t2.id);
    });

    it('creates separate threads for different targets', async () => {
      const t1 = await comments.openOrCreateThread('target-a', WS);
      const t2 = await comments.openOrCreateThread('target-b', WS);
      expect(t1.id).not.toBe(t2.id);
    });

    it('starts with version=1', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      expect(thread.version).toBe(1);
    });

    it('has readBy=[] initially', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      expect(thread.readBy).toEqual([]);
    });
  });

  // ── threadsByTarget$ ───────────────────────────────────────────────────────

  describe('threadsByTarget$()', () => {
    it('returns observable that emits null initially', async () => {
      const obs = comments.threadsByTarget$('unknown-target');
      const value = await firstValueFrom(obs);
      expect(value).toBeNull();
    });

    it('emits the thread after openOrCreateThread', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      const obs = comments.threadsByTarget$(TARGET);
      const value = await firstValueFrom(obs);
      expect(value?.id).toBe(thread.id);
    });
  });

  // ── reply ──────────────────────────────────────────────────────────────────

  describe('reply()', () => {
    it('adds a reply to the thread', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      const reply = await comments.reply(thread.id, 'First reply', []);
      expect(reply.id).toBeTruthy();
      expect(reply.body).toBe('First reply');
    });

    it('sets authorId to the current profile id', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      const reply = await comments.reply(thread.id, 'Hi', []);
      expect(reply.authorId).toBe(ctx.auth.currentProfile?.id);
    });

    it('sets authorName to the current profile username', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      const reply = await comments.reply(thread.id, 'Hi', []);
      expect(reply.authorName).toBe('alice');
    });

    it('timestamps the reply', async () => {
      const before = Date.now();
      const thread = await comments.openOrCreateThread(TARGET, WS);
      const reply = await comments.reply(thread.id, 'Timed', []);
      expect(reply.createdAt).toBeGreaterThanOrEqual(before);
    });

    it('stores mentions', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      const reply = await comments.reply(thread.id, '@bob hello', ['bob']);
      expect(reply.mentions).toContain('bob');
    });

    it('throws NotFound for unknown thread id', async () => {
      await expect(
        comments.reply('ghost-thread', 'Hello', []),
      ).rejects.toSatisfy((e: AppException) => e.error.code === 'NotFound');
    });

    it('throws Validation when thread reaches 50 replies', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      for (let i = 0; i < 50; i++) {
        await comments.reply(thread.id, `Reply ${i}`, []);
      }
      await expect(
        comments.reply(thread.id, 'One too many', []),
      ).rejects.toSatisfy((e: AppException) => e.error.code === 'Validation');
    });

    it('adds inbox item when current user is mentioned', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      await comments.reply(thread.id, '@alice hi', ['alice']);
      const inbox = await firstValueFrom(comments.inbox$);
      expect(inbox.length).toBeGreaterThan(0);
    });

    it('does not add inbox item when current user is not mentioned', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      await comments.reply(thread.id, 'No mention', []);
      const inbox = await firstValueFrom(comments.inbox$);
      expect(inbox.length).toBe(0);
    });
  });

  // ── markThreadRead ─────────────────────────────────────────────────────────

  describe('markThreadRead()', () => {
    it('adds profileId to readBy', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      await comments.markThreadRead(thread.id, 'profile-1');
      const idb = await ctx.db.open();
      const stored = await idb.get('comments', thread.id);
      expect(stored?.readBy).toContain('profile-1');
    });

    it('is idempotent — does not duplicate readBy entries', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      await comments.markThreadRead(thread.id, 'profile-1');
      await comments.markThreadRead(thread.id, 'profile-1');
      const idb = await ctx.db.open();
      const stored = await idb.get('comments', thread.id);
      const count = stored?.readBy.filter((id: string) => id === 'profile-1').length;
      expect(count).toBe(1);
    });

    it('silently handles unknown thread id', async () => {
      await expect(
        comments.markThreadRead('ghost-thread', 'profile-1'),
      ).resolves.toBeUndefined();
    });

    it('marks inbox items for the thread as read', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      // Mention ourselves to create an inbox item
      await comments.reply(thread.id, '@alice', ['alice']);
      await comments.markThreadRead(thread.id, ctx.auth.currentProfile!.id);
      const inbox = await firstValueFrom(comments.inbox$);
      const item = inbox.find(i => i.threadId === thread.id);
      expect(item?.read).toBe(true);
    });
  });

  // ── inbox$ & unreadCount$ ─────────────────────────────────────────────────

  describe('inbox$', () => {
    it('starts empty', async () => {
      const inbox = await firstValueFrom(comments.inbox$);
      expect(inbox).toEqual([]);
    });
  });

  describe('unreadCount$', () => {
    it('starts at 0', async () => {
      const count = await firstValueFrom(comments.unreadCount$);
      expect(count).toBe(0);
    });

    it('increments when a mention arrives', async () => {
      const thread = await comments.openOrCreateThread(TARGET, WS);
      await comments.reply(thread.id, '@alice', ['alice']);
      const count = await firstValueFrom(comments.unreadCount$);
      expect(count).toBe(1);
    });
  });
});
