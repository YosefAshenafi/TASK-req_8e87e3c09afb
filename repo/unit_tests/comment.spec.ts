import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeContext, createAndSignIn } from './helpers';
import { CommentService } from '../src/app/comments/comment.service';
import { ToastService } from '../src/app/core/toast.service';
import { AppException } from '../src/app/core/error';
import { filterMentionSuggestions, stripUnknownMentions } from '../src/app/comments/mention-utils';

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

// ── Roster loading via events store (regression for H-02) ────────────────────
// Validates that the correct IDB store name ('events', not 'telemetry_events')
// is used when loading workspace-scoped roster data for @mention suggestions.

describe('comment drawer roster loading (H-02 regression)', () => {
  let ctx: ReturnType<typeof makeContext>;

  beforeEach(async () => {
    ctx = makeContext();
    await createAndSignIn(ctx.auth, 'alice', 'password123');
  });

  it('events store is queryable by workspace index', async () => {
    const WS_ROSTER = 'workspace-roster-test';
    ctx.telemetry.log({
      workspaceId: WS_ROSTER,
      type: 'workspace.entered',
      payload: { profileId: ctx.auth.currentProfile!.id },
    });
    await new Promise(r => setTimeout(r, 50));

    const idb = await ctx.db.open();
    // Must use the store name 'events' — not 'telemetry_events'
    const events = await idb.getAllFromIndex('events', 'by_workspace', WS_ROSTER);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const profileIds = new Set(
      events
        .map(e => (e.payload as Record<string, unknown>)?.['profileId'])
        .filter(Boolean),
    );
    expect(profileIds.has(ctx.auth.currentProfile!.id)).toBe(true);
  });

  it('returns all profiles as roster when no events exist for workspace', async () => {
    await ctx.auth.createProfile({ username: 'bob', password: 'password123', role: 'Editor' });

    const WS_EMPTY = 'workspace-no-events';
    const idb = await ctx.db.open();
    const events = await idb.getAllFromIndex('events', 'by_workspace', WS_EMPTY);
    expect(events.length).toBe(0);

    // When no events, roster should fall back to all profiles
    const allProfiles = await ctx.auth.listProfiles();
    expect(allProfiles.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Mention suggestion/validation utilities ───────────────────────────────────

describe('filterMentionSuggestions()', () => {
  it('returns usernames matching the prefix', () => {
    const result = filterMentionSuggestions(['alice', 'bob', 'alex'], 'ali');
    expect(result).toEqual(['alice']);
  });

  it('is case-insensitive', () => {
    const result = filterMentionSuggestions(['Alice', 'Bob'], 'ali');
    expect(result).toEqual(['Alice']);
  });

  it('returns empty for unknown prefix', () => {
    const result = filterMentionSuggestions(['alice', 'bob'], 'unknown');
    expect(result).toEqual([]);
  });

  it('caps results at 8', () => {
    const roster = Array.from({ length: 12 }, (_, i) => `user${i}`);
    const result = filterMentionSuggestions(roster, 'user');
    expect(result).toHaveLength(8);
  });
});

describe('stripUnknownMentions()', () => {
  it('keeps valid @mentions intact', () => {
    const { body, unknownMentions } = stripUnknownMentions('@alice hello', ['alice', 'bob']);
    expect(body).toBe('@alice hello');
    expect(unknownMentions).toEqual([]);
  });

  it('strips @handles not in roster and reports them', () => {
    const { body, unknownMentions } = stripUnknownMentions('@unknown hello', ['alice', 'bob']);
    expect(body).toBe('unknown hello');
    expect(unknownMentions).toContain('@unknown');
  });
});
