import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ToastService, Toast, ToastType } from './toast.service';

const ICONS: Record<ToastType, string> = {
  info: 'ℹ', success: '✓', warning: '⚠', error: '✕',
};
const COLORS: Record<ToastType, string> = {
  info: '#1e88e5', success: '#43a047', warning: '#f57c00', error: '#e53935',
};

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-wrap" aria-live="assertive" aria-atomic="true">
      @for (t of toasts(); track t.id) {
        <div class="toast" [style.background]="color(t.type)" (click)="dismiss(t.id)" role="alert">
          <span class="toast-icon">{{ icon(t.type) }}</span>
          <span class="toast-msg">{{ t.message }}</span>
          <button class="toast-close" (click)="$event.stopPropagation(); dismiss(t.id)" aria-label="Dismiss">×</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-wrap {
      position: fixed; top: 16px; right: 16px; z-index: 9999;
      display: flex; flex-direction: column; gap: 8px; pointer-events: none;
    }
    .toast {
      min-width: 280px; max-width: 400px;
      padding: 12px 14px; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      display: flex; align-items: center; gap: 10px;
      font-size: 0.875rem; color: #fff; cursor: pointer;
      pointer-events: all; animation: toast-in 0.2s ease;
    }
    .toast-icon { font-size: 1.1rem; flex-shrink: 0; }
    .toast-msg { flex: 1; line-height: 1.4; }
    .toast-close {
      background: none; border: none; color: rgba(255,255,255,0.75);
      cursor: pointer; font-size: 1.2rem; padding: 0 0 0 4px; line-height: 1;
      flex-shrink: 0;
      &:hover { color: #fff; }
    }
    @keyframes toast-in {
      from { transform: translateX(110%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }
  `],
})
export class ToastComponent {
  private readonly toastService = inject(ToastService);
  protected toasts = toSignal(this.toastService.toasts$, { initialValue: [] as Toast[] });
  protected dismiss(id: string): void { this.toastService.dismiss(id); }
  protected icon(t: ToastType): string { return ICONS[t]; }
  protected color(t: ToastType): string { return COLORS[t]; }
}
