import { Injectable } from '@angular/core';
import JSZip from 'jszip';
import { DbService } from '../core/db.service';
import { PlatformService } from '../core/platform.service';
import { AppException } from '../core/error';

const MAX_PACKAGE_BYTES = 200 * 1024 * 1024; // 200 MB

interface PackageManifest {
  schemaVersion: 1;
  workspaceId: string;
  /**
   * F-H06: include the source workspace name in the manifest so the import
   * side can enforce the prompt's same-name conflict rule without having to
   * parse workspaces.json.
   */
  workspaceName?: string;
  exportedAt: number;
  counts: Record<string, number>;
}

export type ImportOutcome =
  | { ok: true; workspaceId: string; action: 'created' | 'overwritten' | 'copied' }
  | { ok: false; reason: 'BadManifest' | 'TooLarge' | 'Cancelled' | 'Unsupported'; detail?: string };

export type ConflictChoice = 'overwrite' | 'copy' | 'cancel';
export type ConflictResolver = (existingName: string) => Promise<ConflictChoice>;

@Injectable({ providedIn: 'root' })
export class PackageService {
  constructor(
    private readonly db: DbService,
    private readonly platform: PlatformService,
  ) {}

  /** Read full file bytes — jsdom `File.arrayBuffer()` / `Response` can return empty data for some blobs. */
  private _fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
      r.readAsArrayBuffer(file);
    });
  }

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
      workspaceName: workspace.name,
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

  async import(file: File, resolver?: ConflictResolver): Promise<ImportOutcome> {
    if (file.size > MAX_PACKAGE_BYTES) {
      return { ok: false, reason: 'TooLarge', detail: `File exceeds 200 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB)` };
    }

    let zip: JSZip;
    try {
      const buf = await this._fileToArrayBuffer(file);
      // JSZip in some environments rejects ArrayBuffer but accepts Uint8Array.
      zip = await JSZip.loadAsync(new Uint8Array(buf));
    } catch (e: unknown) {
      return {
        ok: false,
        reason: 'BadManifest',
        detail: `Could not read ZIP file: ${e instanceof Error ? e.message : String(e)}`,
      };
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

    // F-H06: detect conflicts by workspace NAME first (the prompt rule),
    // falling back to workspace-id collision for legacy packages that have
    // no workspaceName and no workspaces.json to source one from.
    const idb = await this.db.open();

    // Peek at workspaces.json ahead of the main read so the conflict-detection
    // step knows the incoming name before prompting the user.
    let incomingName: string | undefined = manifest.workspaceName;
    const wsFilePeek = zip.file('workspaces.json');
    if (!incomingName && wsFilePeek) {
      try {
        const raw = JSON.parse(await wsFilePeek.async('text')) as unknown;
        const rows = Array.isArray(raw) ? raw : [raw];
        const first = rows[0] as { name?: string } | undefined;
        if (first?.name) incomingName = first.name;
      } catch {
        // ignore — fall back to id-based detection below
      }
    }

    let existing: { id: string; name: string } | undefined;
    if (incomingName) {
      const all = await idb.getAll('workspaces');
      existing = all.find(w => w.name === incomingName) as { id: string; name: string } | undefined;
    }
    if (!existing) {
      // Legacy fallback: same-id collision for packages with no name info.
      existing = (await idb.get('workspaces', manifest.workspaceId)) as { id: string; name: string } | undefined;
    }

    let action: 'created' | 'overwritten' | 'copied' = existing ? 'overwritten' : 'created';
    let targetWorkspaceId = manifest.workspaceId;

    if (existing) {
      // H-03: 3-way decision. Prefer a UI-supplied resolver that can offer Overwrite / Copy /
      // Cancel. Fall back to native confirm (2-way) only when no resolver is supplied — the
      // UI path in the workspace shell always supplies one, so the user-visible behaviour is
      // Overwrite / Create Copy / Cancel.
      let choice: ConflictChoice;
      if (resolver) {
        choice = await resolver(existing.name);
      } else {
        const overwrite = window.confirm(
          `A workspace named "${existing.name}" already exists. Click OK to overwrite it, Cancel to create a copy.`,
        );
        choice = overwrite ? 'overwrite' : 'copy';
      }

      if (choice === 'cancel') {
        return { ok: false, reason: 'Cancelled', detail: 'Import cancelled by user' };
      }
      if (choice === 'copy') {
        action = 'copied';
        targetWorkspaceId = crypto.randomUUID();
      } else {
        action = 'overwritten';
        // F-H06: when overwriting, replace the existing workspace by ID so
        // downstream consumers that key off the existing id keep working.
        targetWorkspaceId = existing.id;
      }
    }

    const importDate = new Date().toISOString().slice(0, 10);

    // Read the entire ZIP into memory first — awaiting JSZip inside an IDB transaction yields and
    // auto-commits the transaction (fake-indexeddb / browser), causing InvalidStateError.
    const wsFile = zip.file('workspaces.json') ?? null;
    const storeFiles: Array<[string, string]> = [
      ['canvas_objects', 'canvas_objects.json'],
      ['comments', 'comments.json'],
      ['chat', 'chat.json'],
      ['mutual_help', 'mutual_help.json'],
      ['snapshots', 'snapshots.json'],
    ];
    const storeRows: Array<[string, Record<string, unknown>[]]> = [];
    for (const [store, filename] of storeFiles) {
      const f = zip.file(filename);
      storeRows.push([store, f ? (JSON.parse(await f.async('text')) as Record<string, unknown>[]) : []]);
    }

    const attachmentPayloads: Array<{ id: string; blob: Blob }> = [];
    for (const path of Object.keys(zip.files)) {
      if (!path.startsWith('blobs/') || path.endsWith('/')) continue;
      const entry = zip.files[path];
      if (entry.dir) continue;
      attachmentPayloads.push({
        id: path.slice('blobs/'.length),
        blob: await entry.async('blob'),
      });
    }

    let workspaceRowsFromFile: Record<string, unknown>[] | null = null;
    if (wsFile) {
      const raw = JSON.parse(await wsFile.async('text')) as unknown;
      workspaceRowsFromFile = (Array.isArray(raw) ? raw : [raw]) as Record<string, unknown>[];
    }

    const tx = idb.transaction(
      ['workspaces', 'canvas_objects', 'comments', 'chat', 'mutual_help', 'snapshots', 'attachments'],
      'readwrite',
    );

    // F-H06: rewrite imported workspace/row IDs whenever the target id
    // differs from the manifest id. This covers both 'copied' (new uuid) and
    // name-based 'overwritten' (existing id may differ from manifest id).
    const rewriteIds = targetWorkspaceId !== manifest.workspaceId;

    if (!workspaceRowsFromFile) {
      await tx.objectStore('workspaces').put({
        id: targetWorkspaceId,
        name: existing
          ? (action === 'copied'
              ? `${existing.name} (imported ${importDate})`
              : existing.name)
          : (incomingName ?? `Imported ${importDate}`),
        ownerProfileId: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
      });
    } else {
      const wsStore = tx.objectStore('workspaces');
      for (const w of workspaceRowsFromFile) {
        const row = { ...w } as Record<string, unknown>;
        if (rewriteIds) (row as { id: string }).id = targetWorkspaceId;
        if (action === 'copied' && existing) {
          (row as { name: string }).name = `${existing.name} (imported ${importDate})`;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (wsStore as any).put(row);
      }
    }

    for (const [store, rows] of storeRows) {
      const st = tx.objectStore(store as 'canvas_objects');
      for (const row of rows) {
        if (rewriteIds) (row as { workspaceId: string }).workspaceId = targetWorkspaceId;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (st as any).put(row);
      }
    }

    const attStore = tx.objectStore('attachments');
    for (const { id, blob } of attachmentPayloads) {
      await attStore.put({
        id,
        workspaceId: targetWorkspaceId,
        blob,
        uploadedAt: Date.now(),
        filename: id,
        mimeType: 'application/octet-stream',
        sizeBytes: blob.size,
      });
    }

    await tx.done;
    return { ok: true, workspaceId: targetWorkspaceId, action };
  }
}
