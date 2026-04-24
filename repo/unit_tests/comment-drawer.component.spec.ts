/**
 * CommentDrawerComponent — deep behavioural unit tests.
 *
 * Covers:
 *   • happy path: submit() creates a thread on first reply and calls reply(...)
 *   • existing thread: submit() skips openOrCreateThread when one is already bound
 *   • @mention tracking: onDraftChange updates the active query and suggestions
 *   • insertSuggestion replaces the current @fragment with the full handle
 *   • validation: unknown @mentions stripped + warning toast shown
 *   • validation: empty / whitespace bodies are rejected
 *   • event emitters: closed.emit() fires once per close
 *   • lifecycle: ngOnInit subscribes, ngOnDestroy unsubscribes, roster load
 *
 * Component is instantiated directly with mocked services so we can observe
 * exact service-call shapes and toast payloads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { CommentDrawerComponent } from '../src/app/comments/comment-drawer.component';
import type { CommentThread, Reply } from '../src/app/core/types';

function makeThread(replies: Reply[] = []): CommentThread {
  return {
    id: 'th-1',
    workspaceId: 'ws-1',
    targetId: 'obj-1',
    replies,
    readBy: [],
    createdAt: 0,
    updatedAt: 0,
    version: 1,
  };
}

function makeReply(p: Partial<Reply>): Reply {
  return {
    id: p.id ?? 'r-' + Math.random().toString(36).slice(2, 8),
    authorId: p.authorId ?? 'alice',
    authorName: p.authorName,
    body: p.body ?? '',
    mentions: p.mentions ?? [],
    createdAt: p.createdAt ?? 0,
  };
}

function makeDrawer(opts: { thread?: CommentThread | null; profiles?: { id: string; username: string }[] } = {}) {
  const threadSubject = new BehaviorSubject<CommentThread | null>(opts.thread ?? null);
  const commentService = {
    threadsByTarget$: vi.fn().mockReturnValue(threadSubject),
    openOrCreateThread: vi.fn().mockResolvedValue(makeThread()),
    reply: vi.fn().mockResolvedValue(undefined),
  };
  const toast = { show: vi.fn() };
  const auth = {
    listProfiles: vi.fn().mockResolvedValue(opts.profiles ?? [
      { id: 'p1', username: 'alice' },
      { id: 'p2', username: 'alex' },
      { id: 'p3', username: 'bob' },
    ]),
  };
  const db = {
    open: vi.fn().mockResolvedValue({
      getAllFromIndex: vi.fn().mockResolvedValue([]),
    }),
  };
  const component = new CommentDrawerComponent(
    commentService as never,
    toast as never,
    auth as never,
    db as never,
  );
  component.targetId = 'obj-1';
  component.workspaceId = '';
  component.profileId = 'p1';
  component.username = 'alice';
  return { component: component as CommentDrawerComponent & Record<string, unknown>, commentService, toast, auth, db, threadSubject };
}

describe('CommentDrawerComponent — @mention dropdown', () => {
  it('shows no suggestions for an empty draft', () => {
    const { component } = makeDrawer();
    const c = component as any;
    c._roster.set(['alice', 'alex', 'bob']);
    c.onDraftChange('hello there');
    expect(c.mentionSuggestions()).toEqual([]);
  });

  it('matches by case-insensitive prefix after the last @', () => {
    const { component } = makeDrawer();
    const c = component as any;
    c._roster.set(['alice', 'alex', 'bob']);
    c.draft = 'Hi @AL';
    c.onDraftChange(c.draft);
    expect(c.mentionSuggestions()).toEqual(['alice', 'alex']);
  });

  it('returns an empty list when nothing matches the prefix', () => {
    const { component } = makeDrawer();
    const c = component as any;
    c._roster.set(['alice', 'bob']);
    c.draft = 'Hi @zz';
    c.onDraftChange(c.draft);
    expect(c.mentionSuggestions()).toEqual([]);
  });

  it('insertSuggestion replaces the active @fragment and clears the query', () => {
    const { component } = makeDrawer();
    const c = component as any;
    c._roster.set(['alice']);
    c.draft = 'Hey @al';
    c.onDraftChange(c.draft);
    c.insertSuggestion('alice');
    expect(c.draft).toBe('Hey @alice ');
    expect(c.mentionSuggestions()).toEqual([]);
  });

  it('clears the mention query once a space is typed', () => {
    const { component } = makeDrawer();
    const c = component as any;
    c._roster.set(['alice']);
    c.onDraftChange('Hi @alice ');
    expect(c.mentionSuggestions()).toEqual([]);
  });
});

describe('CommentDrawerComponent — submit()', () => {
  it('no-ops for an empty body', async () => {
    const { component, commentService } = makeDrawer();
    const c = component as any;
    c.draft = '   ';
    await c.submit();
    expect(commentService.reply).not.toHaveBeenCalled();
    expect(c.submitting).toBe(false);
  });

  it('creates a thread on first reply when none is bound, then replies', async () => {
    const { component, commentService, toast } = makeDrawer({ thread: null });
    commentService.openOrCreateThread.mockResolvedValue(makeThread([]));
    const c = component as any;
    c.ngOnInit();
    c._roster.set(['alice', 'bob']);
    c.draft = 'hi @bob';

    await c.submit();

    expect(commentService.openOrCreateThread).toHaveBeenCalledWith('obj-1', '');
    expect(commentService.reply).toHaveBeenCalledTimes(1);
    const [threadId, body, mentions] = commentService.reply.mock.calls[0];
    expect(threadId).toBe('th-1');
    expect(body).toBe('hi @bob');
    expect(mentions).toEqual(['bob']);
    expect(toast.show).toHaveBeenCalledWith('Reply posted', 'success');
    expect(c.draft).toBe('');
    expect(c.submitting).toBe(false);
  });

  it('reuses an existing thread without calling openOrCreateThread', async () => {
    const seeded = makeThread([makeReply({ id: 'r1', body: 'hi' })]);
    const { component, commentService } = makeDrawer({ thread: seeded });
    const c = component as any;
    c.ngOnInit(); // populates c.thread from the BehaviorSubject

    c._roster.set(['alice']);
    c.draft = 'second reply';
    await c.submit();

    expect(commentService.openOrCreateThread).not.toHaveBeenCalled();
    expect(commentService.reply).toHaveBeenCalledWith(seeded.id, 'second reply', []);
  });

  it('strips unknown @mentions and surfaces a toast warning', async () => {
    const { component, commentService, toast } = makeDrawer();
    const c = component as any;
    c._roster.set(['alice']);
    c.draft = 'hi @alice and @ghost';

    await c.submit();

    expect(toast.show).toHaveBeenCalledWith(
      expect.stringContaining('Unknown @mention'),
      'warning',
    );
    const [, body, mentions] = commentService.reply.mock.calls[0];
    // Unknown @ghost → stripped to plain "ghost".
    expect(body).toBe('hi @alice and ghost');
    expect(mentions).toEqual(['alice']);
  });

  it('shows an error toast and clears submitting when reply fails', async () => {
    const { component, commentService, toast } = makeDrawer();
    commentService.reply.mockRejectedValue(new Error('boom'));
    const c = component as any;
    c._roster.set(['alice']);
    c.draft = 'hi';

    await c.submit();

    expect(toast.show).toHaveBeenCalledWith('Failed to post reply', 'error');
    expect(c.submitting).toBe(false);
    // Draft is preserved on failure so the user can retry.
    expect(c.draft).toBe('hi');
  });

  it('dedupes repeated @mentions in the mentions array', async () => {
    const { component, commentService } = makeDrawer();
    const c = component as any;
    c._roster.set(['alice']);
    c.draft = '@alice @alice hi';

    await c.submit();
    const [, , mentions] = commentService.reply.mock.calls[0];
    expect(mentions).toEqual(['alice']);
  });
});

describe('CommentDrawerComponent — onEnter keyboard handling', () => {
  it('submits on plain Enter', async () => {
    const { component, commentService } = makeDrawer();
    const c = component as any;
    c._roster.set(['alice']);
    c.draft = 'hi';
    const ev = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false });
    const preventDefault = vi.spyOn(ev, 'preventDefault');
    c.onEnter(ev);
    // submit is async; wait a microtask for the await in submit() to settle
    await Promise.resolve();
    await Promise.resolve();
    expect(preventDefault).toHaveBeenCalled();
    expect(commentService.reply).toHaveBeenCalled();
  });

  it('does NOT submit on Shift+Enter (newline)', () => {
    const { component, commentService } = makeDrawer();
    const c = component as any;
    c._roster.set(['alice']);
    c.draft = 'hi';
    const ev = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true });
    const preventDefault = vi.spyOn(ev, 'preventDefault');
    c.onEnter(ev);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(commentService.reply).not.toHaveBeenCalled();
  });
});

describe('CommentDrawerComponent — lifecycle and emitters', () => {
  it('ngOnInit subscribes and populates replies on thread emission', () => {
    const thread = makeThread([
      makeReply({ id: 'r1', body: 'hi' }),
      makeReply({ id: 'r2', body: 'there' }),
    ]);
    const { component } = makeDrawer({ thread });
    component.ngOnInit();
    const c = component as any;
    expect(c.replies.length).toBe(2);
    expect(c.replies[0].id).toBe('r1');
  });

  it('ngOnDestroy unsubscribes — further emissions do not update replies', () => {
    const seed = makeThread([makeReply({ id: 'r1', body: 'hi' })]);
    const { component, threadSubject } = makeDrawer({ thread: seed });
    component.ngOnInit();
    expect((component as any).replies.length).toBe(1);

    component.ngOnDestroy();
    threadSubject.next(makeThread([
      makeReply({ id: 'r1', body: 'hi' }),
      makeReply({ id: 'r2', body: 'late' }),
    ]));
    expect((component as any).replies.length).toBe(1);
  });

  it('closed EventEmitter propagates to subscribers', () => {
    const { component } = makeDrawer();
    let fired = 0;
    component.closed.subscribe(() => fired++);
    component.closed.emit();
    component.closed.emit();
    expect(fired).toBe(2);
  });

  it('loads the roster from all profiles when workspaceId is empty', async () => {
    const { component, auth } = makeDrawer();
    component.workspaceId = '';
    component.ngOnInit();
    // Allow the microtask in _loadRoster to resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(auth.listProfiles).toHaveBeenCalled();
  });

  it('loads the roster from workspace-scoped events when workspaceId is set', async () => {
    const threadSubject = new BehaviorSubject<CommentThread | null>(null);
    const commentService = {
      threadsByTarget$: vi.fn().mockReturnValue(threadSubject),
      openOrCreateThread: vi.fn(),
      reply: vi.fn(),
    };
    const toast = { show: vi.fn() };
    const auth = {
      listProfiles: vi.fn().mockResolvedValue([
        { id: 'p1', username: 'alice' },
        { id: 'p2', username: 'bob' },
        { id: 'p3', username: 'carol' }, // absent from events → filtered out
      ]),
    };
    const db = {
      open: vi.fn().mockResolvedValue({
        getAllFromIndex: vi.fn().mockResolvedValue([
          { payload: { profileId: 'p1' } },
          { payload: { profileId: 'p2' } },
          { payload: {} }, // no profileId key — ignored
        ]),
      }),
    };
    const component = new CommentDrawerComponent(
      commentService as never,
      toast as never,
      auth as never,
      db as never,
    );
    component.targetId = 'obj-1';
    component.workspaceId = 'ws-42';
    component.profileId = 'p1';
    component.username = 'alice';
    component.ngOnInit();

    // Wait for the async IIFE that loads the roster.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(db.open).toHaveBeenCalled();
    const idb = await db.open.mock.results[0].value;
    expect(idb.getAllFromIndex).toHaveBeenCalledWith('events', 'by_workspace', 'ws-42');

    const c = component as any;
    expect(c._roster()).toEqual(['alice', 'bob']);
  });

  it('falls back to all profiles when the events index query fails', async () => {
    const threadSubject = new BehaviorSubject<CommentThread | null>(null);
    const commentService = {
      threadsByTarget$: vi.fn().mockReturnValue(threadSubject),
      openOrCreateThread: vi.fn(),
      reply: vi.fn(),
    };
    const toast = { show: vi.fn() };
    const auth = {
      listProfiles: vi.fn().mockResolvedValue([
        { id: 'p1', username: 'alice' },
        { id: 'p2', username: 'bob' },
      ]),
    };
    const db = {
      open: vi.fn().mockResolvedValue({
        getAllFromIndex: vi.fn().mockRejectedValue(new Error('idb-broke')),
      }),
    };
    const component = new CommentDrawerComponent(
      commentService as never,
      toast as never,
      auth as never,
      db as never,
    );
    component.targetId = 'obj-1';
    component.workspaceId = 'ws-x';
    component.ngOnInit();

    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect((component as any)._roster()).toEqual(['alice', 'bob']);
  });

  it('falls back to full profile list when no events have been logged yet', async () => {
    const threadSubject = new BehaviorSubject<CommentThread | null>(null);
    const commentService = {
      threadsByTarget$: vi.fn().mockReturnValue(threadSubject),
      openOrCreateThread: vi.fn(),
      reply: vi.fn(),
    };
    const auth = {
      listProfiles: vi.fn().mockResolvedValue([
        { id: 'p1', username: 'alice' },
        { id: 'p2', username: 'bob' },
      ]),
    };
    const db = {
      open: vi.fn().mockResolvedValue({
        getAllFromIndex: vi.fn().mockResolvedValue([]), // empty events
      }),
    };
    const component = new CommentDrawerComponent(
      commentService as never,
      { show: vi.fn() } as never,
      auth as never,
      db as never,
    );
    component.workspaceId = 'ws-fresh';
    component.ngOnInit();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect((component as any)._roster()).toEqual(['alice', 'bob']);
  });

  it('scrollToBottom is called via ngAfterViewChecked after reply count changes', () => {
    const thread = makeThread([makeReply({ id: 'r1', body: 'x' })]);
    const { component } = makeDrawer({ thread });
    component.ngOnInit();
    const c = component as any;
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true });
    c.replyListRef = { nativeElement: el };
    el.scrollTop = 0;

    // Simulate new reply coming in — should set shouldScrollToBottom.
    c.replies = [makeReply({ id: 'r1' }), makeReply({ id: 'r2' })];
    c.shouldScrollToBottom = true;

    c.ngAfterViewChecked();
    expect(el.scrollTop).toBe(500);
    expect(c.shouldScrollToBottom).toBe(false);

    // Calling again with the flag already cleared is a no-op.
    el.scrollTop = 123;
    c.ngAfterViewChecked();
    expect(el.scrollTop).toBe(123);
  });
});

describe('CommentDrawerComponent — avatar helpers', () => {
  it('avatarColor returns a deterministic hex for a given author id', () => {
    const { component } = makeDrawer();
    const c = component as any;
    const a = c.avatarColor('alice');
    const b = c.avatarColor('alice');
    expect(a).toBe(b);
    expect(a).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('initials returns first 2 chars uppercase; "?" for empty id', () => {
    const { component } = makeDrawer();
    const c = component as any;
    expect(c.initials('alice')).toBe('AL');
    expect(c.initials('')).toBe('?');
  });
});
