/**
 * UI components — smoke / residual coverage.
 *
 * The seven larger components (ChatPanel, CommentDrawer, MutualHelpBoard,
 * MutualHelpForm, ActivityFeed, SnapshotPanel, NoteImportWizard) each have
 * their own dedicated deep behavioural spec file:
 *
 *   - chat-panel.component.spec.ts
 *   - comment-drawer.component.spec.ts
 *   - mutual-help-board.component.spec.ts
 *   - mutual-help-form.component.spec.ts
 *   - activity-feed.component.spec.ts
 *   - snapshot-panel.component.spec.ts
 *   - note-import-wizard.component.spec.ts
 *
 * This file now only holds:
 *   • A tiny import-existence check for WorkspaceLayoutComponent (its own
 *     behavioural suite lives in workspace-layout.component.spec.ts).
 *   • The CanvasComponent tool-switching test.
 *   • The InboxPanelComponent suite, which is covered here because the
 *     inbox panel has no sibling .service.ts — the component *is* the unit.
 */
import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { CanvasComponent } from '../src/app/canvas/canvas.component';
import { InboxPanelComponent } from '../src/app/inbox/inbox-panel.component';
import { WorkspaceLayoutComponent } from '../src/app/workspace/workspace-layout.component';

describe('UI components smoke coverage', () => {
  it('imports key container components', () => {
    expect(WorkspaceLayoutComponent).toBeDefined();
  });
});

describe('CanvasComponent', () => {
  function makeCanvas() {
    const canvasService = {
      objects$: new BehaviorSubject<unknown[]>([]),
      conflict$: new BehaviorSubject<unknown>(null),
      loadForWorkspace: vi.fn().mockResolvedValue(undefined),
    };
    const tab = { id: 't1', color: '#123456' };
    const sanitizer = { bypassSecurityTrustHtml: (s: string) => s };
    const presence = { cursors$: new BehaviorSubject<unknown[]>([]) };
    return new CanvasComponent(
      canvasService as never,
      tab as never,
      sanitizer as never,
      presence as never,
    );
  }

  it('switches tools and updates cursor mode', () => {
    const c = makeCanvas() as any;
    c.setTool('erase');
    expect(c.activeTool()).toBe('erase');
    expect(c.cursorStyle()).toBe('cell');

    c.setTool('rectangle');
    expect(c.activeTool()).toBe('rectangle');
    expect(c.cursorStyle()).toBe('crosshair');
  });
});

describe('InboxPanelComponent', () => {
  function makeInbox(initialItems: unknown[] = []) {
    const inbox$ = new BehaviorSubject<unknown[]>(initialItems);
    const commentService = { inbox$, markThreadRead: vi.fn() };
    const c = new InboxPanelComponent(commentService as never) as any;
    c.profileId = 'p1';
    return { c, commentService, inbox$ };
  }

  it('marks unread thread as read when clicked', () => {
    const { c, commentService } = makeInbox();
    c.onItemClick({ id: 'i1', threadId: 't1', read: false, mentionedBy: 'alice', body: 'hello', at: Date.now() });
    expect(commentService.markThreadRead).toHaveBeenCalledWith('t1', 'p1');
  });

  it('does NOT call markThreadRead when an already-read item is clicked', () => {
    const { c, commentService } = makeInbox();
    c.onItemClick({ id: 'i1', threadId: 't1', read: true, mentionedBy: 'alice', body: 'hello', at: Date.now() });
    expect(commentService.markThreadRead).not.toHaveBeenCalled();
  });

  it('ngOnInit subscribes to inbox$ and populates items', () => {
    const items = [
      { id: 'i1', threadId: 't1', read: false, mentionedBy: 'alice', body: 'hello', at: Date.now() },
      { id: 'i2', threadId: 't2', read: true, mentionedBy: 'bob', body: 'world', at: Date.now() },
    ];
    const { c, inbox$ } = makeInbox();
    c.ngOnInit();
    inbox$.next(items);
    expect(c.items.length).toBe(2);
    c.ngOnDestroy();
  });

  it('ngOnInit keeps unreadCount in sync with inbox$', () => {
    const { c, inbox$ } = makeInbox();
    c.ngOnInit();
    inbox$.next([
      { id: 'i1', threadId: 't1', read: false, mentionedBy: 'alice', body: 'a', at: Date.now() },
      { id: 'i2', threadId: 't2', read: false, mentionedBy: 'bob', body: 'b', at: Date.now() },
      { id: 'i3', threadId: 't3', read: true, mentionedBy: 'carol', body: 'c', at: Date.now() },
    ]);
    expect(c.unreadCount).toBe(2);
    c.ngOnDestroy();
  });

  it('ngOnDestroy unsubscribes — further inbox$ emissions do not update items', () => {
    const { c, inbox$ } = makeInbox();
    c.ngOnInit();
    c.ngOnDestroy();
    inbox$.next([{ id: 'i1', threadId: 't1', read: false, mentionedBy: 'x', body: 'y', at: 0 }]);
    expect(c.items.length).toBe(0); // items were never set before destroy
  });

  it('truncate returns the body unchanged when <= 60 characters', () => {
    const { c } = makeInbox();
    expect(c.truncate('short message')).toBe('short message');
    expect(c.truncate('a'.repeat(60))).toBe('a'.repeat(60));
  });

  it('truncate slices to 60 chars and appends ellipsis for long bodies', () => {
    const { c } = makeInbox();
    const long = 'x'.repeat(80);
    expect(c.truncate(long)).toBe('x'.repeat(60) + '…');
  });

  it('relTime returns "just now" for timestamps within the last minute', () => {
    const { c } = makeInbox();
    expect(c.relTime(Date.now() - 30_000)).toBe('just now');
    expect(c.relTime(Date.now() - 59_000)).toBe('just now');
  });

  it('relTime returns "<N>m ago" for timestamps between 1–59 minutes old', () => {
    const { c } = makeInbox();
    expect(c.relTime(Date.now() - 5 * 60_000)).toBe('5m ago');
    expect(c.relTime(Date.now() - 59 * 60_000)).toBe('59m ago');
  });

  it('relTime returns "<N>h ago" for timestamps between 1–23 hours old', () => {
    const { c } = makeInbox();
    expect(c.relTime(Date.now() - 3 * 3600_000)).toBe('3h ago');
  });

  it('closed EventEmitter emits void when triggered', () => {
    const { c } = makeInbox();
    let fired = 0;
    c.closed.subscribe(() => fired++);
    c.closed.emit();
    expect(fired).toBe(1);
  });
});
