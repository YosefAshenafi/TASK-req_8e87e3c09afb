/**
 * SignInComponent — logic unit tests.
 * Tests sign-in flow, lockout state, and error message generation.
 * No Angular TestBed — tests component class methods and signals directly.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Router, ActivatedRoute } from '@angular/router';
import { DbService } from '../src/app/core/db.service';
import { PrefsService } from '../src/app/core/prefs.service';
import { AuthService } from '../src/app/auth/auth.service';
import { SignInComponent } from '../src/app/auth/pages/sign-in.component';

function makeRouter(): Router {
  return { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router;
}

function makeRoute(profileId: string): ActivatedRoute {
  return {
    snapshot: { paramMap: { get: vi.fn().mockReturnValue(profileId) } },
  } as unknown as ActivatedRoute;
}

async function setup() {
  const db = new DbService();
  const prefs = new PrefsService();
  const auth = new AuthService(db, prefs);
  const profile = await auth.createProfile({ username: 'alice', password: 'correctpass1', role: 'Admin' });
  const router = makeRouter();
  const route = makeRoute(profile.id);
  const component = new SignInComponent(auth, route, router);
  return { component, auth, router, profile };
}

describe('SignInComponent', () => {
  // ── ngOnInit ───────────────────────────────────────────────────────────────

  describe('ngOnInit()', () => {
    it('sets username signal from the profile matching the route profileId', async () => {
      const { component } = await setup();
      await component.ngOnInit();
      const comp = component as unknown as { username: () => string };
      expect(comp.username()).toBe('alice');
    });

    it('navigates to /profiles when profileId does not match any profile', async () => {
      const db = new DbService();
      const prefs = new PrefsService();
      const auth = new AuthService(db, prefs);
      const router = makeRouter();
      const route = makeRoute('nonexistent-id');
      const component = new SignInComponent(auth, route, router);

      await component.ngOnInit();
      expect(router.navigate).toHaveBeenCalledWith(['/profiles']);
    });

    it('sets lockedUntil signal when the profile is currently locked', async () => {
      const db = new DbService();
      const prefs = new PrefsService();
      const auth = new AuthService(db, prefs);
      const profile = await auth.createProfile({ username: 'lockme', password: 'pass12345', role: 'Teacher' });

      // Manually set the lockout in DB
      const idb = await db.open();
      const futureTime = Date.now() + 300_000;
      await idb.put('profiles', { ...profile, lockoutUntil: futureTime });

      const router = makeRouter();
      const route = makeRoute(profile.id);
      const component = new SignInComponent(auth, route, router);

      await component.ngOnInit();
      const comp = component as unknown as { lockedUntil: () => number | null };
      expect(comp.lockedUntil()).toBeGreaterThan(Date.now());
    });

    it('does not set lockedUntil when profile is not locked', async () => {
      const { component } = await setup();
      await component.ngOnInit();
      const comp = component as unknown as { lockedUntil: () => number | null };
      expect(comp.lockedUntil()).toBeNull();
    });
  });

  // ── submit() — success ─────────────────────────────────────────────────────

  describe('submit() — successful sign-in', () => {
    it('navigates to /persona on correct credentials', async () => {
      const { component, router } = await setup();
      await component.ngOnInit();
      (component as unknown as { password: string }).password = 'correctpass1';

      await component.submit();
      expect(router.navigate).toHaveBeenCalledWith(['/persona']);
    });

    it('clears loading signal after successful submit', async () => {
      const { component, router } = await setup();
      await component.ngOnInit();
      (component as unknown as { password: string }).password = 'correctpass1';

      await component.submit();
      const comp = component as unknown as { loading: () => boolean };
      expect(comp.loading()).toBe(false);
    });

    it('clears error signal before attempting sign-in', async () => {
      const { component } = await setup();
      await component.ngOnInit();
      const comp = component as unknown as {
        error: { set: (v: string | null) => void; (): string | null };
        password: string;
      };
      comp.error.set('previous error');
      comp.password = 'correctpass1';

      await component.submit();
      expect(comp.error()).toBeNull();
    });
  });

  // ── submit() — wrong password ──────────────────────────────────────────────

  describe('submit() — wrong password', () => {
    it('sets an error message containing attempt count for wrong password', async () => {
      const { component } = await setup();
      await component.ngOnInit();
      (component as unknown as { password: string }).password = 'wrongpassword!';

      await component.submit();

      const comp = component as unknown as { error: () => string | null };
      const errorMsg = comp.error();
      expect(errorMsg).not.toBeNull();
      expect(errorMsg).toMatch(/attempt/i);
    });

    it('does NOT navigate on wrong password', async () => {
      const { component, router } = await setup();
      await component.ngOnInit();
      (component as unknown as { password: string }).password = 'wrongpassword!';

      await component.submit();
      expect(router.navigate).not.toHaveBeenCalledWith(['/persona']);
    });

    it('clears loading after failed submit', async () => {
      const { component } = await setup();
      await component.ngOnInit();
      (component as unknown as { password: string }).password = 'wrongpassword!';

      await component.submit();
      const comp = component as unknown as { loading: () => boolean };
      expect(comp.loading()).toBe(false);
    });
  });

  // ── submit() — lockout ────────────────────────────────────────────────────

  describe('submit() — lockout after MAX_FAILED_ATTEMPTS', () => {
    it('sets lockedUntil signal when account becomes locked', async () => {
      const { component } = await setup();
      await component.ngOnInit();

      // Exhaust all attempts except last
      for (let i = 0; i < 2; i++) {
        (component as unknown as { password: string }).password = 'wrong';
        await component.submit();
      }

      // Final attempt triggers lockout
      (component as unknown as { password: string }).password = 'wrong';
      await component.submit();

      const comp = component as unknown as { lockedUntil: () => number | null };
      expect(comp.lockedUntil()).not.toBeNull();
      expect(comp.lockedUntil()!).toBeGreaterThan(Date.now());
    });
  });

  // ── lockoutMinutesLeft ────────────────────────────────────────────────────

  describe('lockoutMinutesLeft computed signal', () => {
    it('returns 0 when lockedUntil is null', async () => {
      const { component } = await setup();
      await component.ngOnInit();
      const comp = component as unknown as { lockoutMinutesLeft: () => number };
      expect(comp.lockoutMinutesLeft()).toBe(0);
    });

    it('returns ceiling of remaining minutes when locked', async () => {
      const { component } = await setup();
      await component.ngOnInit();
      const comp = component as unknown as {
        lockedUntil: { set: (v: number | null) => void };
        lockoutMinutesLeft: () => number;
      };
      comp.lockedUntil.set(Date.now() + 90_000); // 1.5 min → ceil = 2
      expect(comp.lockoutMinutesLeft()).toBe(2);
    });
  });
});
