/**
 * Global test setup — runs once per test file (via setupFiles in vitest.config.ts).
 * Provides: WebCrypto, BroadcastChannel, IndexedDB, localStorage, URL stubs, Worker stub.
 * Each test gets a fresh in-memory IndexedDB via the global beforeEach.
 */
import 'fake-indexeddb/auto';
import '@angular/compiler';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { vi, beforeEach, afterEach } from 'vitest';

// ─── Cross-realm TypedArray fix ───────────────────────────────────────────────
// jsdom runs in an isolated vm.Context where Uint8Array/ArrayBuffer constructors
// are different from Node.js's native realm. Node.js's WebCrypto (used for PBKDF2)
// checks `instanceof ArrayBuffer` using its own realm's constructor, so typed arrays
// created with jsdom's constructors are rejected.
// Fix: replace the vm-context Uint8Array/ArrayBuffer with Node.js's native ones.
// Buffer (from node:buffer) always extends Node's native Uint8Array, giving us
// a reliable handle into Node's realm regardless of what jsdom has patched.
{
  const NodeUint8Array = Object.getPrototypeOf(Buffer.prototype).constructor as typeof Uint8Array;
  const NodeArrayBuffer = new NodeUint8Array(0).buffer.constructor as typeof ArrayBuffer;

  if ((globalThis as unknown as Record<string, unknown>).Uint8Array !== NodeUint8Array) {
    Object.defineProperty(globalThis, 'Uint8Array', {
      value: NodeUint8Array, writable: true, configurable: true,
    });
  }
  if ((globalThis as unknown as Record<string, unknown>).ArrayBuffer !== NodeArrayBuffer) {
    Object.defineProperty(globalThis, 'ArrayBuffer', {
      value: NodeArrayBuffer, writable: true, configurable: true,
    });
  }
}

// ─── Web Crypto API ──────────────────────────────────────────────────────────
// Always use Node.js's webcrypto so it shares the same realm as the patched types above.
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true,
});

// ─── BroadcastChannel (in-process pub/sub for tests) ─────────────────────────
const _bcChannels = new Map<string, Set<{ onmessage: ((ev: MessageEvent) => void) | null }>>();

class TestBroadcastChannel {
  name: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    if (!_bcChannels.has(name)) _bcChannels.set(name, new Set());
    _bcChannels.get(name)!.add(this);
  }

  postMessage(data: unknown): void {
    _bcChannels.get(this.name)?.forEach(ch => {
      if (ch !== this && ch.onmessage) {
        ch.onmessage(new MessageEvent('message', { data }));
      }
    });
  }

  close(): void {
    _bcChannels.get(this.name)?.delete(this);
  }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return false; }
}

(global as unknown as Record<string, unknown>).BroadcastChannel = TestBroadcastChannel;

// ─── URL stubs (jsdom may not support createObjectURL) ────────────────────────
if (typeof URL !== 'undefined') {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  } else {
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn();
  } else {
    URL.revokeObjectURL = vi.fn();
  }
}

// ─── window.confirm stub ─────────────────────────────────────────────────────
(global as unknown as Record<string, unknown>).confirm = vi.fn(() => true);

// ─── Worker stub (TelemetryService uses Web Workers) ─────────────────────────
(global as unknown as Record<string, unknown>).Worker = class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  postMessage(_data: unknown) {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return false; }
};

// ─── document.visibilityState (MutualHelpService timer check) ────────────────
if (typeof document !== 'undefined' && !Object.getOwnPropertyDescriptor(document, 'visibilityState')?.get) {
  Object.defineProperty(document, 'visibilityState', {
    get: () => 'visible',
    configurable: true,
  });
}

// ─── Per-test isolation ───────────────────────────────────────────────────────
beforeEach(() => {
  // Fresh in-memory IndexedDB for each test
  (global as unknown as Record<string, unknown>).indexedDB = new IDBFactory();
  // Reset BroadcastChannel registry
  _bcChannels.clear();
  // Clear localStorage
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
});

afterEach(() => {
  vi.clearAllMocks();
});
