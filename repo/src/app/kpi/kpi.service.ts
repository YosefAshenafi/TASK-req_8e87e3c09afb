import { Inject, Injectable, Optional } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { DbService } from '../core/db.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { ToastService } from '../core/toast.service';
import type { KpiSnapshot, KpiAlert, WarehouseDaily } from '../core/types';

const DEFAULT_KPI: KpiSnapshot = {
  notesPerMinute: 0,
  avgCommentResponseMs: 0,
  unresolvedRequests: 0,
  activePeers: 0,
  computedAt: 0,
};

/** F-H05: humanise metric field names for toast copy. */
const METRIC_LABEL: Record<string, string> = {
  notesPerMinute: 'notes per minute',
  avgCommentResponseMs: 'avg comment response',
  unresolvedRequests: 'unresolved requests',
  activePeers: 'active peers',
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
    // F-H05: toast is optional so existing unit tests that construct KpiService
    // with two positional args keep working. Production DI always supplies it.
    @Optional() @Inject(ToastService) private readonly toast: ToastService | null = null,
  ) {
    this._listenToWorker();
  }

  async dailyReport(dateRange: { from: string; to: string }): Promise<WarehouseDaily[]> {
    const idb = await this.db.open();
    const all = await idb.getAll('warehouse_daily');
    return all.filter(row => row.date >= dateRange.from && row.date <= dateRange.to) as WarehouseDaily[];
  }

  /**
   * F-H05: subscribe to the telemetry worker stream reactively so we rebind
   * `onmessage` every time a new worker boots (e.g. per workspace open).
   * Also route `kpi-alert` messages to a toast so thresholds surface in the
   * active workspace, not only in the reporting page.
   */
  private _listenToWorker(): void {
    this.telemetry.worker$.subscribe(worker => {
      if (!worker) return;
      worker.onmessage = (ev: MessageEvent) => {
        const data = ev.data as { kind: string };
        if (data.kind === 'kpi-update') {
          const metrics = (data as { kind: string; metrics: KpiSnapshot }).metrics;
          this._metrics$.next({ ...metrics, computedAt: Date.now() });
        } else if (data.kind === 'kpi-alert') {
          const alert = data as KpiAlert & { kind: string };
          const withTs = { ...alert, at: Date.now() };
          const current = this._alerts$.value;
          this._alerts$.next([withTs, ...current].slice(0, 50));
          // Route the alert through the toast system so operators see it.
          if (this.toast) {
            const label = METRIC_LABEL[alert.metric] ?? alert.metric;
            this.toast.show(
              `KPI alert: ${label} is ${alert.direction} threshold (${alert.value} vs ${alert.threshold})`,
              'warning',
              6000,
            );
          }
        }
      };
    });
  }
}
