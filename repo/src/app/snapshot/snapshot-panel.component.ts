import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  signal,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SnapshotService } from './snapshot.service';
import { ToastService } from '../core/toast.service';
import type { SnapshotSummary } from '../core/types';

/**
 * F-B01: list of snapshots for the active workspace with one-click rollback.
 *
 * This component is intentionally a dumb list — it does not own the autosave
 * lifecycle. The workspace shell wires `SnapshotService.startAutoSave()` on
 * workspace open, calls `markDirty()` on mutations, and emits `rolledBack`
 * after a rollback so the shell can tell the canvas / mutual-help services
 * to reload.
 */
@Component({
  selector: 'app-snapshot-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="snap-panel">
      <div class="snap-header">
        <span class="snap-title">Snapshots</span>
        <div class="snap-header-actions">
          <button class="refresh-btn" (click)="refresh()" title="Refresh list" aria-label="Refresh snapshot list">↻</button>
          <button class="close-btn" (click)="closed.emit()" aria-label="Close snapshot panel">×</button>
        </div>
      </div>

      <div class="snap-list" role="list" aria-label="Snapshot list">
        @if (snapshots().length === 0) {
          <div class="empty-state">No snapshots yet. Autosave runs every few seconds while you work.</div>
        }
        @for (s of snapshots(); track s.seq) {
          <div class="snap-row" role="listitem">
            <div class="snap-meta">
              <span class="snap-seq">#{{ s.seq }}</span>
              @if (s.isCheckpoint) {
                <span class="snap-chip">checkpoint</span>
              }
              <span class="snap-time">{{ timeLabel(s.createdAt) }}</span>
            </div>
            <button
              type="button"
              class="rollback-btn"
              [disabled]="rolling() === s.seq"
              (click)="rollback(s)"
              title="Restore workspace to this snapshot"
              aria-label="Rollback to snapshot #{{ s.seq }}"
            >{{ rolling() === s.seq ? '…' : 'Rollback' }}</button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .snap-panel { width:320px; max-height:440px; background:#fff; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.15); border:1px solid #e8e8e8; display:flex; flex-direction:column; overflow:hidden; }
    .snap-header { display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-bottom:1px solid #eee; flex-shrink:0; }
    .snap-title { font-weight:600; font-size:0.9rem; color:#333; }
    .snap-header-actions { display:flex; gap:6px; align-items:center; }
    .refresh-btn { background:none; border:none; font-size:1.1rem; cursor:pointer; color:#666; padding:0 4px; line-height:1; }
    .refresh-btn:hover { color:#333; }
    .close-btn { background:none; border:none; font-size:1.4rem; cursor:pointer; color:#888; padding:0; line-height:1; }
    .close-btn:hover { color:#333; }
    .snap-list { flex:1; overflow-y:auto; padding:4px 0; }
    .snap-row { display:flex; justify-content:space-between; align-items:center; padding:8px 14px; border-bottom:1px solid #f5f5f5; gap:8px; }
    .snap-row:last-child { border-bottom:none; }
    .snap-meta { display:flex; align-items:center; gap:6px; flex:1; min-width:0; }
    .snap-seq { font-weight:600; font-size:0.82rem; color:#333; }
    .snap-chip { font-size:0.66rem; background:#e3f2fd; color:#1565c0; padding:1px 6px; border-radius:8px; font-weight:600; letter-spacing:0.02em; }
    .snap-time { font-size:0.72rem; color:#888; }
    .rollback-btn { padding:4px 10px; font-size:0.76rem; border:1px solid #1e88e5; color:#1565c0; background:#fff; border-radius:6px; cursor:pointer; font-weight:600; }
    .rollback-btn:hover:not(:disabled) { background:#e3f2fd; }
    .rollback-btn:disabled { opacity:0.5; cursor:not-allowed; }
    .empty-state { color:#bbb; text-align:center; padding:28px 16px; font-size:0.82rem; line-height:1.4; }
  `],
})
export class SnapshotPanelComponent implements OnInit, OnChanges {
  @Input() workspaceId = '';
  @Output() closed = new EventEmitter<void>();
  /** F-B01: emits after a successful rollback so the parent can reload state. */
  @Output() rolledBack = new EventEmitter<number>();

  protected readonly snapshots = signal<SnapshotSummary[]>([]);
  protected readonly rolling = signal<number | null>(null);

  private readonly snapshotService = inject(SnapshotService);
  private readonly toast = inject(ToastService);

  ngOnInit(): void {
    this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['workspaceId']) this.refresh();
  }

  protected async refresh(): Promise<void> {
    if (!this.workspaceId) return;
    try {
      const list = await this.snapshotService.listSnapshots(this.workspaceId);
      // Newest first for quick rollback to a recent state.
      this.snapshots.set([...list].sort((a, b) => b.seq - a.seq));
    } catch {
      // ignore — empty list is a safe default
      this.snapshots.set([]);
    }
  }

  protected async rollback(s: SnapshotSummary): Promise<void> {
    if (this.rolling() !== null) return;
    this.rolling.set(s.seq);
    try {
      await this.snapshotService.rollbackTo(this.workspaceId, s.seq);
      this.toast.show(`Rolled back to snapshot #${s.seq}.`, 'success');
      this.rolledBack.emit(s.seq);
      await this.refresh();
    } catch (err) {
      this.toast.show(
        err instanceof Error ? err.message : 'Rollback failed',
        'error',
      );
    } finally {
      this.rolling.set(null);
    }
  }

  protected timeLabel(at: number): string {
    const diff = Date.now() - at;
    if (diff < 60_000) return 'just now';
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}
