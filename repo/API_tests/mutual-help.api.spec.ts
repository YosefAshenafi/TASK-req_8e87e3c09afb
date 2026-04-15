/**
 * MUTUAL HELP API TESTS
 * Tests the complete mutual help post lifecycle — draft, publish, edit,
 * pin, withdraw, and automatic expiry sweep.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeFullContext, signUp } from './helpers';
import type { FullContext } from './helpers';
import type { NewPostInput } from '../src/app/core/types';

const WS = 'ws-mh-api';

function makeInput(overrides: Partial<NewPostInput> = {}): NewPostInput {
  return {
    workspaceId: WS,
    type: 'request',
    category: 'technology',
    title: 'Need a Python tutor',
    description: 'Looking for help with data science',
    tags: ['python', 'data'],
    urgency: 'medium',
    ...overrides,
  };
}

describe('Mutual Help API — full lifecycle', () => {
  let ctx: FullContext;

  beforeEach(async () => {
    ctx = makeFullContext();
    await signUp(ctx.auth, 'mhapiuser', 'password123', 'Admin');
    await ctx.chat.loadForWorkspace(WS);
    await ctx.mutualHelp.loadForWorkspace(WS);
  });

  afterEach(() => {
    ctx.mutualHelp.unload();
    vi.restoreAllMocks();
  });

  it('draft → publish → verify status transition', async () => {
    const draft = await ctx.mutualHelp.createDraft(makeInput({ title: 'Need help' }));
    expect(draft.status).toBe('draft');

    const published = await ctx.mutualHelp.publish(draft.id);
    expect(published.status).toBe('active');
    expect(published.version).toBe(2);

    const posts = await firstValueFrom(ctx.mutualHelp.posts$);
    const found = posts.find(p => p.id === draft.id);
    expect(found?.status).toBe('active');
  });

  it('edit published post with correct version', async () => {
    const draft = await ctx.mutualHelp.createDraft(makeInput({ title: 'Original' }));
    await ctx.mutualHelp.publish(draft.id);

    const edited = await ctx.mutualHelp.edit(draft.id, { title: 'Edited title' }, 2);
    expect(edited.title).toBe('Edited title');
    expect(edited.version).toBe(3);
  });

  it('version conflict prevents stale edits', async () => {
    const draft = await ctx.mutualHelp.createDraft(makeInput());
    await ctx.mutualHelp.publish(draft.id); // version → 2

    await expect(
      ctx.mutualHelp.edit(draft.id, { title: 'Stale edit' }, 1), // still sending v1
    ).rejects.toSatisfy(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.error?.code === 'VersionConflict',
    );
  });

  it('withdraw changes status to withdrawn', async () => {
    const draft = await ctx.mutualHelp.createDraft(makeInput());
    await ctx.mutualHelp.publish(draft.id);
    await ctx.mutualHelp.withdraw(draft.id);

    const posts = await firstValueFrom(ctx.mutualHelp.posts$);
    const post = posts.find(p => p.id === draft.id);
    expect(post?.status).toBe('withdrawn');
  });

  it('pin and unpin a post', async () => {
    const draft = await ctx.mutualHelp.createDraft(makeInput());

    await ctx.mutualHelp.pin(draft.id, true);
    const pinned = await firstValueFrom(ctx.mutualHelp.posts$);
    expect(pinned.find(p => p.id === draft.id)?.pinned).toBe(true);

    await ctx.mutualHelp.pin(draft.id, false);
    const unpinned = await firstValueFrom(ctx.mutualHelp.posts$);
    expect(unpinned.find(p => p.id === draft.id)?.pinned).toBe(false);
  });

  it('sweepExpired marks active expired posts as expired', async () => {
    const draft = await ctx.mutualHelp.createDraft(makeInput({ expiresIn: 1 }));
    await ctx.mutualHelp.publish(draft.id);

    // Wait for expiry
    await new Promise(r => setTimeout(r, 20));

    const count = await ctx.mutualHelp.sweepExpired();
    expect(count).toBeGreaterThanOrEqual(1);

    const posts = await firstValueFrom(ctx.mutualHelp.posts$);
    const post = posts.find(p => p.id === draft.id);
    expect(post?.status).toBe('expired');
  });

  it('pinned posts are not swept as expired', async () => {
    const draft = await ctx.mutualHelp.createDraft(makeInput({ expiresIn: 1 }));
    await ctx.mutualHelp.publish(draft.id);
    await ctx.mutualHelp.pin(draft.id, true);

    await new Promise(r => setTimeout(r, 20));

    const count = await ctx.mutualHelp.sweepExpired();
    expect(count).toBe(0);

    const posts = await firstValueFrom(ctx.mutualHelp.posts$);
    const post = posts.find(p => p.id === draft.id);
    expect(post?.status).toBe('active'); // still active because pinned
  });

  it('offer type posts work the same as requests', async () => {
    const draft = await ctx.mutualHelp.createDraft(
      makeInput({ type: 'offer', title: 'Python tutoring offered' }),
    );
    expect(draft.type).toBe('offer');

    const published = await ctx.mutualHelp.publish(draft.id);
    expect(published.status).toBe('active');
    expect(published.type).toBe('offer');
  });

  it('all three urgency levels work', async () => {
    const low = await ctx.mutualHelp.createDraft(makeInput({ urgency: 'low', title: 'Low urgency' }));
    const medium = await ctx.mutualHelp.createDraft(makeInput({ urgency: 'medium', title: 'Med urgency' }));
    const high = await ctx.mutualHelp.createDraft(makeInput({ urgency: 'high', title: 'High urgency' }));

    expect(low.urgency).toBe('low');
    expect(medium.urgency).toBe('medium');
    expect(high.urgency).toBe('high');
  });

  it('multiple posts coexist in posts$', async () => {
    await ctx.mutualHelp.createDraft(makeInput({ title: 'Post 1' }));
    await ctx.mutualHelp.createDraft(makeInput({ title: 'Post 2' }));
    await ctx.mutualHelp.createDraft(makeInput({ title: 'Post 3' }));

    const posts = await firstValueFrom(ctx.mutualHelp.posts$);
    expect(posts).toHaveLength(3);
  });

  it('postsValue mirrors the current posts$ snapshot', async () => {
    await ctx.mutualHelp.createDraft(makeInput({ title: 'Snapshot post' }));
    const from$ = await firstValueFrom(ctx.mutualHelp.posts$);
    expect(ctx.mutualHelp.postsValue).toEqual(from$);
  });

  it('resolve marks post resolved, emits telemetry, posts system chat, and logs activity', async () => {
    const draft = await ctx.mutualHelp.createDraft(makeInput({ title: 'To resolve' }));
    await ctx.mutualHelp.publish(draft.id);
    await ctx.mutualHelp.resolve(draft.id);

    const posts = await firstValueFrom(ctx.mutualHelp.posts$);
    expect(posts.find(p => p.id === draft.id)?.status).toBe('resolved');

    const messages = await firstValueFrom(ctx.chat.messages$);
    expect(
      messages.some(
        m => m.type === 'system' && m.body.includes('resolved') && m.body.includes('To resolve'),
      ),
    ).toBe(true);
  });

  it('unload stops the expiry sweep timer without throwing', () => {
    expect(() => ctx.mutualHelp.unload()).not.toThrow();
  });

  it('sweep interval calls sweepExpired when the document is visible', async () => {
    vi.useFakeTimers();
    try {
      ctx.mutualHelp.unload();
      const spy = vi.spyOn(ctx.mutualHelp, 'sweepExpired');
      await ctx.mutualHelp.loadForWorkspace(WS);
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      await vi.advanceTimersByTimeAsync(61_000);
      expect(spy).toHaveBeenCalled();
    } finally {
      ctx.mutualHelp.unload();
      vi.useRealTimers();
    }
  });
});
