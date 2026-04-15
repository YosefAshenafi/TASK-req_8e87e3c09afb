import { describe, it, expect, beforeEach, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeContext } from './helpers';
import { MutualHelpService } from '../src/app/mutual-help/mutual-help.service';
import { AppException } from '../src/app/core/error';
import type { NewPostInput } from '../src/app/core/types';

const WS = 'workspace-mutual-help';

function makeInput(overrides: Partial<NewPostInput> = {}): NewPostInput {
  return {
    workspaceId: WS,
    type: 'request',
    category: 'general',
    title: 'Need help with X',
    description: 'Detailed description here',
    tags: ['urgent'],
    urgency: 'medium',
    ...overrides,
  };
}

describe('MutualHelpService', () => {
  let ctx: ReturnType<typeof makeContext>;
  let mh: MutualHelpService;

  beforeEach(() => {
    ctx = makeContext();
    mh = new MutualHelpService(ctx.db, ctx.broadcast);
  });

  // ── loadForWorkspace ───────────────────────────────────────────────────────

  describe('loadForWorkspace()', () => {
    it('starts with empty posts$', async () => {
      await mh.loadForWorkspace(WS);
      const posts = await firstValueFrom(mh.posts$);
      expect(posts).toEqual([]);
    });

    it('loads previously created posts', async () => {
      await mh.loadForWorkspace(WS);
      await mh.createDraft(makeInput());
      const mh2 = new MutualHelpService(ctx.db, ctx.broadcast);
      await mh2.loadForWorkspace(WS);
      const posts = await firstValueFrom(mh2.posts$);
      expect(posts).toHaveLength(1);
    });
  });

  // ── createDraft ────────────────────────────────────────────────────────────

  describe('createDraft()', () => {
    beforeEach(() => mh.loadForWorkspace(WS));

    it('creates a post with status=draft', async () => {
      const post = await mh.createDraft(makeInput());
      expect(post.status).toBe('draft');
    });

    it('assigns an id', async () => {
      const post = await mh.createDraft(makeInput());
      expect(post.id).toBeTruthy();
    });

    it('stores type, category, title, description, tags, urgency', async () => {
      const post = await mh.createDraft(makeInput({
        type: 'offer', category: 'tutoring', title: 'Offer title',
        description: 'Desc', tags: ['tag1', 'tag2'], urgency: 'high',
      }));
      expect(post.type).toBe('offer');
      expect(post.category).toBe('tutoring');
      expect(post.title).toBe('Offer title');
      expect(post.tags).toEqual(['tag1', 'tag2']);
      expect(post.urgency).toBe('high');
    });

    it('sets expiresAt to now + 72h by default', async () => {
      const before = Date.now();
      const post = await mh.createDraft(makeInput());
      const expectedExpiry = before + 72 * 60 * 60 * 1000;
      expect(post.expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 1000);
      expect(post.expiresAt).toBeLessThanOrEqual(expectedExpiry + 1000);
    });

    it('respects custom expiresIn', async () => {
      const before = Date.now();
      const custom = 1 * 60 * 60 * 1000; // 1 hour
      const post = await mh.createDraft(makeInput({ expiresIn: custom }));
      expect(post.expiresAt).toBeGreaterThanOrEqual(before + custom - 1000);
    });

    it('pinned is false by default', async () => {
      const post = await mh.createDraft(makeInput());
      expect(post.pinned).toBe(false);
    });

    it('starts with version=1', async () => {
      const post = await mh.createDraft(makeInput());
      expect(post.version).toBe(1);
    });

    it('adds post to posts$ after creation', async () => {
      await mh.createDraft(makeInput());
      const posts = await firstValueFrom(mh.posts$);
      expect(posts).toHaveLength(1);
    });
  });

  // ── publish ────────────────────────────────────────────────────────────────

  describe('publish()', () => {
    beforeEach(() => mh.loadForWorkspace(WS));

    it('changes status from draft to active', async () => {
      const post = await mh.createDraft(makeInput());
      const published = await mh.publish(post.id);
      expect(published.status).toBe('active');
    });

    it('increments version', async () => {
      const post = await mh.createDraft(makeInput());
      const published = await mh.publish(post.id);
      expect(published.version).toBe(2);
    });

    it('throws NotFound for unknown post id', async () => {
      await expect(mh.publish('ghost-id')).rejects.toSatisfy(
        (e: AppException) => e.error.code === 'NotFound',
      );
    });
  });

  // ── edit ──────────────────────────────────────────────────────────────────

  describe('edit()', () => {
    beforeEach(() => mh.loadForWorkspace(WS));

    it('updates specified fields', async () => {
      const post = await mh.createDraft(makeInput({ title: 'Old' }));
      const edited = await mh.edit(post.id, { title: 'New' }, 1);
      expect(edited.title).toBe('New');
    });

    it('throws VersionConflict when baseVersion does not match', async () => {
      const post = await mh.createDraft(makeInput());
      await expect(mh.edit(post.id, { title: 'X' }, 99)).rejects.toSatisfy(
        (e: AppException) => e.error.code === 'VersionConflict',
      );
    });

    it('throws NotFound for unknown post id', async () => {
      await expect(mh.edit('ghost', { title: 'X' }, 1)).rejects.toSatisfy(
        (e: AppException) => e.error.code === 'NotFound',
      );
    });
  });

  // ── withdraw ──────────────────────────────────────────────────────────────

  describe('withdraw()', () => {
    beforeEach(() => mh.loadForWorkspace(WS));

    it('changes status to withdrawn', async () => {
      const post = await mh.createDraft(makeInput());
      await mh.withdraw(post.id);
      const posts = await firstValueFrom(mh.posts$);
      const updated = posts.find(p => p.id === post.id);
      expect(updated?.status).toBe('withdrawn');
    });
  });

  // ── pin ───────────────────────────────────────────────────────────────────

  describe('pin()', () => {
    beforeEach(() => mh.loadForWorkspace(WS));

    it('pins a post', async () => {
      const post = await mh.createDraft(makeInput());
      await mh.pin(post.id, true);
      const posts = await firstValueFrom(mh.posts$);
      const updated = posts.find(p => p.id === post.id);
      expect(updated?.pinned).toBe(true);
    });

    it('unpins a pinned post', async () => {
      const post = await mh.createDraft(makeInput());
      await mh.pin(post.id, true);
      await mh.pin(post.id, false);
      const posts = await firstValueFrom(mh.posts$);
      const updated = posts.find(p => p.id === post.id);
      expect(updated?.pinned).toBe(false);
    });
  });

  // ── sweepExpired ──────────────────────────────────────────────────────────

  describe('sweepExpired()', () => {
    beforeEach(() => mh.loadForWorkspace(WS));

    it('marks expired active posts as expired', async () => {
      const post = await mh.createDraft(makeInput({ expiresIn: 1 })); // 1ms expiry
      await mh.publish(post.id);
      // Ensure expiry has passed
      await new Promise(r => setTimeout(r, 10));
      const count = await mh.sweepExpired();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('does not expire pinned posts', async () => {
      const post = await mh.createDraft(makeInput({ expiresIn: 1 }));
      await mh.publish(post.id);
      await mh.pin(post.id, true);
      await new Promise(r => setTimeout(r, 10));
      const count = await mh.sweepExpired();
      expect(count).toBe(0);
    });

    it('does not expire draft posts', async () => {
      await mh.createDraft(makeInput({ expiresIn: 1 }));
      await new Promise(r => setTimeout(r, 10));
      const count = await mh.sweepExpired();
      expect(count).toBe(0);
    });

    it('returns 0 when nothing is expired', async () => {
      await mh.createDraft(makeInput());
      await mh.publish((await firstValueFrom(mh.posts$))[0].id);
      const count = await mh.sweepExpired();
      expect(count).toBe(0);
    });
  });

  // ── unload ────────────────────────────────────────────────────────────────

  describe('unload()', () => {
    it('can be called without error', async () => {
      await mh.loadForWorkspace(WS);
      expect(() => mh.unload()).not.toThrow();
    });
  });
});
