import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { DbService } from '../core/db.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import type { KpiSnapshot, KpiAlert, WarehouseDaily } from '../core/types';

const DEFAULT_KPI: KpiSnapshot = {
  notesPerMinute: 0,
  avgCommentResponseMs: 0,
  unresolvedRequests: 0,
  activePeers: 0,
  computedAt: 0,
};

@Injectable({ providedIn: 'root' })
export class KpiService {
  private readonly _metrics$ = new BehaviorSubject<KpiSnapshot>(DEFAULT_KPI);
  private readonly _alerts$ = new BehaviorSubject<KpiAlert[]>([]);

  get metrics$(): Observable<KpiSnapshot> {
    return this._metrics$.asObservable();
  }

  get alerts$(): Observable<KpiAlert[]> {
    return this._alerts$.asObservable();
  }

  constructor(
    private readonly db: DbService,
    private readonly telemetry: TelemetryService,
  ) {
    this._listenToWorker();
  }

  async dailyReport(dateRange: { from: string; to: string }): Promise<WarehouseDaily[]> {
    const idb = await this.db.open();
    const all = await idb.getAll('warehouse_daily');
    return all.filter(row => row.date >= dateRange.from && row.date <= dateRange.to) as WarehouseDaily[];
  }

  private _listenToWorker(): void {
    const worker = this.telemetry.workerMessages$;
    if (!worker) return;

    worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { kind: string };
      if (data.kind === 'kpi-update') {
        const metrics = (data as { kind: string; metrics: KpiSnapshot }).metrics;
        this._metrics$.next({ ...metrics, computedAt: Date.now() });
      } else if (data.kind === 'kpi-alert') {
        const alert = data as KpiAlert & { kind: string };
        const current = this._alerts$.value;
        this._alerts$.next([{ ...alert, at: Date.now() }, ...current].slice(0, 50));
      }
    };
  }
}
