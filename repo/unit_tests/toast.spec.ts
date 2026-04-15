/**
 * ToastService unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../src/app/core/toast.service';

describe('ToastService', () => {
  let svc: ToastService;

  beforeEach(() => {
    svc = new ToastService();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with an empty toast list', async () => {
    const toasts = await firstValueFrom(svc.toasts$);
    expect(toasts).toHaveLength(0);
  });

  it('show() adds a toast to the list', async () => {
    svc.show('Hello world');
    const toasts = await firstValueFrom(svc.toasts$);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Hello world');
    expect(toasts[0].type).toBe('info'); // default type
  });

  it('show() returns an id string', () => {
    const id = svc.show('Test');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('show() with explicit type sets correct type', async () => {
    svc.show('Danger!', 'error');
    const toasts = await firstValueFrom(svc.toasts$);
    expect(toasts[0].type).toBe('error');
  });

  it('show() supports all toast types', async () => {
    for (const type of ['info', 'success', 'warning', 'error'] as const) {
      const s = new ToastService();
      s.show('msg', type);
      const t = await firstValueFrom(s.toasts$);
      expect(t[0].type).toBe(type);
    }
  });

  it('multiple show() calls stack toasts', async () => {
    svc.show('A');
    svc.show('B');
    svc.show('C');
    const toasts = await firstValueFrom(svc.toasts$);
    expect(toasts).toHaveLength(3);
  });

  it('dismiss() removes the targeted toast', async () => {
    const id = svc.show('To dismiss');
    svc.show('Keep me');
    svc.dismiss(id);

    const toasts = await firstValueFrom(svc.toasts$);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Keep me');
  });

  it('dismiss() with unknown id is a no-op', async () => {
    svc.show('A');
    svc.dismiss('no-such-id');
    const toasts = await firstValueFrom(svc.toasts$);
    expect(toasts).toHaveLength(1);
  });

  it('clear() removes all toasts', async () => {
    svc.show('A');
    svc.show('B');
    svc.clear();
    const toasts = await firstValueFrom(svc.toasts$);
    expect(toasts).toHaveLength(0);
  });

  it('toast auto-dismisses after duration', async () => {
    svc.show('Auto dismiss', 'info', 2000);

    let toasts = await firstValueFrom(svc.toasts$);
    expect(toasts).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2001);

    toasts = await firstValueFrom(svc.toasts$);
    expect(toasts).toHaveLength(0);
  });

  it('toast with durationMs=0 never auto-dismisses', async () => {
    svc.show('Sticky', 'warning', 0);
    await vi.advanceTimersByTimeAsync(60_000);
    const toasts = await firstValueFrom(svc.toasts$);
    expect(toasts).toHaveLength(1);
  });

  it('each toast has a unique id', () => {
    const id1 = svc.show('A');
    const id2 = svc.show('B');
    expect(id1).not.toBe(id2);
  });
});
