import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type ToastType = 'info' | 'success' | 'warning' | 'error';
export interface Toast { id: string; type: ToastType; message: string; }

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts$ = new BehaviorSubject<Toast[]>([]);
  get toasts$(): Observable<Toast[]> { return this._toasts$.asObservable(); }

  show(message: string, type: ToastType = 'info', durationMs = 4000): string {
    const id = Math.random().toString(36).slice(2);
    this._toasts$.next([...this._toasts$.value, { id, type, message }]);
    if (durationMs > 0) setTimeout(() => this.dismiss(id), durationMs);
    return id;
  }

  dismiss(id: string): void {
    this._toasts$.next(this._toasts$.value.filter(t => t.id !== id));
  }

  clear(): void { this._toasts$.next([]); }
}
