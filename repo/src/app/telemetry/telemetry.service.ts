import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from '../core/db.service';
import type { TelemetryEvent } from '../core/types';

export type WorkerMessage =
  | { kind: 'boot'; workspaceId: string; now: number }
  | { kind: 'event-appended'; id: string }
  | { kind: 'kpi-update'; metrics: unknown }
  | { kind: 'kpi-alert'; metric: string; value: number; threshold: number }
  | { kind: 'rollup-complete'; date: string };

@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private _worker: Worker | null = null;
  private _workspaceId = '';

  constructor(private readonly db: DbService) {}

  boot(workspaceId: string): void {
    this._workspaceId = workspaceId;
    if (typeof Worker !== 'undefined') {
      this._worker = new Worker(new URL('../../workers/aggregator.worker', import.meta.url), {
        type: 'module',
      });
      this._worker.postMessage({ kind: 'boot', workspaceId, now: Date.now() } satisfies WorkerMessage);
    }
  }

  terminate(): void {
    this._worker?.terminate();
    this._worker = null;
  }

  get workerMessages$(): Worker | null {
    return this._worker;
  }

  log(event: Omit<TelemetryEvent, 'id' | 'at' | 'rolledUp'>): void {
    const full: TelemetryEvent = {
      ...event,
      id: uuidv4(),
      at: Date.now(),
      rolledUp: false,
    };

    // Fire-and-forget — do not await
    this._persist(full).catch(() => undefined);
  }

  private async _persist(event: TelemetryEvent): Promise<void> {
    const idb = await this.db.open();
    await idb.put('events', event);
    this._worker?.postMessage({ kind: 'event-appended', id: event.id } satisfies WorkerMessage);
  }
}
