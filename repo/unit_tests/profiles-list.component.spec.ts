/**
 * ProfilesListComponent — logic unit tests.
 * Tests component state and method behaviour directly (no Angular TestBed rendering).
 * Services are injected as real instances with real IndexedDB (fake-indexeddb).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Router } from '@angular/router';
import { DbService } from '../src/app/core/db.service';
import { PrefsService } from '../src/app/core/prefs.service';
import { AuthService } from '../src/app/auth/auth.service';
import { ProfilesListComponent } from '../src/app/auth/pages/profiles-list.component';
import type { ProfileSummary } from '../src/app/auth/profile.model';

function makeRouter(): Router {
  return { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router;
}

function makeComponent() {
  const db = new DbService();
  const prefs = new PrefsService();
  const auth = new AuthService(db, prefs);
  const router = makeRouter();
  const component = new ProfilesListComponent(auth, router);
  return { component, auth, router, db, prefs };
}

describe('ProfilesListComponent', () => {
  // ── ngOnInit ───────────────────────────────────────────────────────────────

  describe('ngOnInit()', () => {
    it('populates profiles signal with existing profiles from DB', async () => {
      const { component, auth } = makeComponent();

      await auth.createProfile({ username: 'alice', password: 'pass1234', role: 'Admin' });
      await auth.createProfile({ username: 'bob', password: 'pass1234', role: 'Teacher' });

      await component.ngOnInit();

      const profiles = (component as unknown as { profiles: () => ProfileSummary[] }).profiles();
      expect(profiles).toHaveLength(2);
      const usernames = profiles.map(p => p.username);
      expect(usernames).toContain('alice');
      expect(usernames).toContain('bob');
    });

    it('profiles signal is empty when no profiles exist', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();

      const profiles = (component as unknown as { profiles: () => ProfileSummary[] }).profiles();
      expect(profiles).toEqual([]);
    });
  });

  // ── isLockedOut ────────────────────────────────────────────────────────────

  describe('isLockedOut()', () => {
    it('returns false when lockoutUntil is null', () => {
      const { component } = makeComponent();
      const comp = component as unknown as {
        isLockedOut: (p: ProfileSummary) => boolean;
      };
      const profile: ProfileSummary = { id: '1', username: 'alice', role: 'Admin', lockoutUntil: null };
      expect(comp.isLockedOut(profile)).toBe(false);
    });

    it('returns true when lockoutUntil is in the future', () => {
      const { component } = makeComponent();
      const comp = component as unknown as {
        isLockedOut: (p: ProfileSummary) => boolean;
      };
      const profile: ProfileSummary = {
        id: '1', username: 'alice', role: 'Admin',
        lockoutUntil: Date.now() + 60_000,
      };
      expect(comp.isLockedOut(profile)).toBe(true);
    });

    it('returns false when lockoutUntil is in the past', () => {
      const { component } = makeComponent();
      const comp = component as unknown as {
        isLockedOut: (p: ProfileSummary) => boolean;
      };
      const profile: ProfileSummary = {
        id: '1', username: 'alice', role: 'Admin',
        lockoutUntil: Date.now() - 1000,
      };
      expect(comp.isLockedOut(profile)).toBe(false);
    });
  });

  // ── lockoutMinutes ────────────────────────────────────────────────────────

  describe('lockoutMinutes()', () => {
    it('returns 0 when lockoutUntil is null', () => {
      const { component } = makeComponent();
      const comp = component as unknown as {
        lockoutMinutes: (p: ProfileSummary) => number;
      };
      const profile: ProfileSummary = { id: '1', username: 'alice', role: 'Admin', lockoutUntil: null };
      expect(comp.lockoutMinutes(profile)).toBe(0);
    });

    it('returns ceiling of remaining minutes when locked', () => {
      const { component } = makeComponent();
      const comp = component as unknown as {
        lockoutMinutes: (p: ProfileSummary) => number;
      };
      const profile: ProfileSummary = {
        id: '1', username: 'alice', role: 'Admin',
        lockoutUntil: Date.now() + 90_000, // 1.5 minutes → ceil = 2
      };
      expect(comp.lockoutMinutes(profile)).toBe(2);
    });

    it('returns 1 for less than 1 minute remaining', () => {
      const { component } = makeComponent();
      const comp = component as unknown as {
        lockoutMinutes: (p: ProfileSummary) => number;
      };
      const profile: ProfileSummary = {
        id: '1', username: 'alice', role: 'Admin',
        lockoutUntil: Date.now() + 30_000, // 30 seconds → ceil = 1
      };
      expect(comp.lockoutMinutes(profile)).toBe(1);
    });
  });

  // ── selectProfile ──────────────────────────────────────────────────────────

  describe('selectProfile()', () => {
    it('navigates to /sign-in/:id for an unlocked profile', () => {
      const { component, router } = makeComponent();
      const comp = component as unknown as {
        selectProfile: (p: ProfileSummary) => void;
      };
      const profile: ProfileSummary = { id: 'abc-123', username: 'alice', role: 'Admin', lockoutUntil: null };
      comp.selectProfile(profile);
      expect(router.navigate).toHaveBeenCalledWith(['/sign-in', 'abc-123']);
    });

    it('does NOT navigate when the profile is locked out', () => {
      const { component, router } = makeComponent();
      const comp = component as unknown as {
        selectProfile: (p: ProfileSummary) => void;
      };
      const profile: ProfileSummary = {
        id: 'locked', username: 'dave', role: 'Teacher',
        lockoutUntil: Date.now() + 300_000,
      };
      comp.selectProfile(profile);
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });
});
