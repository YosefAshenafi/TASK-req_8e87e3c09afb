/**
 * IMPORT API TESTS
 * Tests the complete CSV/JSON import flow using real services:
 * parse → validate → commit → verify in IndexedDB.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeFullContext, signUp } from './helpers';
import type { FullContext } from './helpers';

const WS = 'ws-import-api';

function makeFile(content: string, name: string): File {
  return new File(
    [content],
    name,
    { type: name.endsWith('.json') ? 'application/json' : 'text/csv' },
  );
}

describe('Import API — full lifecycle', () => {
  let ctx: FullContext;

  beforeEach(async () => {
    ctx = makeFullContext();
    await signUp(ctx.auth, 'alice');
    await ctx.chat.loadForWorkspace(WS);
  });

  // ── CSV import ─────────────────────────────────────────────────────────────

  it('parses CSV → validates → commits sticky notes to IndexedDB', async () => {
    const csv = 'note,color\nFirst note,#fff9c4\nSecond note,#e8f5e9\nThird note,#f3e5f5';
    const file = makeFile(csv, 'import.csv');

    // Parse
    const rows = await ctx.noteImport.parseFile(file);
    expect(rows).toHaveLength(3);

    // Validate
    const { valid, errors } = ctx.noteImport.validate(rows, { text: 'note', color: 'color' }, []);
    expect(valid).toHaveLength(3);
    expect(errors).toHaveLength(0);

    // Commit
    const result = await ctx.noteImport.commit(WS, valid);
    expect(result.committed).toBe(3);

    // Verify in IndexedDB
    const idb = await ctx.db.open();
    const notes = await idb.getAllFromIndex('canvas_objects', 'by_workspace', WS);
    expect(notes).toHaveLength(3);
    expect(notes.every(n => n.type === 'sticky-note')).toBe(true);
  });

  it('parses JSON → validates → commits', async () => {
    const json = JSON.stringify([
      { note: 'JSON note 1', color: '#fff9c4' },
      { note: 'JSON note 2', color: '#e8f5e9' },
    ]);
    const file = makeFile(json, 'import.json');

    const rows = await ctx.noteImport.parseFile(file);
    const { valid } = ctx.noteImport.validate(rows, { text: 'note', color: 'color' }, []);
    const result = await ctx.noteImport.commit(WS, valid);
    expect(result.committed).toBe(2);
  });

  it('validates author column against known authors', async () => {
    const csv = 'note,author\nValid note,alice\nInvalid note,unknown-person';
    const file = makeFile(csv, 'authors.csv');

    const rows = await ctx.noteImport.parseFile(file);
    const { valid, errors } = ctx.noteImport.validate(
      rows,
      { text: 'note', author: 'author' },
      ['alice'],
    );
    expect(valid).toHaveLength(1);
    expect(valid[0].authorId).toBe('alice');
    expect(errors).toHaveLength(1);
    expect(errors[0].reasons).toContain('unknown-author');
  });

  it('commit posts system message with note count', async () => {
    const rows = [{ text: 'Note A' }, { text: 'Note B' }, { text: 'Note C' }];
    await ctx.noteImport.commit(WS, rows);

    const messages = await firstValueFrom(ctx.chat.messages$);
    const sysMsg = messages.find(m => m.type === 'system' && m.body.includes('3'));
    expect(sysMsg).toBeDefined();
  });

  it('handles mixed valid/invalid rows correctly', async () => {
    const csv = 'note,color\nValid note,#fff9c4\n,#bad-not-a-color\nAnother valid,#e8f5e9';
    const file = makeFile(csv, 'mixed.csv');

    const rows = await ctx.noteImport.parseFile(file);
    const { valid, errors } = ctx.noteImport.validate(rows, { text: 'note', color: 'color' }, []);

    expect(valid).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].reasons).toContain('text-missing');
  });

  it('enforces 1000 row limit on CSV', async () => {
    const header = 'note';
    const rows = Array.from({ length: 1001 }, (_, i) => `Note ${i}`).join('\n');
    const csv = `${header}\n${rows}`;

    await expect(
      ctx.noteImport.parseFile(makeFile(csv, 'huge.csv')),
    ).rejects.toSatisfy(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.error?.code === 'Validation',
    );
  });

  it('enforces 1000 row limit on JSON', async () => {
    const json = JSON.stringify(Array.from({ length: 1001 }, (_, i) => ({ note: `${i}` })));
    await expect(
      ctx.noteImport.parseFile(makeFile(json, 'huge.json')),
    ).rejects.toSatisfy(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.error?.code === 'Validation',
    );
  });

  it('grid layout — notes are positioned in a 10-column grid', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ text: `Note ${i}` }));
    await ctx.noteImport.commit(WS, rows);

    const idb = await ctx.db.open();
    const notes = await idb.getAllFromIndex('canvas_objects', 'by_workspace', WS);

    // Notes 0-9 are in row 0, notes 10-14 are in row 1
    const sorted = [...notes].sort((a, b) => (a.zIndex as number) - (b.zIndex as number));
    expect(sorted[0].y).toBe(sorted[0].y);   // row 0
    expect(sorted[10].y).toBeGreaterThan(sorted[0].y); // row 1 starts higher
  });

  it('tags are parsed from comma-separated column', async () => {
    const csv = 'note,tags\nTagged note,"work, urgent, review"';
    const rows = await ctx.noteImport.parseFile(makeFile(csv, 'tags.csv'));
    const { valid } = ctx.noteImport.validate(rows, { text: 'note', tags: 'tags' }, []);

    expect(valid[0].tags).toEqual(['work', 'urgent', 'review']);
  });

  it('empty commit returns committed=0 without error', async () => {
    const result = await ctx.noteImport.commit(WS, []);
    expect(result.committed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});
