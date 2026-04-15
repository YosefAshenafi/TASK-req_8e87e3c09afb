import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeContext, createAndSignIn } from './helpers';
import { NoteImportService } from '../src/app/import-export/note-import.service';

const WS = 'workspace-import';

function makeFile(content: string, name: string): File {
  return new File([content], name, { type: name.endsWith('.json') ? 'application/json' : 'text/csv' });
}

describe('NoteImportService', () => {
  let ctx: ReturnType<typeof makeContext>;
  let importer: NoteImportService;

  beforeEach(async () => {
    ctx = makeContext();
    importer = new NoteImportService(ctx.db, ctx.chat);
    await ctx.chat.loadForWorkspace(WS);
    await createAndSignIn(ctx.auth);
  });

  // ── parseFile (CSV) ────────────────────────────────────────────────────────

  describe('parseFile() — CSV', () => {
    it('parses a simple CSV file', async () => {
      const csv = 'note,color\nHello World,#fff9c4\nSecond note,#e8f5e9';
      const rows = await importer.parseFile(makeFile(csv, 'test.csv'));
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveProperty('note', 'Hello World');
    });

    it('skips empty lines', async () => {
      const csv = 'note\nFirst\n\nSecond\n';
      const rows = await importer.parseFile(makeFile(csv, 'test.csv'));
      expect(rows).toHaveLength(2);
    });

    it('throws Validation when CSV exceeds 1000 rows', async () => {
      const header = 'note';
      const dataRows = Array.from({ length: 1001 }, (_, i) => `Note ${i}`).join('\n');
      const csv = `${header}\n${dataRows}`;
      await expect(importer.parseFile(makeFile(csv, 'big.csv'))).rejects.toSatisfy(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => e.error?.code === 'Validation',
      );
    });
  });

  // ── parseFile (JSON) ──────────────────────────────────────────────────────

  describe('parseFile() — JSON', () => {
    it('parses a JSON array of objects', async () => {
      const json = JSON.stringify([{ note: 'Hello' }, { note: 'World' }]);
      const rows = await importer.parseFile(makeFile(json, 'test.json'));
      expect(rows).toHaveLength(2);
    });

    it('throws Validation when JSON is not an array', async () => {
      const json = JSON.stringify({ note: 'object, not array' });
      await expect(importer.parseFile(makeFile(json, 'test.json'))).rejects.toSatisfy(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => e.error?.code === 'Validation',
      );
    });

    it('throws Validation when JSON array exceeds 1000 items', async () => {
      const json = JSON.stringify(Array.from({ length: 1001 }, (_, i) => ({ note: `${i}` })));
      await expect(importer.parseFile(makeFile(json, 'big.json'))).rejects.toSatisfy(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => e.error?.code === 'Validation',
      );
    });
  });

  // ── validate ──────────────────────────────────────────────────────────────

  describe('validate()', () => {
    const mapping = { text: 'note', color: 'color', author: 'author' };

    it('validates valid rows without errors', () => {
      const rows = [{ note: 'Valid note', color: '#fff9c4', author: '' }];
      const { valid, errors } = importer.validate(rows, { text: 'note' }, []);
      expect(valid).toHaveLength(1);
      expect(errors).toHaveLength(0);
    });

    it('errors on missing text', () => {
      const rows = [{ note: '', color: '#fff9c4' }];
      const { valid, errors } = importer.validate(rows, mapping, []);
      expect(valid).toHaveLength(0);
      expect(errors[0].reasons).toContain('text-missing');
    });

    it('errors when text exceeds 80 characters', () => {
      const rows = [{ note: 'X'.repeat(81) }];
      const { valid, errors } = importer.validate(rows, mapping, []);
      expect(errors[0].reasons).toContain('text-too-long');
    });

    it('errors on invalid color format', () => {
      const rows = [{ note: 'Valid', color: 'not-a-color' }];
      const { valid, errors } = importer.validate(rows, mapping, []);
      expect(errors[0].reasons).toContain('invalid-color');
    });

    it('accepts valid hex colors (#rrggbb and #rgb)', () => {
      const rows3 = [{ note: 'Valid', color: '#abc' }];
      const { valid: v3 } = importer.validate(rows3, mapping, []);
      expect(v3).toHaveLength(1);

      const rows6 = [{ note: 'Valid', color: '#aabbcc' }];
      const { valid: v6 } = importer.validate(rows6, mapping, []);
      expect(v6).toHaveLength(1);
    });

    it('errors when author is not in knownAuthors', () => {
      const rows = [{ note: 'Valid', author: 'unknownPerson' }];
      const { errors } = importer.validate(rows, mapping, ['alice', 'bob']);
      expect(errors[0].reasons).toContain('unknown-author');
    });

    it('accepts author when in knownAuthors', () => {
      const rows = [{ note: 'Valid', author: 'alice' }];
      const { valid, errors } = importer.validate(rows, mapping, ['alice']);
      expect(valid).toHaveLength(1);
      expect(errors).toHaveLength(0);
    });

    it('parses comma-separated tags from the tag column', () => {
      const rows = [{ note: 'Valid', tags: 'a, b, c' }];
      const { valid } = importer.validate(rows, { text: 'note', tags: 'tags' }, []);
      expect(valid[0].tags).toEqual(['a', 'b', 'c']);
    });

    it('includes rowIndex and rawValues in error objects', () => {
      const rows = [{ note: '' }, { note: 'Valid' }];
      const { errors } = importer.validate(rows, { text: 'note' }, []);
      expect(errors[0].rowIndex).toBe(0);
      expect(errors[0].rawValues).toEqual({ note: '' });
    });

    it('handles multiple validation errors per row', () => {
      const rows = [{ note: '', color: 'bad-color' }];
      const { errors } = importer.validate(rows, mapping, []);
      expect(errors[0].reasons.length).toBeGreaterThan(1);
    });
  });

  // ── commit ────────────────────────────────────────────────────────────────

  describe('commit()', () => {
    it('commits valid import rows as canvas objects', async () => {
      const rows = [
        { text: 'First note', color: '#fff9c4', tags: ['a'] },
        { text: 'Second note' },
      ];
      const result = await importer.commit(WS, rows);
      expect(result.committed).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('writes sticky notes to canvas_objects store', async () => {
      await importer.commit(WS, [{ text: 'Test', color: '#fff9c4' }]);
      const idb = await ctx.db.open();
      const objects = await idb.getAllFromIndex('canvas_objects', 'by_workspace', WS);
      expect(objects.length).toBeGreaterThanOrEqual(1);
      expect(objects[0].type).toBe('sticky-note');
      expect(objects[0].text).toBe('Test');
    });

    it('posts a system chat message with the count', async () => {
      await importer.commit(WS, [
        { text: 'Note 1' },
        { text: 'Note 2' },
      ]);
      const msgs = await firstValueFrom(ctx.chat.messages$);
      const sysMsg = msgs.find(m => m.type === 'system' && m.body.includes('2'));
      expect(sysMsg).toBeDefined();
    });

    it('returns committed=0 for empty rows', async () => {
      const result = await importer.commit(WS, []);
      expect(result.committed).toBe(0);
    });

    it('lays out objects in a grid (x,y based on index)', async () => {
      const rows = Array.from({ length: 11 }, (_, i) => ({ text: `Note ${i}` }));
      await importer.commit(WS, rows);
      const idb = await ctx.db.open();
      const objects = await idb.getAllFromIndex('canvas_objects', 'by_workspace', WS);
      // getAllFromIndex returns rows in primary-key (UUID) order, not insertion order —
      // look up the specific notes by text rather than assuming `objects[0]` is Note 0.
      const firstObj = objects.find(o => o.text === 'Note 0');
      const eleventhObj = objects.find(o => o.text === 'Note 10');
      // The 11th object (index 10) should be on the second row (Math.floor(10/10)=1)
      expect(eleventhObj?.y).toBeGreaterThan(firstObj!.y);
    });
  });
});
