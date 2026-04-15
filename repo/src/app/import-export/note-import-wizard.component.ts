import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  signal,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NoteImportService } from './note-import.service';
import { ToastService } from '../core/toast.service';
import { PrefsService } from '../core/prefs.service';
import { AuthService } from '../auth/auth.service';
import type { ColumnMapping, ImportRow, ImportRowError } from '../core/types';

type Step = 'pick' | 'map' | 'review' | 'done';

/**
 * Bulk note import wizard (H-02).
 *
 * Flow: upload CSV/JSON → map columns → validate / show error table → commit to canvas.
 * Uses `NoteImportService` for parsing, validation, and commit.
 */
@Component({
  selector: 'app-note-import-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="wizard-backdrop" role="dialog" aria-modal="true" aria-label="Bulk note import">
      <div class="wizard-card">
        <header class="wizard-header">
          <h3>Import notes</h3>
          <button class="close-btn" aria-label="Close" (click)="cancel()">×</button>
        </header>

        <!-- Step 1: pick file -->
        @if (step() === 'pick') {
          <div class="wizard-body">
            <p class="wizard-hint">
              Upload a CSV or JSON file with up to 1000 rows. Each row becomes a sticky note
              (text must be ≤ 80 characters).
            </p>
            <label class="file-drop">
              <input
                type="file"
                accept=".csv,.json,text/csv,application/json"
                (change)="onFileSelected($event)"
                aria-label="Select notes file"
              />
              <span>Click to pick a CSV / JSON file</span>
            </label>
            @if (parseError()) {
              <div class="error-banner">{{ parseError() }}</div>
            }
          </div>
        }

        <!-- Step 2: map columns -->
        @if (step() === 'map') {
          <div class="wizard-body">
            <p class="wizard-hint">
              Map the columns in your file to note fields. "Text" is required.
              Detected {{ rawRows().length }} row{{ rawRows().length === 1 ? '' : 's' }}.
            </p>

            <div class="mapping-grid">
              <label>
                <span>Text *</span>
                <select [(ngModel)]="mapText" aria-label="Text column">
                  <option value="">— choose —</option>
                  @for (col of columns(); track col) {
                    <option [value]="col">{{ col }}</option>
                  }
                </select>
              </label>
              <label>
                <span>Color</span>
                <select [(ngModel)]="mapColor" aria-label="Color column">
                  <option value="">(none)</option>
                  @for (col of columns(); track col) {
                    <option [value]="col">{{ col }}</option>
                  }
                </select>
              </label>
              <label>
                <span>Tags</span>
                <select [(ngModel)]="mapTags" aria-label="Tags column">
                  <option value="">(none)</option>
                  @for (col of columns(); track col) {
                    <option [value]="col">{{ col }}</option>
                  }
                </select>
              </label>
              <label>
                <span>Author</span>
                <select [(ngModel)]="mapAuthor" aria-label="Author column">
                  <option value="">(none)</option>
                  @for (col of columns(); track col) {
                    <option [value]="col">{{ col }}</option>
                  }
                </select>
              </label>
            </div>

            <div class="wizard-actions">
              <button class="btn-ghost" (click)="cancel()">Cancel</button>
              <button
                class="btn-primary"
                [disabled]="!mapText"
                (click)="validate()"
              >Validate</button>
            </div>
          </div>
        }

        <!-- Step 3: review / error table -->
        @if (step() === 'review') {
          <div class="wizard-body">
            <p class="wizard-hint">
              {{ validRows().length }} valid · {{ errors().length }} with error{{ errors().length === 1 ? '' : 's' }}.
              Only valid rows will be imported.
            </p>

            @if (errors().length > 0) {
              <div class="error-table-wrap">
                <table class="error-table">
                  <thead>
                    <tr><th>Row</th><th>Reasons</th><th>Preview</th></tr>
                  </thead>
                  <tbody>
                    @for (err of errors().slice(0, 50); track err.rowIndex) {
                      <tr>
                        <td>{{ err.rowIndex + 1 }}</td>
                        <td>{{ err.reasons.join(', ') }}</td>
                        <td class="preview-cell">{{ rawPreview(err) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
                @if (errors().length > 50) {
                  <p class="truncate-hint">
                    Showing first 50 of {{ errors().length }} errors.
                  </p>
                }
              </div>
            }

            <div class="wizard-actions">
              <button class="btn-ghost" (click)="step.set('map')">Back</button>
              <button
                class="btn-primary"
                [disabled]="validRows().length === 0 || committing()"
                (click)="commit()"
              >
                {{ committing() ? 'Importing…' : 'Import ' + validRows().length + ' note' + (validRows().length === 1 ? '' : 's') }}
              </button>
            </div>
          </div>
        }

        <!-- Step 4: done -->
        @if (step() === 'done') {
          <div class="wizard-body wizard-done">
            <div class="done-check">✓</div>
            <p>Imported {{ committedCount() }} note{{ committedCount() === 1 ? '' : 's' }}.</p>
            <div class="wizard-actions">
              <button class="btn-primary" (click)="closed.emit()">Close</button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .wizard-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.42);
      display: flex; align-items: center; justify-content: center; z-index: 2000;
    }
    .wizard-card {
      background: #fff; border-radius: 10px; width: 520px; max-width: 90vw;
      max-height: 80vh; display: flex; flex-direction: column;
      box-shadow: 0 10px 30px rgba(0,0,0,0.18);
    }
    .wizard-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 20px; border-bottom: 1px solid #eee;
    }
    .wizard-header h3 { margin: 0; font-size: 1.05rem; }
    .close-btn {
      background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #999;
      padding: 0; width: 28px; height: 28px;
    }
    .wizard-body { padding: 18px 20px; overflow-y: auto; }
    .wizard-hint { font-size: 0.85rem; color: #555; margin: 0 0 14px 0; line-height: 1.5; }
    .file-drop {
      display: block; border: 2px dashed #c2cbd6; border-radius: 8px; padding: 24px;
      text-align: center; color: #7a8899; cursor: pointer; font-size: 0.88rem;
    }
    .file-drop input[type="file"] { display: block; margin: 0 auto 8px; }
    .error-banner {
      margin-top: 12px; background: #ffebee; color: #c62828;
      padding: 9px 12px; border-radius: 6px; font-size: 0.82rem;
    }
    .mapping-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px 18px; margin-bottom: 16px;
    }
    .mapping-grid label { display: flex; flex-direction: column; gap: 5px; font-size: 0.78rem; color: #444; font-weight: 600; }
    .mapping-grid select {
      padding: 6px 8px; font-size: 0.84rem; border: 1px solid #d7dde5;
      border-radius: 5px; background: #fff;
    }
    .error-table-wrap { max-height: 220px; overflow-y: auto; border: 1px solid #eee; border-radius: 6px; margin-bottom: 12px; }
    .error-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
    .error-table th, .error-table td { padding: 6px 9px; text-align: left; border-bottom: 1px solid #f2f2f2; }
    .error-table th { background: #fafafa; color: #555; font-weight: 600; }
    .preview-cell { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #777; }
    .truncate-hint { font-size: 0.72rem; color: #999; margin: 8px 0 0 4px; }
    .wizard-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    .wizard-actions button {
      border: 1px solid #ddd; background: #fff; color: #333;
      padding: 7px 16px; border-radius: 6px; font-size: 0.84rem; font-weight: 600; cursor: pointer;
    }
    .wizard-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
    .wizard-actions .btn-primary { background: #1e88e5; color: #fff; border-color: #1e88e5; }
    .wizard-actions .btn-ghost   { background: #f5f5f5; }
    .wizard-done { text-align: center; }
    .done-check {
      width: 48px; height: 48px; border-radius: 50%; background: #43a047; color: #fff;
      display: flex; align-items: center; justify-content: center; font-size: 1.4rem;
      margin: 6px auto 12px;
    }
  `],
})
export class NoteImportWizardComponent implements OnInit {
  @Input() workspaceId = '';
  @Output() closed = new EventEmitter<void>();
  @Output() imported = new EventEmitter<number>();

  protected readonly step = signal<Step>('pick');
  protected readonly rawRows = signal<Record<string, string>[]>([]);
  protected readonly validRows = signal<ImportRow[]>([]);
  protected readonly errors = signal<ImportRowError[]>([]);
  protected readonly parseError = signal<string | null>(null);
  protected readonly committing = signal(false);
  protected readonly committedCount = signal(0);

  protected readonly columns = computed(() => {
    const rows = this.rawRows();
    return rows.length === 0 ? [] : Object.keys(rows[0]);
  });

  protected mapText = '';
  protected mapColor = '';
  protected mapTags = '';
  protected mapAuthor = '';

  private readonly importer = inject(NoteImportService);
  private readonly toast = inject(ToastService);
  private readonly prefs = inject(PrefsService);
  private readonly auth = inject(AuthService);

  ngOnInit(): void {
    // Restore last-used mapping for this workspace, if any.
    const saved = this.prefs.get('lastImportMapping');
    const mapping = saved?.[this.workspaceId];
    if (mapping) {
      this.mapText   = mapping.text   ?? '';
      this.mapColor  = mapping.color  ?? '';
      this.mapTags   = mapping.tags   ?? '';
      this.mapAuthor = mapping.author ?? '';
    }
  }

  protected async onFileSelected(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.parseError.set(null);
    try {
      const rows = await this.importer.parseFile(file);
      if (rows.length === 0) {
        this.parseError.set('File has no rows.');
        return;
      }
      this.rawRows.set(rows);
      // Auto-select "text"-like column on first load if nothing restored.
      if (!this.mapText) {
        const guess = this.columns().find(c => /^(text|body|note|content)$/i.test(c));
        if (guess) this.mapText = guess;
      }
      this.step.set('map');
    } catch (err) {
      this.parseError.set(err instanceof Error ? err.message : 'Could not parse file');
    }
  }

  protected validate(): void {
    if (!this.mapText) return;
    const mapping: ColumnMapping = {
      text: this.mapText,
      color: this.mapColor || undefined,
      tags: this.mapTags || undefined,
      author: this.mapAuthor || undefined,
    };
    const knownAuthors = this.auth.currentProfile?.username
      ? [this.auth.currentProfile.username]
      : [];
    const { valid, errors } = this.importer.validate(this.rawRows(), mapping, knownAuthors);
    this.validRows.set(valid);
    this.errors.set(errors);

    // Persist the mapping for next time.
    const saved = { ...(this.prefs.get('lastImportMapping') ?? {}) };
    saved[this.workspaceId] = mapping;
    this.prefs.set('lastImportMapping', saved);

    this.step.set('review');
  }

  protected async commit(): Promise<void> {
    if (this.validRows().length === 0 || this.committing()) return;
    this.committing.set(true);
    try {
      const result = await this.importer.commit(this.workspaceId, this.validRows());
      this.committedCount.set(result.committed);
      this.imported.emit(result.committed);
      this.toast.show(
        `Imported ${result.committed} note${result.committed === 1 ? '' : 's'}`,
        'success',
      );
      this.step.set('done');
    } catch (err) {
      this.toast.show(err instanceof Error ? err.message : 'Import failed', 'error');
    } finally {
      this.committing.set(false);
    }
  }

  protected cancel(): void {
    this.closed.emit();
  }

  protected rawPreview(err: ImportRowError): string {
    const text = err.rawValues[this.mapText];
    if (text) return text.length > 40 ? text.slice(0, 40) + '…' : text;
    return Object.values(err.rawValues).slice(0, 2).join(' · ');
  }
}
