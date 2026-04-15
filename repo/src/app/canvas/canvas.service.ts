import { Inject, Injectable, Optional } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import * as jsonpatch from 'fast-json-patch';
import { DbService } from '../core/db.service';
import { BroadcastService } from '../core/broadcast.service';
import { TabIdentityService } from '../core/tab-identity.service';
import { AuthService } from '../auth/auth.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { PresenceService } from '../presence/presence.service';
import { ChatService } from '../chat/chat.service';
import { AppException } from '../core/error';
import type { CanvasObject, JsonPatch } from '../core/types';

const MAX_NOTE_CHARS = 80;

@Injectable({ providedIn: 'root' })
export class CanvasService {
  private readonly _objects$ = new BehaviorSubject<CanvasObject[]>([]);

  /** H-02: emits whenever a version conflict is detected, from any edit path. */
  readonly conflict$ = new Subject<{ objectId: string; local: number; incoming: number }>();

  get objects$(): Observable<CanvasObject[]> {
    return this._objects$.asObservable();
  }

  /** F-B01: synchronous snapshot of the current canvas objects (used by snapshot autosave). */
  get objectsValue(): CanvasObject[] {
    return this._objects$.value;
  }

  constructor(
    private readonly db: DbService,
    private readonly broadcast: BroadcastService,
    private readonly tab: TabIdentityService,
    private readonly auth: AuthService,
    private readonly telemetry: TelemetryService,
    // F-H04: presence is optional so existing unit tests that construct
    // CanvasService without it keep working; production DI always supplies it.
    @Optional() @Inject(PresenceService) private readonly presence: PresenceService | null = null,
    // ChatService is optional so unit tests that omit it keep working.
    @Optional() private readonly chat: ChatService | null = null,
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

    // H-05: emit telemetry for KPI aggregation
    if (obj.type === 'sticky-note') {
      this.telemetry.log({
        workspaceId: obj.workspaceId,
        type: 'note-created',
        payload: { profileId: this.auth.currentProfile?.id, objectId: obj.id },
      });
    }

    // F-H04: feed the activity log so the recent-actions panel is populated.
    const label = obj.type === 'sticky-note' ? 'created a sticky note' : `added a ${obj.type}`;
    this.presence?.logActivity(label, obj.id, obj.type);

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
      this.conflict$.next({ objectId: id, local: existing.version, incoming: baseVersion });
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
      this.conflict$.next({ objectId: id, local: existing.version, incoming: baseVersion });
      throw new AppException({
        code: 'VersionConflict',
        objectId: id,
        local: existing.version,
        incoming: baseVersion,
      });
    }
    await idb.delete('canvas_objects', id);
    this._objects$.next(this._objects$.value.filter(o => o.id !== id));

    // System message for canvas deletion
    await this.chat?.postSystem(`A ${existing.type} was deleted from the canvas.`);

    // F-H04: record deletion in the activity log
    this.presence?.logActivity(`deleted a ${existing.type}`, id, existing.type);
  }

  // ── Incoming broadcast edits ────────────────────────────────────────────

  private _listenForEdits(): void {
    this.broadcast.on('edit').subscribe(async msg => {
      const idb = await this.db.open();
      const existing = await idb.get('canvas_objects', msg.objectId);
      if (!existing) return;

      if (existing.version !== msg.baseVersion) {
        // H-02: surface the conflict so CanvasComponent and other subscribers can react.
        this.conflict$.next({ objectId: msg.objectId, local: existing.version, incoming: msg.baseVersion });
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
