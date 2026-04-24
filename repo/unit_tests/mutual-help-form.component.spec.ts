/**
 * MutualHelpFormComponent — deep behavioural unit tests.
 *
 * Covers:
 *   • required-field validation: category / title / description
 *   • create flow: createDraft called with the right shape + expiresIn math
 *   • publish branch: create → publish chain for the 'publish' action
 *   • edit flow (F-B02): mutualHelpService.edit called with version + merged attachments
 *   • attachment size enforcement via onFilesSelected (20 MB cap)
 *   • removeFile drops a single file without touching the others
 *   • overlay click emits `cancelled`, inner click does not
 *   • saved / cancelled EventEmitters fire correctly
 *   • error toast + errorMsg on service failure
 *   • ngOnInit preloads the form when editing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MutualHelpFormComponent } from '../src/app/mutual-help/mutual-help-form.component';
import { MAX_ATTACHMENT_BYTES } from '../src/app/core/attachment.service';
import type { MutualHelpPost } from '../src/app/core/types';

const NOW = 1_700_000_000_000;

function makePost(p: Partial<MutualHelpPost>): MutualHelpPost {
  return {
    id: p.id ?? 'post-x',
    workspaceId: p.workspaceId ?? 'ws-1',
    status: p.status ?? 'active',
    type: p.type ?? 'request',
    category: p.category ?? 'transport',
    title: p.title ?? 'Need ride',
    description: p.description ?? 'desc',
    tags: p.tags ?? ['carpool'],
    timeWindow: p.timeWindow,
    budget: p.budget,
    urgency: p.urgency ?? 'low',
    attachmentIds: p.attachmentIds ?? ['a1'],
    authorId: p.authorId ?? 'p-me',
    pinned: p.pinned ?? false,
    expiresAt: p.expiresAt ?? NOW + 3_600_000,
    createdAt: p.createdAt ?? NOW - 1000,
    updatedAt: p.updatedAt ?? NOW - 1000,
    version: p.version ?? 3,
  };
}

function makeForm(opts: {
  post?: MutualHelpPost | null;
  attachmentOk?: boolean;
  createOk?: boolean;
  publishOk?: boolean;
  editOk?: boolean;
} = {}) {
  const mutualHelpService = {
    edit: vi.fn().mockImplementation(() =>
      opts.editOk === false ? Promise.reject(new Error('edit-fail')) : Promise.resolve(),
    ),
    createDraft: vi.fn().mockImplementation(() =>
      opts.createOk === false
        ? Promise.reject(new Error('create-fail'))
        : Promise.resolve({ id: 'post-new', version: 1 }),
    ),
    publish: vi.fn().mockImplementation(() =>
      opts.publishOk === false
        ? Promise.reject(new Error('publish-fail'))
        : Promise.resolve(),
    ),
  };
  const toast = { show: vi.fn() };
  const attachment = {
    upload: vi.fn().mockImplementation((f: File) =>
      opts.attachmentOk === false
        ? Promise.reject(new Error('upload-fail'))
        : Promise.resolve('att-' + f.name),
    ),
  };
  const component = new MutualHelpFormComponent(
    mutualHelpService as never,
    toast as never,
    attachment as never,
  );
  component.workspaceId = 'ws-1';
  component.profileId = 'p-me';
  component.post = opts.post ?? null;
  return { component: component as MutualHelpFormComponent & Record<string, any>, mutualHelpService, toast, attachment };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe('MutualHelpFormComponent — validation', () => {
  it('errors when category is blank', async () => {
    const { component, mutualHelpService } = makeForm();
    const c = component as any;
    c.form.category = '  ';
    c.form.title = 'T';
    c.form.description = 'D';
    await c.submit();
    expect(c.errorMsg()).toBe('Category is required.');
    expect(mutualHelpService.createDraft).not.toHaveBeenCalled();
  });

  it('errors when title is blank', async () => {
    const { component, mutualHelpService } = makeForm();
    const c = component as any;
    c.form.category = 'c';
    c.form.title = '   ';
    c.form.description = 'D';
    await c.submit();
    expect(c.errorMsg()).toBe('Title is required.');
    expect(mutualHelpService.createDraft).not.toHaveBeenCalled();
  });

  it('errors when description is blank', async () => {
    const { component, mutualHelpService } = makeForm();
    const c = component as any;
    c.form.category = 'c';
    c.form.title = 'T';
    c.form.description = '';
    await c.submit();
    expect(c.errorMsg()).toBe('Description is required.');
    expect(mutualHelpService.createDraft).not.toHaveBeenCalled();
  });

  it('clears the error after a valid submit', async () => {
    const { component } = makeForm();
    const c = component as any;
    c.errorMsg.set('stale');
    c.form.category = 'c';
    c.form.title = 'T';
    c.form.description = 'D';
    c.form.tagsInput = '  one,  two , , ';
    await c.submit();
    expect(c.errorMsg()).toBe('');
  });
});

describe('MutualHelpFormComponent — create flow', () => {
  it('createDraft receives a correctly shaped NewPostInput', async () => {
    const { component, mutualHelpService } = makeForm();
    const c = component as any;
    c.form.type = 'offer';
    c.form.category = 'transport';
    c.form.title = '  Need ride  ';
    c.form.description = '  go east  ';
    c.form.tagsInput = 'carpool, urgent ,,';
    c.form.timeWindow = ' mornings ';
    c.form.budget = ' $10 ';
    c.form.urgency = 'high';
    c.form.expiresIn = 24;
    c.form.action = 'draft';

    await c.submit();

    const arg = mutualHelpService.createDraft.mock.calls[0][0];
    expect(arg.workspaceId).toBe('ws-1');
    expect(arg.type).toBe('offer');
    expect(arg.category).toBe('transport');
    expect(arg.title).toBe('Need ride');
    expect(arg.description).toBe('go east');
    expect(arg.tags).toEqual(['carpool', 'urgent']);
    expect(arg.timeWindow).toBe('mornings');
    expect(arg.budget).toBe('$10');
    expect(arg.urgency).toBe('high');
    // 24 hours in ms.
    expect(arg.expiresIn).toBe(24 * 60 * 60 * 1000);
    expect(arg.attachmentIds).toEqual([]);
  });

  it('omits empty optional fields (timeWindow/budget → undefined)', async () => {
    const { component, mutualHelpService } = makeForm();
    const c = component as any;
    c.form.category = 'c';
    c.form.title = 'T';
    c.form.description = 'D';
    c.form.timeWindow = '   ';
    c.form.budget = '';
    await c.submit();
    const arg = mutualHelpService.createDraft.mock.calls[0][0];
    expect(arg.timeWindow).toBeUndefined();
    expect(arg.budget).toBeUndefined();
  });

  it('chains publish after createDraft when action is "publish"', async () => {
    const { component, mutualHelpService } = makeForm();
    const c = component as any;
    c.form.category = 'c';
    c.form.title = 'T';
    c.form.description = 'D';
    c.form.action = 'publish';
    await c.submit();
    expect(mutualHelpService.createDraft).toHaveBeenCalledTimes(1);
    expect(mutualHelpService.publish).toHaveBeenCalledWith('post-new');
    // create-then-publish order.
    const createOrder = mutualHelpService.createDraft.mock.invocationCallOrder[0];
    const publishOrder = mutualHelpService.publish.mock.invocationCallOrder[0];
    expect(publishOrder).toBeGreaterThan(createOrder);
  });

  it('does NOT call publish when action stays "draft"', async () => {
    const { component, mutualHelpService } = makeForm();
    const c = component as any;
    c.form.category = 'c';
    c.form.title = 'T';
    c.form.description = 'D';
    c.form.action = 'draft';
    await c.submit();
    expect(mutualHelpService.publish).not.toHaveBeenCalled();
  });

  it('emits `saved` after a successful create', async () => {
    const { component } = makeForm();
    const c = component as any;
    let fired = 0;
    component.saved.subscribe(() => fired++);
    c.form.category = 'c';
    c.form.title = 'T';
    c.form.description = 'D';
    await c.submit();
    expect(fired).toBe(1);
  });

  it('uploads attached files before creating the draft', async () => {
    const { component, mutualHelpService, attachment } = makeForm();
    const c = component as any;
    c.attachmentFiles.set([
      new File(['a'], 'a.txt'),
      new File(['b'], 'b.txt'),
    ]);
    c.form.category = 'c';
    c.form.title = 'T';
    c.form.description = 'D';
    await c.submit();
    expect(attachment.upload).toHaveBeenCalledTimes(2);
    const arg = mutualHelpService.createDraft.mock.calls[0][0];
    expect(arg.attachmentIds).toEqual(['att-a.txt', 'att-b.txt']);
  });
});

describe('MutualHelpFormComponent — edit flow (F-B02)', () => {
  it('ngOnInit preloads the form from an existing post', () => {
    const post = makePost({
      type: 'offer',
      category: 'babysitting',
      title: 'Edit me',
      description: 'edit desc',
      tags: ['tagA', 'tagB'],
      timeWindow: 'eves',
      budget: '$5',
      urgency: 'high',
      expiresAt: NOW + 2 * 3600_000, // 2h from now
      version: 7,
    });
    const { component } = makeForm({ post });
    component.ngOnInit();
    const c = component as any;
    expect(c.form.type).toBe('offer');
    expect(c.form.category).toBe('babysitting');
    expect(c.form.title).toBe('Edit me');
    expect(c.form.description).toBe('edit desc');
    expect(c.form.tagsInput).toBe('tagA, tagB');
    expect(c.form.timeWindow).toBe('eves');
    expect(c.form.budget).toBe('$5');
    expect(c.form.urgency).toBe('high');
    expect(c.form.expiresIn).toBe(2);
  });

  it('expiresIn is clamped to at least 1 hour for nearly-expired posts', () => {
    const post = makePost({ expiresAt: NOW + 60_000 }); // 1 minute left
    const { component } = makeForm({ post });
    component.ngOnInit();
    expect((component as any).form.expiresIn).toBeGreaterThanOrEqual(1);
  });

  it('edit path calls mutualHelpService.edit with version + merged attachments', async () => {
    const post = makePost({ id: 'edit-1', attachmentIds: ['old-1'], version: 3 });
    const { component, mutualHelpService, attachment } = makeForm({ post });
    component.ngOnInit();
    const c = component as any;
    c.attachmentFiles.set([new File(['new'], 'new.txt')]);
    c.form.title = 'renamed';

    await c.submit();
    expect(mutualHelpService.edit).toHaveBeenCalledTimes(1);
    const [id, patch, version] = mutualHelpService.edit.mock.calls[0];
    expect(id).toBe('edit-1');
    expect(version).toBe(3);
    expect(patch.title).toBe('renamed');
    expect(patch.attachmentIds).toEqual(['old-1', 'att-new.txt']);
    expect(attachment.upload).toHaveBeenCalledOnce();
  });

  it('shows a success toast on edit success', async () => {
    const post = makePost({ id: 'e2' });
    const { component, toast } = makeForm({ post });
    component.ngOnInit();
    await (component as any).submit();
    expect(toast.show).toHaveBeenCalledWith('Post updated.', 'success');
  });

  it('surfaces errorMsg when edit fails', async () => {
    const post = makePost({ id: 'e3' });
    const { component } = makeForm({ post, editOk: false });
    component.ngOnInit();
    await (component as any).submit();
    expect((component as any).errorMsg()).toBe('Failed to save post. Please try again.');
    expect((component as any).submitting()).toBe(false);
  });
});

describe('MutualHelpFormComponent — attachments', () => {
  function fileEvent(files: File[]): Event {
    const input = { files, value: 'keep' } as unknown as HTMLInputElement;
    return { target: input } as unknown as Event;
  }

  it('onFilesSelected accepts files under the size cap', () => {
    const { component } = makeForm();
    const c = component as any;
    const f = new File([new Uint8Array(100)], 'a.txt');
    c.onFilesSelected(fileEvent([f]));
    expect(c.attachmentFiles().length).toBe(1);
    expect(c.errorMsg()).toBe('');
  });

  it('onFilesSelected rejects files over MAX_ATTACHMENT_BYTES with a size error', () => {
    const { component } = makeForm();
    const c = component as any;
    const tooBig = { name: 'huge.bin', size: MAX_ATTACHMENT_BYTES + 1, type: '' } as unknown as File;
    c.onFilesSelected(fileEvent([tooBig]));
    expect(c.attachmentFiles().length).toBe(0);
    expect(c.errorMsg()).toMatch(/Files exceed 20 MB limit/);
  });

  it('onFilesSelected mixes valid + invalid and errors for only the big ones', () => {
    const { component } = makeForm();
    const c = component as any;
    const ok = new File([new Uint8Array(1)], 'ok.txt');
    const tooBig = { name: 'huge.bin', size: MAX_ATTACHMENT_BYTES + 1, type: '' } as unknown as File;
    c.onFilesSelected(fileEvent([ok, tooBig]));
    expect(c.attachmentFiles().map((f: File) => f.name)).toEqual(['ok.txt']);
    expect(c.errorMsg()).toContain('huge.bin');
  });

  it('removeFile drops exactly one file by index', () => {
    const { component } = makeForm();
    const c = component as any;
    c.attachmentFiles.set([
      new File(['1'], 'a.txt'),
      new File(['2'], 'b.txt'),
      new File(['3'], 'c.txt'),
    ]);
    c.removeFile(1);
    expect(c.attachmentFiles().map((f: File) => f.name)).toEqual(['a.txt', 'c.txt']);
  });
});

describe('MutualHelpFormComponent — overlay + emitters', () => {
  it('onOverlayClick emits `cancelled` when the overlay itself is clicked', () => {
    const { component } = makeForm();
    const c = component as any;
    const target = document.createElement('div');
    target.classList.add('modal-overlay');
    let fired = 0;
    component.cancelled.subscribe(() => fired++);
    c.onOverlayClick({ target } as MouseEvent);
    expect(fired).toBe(1);
  });

  it('onOverlayClick does NOT emit when the click is inside the modal card', () => {
    const { component } = makeForm();
    const c = component as any;
    const target = document.createElement('div');
    target.classList.add('modal-card');
    let fired = 0;
    component.cancelled.subscribe(() => fired++);
    c.onOverlayClick({ target } as MouseEvent);
    expect(fired).toBe(0);
  });
});

describe('MutualHelpFormComponent — submit error path', () => {
  it('sets errorMsg when createDraft rejects and clears submitting', async () => {
    const { component } = makeForm({ createOk: false });
    const c = component as any;
    c.form.category = 'c';
    c.form.title = 'T';
    c.form.description = 'D';
    await c.submit();
    expect(c.errorMsg()).toBe('Failed to save post. Please try again.');
    expect(c.submitting()).toBe(false);
  });
});
