import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
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
  protected rows = signal<WarehouseDaily[]>([]);
  protected from = signal(this._defaultFrom());
  protected to = signal(new Date().toISOString().slice(0, 10));

  constructor(private readonly kpi: KpiService) {}

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
    const result = await this.kpi.dailyReport({ from: this.from(), to: this.to() });
    this.rows.set(result);
  }

  private _defaultFrom(): string {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }
}
