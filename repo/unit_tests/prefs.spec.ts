import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { PrefsService } from '../src/app/core/prefs.service';

describe('PrefsService', () => {
  let service: PrefsService;

  beforeEach(() => {
    service = new PrefsService();
  });

  describe('get()', () => {
    it('returns undefined for unset optional key', () => {
      expect(service.get('lastOpenedWorkspaceId')).toBeUndefined();
    });

    it('returns default theme (system)', () => {
      expect(service.get('theme')).toBe('system');
    });

    it('returns default privacyMaskingEnabled (false)', () => {
      expect(service.get('privacyMaskingEnabled')).toBe(false);
    });
  });

  describe('set()', () => {
    it('stores and retrieves a value', () => {
      service.set('theme', 'dark');
      expect(service.get('theme')).toBe('dark');
    });

    it('overwrites a previous value', () => {
      service.set('theme', 'dark');
      service.set('theme', 'light');
      expect(service.get('theme')).toBe('light');
    });

    it('stores optional string values', () => {
      service.set('lastOpenedWorkspaceId', 'ws-123');
      expect(service.get('lastOpenedWorkspaceId')).toBe('ws-123');
    });

    it('stores persona role', () => {
      service.set('personaRole', 'Teacher');
      expect(service.get('personaRole')).toBe('Teacher');
    });

    it('stores activeProfileId', () => {
      service.set('activeProfileId', 'profile-xyz');
      expect(service.get('activeProfileId')).toBe('profile-xyz');
    });

    it('clears activeProfileId when set to undefined', () => {
      service.set('activeProfileId', 'profile-xyz');
      service.set('activeProfileId', undefined);
      expect(service.get('activeProfileId')).toBeUndefined();
    });
  });

  describe('changes$()', () => {
    it('emits when a value is set', async () => {
      const promise = firstValueFrom(
        service.changes$.pipe(filter(p => p.theme === 'light')),
      );
      service.set('theme', 'light');
      const prefs = await promise;
      expect(prefs.theme).toBe('light');
    });

    it('includes the full prefs object on each emission', async () => {
      service.set('theme', 'dark');
      const promise = firstValueFrom(
        service.changes$.pipe(filter(p => p.privacyMaskingEnabled === true)),
      );
      service.set('privacyMaskingEnabled', true);
      const prefs = await promise;
      expect(prefs.theme).toBe('dark');
      expect(prefs.privacyMaskingEnabled).toBe(true);
    });
  });

  describe('select$()', () => {
    it('emits the current value on subscription', async () => {
      service.set('theme', 'dark');
      const value = await firstValueFrom(service.select$('theme'));
      expect(value).toBe('dark');
    });

    it('emits only distinct values', async () => {
      const emissions: string[] = [];
      const sub = service.select$('theme').subscribe(v => {
        if (v) emissions.push(v);
      });
      service.set('theme', 'dark');
      service.set('theme', 'dark'); // duplicate — should not emit again
      service.set('theme', 'light');
      sub.unsubscribe();
      expect(emissions).toEqual(['system', 'dark', 'light']);
    });
  });

  describe('persistence', () => {
    it('persists values across service instances', () => {
      service.set('theme', 'dark');
      const service2 = new PrefsService();
      expect(service2.get('theme')).toBe('dark');
    });

    it('merges stored values with defaults', () => {
      service.set('theme', 'dark');
      const service2 = new PrefsService();
      // privacyMaskingEnabled should still be its default
      expect(service2.get('privacyMaskingEnabled')).toBe(false);
    });
  });
});
