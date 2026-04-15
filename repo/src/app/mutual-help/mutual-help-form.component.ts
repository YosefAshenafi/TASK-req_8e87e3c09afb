import {
  Component,
  Input,
  Output,
  EventEmitter,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MutualHelpService } from './mutual-help.service';
import { ToastService } from '../core/toast.service';
import { AttachmentService, MAX_ATTACHMENT_BYTES } from '../core/attachment.service';
import type { NewPostInput } from '../core/types';

interface PostForm {
  type: 'request' | 'offer';
  category: string;
  title: string;
  description: string;
  tagsInput: string;
  timeWindow: string;
  budget: string;
  urgency: 'low' | 'medium' | 'high';
  expiresIn: number;
  action: 'draft' | 'publish';
}

@Component({
  selector: 'app-mutual-help-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-overlay" (click)="onOverlayClick($event)">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="form-title">
        <div class="modal-header">
          <h3 id="form-title" class="modal-title">New Post</h3>
          <button class="close-btn" (click)="cancelled.emit()" aria-label="Close">×</button>
        </div>

        <form class="post-form" (ngSubmit)="submit()" novalidate>

          @if (errorMsg()) {
            <div class="form-error" role="alert">{{ errorMsg() }}</div>
          }

          <div class="form-grid-2col">
            <!-- Type -->
            <div class="form-group">
              <label class="form-label">Type <span class="req">*</span></label>
              <div class="radio-group">
                <label class="radio-label">
                  <input type="radio" name="type" value="request" [(ngModel)]="form.type" />
                  Request
                </label>
                <label class="radio-label">
                  <input type="radio" name="type" value="offer" [(ngModel)]="form.type" />
                  Offer
                </label>
              </div>
            </div>

            <!-- Urgency -->
            <div class="form-group">
              <label class="form-label" for="urgency">Urgency <span class="req">*</span></label>
              <select id="urgency" class="form-control" [(ngModel)]="form.urgency" name="urgency">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <!-- Category -->
          <div class="form-group">
            <label class="form-label" for="category">Category <span class="req">*</span></label>
            <input
              id="category"
              class="form-control"
              type="text"
              [(ngModel)]="form.category"
              name="category"
              placeholder="e.g. Transportation, Childcare, Tutoring"
            />
          </div>

          <!-- Title -->
          <div class="form-group">
            <label class="form-label" for="title">Title <span class="req">*</span></label>
            <input
              id="title"
              class="form-control"
              type="text"
              [(ngModel)]="form.title"
              name="title"
              maxlength="100"
              placeholder="Brief summary of your request or offer"
            />
            <span class="char-hint">{{ form.title.length }}/100</span>
          </div>

          <!-- Description -->
          <div class="form-group">
            <label class="form-label" for="description">Description <span class="req">*</span></label>
            <textarea
              id="description"
              class="form-control form-textarea"
              [(ngModel)]="form.description"
              name="description"
              maxlength="500"
              placeholder="Describe what you need or what you're offering..."
            ></textarea>
            <span class="char-hint">{{ form.description.length }}/500</span>
          </div>

          <!-- Tags -->
          <div class="form-group">
            <label class="form-label" for="tagsInput">Tags</label>
            <input
              id="tagsInput"
              class="form-control"
              type="text"
              [(ngModel)]="form.tagsInput"
              name="tagsInput"
              placeholder="Comma-separated, e.g. urgent, weekends, remote"
            />
            <span class="field-hint">Separate tags with commas</span>
          </div>

          <div class="form-grid-2col">
            <!-- Time Window -->
            <div class="form-group">
              <label class="form-label" for="timeWindow">Time Window</label>
              <input
                id="timeWindow"
                class="form-control"
                type="text"
                [(ngModel)]="form.timeWindow"
                name="timeWindow"
                placeholder="e.g. Weekday mornings"
              />
            </div>

            <!-- Budget -->
            <div class="form-group">
              <label class="form-label" for="budget">Budget</label>
              <input
                id="budget"
                class="form-control"
                type="text"
                [(ngModel)]="form.budget"
                name="budget"
                placeholder="e.g. $20/hr or Free"
              />
            </div>
          </div>

          <!-- Expires In -->
          <div class="form-group">
            <label class="form-label" for="expiresIn">Expires In (hours)</label>
            <input
              id="expiresIn"
              class="form-control expires-input"
              type="number"
              [(ngModel)]="form.expiresIn"
              name="expiresIn"
              min="1"
              max="8760"
            />
          </div>

          <!-- Attachments -->
          <div class="form-group">
            <label class="form-label">Attachments <span class="field-hint">(max 20 MB each)</span></label>
            <input
              type="file"
              multiple
              class="file-input"
              (change)="onFilesSelected($event)"
              aria-label="Add attachments"
            />
            @if (attachmentFiles().length > 0) {
              <ul class="file-list">
                @for (f of attachmentFiles(); track f.name; let i = $index) {
                  <li class="file-item">
                    <span class="file-name">{{ f.name }}</span>
                    <span class="file-size">({{ (f.size / 1024 / 1024).toFixed(1) }} MB)</span>
                    <button type="button" class="file-remove" (click)="removeFile(i)" aria-label="Remove file">×</button>
                  </li>
                }
              </ul>
            }
          </div>

          <div class="form-actions">
            <button
              type="button"
              class="btn btn-secondary"
              (click)="cancelled.emit()"
              [disabled]="submitting()"
            >Cancel</button>
            <button
              type="submit"
              class="btn btn-outline"
              (click)="form.action = 'draft'"
              [disabled]="submitting()"
            >{{ submitting() && form.action === 'draft' ? 'Saving…' : 'Save Draft' }}</button>
            <button
              type="submit"
              class="btn btn-primary"
              (click)="form.action = 'publish'"
              [disabled]="submitting()"
            >{{ submitting() && form.action === 'publish' ? 'Publishing…' : 'Publish Now' }}</button>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:500; }
    .modal-card { background:#fff; border-radius:12px; max-width:520px; width:90%; max-height:85vh; overflow-y:auto; padding:24px; box-sizing:border-box; }
    .modal-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
    .modal-title { font-size:1.1rem; font-weight:700; margin:0; }
    .close-btn { background:none; border:none; font-size:1.5rem; cursor:pointer; color:#888; padding:0; line-height:1; }
    .close-btn:hover { color:#333; }
    .post-form { display:flex; flex-direction:column; gap:14px; }
    .form-error { background:#ffebee; color:#c62828; border:1px solid #ffcdd2; border-radius:8px; padding:10px 14px; font-size:0.84rem; }
    .form-grid-2col { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .form-group { display:flex; flex-direction:column; gap:4px; }
    .form-label { font-size:0.82rem; font-weight:600; color:#444; }
    .req { color:#e53935; margin-left:2px; }
    .form-control { border:1px solid #ddd; border-radius:8px; padding:8px 12px; font-size:0.86rem; font-family:inherit; outline:none; box-sizing:border-box; width:100%; }
    .form-control:focus { border-color:#1e88e5; box-shadow:0 0 0 2px rgba(30,136,229,0.15); }
    .form-textarea { resize:vertical; min-height:90px; }
    .char-hint { font-size:0.68rem; color:#aaa; text-align:right; }
    .field-hint { font-size:0.68rem; color:#aaa; }
    .radio-group { display:flex; gap:16px; padding:8px 0; }
    .radio-label { display:flex; align-items:center; gap:6px; font-size:0.86rem; cursor:pointer; }
    .expires-input { max-width:140px; }
    .file-input { font-size:0.82rem; }
    .file-list { list-style:none; padding:0; margin:4px 0 0; display:flex; flex-direction:column; gap:4px; }
    .file-item { display:flex; align-items:center; gap:8px; font-size:0.8rem; background:#f5f5f5; border-radius:6px; padding:4px 10px; }
    .file-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .file-size { color:#aaa; white-space:nowrap; }
    .file-remove { background:none; border:none; color:#e53935; font-size:1rem; cursor:pointer; padding:0 2px; line-height:1; flex-shrink:0; }
    .form-actions { display:flex; gap:8px; justify-content:flex-end; padding-top:6px; border-top:1px solid #f0f0f0; flex-wrap:wrap; }
    .btn { padding:8px 18px; border-radius:8px; cursor:pointer; font-size:0.86rem; font-weight:600; border:none; }
    .btn:disabled { opacity:0.5; cursor:not-allowed; }
    .btn-secondary { background:#f5f5f5; color:#555; border:1px solid #ddd; }
    .btn-secondary:hover:not(:disabled) { background:#eeeeee; }
    .btn-outline { background:#fff; color:#1565c0; border:1px solid #1e88e5; }
    .btn-outline:hover:not(:disabled) { background:#e3f0fd; }
    .btn-primary { background:#1e88e5; color:#fff; }
    .btn-primary:hover:not(:disabled) { background:#1565c0; }
  `],
})
export class MutualHelpFormComponent {
  @Input() workspaceId = '';
  @Input() profileId = '';
  @Output() saved = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  protected form: PostForm = {
    type: 'request',
    category: '',
    title: '',
    description: '',
    tagsInput: '',
    timeWindow: '',
    budget: '',
    urgency: 'medium',
    expiresIn: 72,
    action: 'draft',
  };

  protected readonly submitting = signal(false);
  protected readonly errorMsg = signal('');
  protected readonly attachmentFiles = signal<File[]>([]);
  protected readonly maxFileMb = MAX_ATTACHMENT_BYTES / 1024 / 1024;

  constructor(
    private readonly mutualHelpService: MutualHelpService,
    private readonly toastService: ToastService,
    private readonly attachmentService: AttachmentService,
  ) {}

  protected onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    const tooBig: string[] = [];
    const valid: File[] = [];
    for (const f of Array.from(input.files)) {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        tooBig.push(`${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        valid.push(f);
      }
    }
    if (tooBig.length) {
      this.errorMsg.set(`Files exceed 20 MB limit and were skipped: ${tooBig.join(', ')}`);
    }
    this.attachmentFiles.update(prev => [...prev, ...valid]);
    input.value = '';
  }

  protected removeFile(index: number): void {
    this.attachmentFiles.update(prev => prev.filter((_, i) => i !== index));
  }

  protected onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.cancelled.emit();
    }
  }

  protected async submit(): Promise<void> {
    // Validate required fields
    if (!this.form.category.trim()) {
      this.errorMsg.set('Category is required.');
      return;
    }
    if (!this.form.title.trim()) {
      this.errorMsg.set('Title is required.');
      return;
    }
    if (!this.form.description.trim()) {
      this.errorMsg.set('Description is required.');
      return;
    }

    this.errorMsg.set('');
    this.submitting.set(true);

    try {
      const tags = this.form.tagsInput
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      // Upload attachments (20 MB limit already enforced in onFilesSelected)
      const attachmentIds: string[] = [];
      for (const file of this.attachmentFiles()) {
        const id = await this.attachmentService.upload(file, this.workspaceId);
        attachmentIds.push(id);
      }

      const input: NewPostInput = {
        workspaceId: this.workspaceId,
        type: this.form.type,
        category: this.form.category.trim(),
        title: this.form.title.trim(),
        description: this.form.description.trim(),
        tags,
        timeWindow: this.form.timeWindow.trim() || undefined,
        budget: this.form.budget.trim() || undefined,
        urgency: this.form.urgency,
        attachmentIds,
        expiresIn: this.form.expiresIn * 60 * 60 * 1000,
      };

      const post = await this.mutualHelpService.createDraft(input);

      if (this.form.action === 'publish') {
        await this.mutualHelpService.publish(post.id);
      }

      this.toastService.show('Post created!', 'success');
      this.saved.emit();
    } catch {
      this.errorMsg.set('Failed to save post. Please try again.');
    } finally {
      this.submitting.set(false);
    }
  }
}
