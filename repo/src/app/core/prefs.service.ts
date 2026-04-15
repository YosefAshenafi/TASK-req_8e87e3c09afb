import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs/operators';
import type { ColumnMapping, PersonaRole } from './types';

export interface Prefs {
  theme: 'light' | 'dark' | 'system';
  lastOpenedWorkspaceId?: string;
  activeProfileId?: string;
  personaRole?: PersonaRole;
  privacyMaskingEnabled: boolean;
  lastImportMapping?: Record<string, ColumnMapping>;
}

const DEFAULTS: Prefs = {
  theme: 'system',
  privacyMaskingEnabled: false,
};

const STORAGE_KEY = 'secureroom:prefs';

@Injectable({ providedIn: 'root' })
export class PrefsService {
  private readonly _prefs$ = new BehaviorSubject<Prefs>(this._load());

  get changes$(): Observable<Partial<Prefs>> {
    return this._prefs$.asObservable();
  }

  get<K extends keyof Prefs>(key: K): Prefs[K] | undefined {
    return this._prefs$.value[key];
  }

  set<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
    const next = { ...this._prefs$.value, [key]: value };
    this._prefs$.next(next);
    this._save(next);
  }

  select$<K extends keyof Prefs>(key: K): Observable<Prefs[K] | undefined> {
    return this._prefs$.pipe(
      map(p => p[key]),
      distinctUntilChanged(),
    );
  }

  private _load(): Prefs {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      // localStorage unavailable or corrupt — fall through to defaults
    }
    return { ...DEFAULTS };
  }

  private _save(prefs: Prefs): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Quota exceeded or private mode — ignore
    }
  }
}
