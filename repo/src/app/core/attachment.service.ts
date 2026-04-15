import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from './db.service';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB

export interface AttachmentMeta {
  id: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: number;
}

@Injectable({ providedIn: 'root' })
export class AttachmentService {
  constructor(private readonly db: DbService) {}

  /**
   * Upload a File to IndexedDB.
   * Throws an Error if the file exceeds MAX_ATTACHMENT_BYTES (20 MB).
   * Returns the stored attachment id.
   */
  async upload(file: File, workspaceId: string): Promise<string> {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `File "${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — attachments must be ≤ 20 MB.`,
      );
    }

    const id = uuidv4();
    const idb = await this.db.open();
    // Store bytes as Uint8Array — fake-indexeddb/jsdom often drops Blob on structured clone read.
    const body = new Uint8Array(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';
    await idb.put('attachments', {
      id,
      workspaceId,
      filename: file.name,
      mimeType,
      sizeBytes: file.size,
      blob: body as unknown as Blob,
      uploadedAt: Date.now(),
    });
    return id;
  }

  async getMeta(id: string): Promise<AttachmentMeta | undefined> {
    const idb = await this.db.open();
    const rec = await idb.get('attachments', id);
    if (!rec) return undefined;
    const { blob: _blob, ...meta } = rec;
    return meta as AttachmentMeta;
  }

  async getBlob(id: string): Promise<Blob | undefined> {
    const idb = await this.db.open();
    const rec = await idb.get('attachments', id);
    if (!rec) return undefined;
    const raw = rec.blob as unknown;
    if (raw instanceof Blob) return raw;
    if (raw instanceof Uint8Array) {
      // Normalize to a plain Uint8Array backed by ArrayBuffer for strict TS BlobPart typing.
      const bytes = Uint8Array.from(raw);
      return new Blob([bytes], { type: rec.mimeType || 'application/octet-stream' });
    }
    return undefined;
  }

  async delete(id: string): Promise<void> {
    const idb = await this.db.open();
    await idb.delete('attachments', id);
  }
}
