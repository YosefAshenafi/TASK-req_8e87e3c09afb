/**
 * AttachmentService — integration tests.
 * Exercises upload, getMeta, getBlob, and delete against real IndexedDB (fake-indexeddb).
 * No mocking of any kind.
 */
import { describe, it, expect } from 'vitest';
import { DbService } from '../src/app/core/db.service';
import { AttachmentService, MAX_ATTACHMENT_BYTES } from '../src/app/core/attachment.service';

function makeService() {
  const db = new DbService();
  const svc = new AttachmentService(db);
  return { svc, db };
}

/** Build a minimal File object with controlled content and size. */
function makeFile(name: string, content: string, mimeType = 'text/plain'): File {
  return new File([content], name, { type: mimeType });
}

/** Build a File that exceeds the 20 MB limit. */
function makeOversizedFile(): File {
  const bytes = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
  return new File([bytes], 'oversized.bin', { type: 'application/octet-stream' });
}

describe('AttachmentService', () => {
  // ── upload() ───────────────────────────────────────────────────────────────

  describe('upload()', () => {
    it('returns a non-empty UUID string', async () => {
      const { svc } = makeService();
      const id = await svc.upload(makeFile('test.txt', 'hello'), 'ws-1');
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('returns unique ids for distinct uploads', async () => {
      const { svc } = makeService();
      const id1 = await svc.upload(makeFile('a.txt', 'aaa'), 'ws-1');
      const id2 = await svc.upload(makeFile('b.txt', 'bbb'), 'ws-1');
      expect(id1).not.toBe(id2);
    });

    it('throws when file exceeds MAX_ATTACHMENT_BYTES (20 MB)', async () => {
      const { svc } = makeService();
      await expect(svc.upload(makeOversizedFile(), 'ws-1')).rejects.toThrow(/20 MB/);
    });

    it('does not throw for a file at exactly the size boundary', async () => {
      const { svc } = makeService();
      const exactBytes = new Uint8Array(MAX_ATTACHMENT_BYTES);
      const exactFile = new File([exactBytes], 'exact.bin', { type: 'application/octet-stream' });
      await expect(svc.upload(exactFile, 'ws-1')).resolves.toBeDefined();
    });

    it('accepts different MIME types', async () => {
      const { svc } = makeService();
      const id = await svc.upload(makeFile('image.png', 'PNG_DATA', 'image/png'), 'ws-2');
      expect(id).toBeTruthy();
    });
  });

  // ── getMeta() ─────────────────────────────────────────────────────────────

  describe('getMeta()', () => {
    it('returns metadata matching the uploaded file', async () => {
      const { svc } = makeService();
      const file = makeFile('doc.txt', 'document content');
      const id = await svc.upload(file, 'ws-42');

      const meta = await svc.getMeta(id);

      expect(meta).toBeDefined();
      expect(meta!.id).toBe(id);
      expect(meta!.filename).toBe('doc.txt');
      expect(meta!.workspaceId).toBe('ws-42');
      expect(meta!.mimeType).toBe('text/plain');
      expect(meta!.sizeBytes).toBe(file.size);
      expect(meta!.uploadedAt).toBeGreaterThan(0);
    });

    it('returns undefined for a non-existent id', async () => {
      const { svc } = makeService();
      const result = await svc.getMeta('does-not-exist');
      expect(result).toBeUndefined();
    });

    it('does NOT include the blob field in the returned metadata', async () => {
      const { svc } = makeService();
      const id = await svc.upload(makeFile('x.txt', 'content'), 'ws-1');
      const meta = await svc.getMeta(id);
      expect('blob' in (meta ?? {})).toBe(false);
    });

    it('stores the correct sizeBytes for the original file', async () => {
      const { svc } = makeService();
      const content = 'exactly this content';
      const file = makeFile('sized.txt', content);
      const id = await svc.upload(file, 'ws-1');

      const meta = await svc.getMeta(id);
      expect(meta!.sizeBytes).toBe(file.size);
    });
  });

  // ── getBlob() ─────────────────────────────────────────────────────────────

  describe('getBlob()', () => {
    it('returns a Blob for an uploaded file', async () => {
      const { svc } = makeService();
      const id = await svc.upload(makeFile('hello.txt', 'hello world'), 'ws-1');

      const blob = await svc.getBlob(id);

      expect(blob).toBeDefined();
      expect(blob).toBeInstanceOf(Blob);
    });

    it('returns a Blob with the correct MIME type', async () => {
      const { svc } = makeService();
      const id = await svc.upload(makeFile('img.png', 'PNG_BYTES', 'image/png'), 'ws-1');

      const blob = await svc.getBlob(id);

      expect(blob!.type).toBe('image/png');
    });

    it('returns a Blob with the correct byte content', async () => {
      const { svc } = makeService();
      const content = 'exact content to verify';
      const id = await svc.upload(makeFile('verify.txt', content), 'ws-1');

      const blob = await svc.getBlob(id);
      const text = await blob!.text();

      expect(text).toBe(content);
    });

    it('returns undefined for a non-existent id', async () => {
      const { svc } = makeService();
      const result = await svc.getBlob('no-such-attachment');
      expect(result).toBeUndefined();
    });
  });

  // ── delete() ──────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('removes the attachment so getMeta returns undefined', async () => {
      const { svc } = makeService();
      const id = await svc.upload(makeFile('remove.txt', 'data'), 'ws-1');
      expect(await svc.getMeta(id)).toBeDefined();

      await svc.delete(id);

      expect(await svc.getMeta(id)).toBeUndefined();
    });

    it('removes the attachment so getBlob returns undefined', async () => {
      const { svc } = makeService();
      const id = await svc.upload(makeFile('remove.txt', 'data'), 'ws-1');
      expect(await svc.getBlob(id)).toBeDefined();

      await svc.delete(id);

      expect(await svc.getBlob(id)).toBeUndefined();
    });

    it('does not throw when deleting a non-existent id', async () => {
      const { svc } = makeService();
      await expect(svc.delete('ghost-id')).resolves.toBeUndefined();
    });

    it('deleting one attachment does not affect others', async () => {
      const { svc } = makeService();
      const id1 = await svc.upload(makeFile('keep.txt', 'keep'), 'ws-1');
      const id2 = await svc.upload(makeFile('delete.txt', 'delete'), 'ws-1');

      await svc.delete(id2);

      expect(await svc.getMeta(id1)).toBeDefined();
      expect(await svc.getMeta(id2)).toBeUndefined();
    });
  });

  // ── workspaceId scoping ────────────────────────────────────────────────────

  describe('workspace scoping', () => {
    it('stores the correct workspaceId', async () => {
      const { svc } = makeService();
      const id = await svc.upload(makeFile('scoped.txt', 'data'), 'workspace-xyz');

      const meta = await svc.getMeta(id);
      expect(meta!.workspaceId).toBe('workspace-xyz');
    });

    it('two attachments in different workspaces are independent', async () => {
      const { svc } = makeService();
      const id1 = await svc.upload(makeFile('f.txt', 'a'), 'ws-A');
      const id2 = await svc.upload(makeFile('f.txt', 'b'), 'ws-B');

      const meta1 = await svc.getMeta(id1);
      const meta2 = await svc.getMeta(id2);

      expect(meta1!.workspaceId).toBe('ws-A');
      expect(meta2!.workspaceId).toBe('ws-B');
    });
  });
});
