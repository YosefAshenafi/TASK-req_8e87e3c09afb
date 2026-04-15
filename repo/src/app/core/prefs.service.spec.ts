import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { PrefsService } from './prefs.service';

describe('PrefsService', () => {
  let service: PrefsService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(PrefsService);
  });

  it('returns undefined for unset optional keys', () => {
    expect(service.get('lastOpenedWorkspaceId')).toBeUndefined();
  });

  it('returns default value for theme', () => {
    expect(service.get('theme')).toBe('system');
  });

  it('round-trips a set value', () => {
    service.set('theme', 'dark');
    expect(service.get('theme')).toBe('dark');
  });

  it('emits on changes$', async () => {
    const promise = firstValueFrom(
      service.changes$.pipe(filter(p => p.theme === 'light')),
    );
    service.set('theme', 'light');
    const prefs = await promise;
    expect(prefs.theme).toBe('light');
  });

  it('persists across service recreation', () => {
    service.set('theme', 'dark');
    const service2 = new PrefsService();
    expect(service2.get('theme')).toBe('dark');
  });
});
