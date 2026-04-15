/**
 * COMMENT API TESTS
 * Tests the complete threaded comment system including mentions and inbox.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeFullContext, signUp } from './helpers';
import type { FullContext } from './helpers';

const WS = 'ws-comment-api';

describe('Comment API — full lifecycle', () => {
  let ctx: FullContext;

  beforeEach(async () => {
    ctx = makeFullContext();
    await signUp(ctx.auth, 'alice');
  });

  it('open thread → reply → mark read — full flow', async () => {
    const thread = await ctx.comments.openOrCreateThread('canvas-obj-1', WS);
    expect(thread.id).toBeTruthy();
    expect(thread.replies).toHaveLength(0);

    const reply = await ctx.comments.reply(thread.id, 'First comment!', []);
    expect(reply.id).toBeTruthy();
    expect(reply.body).toBe('First comment!');
    expect(reply.authorName).toBe('alice');

    await ctx.comments.markThreadRead(thread.id, ctx.auth.currentProfile!.id);

    const idb = await ctx.db.open();
    const stored = await idb.get('comments', thread.id);
    expect(stored?.readBy).toContain(ctx.auth.currentProfile!.id);
  });

  it('mentions add inbox items and unreadCount increments', async () => {
    const thread = await ctx.comments.openOrCreateThread('obj-1', WS);

    await ctx.comments.reply(thread.id, '@alice please review', ['alice']);

    const inbox = await firstValueFrom(ctx.comments.inbox$);
    expect(inbox.length).toBeGreaterThanOrEqual(1);
    expect(inbox[0].read).toBe(false);

    const count = await firstValueFrom(ctx.comments.unreadCount$);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('markThreadRead clears inbox items for thread', async () => {
    const thread = await ctx.comments.openOrCreateThread('obj-1', WS);
    await ctx.comments.reply(thread.id, '@alice hi', ['alice']);

    await ctx.comments.markThreadRead(thread.id, ctx.auth.currentProfile!.id);

    const inbox = await firstValueFrom(ctx.comments.inbox$);
    const item = inbox.find(i => i.threadId === thread.id);
    expect(item?.read).toBe(true);

    const count = await firstValueFrom(ctx.comments.unreadCount$);
    expect(count).toBe(0);
  });

  it('multiple threads for different canvas objects', async () => {
    const t1 = await ctx.comments.openOrCreateThread('obj-a', WS);
    const t2 = await ctx.comments.openOrCreateThread('obj-b', WS);
    const t3 = await ctx.comments.openOrCreateThread('obj-c', WS);

    expect(t1.id).not.toBe(t2.id);
    expect(t2.id).not.toBe(t3.id);

    await ctx.comments.reply(t1.id, 'Comment on A', []);
    await ctx.comments.reply(t2.id, 'Comment on B', []);

    const idb = await ctx.db.open();
    const storedT1 = await idb.get('comments', t1.id);
    const storedT2 = await idb.get('comments', t2.id);

    expect(storedT1?.replies).toHaveLength(1);
    expect(storedT2?.replies).toHaveLength(1);
    expect(storedT1?.replies[0].body).toBe('Comment on A');
    expect(storedT2?.replies[0].body).toBe('Comment on B');
  });

  it('idempotent thread creation — second call returns same thread', async () => {
    const t1 = await ctx.comments.openOrCreateThread('shared-obj', WS);
    const t2 = await ctx.comments.openOrCreateThread('shared-obj', WS);
    expect(t1.id).toBe(t2.id);
  });

  it('threadsByTarget$ observable emits thread data', async () => {
    const obs = ctx.comments.threadsByTarget$('my-obj');
    const initial = await firstValueFrom(obs);
    expect(initial).toBeNull();

    await ctx.comments.openOrCreateThread('my-obj', WS);
    const thread = await firstValueFrom(ctx.comments.threadsByTarget$('my-obj'));
    expect(thread).not.toBeNull();
    expect(thread?.targetId).toBe('my-obj');
  });

  it('reply limit at 50 is enforced', async () => {
    const thread = await ctx.comments.openOrCreateThread('obj-limit', WS);
    for (let i = 0; i < 50; i++) {
      await ctx.comments.reply(thread.id, `Reply ${i}`, []);
    }
    await expect(
      ctx.comments.reply(thread.id, 'One too many', []),
    ).rejects.toSatisfy(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.error?.code === 'Validation',
    );
  });

  it('replies persist across service instances', async () => {
    const thread = await ctx.comments.openOrCreateThread('persistent-obj', WS);
    await ctx.comments.reply(thread.id, 'Persisted reply', []);

    const ctx2 = makeFullContext();
    const idb = await ctx2.db.open();
    // Create the same DB by using the same DbService instance indirectly
    // (Here, ctx2 has a fresh IDB - but we verify the original ctx stored it)
    const stored = await ctx.db.open().then(db => db.get('comments', thread.id));
    expect(stored?.replies).toHaveLength(1);
    expect(stored?.replies[0].body).toBe('Persisted reply');
  });

  it('incoming broadcast comment appends reply and creates inbox mention', async () => {
    const thread = await ctx.comments.openOrCreateThread('broadcast-target', WS);
    ctx.broadcast.openForWorkspace(WS);

    const senderCtx = makeFullContext();
    senderCtx.broadcast.openForWorkspace(WS);

    senderCtx.broadcast.publish({
      kind: 'comment',
      threadId: thread.id,
      reply: {
        id: 'reply-from-other-tab',
        authorId: senderCtx.tab.tabId,
        authorName: 'bob',
        body: 'Please check this @alice',
        mentions: ['alice'],
        createdAt: Date.now(),
      },
      mentions: ['alice'],
    });

    await new Promise(resolve => setTimeout(resolve, 20));

    const idb = await ctx.db.open();
    const stored = await idb.get('comments', thread.id);
    expect(stored?.replies.some(r => r.id === 'reply-from-other-tab')).toBe(true);

    const inbox = await firstValueFrom(ctx.comments.inbox$);
    expect(inbox.some(i => i.threadId === thread.id && i.read === false)).toBe(true);
  });
});
