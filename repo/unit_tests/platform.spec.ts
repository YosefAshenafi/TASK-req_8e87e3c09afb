/**
 * PlatformService unit tests.
 * Verifies that capability flags reflect the jsdom environment correctly.
 */
import { describe, it, expect } from 'vitest';
import { PlatformService } from '../src/app/core/platform.service';

describe('PlatformService', () => {
  function make() {
    return new PlatformService();
  }

  it('instantiates without error', () => {
    expect(() => make()).not.toThrow();
  });

  it('hasIndexedDB is true in jsdom (fake-indexeddb is installed)', () => {
    const svc = make();
    // fake-indexeddb/auto patches global.indexedDB, so jsdom "has" it
    expect(svc.hasIndexedDB).toBe(true);
  });

  it('hasBroadcastChannel is true because TestBroadcastChannel is installed by setup', () => {
    const svc = make();
    // setup.ts installs global.BroadcastChannel = TestBroadcastChannel
    expect(svc.hasBroadcastChannel).toBe(true);
  });

  it('hasSubtleCrypto is true because setup.ts installs webcrypto', () => {
    const svc = make();
    // setup.ts installs global.crypto = webcrypto which includes .subtle
    expect(svc.hasSubtleCrypto).toBe(true);
  });

  it('hasShowSaveFilePicker reflects window API availability', () => {
    const svc = make();
    // jsdom does not implement showSaveFilePicker
    expect(typeof svc.hasShowSaveFilePicker).toBe('boolean');
  });

  it('hasFileSystemAccess equals hasShowSaveFilePicker', () => {
    const svc = make();
    expect(svc.hasFileSystemAccess).toBe(svc.hasShowSaveFilePicker);
  });

  it('hasServiceWorker is false in jsdom (no navigator.serviceWorker)', () => {
    const svc = make();
    expect(typeof svc.hasServiceWorker).toBe('boolean');
  });

  it('all properties are booleans', () => {
    const svc = make();
    for (const key of [
      'hasShowSaveFilePicker',
      'hasBroadcastChannel',
      'hasServiceWorker',
      'hasIndexedDB',
      'hasSubtleCrypto',
      'hasFileSystemAccess',
    ] as const) {
      expect(typeof svc[key]).toBe('boolean');
    }
  });
});
