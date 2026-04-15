import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PlatformService {
  readonly hasShowSaveFilePicker: boolean =
    typeof window !== 'undefined' && 'showSaveFilePicker' in window;

  readonly hasBroadcastChannel: boolean =
    typeof window !== 'undefined' && 'BroadcastChannel' in window;

  readonly hasServiceWorker: boolean =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

  readonly hasIndexedDB: boolean =
    typeof window !== 'undefined' && 'indexedDB' in window;

  readonly hasSubtleCrypto: boolean =
    typeof window !== 'undefined' &&
    typeof crypto !== 'undefined' &&
    'subtle' in crypto;

  readonly hasFileSystemAccess: boolean = this.hasShowSaveFilePicker;
}
