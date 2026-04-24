/**
 * MutualHelpBoardComponent — deep behavioural unit tests.
 *
 * Covers:
 *   • filteredPosts() correctness across all FilterTab values (all / active / draft / closed)
 *   • countFor() across tabs
 *   • truncate() boundary conditions
 *   • expiryLabel() time math (Date.now is mocked so the label is deterministic)
 *   • tabLabel() mapping
 *   • togglePin / withdrawPost / publishPost call the service with correct args
 *     and swallow service errors (component contract)
 *   • editPost / onFormSaved / onFormCancelled state transitions
 *   • lifecycle: ngOnInit subscribes to posts$, ngOnDestroy unsubscribes
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { MutualHelpBoardComponent } from '../src/app/mutual-help/mutual-help-board.component';
import type { MutualHelpPost } from '../src/app/core/types';

const NOW = 1_700_000_000_000;

function makePost(p: Partial<MutualHelpPost>): MutualHelpPost {
  return {
    id: p.id ?? 'post-' + Math.random().toString(36).slice(2, 8),
    workspaceId: p.workspaceId ?? 'ws-1',
    status: p.status ?? 'active',
    type: p.type ?? 'request',
    category: p.category ?? 'transport',
    title: p.title ?? 'Need ride',
    description: p.description ?? 'A short description',
    tags: p.tags ?? [],
    timeWindow: p.timeWindow,
    budget: p.budget,
    urgency: p.urgency ?? 'medium',
    attachmentIds: p.attachmentIds ?? [],
    authorId: p.authorId ?? 'p-author',
    pinned: p.pinned ?? false,
    expiresAt: p.expiresAt ?? NOW + 3_600_000,
    createdAt: p.createdAt ?? NOW - 1000,
    updatedAt: p.updatedAt ?? NOW - 1000,
    version: p.version ?? 1,
  };
}

function makeBoard(opts: { profileId?: string } = {}) {
  const mutualHelpService = {
    loadForWorkspace: vi.fn().mockResolvedValue(undefined),
    posts$: new BehaviorSubject<MutualHelpPost[]>([]),
    pin: vi.fn().mockResolvedValue(undefined),
    withdraw: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
  };
  const auth = { currentProfile: { id: opts.profileId ?? 'me' } };
  const component = new MutualHelpBoardComponent(mutualHelpService as never, auth as never);
  component.workspaceId = 'ws-1';
  component.profileId = opts.profileId ?? 'me';
  return { component: component as MutualHelpBoardComponent & Record<string, any>, mutualHelpService };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MutualHelpBoardComponent — filteredPosts', () => {
  it('returns everything when the filter is "all"', () => {
    const { component } = makeBoard();
    const c = component as any;
    c.allPosts.set([
      makePost({ id: 'a', status: 'active' }),
      makePost({ id: 'b', status: 'draft' }),
      makePost({ id: 'c', status: 'withdrawn' }),
    ]);
    c.activeFilter.set('all');
    expect(c.filteredPosts().map((p: MutualHelpPost) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters to active only', () => {
    const { component } = makeBoard();
    const c = component as any;
    c.allPosts.set([
      makePost({ id: 'a', status: 'active' }),
      makePost({ id: 'b', status: 'draft' }),
      makePost({ id: 'c', status: 'withdrawn' }),
    ]);
    c.activeFilter.set('active');
    expect(c.filteredPosts().map((p: MutualHelpPost) => p.id)).toEqual(['a']);
  });

  it('filters to draft only', () => {
    const { component } = makeBoard();
    const c = component as any;
    c.allPosts.set([
      makePost({ id: 'a', status: 'active' }),
      makePost({ id: 'b', status: 'draft' }),
    ]);
    c.activeFilter.set('draft');
    expect(c.filteredPosts().map((p: MutualHelpPost) => p.id)).toEqual(['b']);
  });

  it('treats "closed" as expired + withdrawn', () => {
    const { component } = makeBoard();
    const c = component as any;
    c.allPosts.set([
      makePost({ id: 'a', status: 'active' }),
      makePost({ id: 'b', status: 'expired' }),
      makePost({ id: 'c', status: 'withdrawn' }),
      makePost({ id: 'd', status: 'resolved' }),
    ]);
    c.activeFilter.set('closed');
    expect(c.filteredPosts().map((p: MutualHelpPost) => p.id)).toEqual(['b', 'c']);
  });
});

describe('MutualHelpBoardComponent — countFor', () => {
  it('counts accurately per tab', () => {
    const { component } = makeBoard();
    const c = component as any;
    c.allPosts.set([
      makePost({ status: 'active' }),
      makePost({ status: 'active' }),
      makePost({ status: 'draft' }),
      makePost({ status: 'expired' }),
      makePost({ status: 'withdrawn' }),
      makePost({ status: 'resolved' }),
    ]);
    expect(c.countFor('all')).toBe(6);
    expect(c.countFor('active')).toBe(2);
    expect(c.countFor('draft')).toBe(1);
    expect(c.countFor('closed')).toBe(2);
  });
});

describe('MutualHelpBoardComponent — display helpers', () => {
  it('tabLabel returns the right human label for each filter', () => {
    const { component } = makeBoard();
    const c = component as any;
    expect(c.tabLabel('all')).toBe('All');
    expect(c.tabLabel('active')).toBe('Active');
    expect(c.tabLabel('draft')).toBe('Draft');
    expect(c.tabLabel('closed')).toBe('Expired/Withdrawn');
  });

  it('truncate leaves short strings untouched', () => {
    const { component } = makeBoard();
    const c = component as any;
    expect(c.truncate('short', 10)).toBe('short');
    expect(c.truncate('exactlen', 8)).toBe('exactlen');
  });

  it('truncate slices + appends ellipsis for long strings', () => {
    const { component } = makeBoard();
    const c = component as any;
    expect(c.truncate('abcdefghij', 5)).toBe('abcde…');
  });

  it('expiryLabel returns "Expired" for past timestamps', () => {
    const { component } = makeBoard();
    const c = component as any;
    expect(c.expiryLabel(NOW - 1000)).toBe('Expired');
    expect(c.expiryLabel(NOW)).toBe('Expired');
  });

  it('expiryLabel returns "Expires in Xh Ym" for future timestamps', () => {
    const { component } = makeBoard();
    const c = component as any;
    // 2h 30m from NOW
    expect(c.expiryLabel(NOW + 2 * 3600_000 + 30 * 60_000)).toBe('Expires in 2h 30m');
    // Sub-hour window
    expect(c.expiryLabel(NOW + 15 * 60_000)).toBe('Expires in 0h 15m');
  });
});

describe('MutualHelpBoardComponent — service actions', () => {
  it('togglePin pins an unpinned post', async () => {
    const { component, mutualHelpService } = makeBoard();
    const c = component as any;
    const p = makePost({ id: 'x', pinned: false });
    await c.togglePin(p);
    expect(mutualHelpService.pin).toHaveBeenCalledWith('x', true);
  });

  it('togglePin unpins a pinned post', async () => {
    const { component, mutualHelpService } = makeBoard();
    const c = component as any;
    const p = makePost({ id: 'x', pinned: true });
    await c.togglePin(p);
    expect(mutualHelpService.pin).toHaveBeenCalledWith('x', false);
  });

  it('togglePin swallows service errors silently', async () => {
    const { component, mutualHelpService } = makeBoard();
    mutualHelpService.pin.mockRejectedValue(new Error('boom'));
    const c = component as any;
    await expect(c.togglePin(makePost({ id: 'x' }))).resolves.toBeUndefined();
  });

  it('withdrawPost calls service.withdraw with the post id', async () => {
    const { component, mutualHelpService } = makeBoard();
    const c = component as any;
    await c.withdrawPost(makePost({ id: 'w1' }));
    expect(mutualHelpService.withdraw).toHaveBeenCalledWith('w1');
  });

  it('publishPost calls service.publish with the post id', async () => {
    const { component, mutualHelpService } = makeBoard();
    const c = component as any;
    await c.publishPost(makePost({ id: 'd1' }));
    expect(mutualHelpService.publish).toHaveBeenCalledWith('d1');
  });
});

describe('MutualHelpBoardComponent — form state transitions', () => {
  it('editPost sets editingPost and keeps showForm false', () => {
    const { component } = makeBoard();
    const c = component as any;
    const p = makePost({ id: 'e1' });
    c.editPost(p);
    expect(c.editingPost()).toBe(p);
    expect(c.showForm()).toBe(false);
  });

  it('onFormSaved clears both showForm and editingPost', () => {
    const { component } = makeBoard();
    const c = component as any;
    c.showForm.set(true);
    c.editingPost.set(makePost({ id: 'e1' }));
    c.onFormSaved();
    expect(c.showForm()).toBe(false);
    expect(c.editingPost()).toBeNull();
  });

  it('onFormCancelled clears both showForm and editingPost', () => {
    const { component } = makeBoard();
    const c = component as any;
    c.showForm.set(true);
    c.editingPost.set(makePost({ id: 'e1' }));
    c.onFormCancelled();
    expect(c.showForm()).toBe(false);
    expect(c.editingPost()).toBeNull();
  });
});

describe('MutualHelpBoardComponent — lifecycle', () => {
  it('ngOnInit loads posts and subscribes to the posts$ stream', async () => {
    const { component, mutualHelpService } = makeBoard();
    const c = component as any;
    await component.ngOnInit();
    expect(mutualHelpService.loadForWorkspace).toHaveBeenCalledWith('ws-1');

    mutualHelpService.posts$.next([makePost({ id: 'p1' })]);
    expect(c.allPosts().length).toBe(1);
  });

  it('ngOnDestroy unsubscribes — further emissions do not update allPosts', async () => {
    const { component, mutualHelpService } = makeBoard();
    const c = component as any;
    await component.ngOnInit();
    mutualHelpService.posts$.next([makePost({ id: 'p1' })]);
    component.ngOnDestroy();
    mutualHelpService.posts$.next([makePost({ id: 'p1' }), makePost({ id: 'p2' })]);
    expect(c.allPosts().length).toBe(1);
  });
});
