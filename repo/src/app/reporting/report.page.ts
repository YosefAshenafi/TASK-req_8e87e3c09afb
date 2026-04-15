import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { KpiService } from '../kpi/kpi.service';
import type { WarehouseDaily } from '../core/types';

@Component({
  selector: 'app-report',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="report-page">
      <a routerLink="/workspaces" class="back-link">← Back to workspaces</a>
      <h2>Daily Activity Report</h2>

      <!-- KPI live metrics section -->
      <div class="kpi-section">
        <h3>Live KPIs</h3>
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-value">{{ metrics().notesPerMinute | number:'1.1-1' }}</div>
            <div class="kpi-label">Notes / min</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">{{ metrics().avgCommentResponseMs ? (metrics().avgCommentResponseMs + 'ms') : '–' }}</div>
            <div class="kpi-label">Comment response</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">{{ metrics().unresolvedRequests }}</div>
            <div class="kpi-label">Unresolved requests</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">{{ metrics().activePeers }}</div>
            <div class="kpi-label">Active peers</div>
          </div>
        </div>

        @if (alerts().length > 0) {
          <div class="alerts-row">
            @for (alert of alerts().slice(0, 5); track alert.at) {
              <span class="alert-badge">
                ⚠ {{ alert.metric }}: {{ alert.value }} ({{ alert.direction }} {{ alert.threshold }})
              </span>
            }
          </div>
        }
      </div>

      <!-- Date-range picker -->
      <div class="date-range">
        <input type="date" [value]="from()" (change)="setFrom($event)" aria-label="From date" />
        <span>to</span>
        <input type="date" [value]="to()" (change)="setTo($event)" aria-label="To date" />
        <button class="btn-primary" (click)="load()">Load</button>
      </div>

      @if (rows().length === 0) {
        <p class="empty-state">No data for the selected range.</p>
      } @else {
        <table class="report-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Notes created</th>
              <th>Comments</th>
              <th>Chat messages</th>
              <th>Mutual-help posts</th>
              <th>Active profiles</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.date + row.workspaceId) {
              <tr>
                <td>{{ row.date }}</td>
                <td>{{ row.notesCreated }}</td>
                <td>{{ row.commentsAdded }}</td>
                <td>{{ row.chatMessagesSent }}</td>
                <td>{{ row.mutualHelpPublished }}</td>
                <td>{{ row.activeProfiles.length }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
  styleUrl: './report.page.scss',
})
export class ReportPage implements OnInit {
  private readonly kpiService = inject(KpiService);

  protected rows = signal<WarehouseDaily[]>([]);
  protected from = signal(this._defaultFrom());
  protected to = signal(new Date().toISOString().slice(0, 10));

  protected metrics = toSignal(this.kpiService.metrics$, {
    initialValue: {
      notesPerMinute: 0,
      avgCommentResponseMs: 0,
      unresolvedRequests: 0,
      activePeers: 0,
      computedAt: 0,
    },
  });

  protected alerts = toSignal(this.kpiService.alerts$, { initialValue: [] });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected setFrom(e: Event): void {
    this.from.set((e.target as HTMLInputElement).value);
  }

  protected setTo(e: Event): void {
    this.to.set((e.target as HTMLInputElement).value);
  }

  async load(): Promise<void> {
    const result = await this.kpiService.dailyReport({ from: this.from(), to: this.to() });
    this.rows.set(result);
  }

  private _defaultFrom(): string {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }
}
