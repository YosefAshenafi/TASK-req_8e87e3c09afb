import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ConflictChoice } from './package.service';

/**
 * 3-way import-conflict dialog (H-03).
 *
 * Renders Overwrite / Create Copy / Cancel — the choice is emitted to the parent
 * which resolves the matching promise held by `PackageService.import(file, resolver)`.
 */
@Component({
  selector: 'app-package-import-conflict-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="conflict-backdrop" role="dialog" aria-modal="true" aria-label="Import conflict">
      <div class="conflict-card">
        <h3>Workspace already exists</h3>
        <p>
          A workspace named <strong>"{{ existingName }}"</strong> already exists locally.
          How would you like to continue?
        </p>
        <div class="conflict-actions">
          <button class="btn-danger" (click)="decide.emit('overwrite')">
            Overwrite existing
          </button>
          <button class="btn-primary" (click)="decide.emit('copy')">
            Create copy
          </button>
          <button class="btn-ghost" (click)="decide.emit('cancel')">
            Cancel
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .conflict-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.42);
      display: flex; align-items: center; justify-content: center;
      z-index: 2000;
    }
    .conflict-card {
      background: #fff; border-radius: 10px; padding: 22px 24px;
      max-width: 440px; box-shadow: 0 10px 30px rgba(0,0,0,0.18);
    }
    .conflict-card h3 { margin: 0 0 8px 0; font-size: 1.05rem; }
    .conflict-card p  { font-size: 0.88rem; color: #444; margin: 0 0 16px 0; line-height: 1.5; }
    .conflict-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    .conflict-actions button {
      border: 1px solid #ddd; background: #fff; color: #333;
      border-radius: 6px; padding: 7px 14px; font-size: 0.84rem; font-weight: 600;
      cursor: pointer;
    }
    .conflict-actions .btn-primary { background: #1e88e5; color: #fff; border-color: #1e88e5; }
    .conflict-actions .btn-danger  { background: #e53935; color: #fff; border-color: #e53935; }
    .conflict-actions .btn-ghost   { background: #f5f5f5; }
  `],
})
export class PackageImportConflictDialogComponent {
  @Input() existingName = '';
  @Output() decide = new EventEmitter<ConflictChoice>();
}
