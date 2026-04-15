import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PlatformService {
  /** Evaluated at access time so tests can install `showSaveFilePicker` before export(). */
  get hasShowSaveFilePicker(): boolean {
    if (typeof window === 'undefined') return false;
    const filePickerWindow = window as Window & {
      showSaveFilePicker?: unknown;
    };
    return typeof filePickerWindow.showSaveFilePicker === 'function';
  }

  get hasBroadcastChannel(): boolean {
    return typeof window !== 'undefined' && 'BroadcastChannel' in window;
  }

  get hasServiceWorker(): boolean {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  }

  get hasIndexedDB(): boolean {
    return typeof window !== 'undefined' && 'indexedDB' in window;
  }

  get hasSubtleCrypto(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof crypto !== 'undefined' &&
      'subtle' in crypto
    );
  }

  get hasFileSystemAccess(): boolean {
    return this.hasShowSaveFilePicker;
  }
}
