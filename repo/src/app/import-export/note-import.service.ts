import { Injectable } from '@angular/core';
import Papa from 'papaparse';
import { DbService } from '../core/db.service';
import { ChatService } from '../chat/chat.service';
import { AppException } from '../core/error';
import type { ColumnMapping, ImportRow, ImportRowError } from '../core/types';
import { v4 as uuidv4 } from 'uuid';

const MAX_ROWS = 1000;
const MAX_TEXT_CHARS = 80;

export interface ImportResult {
  committed: number;
  errors: ImportRowError[];
}

@Injectable({ providedIn: 'root' })
export class NoteImportService {
  constructor(
    private readonly db: DbService,
    private readonly chat: ChatService,
  ) {}

  /** Parse the file — returns raw rows. Throws if row count > 1000. */
  async parseFile(file: File): Promise<Record<string, string>[]> {
    const text = await file.text();

    if (file.name.endsWith('.json')) {
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) throw new AppException({ code: 'Validation', detail: 'JSON must be an array of objects' });
      if (parsed.length > MAX_ROWS) {
        throw new AppException({ code: 'Validation', detail: `File has ${parsed.length} rows; maximum is ${MAX_ROWS}`, field: 'rows' });
      }
      return parsed as Record<string, string>[];
    }

    // CSV
    const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    if (result.data.length > MAX_ROWS) {
      throw new AppException({ code: 'Validation', detail: `File has ${result.data.length} rows; maximum is ${MAX_ROWS}`, field: 'rows' });
    }
    return result.data;
  }

  /** Map raw rows to ImportRow using the column mapping; validate each row. */
  validate(
    rawRows: Record<string, string>[],
    mapping: ColumnMapping,
    knownAuthors: string[],
  ): { valid: ImportRow[]; errors: ImportRowError[] } {
    const valid: ImportRow[] = [];
    const errors: ImportRowError[] = [];

    rawRows.forEach((raw, i) => {
      const reasons: ImportRowError['reasons'] = [];
      const text = raw[mapping.text] ?? '';

      if (!text) reasons.push('text-missing');
      else if (text.length > MAX_TEXT_CHARS) reasons.push('text-too-long');

      const color = mapping.color ? raw[mapping.color] : undefined;
      if (color && !/^#[0-9a-fA-F]{3,6}$/.test(color)) reasons.push('invalid-color');

      const author = mapping.author ? raw[mapping.author] : undefined;
      if (author && !knownAuthors.includes(author)) reasons.push('unknown-author');

      if (reasons.length > 0) {
        errors.push({ rowIndex: i, rawValues: raw, reasons });
      } else {
        const tags = mapping.tags ? (raw[mapping.tags] ?? '').split(',').map(t => t.trim()).filter(Boolean) : [];
        valid.push({ text, color, tags, authorId: author });
      }
    });

    return { valid, errors };
  }

  /** Commit valid rows as canvas sticky notes in a single IDB transaction. */
  async commit(workspaceId: string, rows: ImportRow[]): Promise<ImportResult> {
    const idb = await this.db.open();
    const tx = idb.transaction('canvas_objects', 'readwrite');
    const store = tx.objectStore('canvas_objects');
    const now = Date.now();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      await store.put({
        id: uuidv4(),
        workspaceId,
        type: 'sticky-note',
        x: (i % 10) * 180 + 20,
        y: Math.floor(i / 10) * 140 + 20,
        width: 160,
        height: 120,
        text: row.text,
        color: row.color ?? '#fff9c4',
        strokeColor: '#f9a825',
        zIndex: i,
        version: 1,
        createdAt: now,
        updatedAt: now,
        lastEditedBy: '',
      });
    }
    await tx.done;

    await this.chat.postSystem(`Bulk import: ${rows.length} note${rows.length !== 1 ? 's' : ''} added to the canvas.`);
    return { committed: rows.length, errors: [] };
  }
}
