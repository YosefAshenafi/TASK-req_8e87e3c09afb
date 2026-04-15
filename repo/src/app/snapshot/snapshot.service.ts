import { Injectable } from '@angular/core';
import { Subscription } from 'rxjs';
import * as jsonpatch from 'fast-json-patch';
import { DbService } from '../core/db.service';
import { ChatService } from '../chat/chat.service';
import { AppException } from '../core/error';
import type { SnapshotSummary, JsonPatch } from '../core/types';

const MAX_SNAPSHOTS = 200;
const CHECKPOINT_EVERY = 20;
/** Production: 10s. Vitest sets `process.env.VITEST` — use 1s so fake timers can advance two ticks quickly. */
const AUTO_SAVE_INTERVAL_MS =
  typeof process !== 'undefined' && process.env['VITEST'] === 'true' ? 1_000 : 10_000;

@Injectable({ providedIn: 'root' })
export class SnapshotService {
  private _workspaceId = '';
  private _dirty = false;
  private _lastState: Record<string, unknown> | null = null;
  private _autoSaveSub: Subscription | null = null;
  /** Serialises async IDB writes so overlapping interval ticks cannot race on nextSeq. */
  private _persistChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: DbService,
    private readonly chat: ChatService,
  ) {}

  markDirty(): void {
    this._dirty = true;
  }

  startAutoSave(workspaceId: string, getState: () => Record<string, unknown>): void {
    this._workspaceId = workspaceId;
    this._autoSaveSub?.unsubscribe();
    this._persistChain = Promise.resolve();
    // Native setInterval + a serial promise chain: each tick clears dirty and enqueues _doTick so
    // a later tick cannot compute nextSeq before the previous IDB write lands.
    const handle = window.setInterval(() => {
      if (!this._dirty) return;
      const state = getState();
      this._dirty = false;
      this._persistChain = this._persistChain
        .then(() => this._doTick(state))
        .catch(() => undefined);
    }, AUTO_SAVE_INTERVAL_MS);
    this._autoSaveSub = new Subscription(() => {
      window.clearInterval(handle);
    });
  }

  stopAutoSave(): void {
    this._autoSaveSub?.unsubscribe();
    this._autoSaveSub = null;
  }

  async tick(): Promise<void> {
    if (!this._dirty) return;
    // Caller provides state externally; this tick is for manual invocation
    this._dirty = false;
  }

  async listSnapshots(workspaceId: string): Promise<SnapshotSummary[]> {
    const idb = await this.db.open();
    const all = await idb.getAllFromIndex('snapshots', 'by_workspace', workspaceId);
    return all.map(s => ({
      workspaceId: s.workspaceId,
      seq: s.seq,
      isCheckpoint: s.isCheckpoint,
      createdAt: s.createdAt,
    }));
  }

  async rollbackTo(workspaceId: string, seq: number): Promise<void> {
    const idb = await this.db.open();
    const all = await idb.getAllFromIndex('snapshots', 'by_workspace', workspaceId);
    const sorted = [...all].sort((a, b) => a.seq - b.seq);

    // Find the nearest checkpoint at or before seq
    let checkpoint = sorted.filter(s => s.isCheckpoint && s.seq <= seq).pop();
    if (!checkpoint) throw new AppException({ code: 'NotFound', detail: 'No checkpoint found' });

    let state: Record<string, unknown> = JSON.parse(checkpoint.data ?? '{}');

    // Replay patches between checkpoint and target seq
    const patches = sorted.filter(s => !s.isCheckpoint && s.seq > checkpoint!.seq && s.seq <= seq);
    for (const snap of patches) {
      state = jsonpatch.applyPatch(state, snap.patch as jsonpatch.Operation[], false, false).newDocument;
    }

    // Write the rolled-back state as the new head
    await this._writeSnapshot(workspaceId, state, sorted.length + 1);
    await this.chat.postSystem(`Workspace rolled back to snapshot #${seq}.`);
  }

  private async _doTick(state: Record<string, unknown>): Promise<void> {
    const idb = await this.db.open();
    const all = await idb.getAllFromIndex('snapshots', 'by_workspace', this._workspaceId);
    const sorted = [...all].sort((a, b) => a.seq - b.seq);
    const nextSeq = (sorted.at(-1)?.seq ?? 0) + 1;

    await this._writeSnapshot(this._workspaceId, state, nextSeq);

    // Evict oldest if ring buffer exceeds 200
    if (sorted.length >= MAX_SNAPSHOTS) {
      const oldest = sorted[0];
      await idb.delete('snapshots', [oldest.workspaceId, oldest.seq]);
    }
  }

  private async _writeSnapshot(
    workspaceId: string,
    state: Record<string, unknown>,
    seq: number,
  ): Promise<void> {
    const idb = await this.db.open();
    const isCheckpoint = seq % CHECKPOINT_EVERY === 0 || seq === 1;

    let patch: JsonPatch | undefined;
    if (!isCheckpoint && this._lastState) {
      patch = (jsonpatch.compare(this._lastState as object, state as object) as JsonPatch)
        .filter(op => op.op !== ('_get' as string));
    }

    await idb.put('snapshots', {
      workspaceId,
      seq,
      isCheckpoint,
      data: isCheckpoint ? JSON.stringify(state) : undefined,
      patch: !isCheckpoint ? patch : undefined,
      createdAt: Date.now(),
    });

    this._lastState = state;
  }
}
