/**
 * NoteImportWizardComponent — deep behavioural unit tests.
 *
 * Covers the wizard's full state machine:
 *   • pick step:
 *       - parse error is surfaced in parseError()
 *       - empty file is rejected with "File has no rows."
 *       - auto-detection picks a "text"-like column when none is restored
 *       - saved mapping from PrefsService is restored on ngOnInit
 *   • map step:
 *       - validate() splits valid rows from errors and persists the mapping
 *       - validate() is a no-op if mapText is blank
 *   • review step:
 *       - commit() calls the importer with the right payload, emits `imported`,
 *         toasts success, moves to 'done'
 *       - commit() refuses when validRows is empty or it's already running
 *       - commit() surfaces error toast on importer failure
 *   • cancel() emits `closed`
 *   • rawPreview() truncates long text and falls back to raw field concat
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { NoteImportWizardComponent } from '../src/app/import-export/note-import-wizard.component';
import { NoteImportService } from '../src/app/import-export/note-import.service';
import { ToastService } from '../src/app/core/toast.service';
import { PrefsService } from '../src/app/core/prefs.service';
import { AuthService } from '../src/app/auth/auth.service';
import type { ColumnMapping, ImportRow, ImportRowError } from '../src/app/core/types';

function makeWizard(opts: {
  workspaceId?: string;
  parseFile?: ReturnType<typeof vi.fn>;
  validate?: ReturnType<typeof vi.fn>;
  commit?: ReturnType<typeof vi.fn>;
  prefsGet?: unknown;
  currentUsername?: string | null;
} = {}) {
  const importer = {
    parseFile: opts.parseFile ?? vi.fn().mockResolvedValue([]),
    validate: opts.validate ?? vi.fn().mockReturnValue({ valid: [], errors: [] }),
    commit: opts.commit ?? vi.fn().mockResolvedValue({ committed: 0, errors: [] }),
  };
  const toast = { show: vi.fn() };
  const prefs = {
    get: vi.fn().mockReturnValue(opts.prefsGet),
    set: vi.fn(),
  };
  const auth = {
    currentProfile: opts.currentUsername
      ? { username: opts.currentUsername, id: 'p-me', role: 'Teacher' }
      : null,
  };
  const injector = Injector.create({
    providers: [
      { provide: NoteImportService, useValue: importer },
      { provide: ToastService, useValue: toast },
      { provide: PrefsService, useValue: prefs },
      { provide: AuthService, useValue: auth },
    ],
  });
  let component!: NoteImportWizardComponent;
  runInInjectionContext(injector, () => {
    component = new NoteImportWizardComponent();
  });
  component.workspaceId = opts.workspaceId ?? 'ws-1';
  return { component: component as NoteImportWizardComponent & Record<string, any>, importer, toast, prefs, auth };
}

function fakeFile(name = 'notes.csv') {
  return new File(['x,y'], name, { type: 'text/csv' });
}

function fileEvent(file: File | undefined): Event {
  return { target: { files: file ? [file] : null } } as unknown as Event;
}

describe('NoteImportWizardComponent — ngOnInit restores saved mapping', () => {
  it('restores per-workspace mapping when one exists', () => {
    const saved: Record<string, ColumnMapping> = {
      'ws-1': { text: 'body', color: 'col', tags: 'labels', author: 'writer' },
    };
    const { component } = makeWizard({ prefsGet: saved });
    component.ngOnInit();
    const c = component as any;
    expect(c.mapText).toBe('body');
    expect(c.mapColor).toBe('col');
    expect(c.mapTags).toBe('labels');
    expect(c.mapAuthor).toBe('writer');
  });

  it('leaves mapping unset when Prefs has no entry for this workspace', () => {
    const { component } = makeWizard({ prefsGet: undefined });
    component.ngOnInit();
    const c = component as any;
    expect(c.mapText).toBe('');
  });
});

describe('NoteImportWizardComponent — pick step', () => {
  it('sets parseError when the file has zero rows and stays on "pick"', async () => {
    const parseFile = vi.fn().mockResolvedValue([]);
    const { component } = makeWizard({ parseFile });
    await (component as any).onFileSelected(fileEvent(fakeFile()));
    expect((component as any).parseError()).toBe('File has no rows.');
    expect((component as any).step()).toBe('pick');
  });

  it('sets parseError from thrown Error.message', async () => {
    const parseFile = vi.fn().mockRejectedValue(new Error('bad json'));
    const { component } = makeWizard({ parseFile });
    await (component as any).onFileSelected(fileEvent(fakeFile()));
    expect((component as any).parseError()).toBe('bad json');
    expect((component as any).step()).toBe('pick');
  });

  it('falls back to a generic message when the thrown value is not an Error', async () => {
    const parseFile = vi.fn().mockRejectedValue('oops');
    const { component } = makeWizard({ parseFile });
    await (component as any).onFileSelected(fileEvent(fakeFile()));
    expect((component as any).parseError()).toBe('Could not parse file');
  });

  it('no-ops when the event has no selected file', async () => {
    const parseFile = vi.fn();
    const { component } = makeWizard({ parseFile });
    await (component as any).onFileSelected(fileEvent(undefined));
    expect(parseFile).not.toHaveBeenCalled();
  });

  it('advances to "map" and auto-detects the "text"-like column', async () => {
    const parseFile = vi.fn().mockResolvedValue([
      { body: 'hello', author: 'alice' },
    ]);
    const { component } = makeWizard({ parseFile });
    await (component as any).onFileSelected(fileEvent(fakeFile()));
    expect((component as any).step()).toBe('map');
    expect((component as any).mapText).toBe('body');
    expect((component as any).columns()).toEqual(['body', 'author']);
  });

  it('does not overwrite a restored mapping when auto-detecting', async () => {
    const saved: Record<string, ColumnMapping> = {
      'ws-1': { text: 'content' },
    };
    const parseFile = vi.fn().mockResolvedValue([{ body: 'hi' }]);
    const { component } = makeWizard({ prefsGet: saved, parseFile });
    component.ngOnInit();
    await (component as any).onFileSelected(fileEvent(fakeFile()));
    expect((component as any).mapText).toBe('content');
  });
});

describe('NoteImportWizardComponent — validate()', () => {
  it('passes mapping + knownAuthors to importer and advances to "review"', () => {
    const validRows: ImportRow[] = [{ text: 'a' }];
    const errors: ImportRowError[] = [];
    const validate = vi.fn().mockReturnValue({ valid: validRows, errors });
    const { component, importer, prefs } = makeWizard({
      validate,
      currentUsername: 'alice',
    });
    const c = component as any;
    c.rawRows.set([{ body: 'hi' }]);
    c.mapText = 'body';
    c.mapColor = 'color';
    c.validate();
    expect(importer.validate).toHaveBeenCalledWith(
      [{ body: 'hi' }],
      { text: 'body', color: 'color', tags: undefined, author: undefined },
      ['alice'],
    );
    expect(c.step()).toBe('review');
    expect(c.validRows()).toBe(validRows);
    expect(c.errors()).toBe(errors);
    expect(prefs.set).toHaveBeenCalledWith(
      'lastImportMapping',
      { 'ws-1': { text: 'body', color: 'color', tags: undefined, author: undefined } },
    );
  });

  it('no-ops when mapText is blank', () => {
    const validate = vi.fn();
    const { component, importer } = makeWizard({ validate });
    const c = component as any;
    c.mapText = '';
    c.validate();
    expect(importer.validate).not.toHaveBeenCalled();
    expect(c.step()).toBe('pick');
  });

  it('passes [] as knownAuthors when no user is signed in', () => {
    const validate = vi.fn().mockReturnValue({ valid: [], errors: [] });
    const { component, importer } = makeWizard({ validate, currentUsername: null });
    const c = component as any;
    c.rawRows.set([{ body: 'hi' }]);
    c.mapText = 'body';
    c.validate();
    expect(importer.validate).toHaveBeenCalledWith(
      [{ body: 'hi' }],
      expect.any(Object),
      [],
    );
  });
});

describe('NoteImportWizardComponent — commit()', () => {
  it('happy path: imports valid rows, emits `imported`, toasts, moves to done', async () => {
    const commit = vi.fn().mockResolvedValue({ committed: 3, errors: [] });
    const { component, toast } = makeWizard({ commit });
    const c = component as any;
    c.validRows.set([{ text: 'a' }, { text: 'b' }, { text: 'c' }] as ImportRow[]);

    let imported = 0;
    component.imported.subscribe(n => { imported = n; });

    await c.commit();

    expect(commit).toHaveBeenCalledWith('ws-1', c.validRows());
    expect(imported).toBe(3);
    expect(toast.show).toHaveBeenCalledWith('Imported 3 notes', 'success');
    expect(c.step()).toBe('done');
    expect(c.committedCount()).toBe(3);
    expect(c.committing()).toBe(false);
  });

  it('no-ops when validRows is empty', async () => {
    const commit = vi.fn();
    const { component } = makeWizard({ commit });
    const c = component as any;
    c.validRows.set([]);
    await c.commit();
    expect(commit).not.toHaveBeenCalled();
  });

  it('guards against concurrent commit() calls while still running', async () => {
    let resolve!: (v: { committed: number; errors: [] }) => void;
    const commit = vi.fn().mockImplementation(
      () => new Promise(res => { resolve = res; }),
    );
    const { component } = makeWizard({ commit });
    const c = component as any;
    c.validRows.set([{ text: 'a' }] as ImportRow[]);
    const p1 = c.commit();
    const p2 = c.commit();
    await p2; // short-circuits immediately
    expect(commit).toHaveBeenCalledTimes(1);
    resolve({ committed: 1, errors: [] });
    await p1;
  });

  it('surfaces Error.message via toast on importer failure', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('bad row'));
    const { component, toast } = makeWizard({ commit });
    const c = component as any;
    c.validRows.set([{ text: 'a' }] as ImportRow[]);
    await c.commit();
    expect(toast.show).toHaveBeenCalledWith('bad row', 'error');
    expect(c.committing()).toBe(false);
    expect(c.step()).not.toBe('done');
  });

  it('singular "note" for committed === 1', async () => {
    const commit = vi.fn().mockResolvedValue({ committed: 1, errors: [] });
    const { component, toast } = makeWizard({ commit });
    const c = component as any;
    c.validRows.set([{ text: 'a' }] as ImportRow[]);
    await c.commit();
    expect(toast.show).toHaveBeenCalledWith('Imported 1 note', 'success');
  });
});

describe('NoteImportWizardComponent — cancel() and rawPreview', () => {
  it('cancel emits `closed`', () => {
    const { component } = makeWizard();
    let fired = 0;
    component.closed.subscribe(() => fired++);
    (component as any).cancel();
    expect(fired).toBe(1);
  });

  it('rawPreview returns trimmed text when the mapText column has content', () => {
    const { component } = makeWizard();
    const c = component as any;
    c.mapText = 'body';
    const err: ImportRowError = {
      rowIndex: 0,
      rawValues: { body: 'a'.repeat(60) },
      reasons: ['text-too-long'],
    };
    const preview = c.rawPreview(err);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(41);
  });

  it('rawPreview passes through short text unchanged', () => {
    const { component } = makeWizard();
    const c = component as any;
    c.mapText = 'body';
    const err: ImportRowError = {
      rowIndex: 0,
      rawValues: { body: 'short' },
      reasons: ['text-missing'],
    };
    expect(c.rawPreview(err)).toBe('short');
  });

  it('rawPreview falls back to concatenating other fields when text is missing', () => {
    const { component } = makeWizard();
    const c = component as any;
    c.mapText = 'body';
    const err: ImportRowError = {
      rowIndex: 0,
      rawValues: { body: '', author: 'alice', color: '#fff' },
      reasons: ['text-missing'],
    };
    // The first two values (empty body + 'alice') are joined with ' · '
    expect(c.rawPreview(err)).toBe(' · alice');
  });
});
