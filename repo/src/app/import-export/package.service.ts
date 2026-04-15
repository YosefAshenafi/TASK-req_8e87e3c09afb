import { Injectable } from '@angular/core';
import JSZip from 'jszip';
import { DbService } from '../core/db.service';
import { PlatformService } from '../core/platform.service';
import { AppException } from '../core/error';

const MAX_PACKAGE_BYTES = 200 * 1024 * 1024; // 200 MB

interface PackageManifest {
  schemaVersion: 1;
  workspaceId: string;
  exportedAt: number;
  counts: Record<string, number>;
}

export type ImportOutcome =
  | { ok: true; workspaceId: string; action: 'created' | 'overwritten' | 'copied' }
  | { ok: false; reason: 'BadManifest' | 'TooLarge' | 'Cancelled' | 'Unsupported'; detail?: string };

@Injectable({ providedIn: 'root' })
export class PackageService {
  constructor(
    private readonly db: DbService,
    private readonly platform: PlatformService,
  ) {}

  async export(workspaceId: string): Promise<{ ok: boolean; detail?: string }> {
    const idb = await this.db.open();
    const workspace = await idb.get('workspaces', workspaceId);
    if (!workspace) throw new AppException({ code: 'NotFound', detail: 'Workspace not found' });

    const zip = new JSZip();
    const counts: Record<string, number> = {};

    // Serialise each store
    const stores = ['canvas_objects', 'comments', 'chat', 'mutual_help', 'snapshots'] as const;
    for (const store of stores) {
      const data = store === 'canvas_objects'
        ? await idb.getAllFromIndex('canvas_objects', 'by_workspace', workspaceId)
        : store === 'comments'
        ? await idb.getAllFromIndex('comments', 'by_workspace', workspaceId)
        : store === 'chat'
        ? await idb.getAllFromIndex('chat', 'by_workspace_createdAt',
            IDBKeyRange.bound([workspaceId, 0], [workspaceId, Number.MAX_SAFE_INTEGER]))
        : store === 'mutual_help'
        ? await idb.getAllFromIndex('mutual_help', 'by_workspace', workspaceId)
        : await idb.getAllFromIndex('snapshots', 'by_workspace', workspaceId);
      counts[store] = data.length;
      zip.file(`${store}.json`, JSON.stringify(data));
    }

    // Attachments as blobs
    const allAttachments = await idb.getAll('attachments');
    const wsAttachments = allAttachments.filter(a => a.workspaceId === workspaceId);
    counts['attachments'] = wsAttachments.length;
    for (const att of wsAttachments) {
      zip.file(`blobs/${att.id}`, att.blob);
    }

    const manifest: PackageManifest = {
      schemaVersion: 1,
      workspaceId,
      exportedAt: Date.now(),
      counts,
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

    if (blob.size > MAX_PACKAGE_BYTES) {
      throw new AppException({
        code: 'QuotaExceeded',
        sizeBytes: blob.size,
        limitBytes: MAX_PACKAGE_BYTES,
      });
    }

    const filename = `${workspace.name.replace(/\s+/g, '-')}-${Date.now()}.srpackage`;

    if (this.platform.hasShowSaveFilePicker) {
      try {
        const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> })
          .showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'SecureRoom Package', accept: { 'application/zip': ['.srpackage'] } }],
          });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { ok: true };
      } catch (e: unknown) {
        if ((e as { name?: string }).name === 'AbortError') return { ok: false, detail: 'User cancelled' };
      }
    }

    // Fallback: Blob URL download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { ok: true };
  }

  async import(file: File): Promise<ImportOutcome> {
    if (file.size > MAX_PACKAGE_BYTES) {
      return { ok: false, reason: 'TooLarge', detail: `File exceeds 200 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB)` };
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch {
      return { ok: false, reason: 'BadManifest', detail: 'Could not read ZIP file' };
    }

    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) return { ok: false, reason: 'BadManifest', detail: 'Missing manifest.json' };

    let manifest: PackageManifest;
    try {
      manifest = JSON.parse(await manifestFile.async('text')) as PackageManifest;
    } catch {
      return { ok: false, reason: 'BadManifest', detail: 'Invalid manifest JSON' };
    }

    if (manifest.schemaVersion !== 1) {
      return { ok: false, reason: 'Unsupported', detail: `Unknown schema version: ${manifest.schemaVersion}` };
    }

    // Check for same-name collision
    const idb = await this.db.open();
    const existing = await idb.get('workspaces', manifest.workspaceId);
    let action: 'created' | 'overwritten' | 'copied' = existing ? 'overwritten' : 'created';
    let targetWorkspaceId = manifest.workspaceId;

    if (existing) {
      const choice = window.confirm(
        `A workspace named "${existing.name}" already exists. Click OK to overwrite it, Cancel to create a copy.`,
      );
      if (!choice) {
        action = 'copied';
        targetWorkspaceId = crypto.randomUUID();
      }
    }

    // Write all stores in a single transaction (atomicity)
    const tx = idb.transaction(
      ['workspaces', 'canvas_objects', 'comments', 'chat', 'mutual_help', 'snapshots', 'attachments'],
      'readwrite',
    );

    const importDate = new Date().toISOString().slice(0, 10);

    // Workspace
    const wsFile = zip.file('workspaces.json') ?? null;
    if (!wsFile) {
      // Read from manifest — at minimum create a stub workspace
      await tx.objectStore('workspaces').put({
        id: targetWorkspaceId,
        name: existing ? `${existing.name} (imported ${importDate})` : `Imported ${importDate}`,
        ownerProfileId: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
      });
    }

    // Restore each store
    const storeFiles: Array<[string, string]> = [
      ['canvas_objects', 'canvas_objects.json'],
      ['comments', 'comments.json'],
      ['chat', 'chat.json'],
      ['mutual_help', 'mutual_help.json'],
      ['snapshots', 'snapshots.json'],
    ];

    for (const [store, filename] of storeFiles) {
      const f = zip.file(filename);
      if (!f) continue;
      const rows = JSON.parse(await f.async('text')) as Record<string, unknown>[];
      const st = tx.objectStore(store as 'canvas_objects');
      for (const row of rows) {
        if (action === 'copied') (row as { workspaceId: string }).workspaceId = targetWorkspaceId;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (st as any).put(row);
      }
    }

    // Attachments
    const blobFolder = zip.folder('blobs');
    if (blobFolder) {
      const attStore = tx.objectStore('attachments');
      blobFolder.forEach(async (relativePath, file) => {
        const blob = await file.async('blob');
        const id = relativePath.replace('blobs/', '');
        await attStore.put({ id, workspaceId: targetWorkspaceId, blob, uploadedAt: Date.now(), filename: id, mimeType: 'application/octet-stream', sizeBytes: blob.size });
      });
    }

    await tx.done;
    return { ok: true, workspaceId: targetWorkspaceId, action };
  }
}
