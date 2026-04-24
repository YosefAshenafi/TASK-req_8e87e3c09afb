/**
 * ChatPanelComponent — deep behavioural unit tests.
 *
 * Covers:
 *   • happy path: send(), search(), toggleSearch()
 *   • validation: empty / whitespace drafts are rejected
 *   • state transitions: sending flag, searchResults signal, showSearch toggle
 *   • subscription lifecycle: ngOnInit subscribes, ngOnDestroy unsubscribes
 *   • grouping: _buildRows produces correct avatar/name flags for runs of messages
 *   • side effects: chatService.send / chatService.search called with the right args
 *
 * No Angular TestBed — the component is instantiated directly with mocked
 * services so we can observe exact side-effects on the collaborators.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { ChatPanelComponent } from '../src/app/chat/chat-panel.component';
import type { ChatMessage } from '../src/app/core/types';

type ChatMocks = {
  messages$: BehaviorSubject<ChatMessage[]>;
  loadForWorkspace: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

function makeChat(opts: { profile?: { id: string; username: string } | null } = {}) {
  const chatService: ChatMocks = {
    messages$: new BehaviorSubject<ChatMessage[]>([]),
    loadForWorkspace: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    send: vi.fn().mockResolvedValue(undefined),
  };
  const profile = opts.profile === undefined
    ? { id: 'u1', username: 'alice' }
    : opts.profile;
  const auth = { currentProfile: profile };
  const component = new ChatPanelComponent(chatService as never, auth as never);
  return { component: component as ChatPanelComponent & Record<string, unknown>, chatService, auth };
}

const makeMsg = (p: Partial<ChatMessage>): ChatMessage => ({
  id: p.id ?? 'm-' + Math.random().toString(36).slice(2, 8),
  workspaceId: p.workspaceId ?? 'ws1',
  type: p.type ?? 'user',
  authorId: p.authorId,
  authorName: p.authorName,
  body: p.body ?? '',
  createdAt: p.createdAt ?? Date.now(),
});

describe('ChatPanelComponent — constructor / own-user metadata', () => {
  it('derives ownName and ownInitials from the current profile username', () => {
    const { component } = makeChat({ profile: { id: 'u1', username: 'Alice Smith' } });
    const c = component as any;
    expect(c.ownName).toBe('Alice Smith');
    expect(c.ownInitials).toBe('AS');
  });

  it('falls back to "Me" / "?" when the user is not signed in', () => {
    const { component } = makeChat({ profile: null });
    const c = component as any;
    expect(c.ownName).toBe('Me');
    expect(c.ownInitials).toBe('?');
    expect(c.ownColor).toBe('#90a4ae');
  });

  it('ownColor is a hex from the palette for a signed-in user', () => {
    const { component } = makeChat();
    const c = component as any;
    expect(c.ownColor).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('ChatPanelComponent — send()', () => {
  it('trims surrounding whitespace and sends trimmed body', async () => {
    const { component, chatService } = makeChat();
    const c = component as any;
    c.draft = '   hello world   ';
    await c.send();
    expect(chatService.send).toHaveBeenCalledTimes(1);
    expect(chatService.send).toHaveBeenCalledWith('hello world');
  });

  it('clears the draft after successful send', async () => {
    const { component } = makeChat();
    const c = component as any;
    c.draft = 'hi';
    await c.send();
    expect(c.draft).toBe('');
  });

  it('no-ops when the draft is empty', async () => {
    const { component, chatService } = makeChat();
    const c = component as any;
    c.draft = '';
    await c.send();
    expect(chatService.send).not.toHaveBeenCalled();
  });

  it('no-ops when the draft is whitespace-only', async () => {
    const { component, chatService } = makeChat();
    const c = component as any;
    c.draft = '     ';
    await c.send();
    expect(chatService.send).not.toHaveBeenCalled();
  });

  it('toggles the `sending` signal true → false around the call', async () => {
    let during = false;
    const { component, chatService } = makeChat();
    chatService.send.mockImplementation(async () => {
      during = (component as any).sending();
    });
    const c = component as any;
    expect(c.sending()).toBe(false);
    c.draft = 'hi';
    await c.send();
    expect(during).toBe(true);
    expect(c.sending()).toBe(false);
  });

  it('clears `sending` even when the service rejects', async () => {
    const { component, chatService } = makeChat();
    chatService.send.mockRejectedValue(new Error('network down'));
    const c = component as any;
    c.draft = 'boom';
    await expect(c.send()).rejects.toThrow('network down');
    expect(c.sending()).toBe(false);
  });
});

describe('ChatPanelComponent — search flow', () => {
  it('toggleSearch flips showSearch and clears state when closing', () => {
    const { component } = makeChat();
    const c = component as any;
    expect(c.showSearch()).toBe(false);

    c.toggleSearch();
    expect(c.showSearch()).toBe(true);

    c.searchQuery = 'hello';
    c.searchResults.set([makeMsg({ id: 'x1', body: 'hello' })]);

    c.toggleSearch();
    expect(c.showSearch()).toBe(false);
    expect(c.searchQuery).toBe('');
    expect(c.searchResults().length).toBe(0);
  });

  it('onSearch populates searchResults for a non-empty query', async () => {
    const { component, chatService } = makeChat();
    const found: ChatMessage[] = [
      makeMsg({ id: 'r1', body: 'hello there', authorId: 'u2' }),
      makeMsg({ id: 'r2', body: 'hello again',  authorId: 'u2' }),
    ];
    chatService.search.mockResolvedValue(found);
    const c = component as any;
    c.searchQuery = 'hello';
    await c.onSearch();
    expect(chatService.search).toHaveBeenCalledWith('hello');
    expect(c.searchResults().length).toBe(2);
    expect(c.searchRows().length).toBe(2);
  });

  it('onSearch clears results when the query is empty / whitespace', async () => {
    const { component, chatService } = makeChat();
    const c = component as any;
    // Seed existing results so we can observe them being cleared.
    c.searchResults.set([makeMsg({ id: 'x1', body: 'x' })]);
    c.searchRows.set([{ msg: makeMsg({ id: 'x1', body: 'x' }), isOwn: false, showAvatar: true, showName: true }]);

    c.searchQuery = '   ';
    await c.onSearch();

    expect(chatService.search).not.toHaveBeenCalled();
    expect(c.searchResults().length).toBe(0);
    expect(c.searchRows().length).toBe(0);
  });
});

describe('ChatPanelComponent — lifecycle and rows subscription', () => {
  it('ngOnInit calls loadForWorkspace(workspaceId)', async () => {
    const { component, chatService } = makeChat();
    component.workspaceId = 'ws-42';
    await component.ngOnInit();
    expect(chatService.loadForWorkspace).toHaveBeenCalledWith('ws-42');
  });

  it('subscribes to messages$ and rebuilds rows on each emission', async () => {
    const { component, chatService } = makeChat();
    await component.ngOnInit();
    const c = component as any;

    const msgs: ChatMessage[] = [
      makeMsg({ id: 'm1', body: 'hi',   authorId: 'u1', authorName: 'alice' }),
      makeMsg({ id: 'm2', body: 'hey',  authorId: 'u1', authorName: 'alice' }),
      makeMsg({ id: 'm3', body: 'yo',   authorId: 'u2', authorName: 'bob' }),
    ];
    chatService.messages$.next(msgs);

    const rows = c.rows();
    expect(rows).toHaveLength(3);
    // First bubble in the alice run shows avatar & owns it (u1 === me)
    expect(rows[0]).toMatchObject({ isOwn: true,  showAvatar: true,  showName: false });
    // Second consecutive alice message collapses the avatar
    expect(rows[1]).toMatchObject({ isOwn: true,  showAvatar: false, showName: false });
    // Switching to bob starts a new group: show avatar + sender name
    expect(rows[2]).toMatchObject({ isOwn: false, showAvatar: true,  showName: true });
  });

  it('system messages always render with avatar=true and isOwn=false', async () => {
    const { component, chatService } = makeChat();
    await component.ngOnInit();
    const c = component as any;

    chatService.messages$.next([
      makeMsg({ id: 's1', type: 'system', body: 'User joined' }),
      makeMsg({ id: 'u1', type: 'user',   body: 'hello', authorId: 'u2', authorName: 'bob' }),
    ]);
    const rows = c.rows();
    expect(rows[0]).toMatchObject({ isOwn: false, showAvatar: true, showName: false });
    // After a system row, the next user message starts a new group.
    expect(rows[1]).toMatchObject({ showAvatar: true, showName: true });
  });

  it('ngOnDestroy unsubscribes — further emissions do not update rows', async () => {
    const { component, chatService } = makeChat();
    await component.ngOnInit();
    const c = component as any;

    chatService.messages$.next([makeMsg({ id: 'm1', body: 'a', authorId: 'u1', authorName: 'alice' })]);
    expect(c.rows().length).toBe(1);

    component.ngOnDestroy();
    chatService.messages$.next([
      makeMsg({ id: 'm1', body: 'a', authorId: 'u1', authorName: 'alice' }),
      makeMsg({ id: 'm2', body: 'b', authorId: 'u1', authorName: 'alice' }),
    ]);
    // Still 1 — the component has unsubscribed.
    expect(c.rows().length).toBe(1);
  });
});

describe('ChatPanelComponent — ngAfterViewChecked scroll behaviour', () => {
  it('scrolls the message list to the bottom when new messages arrive', async () => {
    const { component, chatService } = makeChat();
    await component.ngOnInit();
    const c = component as any;

    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 800, configurable: true });
    c.messageListRef = { nativeElement: el };
    el.scrollTop = 0;

    chatService.messages$.next([makeMsg({ id: 'm1', body: 'hi' })]);
    // _shouldScroll should be true now — ngAfterViewChecked will flush it.
    c.ngAfterViewChecked();
    expect(el.scrollTop).toBe(800);
  });

  it('ngAfterViewChecked is a no-op when _shouldScroll is false', () => {
    const { component } = makeChat();
    const c = component as any;
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 999, configurable: true });
    el.scrollTop = 42;
    c.messageListRef = { nativeElement: el };
    c._shouldScroll = false;
    c.ngAfterViewChecked();
    expect(el.scrollTop).toBe(42);
  });

  it('does not throw when messageListRef is not yet wired', () => {
    const { component } = makeChat();
    const c = component as any;
    c._shouldScroll = true;
    // messageListRef intentionally unset — Angular @ViewChild may not resolve
    // before the first check. The component should handle this gracefully.
    expect(() => c.ngAfterViewChecked()).not.toThrow();
  });
});
