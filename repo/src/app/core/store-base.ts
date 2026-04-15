import { BehaviorSubject, Observable } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs/operators';

/**
 * Generic RxJS BehaviorSubject store with selector and dispatch helpers.
 * Services extend this and add IndexedDB write-through in their dispatch methods.
 */
export abstract class StoreBase<S> {
  protected readonly state$: BehaviorSubject<S>;

  constructor(initialState: S) {
    this.state$ = new BehaviorSubject<S>(initialState);
  }

  get snapshot(): S {
    return this.state$.value;
  }

  select$<R>(selector: (state: S) => R): Observable<R> {
    return this.state$.pipe(map(selector), distinctUntilChanged());
  }

  protected setState(next: S): void {
    this.state$.next(next);
  }

  protected patchState(patch: Partial<S>): void {
    this.state$.next({ ...this.state$.value, ...patch });
  }
}
