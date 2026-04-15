import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from '../core/db.service';
import type { TelemetryEvent } from '../core/types';

export type WorkerMessage =
  | { kind: 'boot'; workspaceId: string; now: number }
  | {
      kind: 'event-appended';
      id: string;
      type: string;
      workspaceId: string;
      profileId?: string;
      threadId?: string;
    }
  | { kind: 'kpi-update'; metrics: unknown }
  | { kind: 'kpi-alert'; metric: string; value: number; threshold: number }
  | { kind: 'rollup-complete'; date: string };

@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private _worker: Worker | null = null;
  private _workspaceId = '';
  /**
   * F-H05: expose the worker reference as a reactive stream so late
   * subscribers (e.g. KpiService) can rebind `onmessage` whenever a new
   * worker boots. This fixes the fragile one-shot binding where KpiService
   * saw `null` if it was constructed before the workspace opened.
   */
  private readonly _worker$ = new BehaviorSubject<Worker | null>(null);

  constructor(private readonly db: DbService) {}

  boot(workspaceId: string): void {
    this._workspaceId = workspaceId;
    if (typeof Worker !== 'undefined') {
      this._worker = new Worker(new URL('../../workers/aggregator.worker', import.meta.url), {
        type: 'module',
      });
      this._worker.postMessage({ kind: 'boot', workspaceId, now: Date.now() } satisfies WorkerMessage);
      this._worker$.next(this._worker);
    }
  }

  terminate(): void {
    this._worker?.terminate();
    this._worker = null;
    this._worker$.next(null);
  }

  get workerMessages$(): Worker | null {
    return this._worker;
  }

  /** F-H05: reactive worker reference for KpiService and other listeners. */
  get worker$(): Observable<Worker | null> {
    return this._worker$.asObservable();
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
    // H-05: send the full event shape the aggregator worker expects (type, workspaceId, profileId, threadId).
    const payload = event.payload as Record<string, unknown> | undefined;
    const profileId =
      typeof payload?.['profileId'] === 'string' ? (payload['profileId'] as string) : undefined;
    const threadId =
      typeof payload?.['threadId'] === 'string' ? (payload['threadId'] as string) : undefined;
    this._worker?.postMessage({
      kind: 'event-appended',
      id: event.id,
      type: event.type,
      workspaceId: event.workspaceId,
      profileId,
      threadId,
    } satisfies WorkerMessage);
  }
}
