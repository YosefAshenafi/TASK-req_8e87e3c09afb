import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import * as jsonpatch from 'fast-json-patch';
import { DbService } from '../core/db.service';
import { BroadcastService } from '../core/broadcast.service';
import { TabIdentityService } from '../core/tab-identity.service';
import { AppException } from '../core/error';
import type { CanvasObject, JsonPatch } from '../core/types';

const MAX_NOTE_CHARS = 80;

@Injectable({ providedIn: 'root' })
export class CanvasService {
  private readonly _objects$ = new BehaviorSubject<CanvasObject[]>([]);

  get objects$(): Observable<CanvasObject[]> {
    return this._objects$.asObservable();
  }

  constructor(
    private readonly db: DbService,
    private readonly broadcast: BroadcastService,
    private readonly tab: TabIdentityService,
  ) {
    this._listenForEdits();
  }

  async loadForWorkspace(workspaceId: string): Promise<void> {
    const idb = await this.db.open();
    const all = await idb.getAllFromIndex('canvas_objects', 'by_workspace', workspaceId);
    this._objects$.next(all as CanvasObject[]);
  }

  async addObject(
    partial: Omit<CanvasObject, 'id' | 'version' | 'updatedAt' | 'lastEditedBy'>,
  ): Promise<CanvasObject> {
    if (partial.type === 'sticky-note' && (partial.text?.length ?? 0) > MAX_NOTE_CHARS) {
      throw new AppException({
        code: 'Validation',
        detail: `Sticky note text must be ≤ ${MAX_NOTE_CHARS} characters`,
        field: 'text',
      });
    }

    const idb = await this.db.open();
    const now = Date.now();
    const obj: CanvasObject = {
      ...partial,
      id: uuidv4(),
      version: 1,
      updatedAt: now,
      lastEditedBy: this.tab.tabId,
    };
    await idb.put('canvas_objects', obj);
    this._objects$.next([...this._objects$.value, obj]);
    return obj;
  }

  async patchObject(
    id: string,
    patch: Partial<CanvasObject>,
    baseVersion: number,
  ): Promise<CanvasObject> {
    const idb = await this.db.open();
    const existing = await idb.get('canvas_objects', id);
    if (!existing) throw new AppException({ code: 'NotFound', detail: `Object ${id} not found` });

    if (existing.version !== baseVersion) {
      throw new AppException({
        code: 'VersionConflict',
        objectId: id,
        local: existing.version,
        incoming: baseVersion,
      });
    }

    const updated: CanvasObject = {
      ...existing as CanvasObject,
      ...patch,
      version: existing.version + 1,
      updatedAt: Date.now(),
      lastEditedBy: this.tab.tabId,
    };

    await idb.put('canvas_objects', updated);
    this._updateLocal(updated);

    // Broadcast the edit as an RFC 6902 patch (filter out internal _get ops)
    const rfcPatch: JsonPatch = (jsonpatch.compare(existing as object, updated as object) as JsonPatch)
      .filter(op => op.op !== ('_get' as string));
    this.broadcast.publish({
      kind: 'edit',
      objectId: id,
      baseVersion,
      patch: rfcPatch,
    });

    return updated;
  }

  async setNoteText(id: string, text: string, baseVersion: number): Promise<CanvasObject> {
    if (text.length > MAX_NOTE_CHARS) {
      throw new AppException({
        code: 'Validation',
        detail: `Sticky note text must be ≤ ${MAX_NOTE_CHARS} characters`,
        field: 'text',
      });
    }
    return this.patchObject(id, { text }, baseVersion);
  }

  async deleteObject(id: string, baseVersion: number): Promise<void> {
    const idb = await this.db.open();
    const existing = await idb.get('canvas_objects', id);
    if (!existing) return;
    if (existing.version !== baseVersion) {
      throw new AppException({
        code: 'VersionConflict',
        objectId: id,
        local: existing.version,
        incoming: baseVersion,
      });
    }
    await idb.delete('canvas_objects', id);
    this._objects$.next(this._objects$.value.filter(o => o.id !== id));
  }

  // ── Incoming broadcast edits ────────────────────────────────────────────

  private _listenForEdits(): void {
    this.broadcast.on('edit').subscribe(async msg => {
      const idb = await this.db.open();
      const existing = await idb.get('canvas_objects', msg.objectId);
      if (!existing) return;

      if (existing.version !== msg.baseVersion) {
        // Conflict — let CanvasComponent handle via conflict$ stream
        // (Phase 4 conflict drawer)
        return;
      }

      try {
        const patched = jsonpatch.applyPatch(
          JSON.parse(JSON.stringify(existing)),
          msg.patch as jsonpatch.Operation[],
        ).newDocument as CanvasObject;
        await idb.put('canvas_objects', patched);
        this._updateLocal(patched);
      } catch {
        // Malformed patch — ignore
      }
    });
  }

  private _updateLocal(updated: CanvasObject): void {
    this._objects$.next(
      this._objects$.value.map(o => (o.id === updated.id ? updated : o)),
    );
  }
}
