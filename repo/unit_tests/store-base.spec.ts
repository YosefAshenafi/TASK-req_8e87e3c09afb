/**
 * StoreBase unit tests.
 * StoreBase is abstract; we create a minimal concrete subclass to exercise
 * all its methods: snapshot, select$, setState, and patchState.
 */
import { describe, it, expect } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { StoreBase } from '../src/app/core/store-base';

interface TestState {
  count: number;
  label: string;
  active: boolean;
}

/** Concrete subclass that exposes protected methods for white-box testing. */
class TestStore extends StoreBase<TestState> {
  constructor(initial?: Partial<TestState>) {
    super({ count: 0, label: 'init', active: false, ...initial });
  }

  // Expose protected helpers as public for tests
  public setPublic(state: TestState): void {
    this.setState(state);
  }

  public patchPublic(patch: Partial<TestState>): void {
    this.patchState(patch);
  }
}

describe('StoreBase', () => {
  it('initialises with the provided state', () => {
    const store = new TestStore({ count: 5, label: 'hello' });
    expect(store.snapshot.count).toBe(5);
    expect(store.snapshot.label).toBe('hello');
  });

  // ── snapshot ──────────────────────────────────────────────────────────────

  it('snapshot returns the current state synchronously', () => {
    const store = new TestStore();
    expect(store.snapshot).toEqual({ count: 0, label: 'init', active: false });
  });

  it('snapshot reflects mutations from setState', () => {
    const store = new TestStore();
    store.setPublic({ count: 10, label: 'updated', active: true });
    expect(store.snapshot).toEqual({ count: 10, label: 'updated', active: true });
  });

  it('snapshot reflects partial mutations from patchState', () => {
    const store = new TestStore({ count: 3 });
    store.patchPublic({ count: 7 });
    expect(store.snapshot.count).toBe(7);
    expect(store.snapshot.label).toBe('init'); // unchanged
  });

  // ── setState ──────────────────────────────────────────────────────────────

  it('setState replaces the entire state', () => {
    const store = new TestStore({ count: 1, label: 'old', active: true });
    store.setPublic({ count: 99, label: 'new', active: false });
    expect(store.snapshot).toEqual({ count: 99, label: 'new', active: false });
  });

  it('setState emits the new state via select$', async () => {
    const store = new TestStore();
    store.setPublic({ count: 42, label: 'x', active: true });
    const count = await firstValueFrom(store.select$(s => s.count));
    expect(count).toBe(42);
  });

  // ── patchState ────────────────────────────────────────────────────────────

  it('patchState merges partial update, preserves other fields', () => {
    const store = new TestStore({ count: 1, label: 'alpha', active: false });
    store.patchPublic({ label: 'beta' });
    expect(store.snapshot).toEqual({ count: 1, label: 'beta', active: false });
  });

  it('patchState with an empty object leaves state unchanged', () => {
    const store = new TestStore({ count: 5 });
    store.patchPublic({});
    expect(store.snapshot.count).toBe(5);
  });

  it('patchState multiple times accumulates correctly', () => {
    const store = new TestStore();
    store.patchPublic({ count: 1 });
    store.patchPublic({ count: 2 });
    store.patchPublic({ label: 'done' });
    expect(store.snapshot.count).toBe(2);
    expect(store.snapshot.label).toBe('done');
  });

  // ── select$ ───────────────────────────────────────────────────────────────

  it('select$ emits the current value immediately', async () => {
    const store = new TestStore({ count: 77 });
    const val = await firstValueFrom(store.select$(s => s.count));
    expect(val).toBe(77);
  });

  it('select$ emits on state changes', async () => {
    const store = new TestStore({ count: 0 });
    const emissions = store.select$(s => s.count).pipe(take(3), toArray());
    const promise = firstValueFrom(emissions);

    store.patchPublic({ count: 1 });
    store.patchPublic({ count: 2 });

    const values = await promise;
    expect(values).toEqual([0, 1, 2]);
  });

  it('select$ is distinctUntilChanged — does not re-emit same value', async () => {
    const store = new TestStore({ label: 'same' });
    const emissions = store.select$(s => s.label).pipe(take(2), toArray());
    const promise = firstValueFrom(emissions);

    store.patchPublic({ label: 'same' }); // duplicate — should not emit
    store.patchPublic({ label: 'different' }); // new value — emits

    const values = await promise;
    expect(values).toEqual(['same', 'different']); // only 2 emissions
  });

  it('select$ with a derived/computed selector', async () => {
    const store = new TestStore({ count: 10 });
    const doubled = await firstValueFrom(store.select$(s => s.count * 2));
    expect(doubled).toBe(20);
  });
});
