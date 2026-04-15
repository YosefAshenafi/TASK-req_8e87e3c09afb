/**
 * AttachmentService unit tests.
 * Tests upload, getMeta, getBlob, and delete with real IndexedDB (fake-indexeddb).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DbService } from '../src/app/core/db.service';
import { AttachmentService, MAX_ATTACHMENT_BYTES } from '../src/app/core/attachment.service';

const WS = 'ws-attach';

function makeService() {
  const db = new DbService();
  return new AttachmentService(db);
}

function makeFile(name: string, content: string, type = 'text/plain'): File {
  return new File([content], name, { type });
}

describe('AttachmentService', () => {
  let svc: AttachmentService;

  beforeEach(() => {
    svc = makeService();
  });

  // ── upload ────────────────────────────────────────────────────────────────

  it('upload() returns an id string', async () => {
    const id = await svc.upload(makeFile('test.txt', 'hello'), WS);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('upload() stores the attachment and getMeta() retrieves metadata', async () => {
    const file = makeFile('doc.txt', 'content here', 'text/plain');
    const id = await svc.upload(file, WS);

    const meta = await svc.getMeta(id);
    expect(meta).toBeDefined();
    expect(meta!.id).toBe(id);
    expect(meta!.workspaceId).toBe(WS);
    expect(meta!.filename).toBe('doc.txt');
    expect(meta!.mimeType).toBe('text/plain');
    expect(meta!.sizeBytes).toBe(file.size);
    expect(typeof meta!.uploadedAt).toBe('number');
  });

  it('upload() uses "application/octet-stream" when MIME type is empty', async () => {
    const file = new File(['data'], 'noext', { type: '' });
    const id = await svc.upload(file, WS);
    const meta = await svc.getMeta(id);
    expect(meta!.mimeType).toBe('application/octet-stream');
  });

  it('upload() throws when file exceeds MAX_ATTACHMENT_BYTES (20 MB)', async () => {
    // Create a fake large file using size property manipulation
    const oversized = Object.defineProperty(
      new File(['x'], 'big.bin', { type: 'application/octet-stream' }),
      'size',
      { value: MAX_ATTACHMENT_BYTES + 1 },
    );
    await expect(svc.upload(oversized, WS)).rejects.toThrow(/≤ 20 MB/);
  });

  it('upload() allows a file exactly at MAX_ATTACHMENT_BYTES', async () => {
    const atLimit = Object.defineProperty(
      new File(['x'], 'limit.bin'),
      'size',
      { value: MAX_ATTACHMENT_BYTES },
    );
    await expect(svc.upload(atLimit, WS)).resolves.toBeDefined();
  });

  it('upload() scopes to workspace — each has its own id', async () => {
    const id1 = await svc.upload(makeFile('a.txt', 'a'), 'ws-one');
    const id2 = await svc.upload(makeFile('b.txt', 'b'), 'ws-two');
    expect(id1).not.toBe(id2);
  });

  // ── getMeta ───────────────────────────────────────────────────────────────

  it('getMeta() returns undefined for unknown id', async () => {
    const meta = await svc.getMeta('non-existent-id');
    expect(meta).toBeUndefined();
  });

  it('getMeta() does not include the blob field', async () => {
    const id = await svc.upload(makeFile('f.txt', 'data'), WS);
    const meta = await svc.getMeta(id);
    expect(meta).not.toHaveProperty('blob');
  });

  // ── getBlob ───────────────────────────────────────────────────────────────

  it('getBlob() retrieves the stored file blob', async () => {
    const file = makeFile('img.png', 'fake-image-data', 'image/png');
    const id = await svc.upload(file, WS);
    const blob = await svc.getBlob(id);
    expect(blob).toBeDefined();
    expect(blob!.size).toBe(file.size);
  });

  it('getBlob() returns undefined for unknown id', async () => {
    const blob = await svc.getBlob('missing-id');
    expect(blob).toBeUndefined();
  });

  // ── delete ────────────────────────────────────────────────────────────────

  it('delete() removes the attachment', async () => {
    const id = await svc.upload(makeFile('del.txt', 'bye'), WS);
    await svc.delete(id);
    expect(await svc.getMeta(id)).toBeUndefined();
    expect(await svc.getBlob(id)).toBeUndefined();
  });

  it('delete() with unknown id does not throw', async () => {
    await expect(svc.delete('ghost-id')).resolves.toBeUndefined();
  });
});
