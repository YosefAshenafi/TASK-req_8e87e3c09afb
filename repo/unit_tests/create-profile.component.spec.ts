/**
 * CreateProfileComponent — logic unit tests.
 * Tests form submission, error handling, and navigation.
 * No Angular TestBed — tests component class methods and signals directly.
 */
import { describe, it, expect, vi } from 'vitest';
import { Router } from '@angular/router';
import { DbService } from '../src/app/core/db.service';
import { PrefsService } from '../src/app/core/prefs.service';
import { AuthService } from '../src/app/auth/auth.service';
import { CreateProfileComponent } from '../src/app/auth/pages/create-profile.component';

function makeRouter(): Router {
  return { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router;
}

function makeComponent() {
  const db = new DbService();
  const prefs = new PrefsService();
  const auth = new AuthService(db, prefs);
  const router = makeRouter();
  const component = new CreateProfileComponent(auth, router);
  return { component, auth, router };
}

describe('CreateProfileComponent', () => {
  // ── submit() — success ─────────────────────────────────────────────────────

  describe('submit() — success', () => {
    it('navigates to /profiles after successful profile creation', async () => {
      const { component, router } = makeComponent();
      const comp = component as unknown as {
        username: string;
        password: string;
        role: string;
        submit: () => Promise<void>;
      };
      comp.username = 'newuser';
      comp.password = 'securepass1';
      comp.role = 'Admin';

      await comp.submit();
      expect(router.navigate).toHaveBeenCalledWith(['/profiles']);
    });

    it('clears error signal on successful submission', async () => {
      const { component } = makeComponent();
      const comp = component as unknown as {
        username: string;
        password: string;
        role: string;
        error: { set: (v: string | null) => void; (): string | null };
        submit: () => Promise<void>;
      };
      comp.error.set('previous error');
      comp.username = 'cleanuser';
      comp.password = 'securepass2';
      comp.role = 'Teacher';

      await comp.submit();
      expect(comp.error()).toBeNull();
    });

    it('clears loading signal after successful submission', async () => {
      const { component } = makeComponent();
      const comp = component as unknown as {
        username: string;
        password: string;
        role: string;
        loading: () => boolean;
        submit: () => Promise<void>;
      };
      comp.username = 'loadcheck';
      comp.password = 'securepass3';
      comp.role = 'Academic Affairs';

      await comp.submit();
      expect(comp.loading()).toBe(false);
    });
  });

  // ── submit() — validation errors ──────────────────────────────────────────

  describe('submit() — validation failure', () => {
    it('sets error signal when password is too short', async () => {
      const { component } = makeComponent();
      const comp = component as unknown as {
        username: string;
        password: string;
        role: string;
        error: () => string | null;
        submit: () => Promise<void>;
      };
      comp.username = 'shortpass';
      comp.password = 'abc'; // too short (< 8 chars)
      comp.role = 'Teacher';

      await comp.submit();
      expect(comp.error()).not.toBeNull();
    });

    it('sets error signal on duplicate username', async () => {
      const { component, auth } = makeComponent();

      // Pre-create the user
      await auth.createProfile({ username: 'existing', password: 'pass1234', role: 'Admin' });

      const comp = component as unknown as {
        username: string;
        password: string;
        role: string;
        error: () => string | null;
        submit: () => Promise<void>;
      };
      comp.username = 'existing';
      comp.password = 'pass1234';
      comp.role = 'Teacher';

      await comp.submit();
      expect(comp.error()).not.toBeNull();
    });

    it('does NOT navigate when submission fails', async () => {
      const { component, router } = makeComponent();
      const comp = component as unknown as {
        username: string;
        password: string;
        role: string;
        submit: () => Promise<void>;
      };
      comp.username = 'failuser';
      comp.password = 'short'; // will fail validation
      comp.role = 'Teacher';

      await comp.submit();
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('clears loading signal even after a failure', async () => {
      const { component } = makeComponent();
      const comp = component as unknown as {
        username: string;
        password: string;
        role: string;
        loading: () => boolean;
        submit: () => Promise<void>;
      };
      comp.username = 'failload';
      comp.password = 'short';
      comp.role = 'Teacher';

      await comp.submit();
      expect(comp.loading()).toBe(false);
    });
  });

  // ── Default state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('error signal starts null', () => {
      const { component } = makeComponent();
      const comp = component as unknown as { error: () => string | null };
      expect(comp.error()).toBeNull();
    });

    it('loading signal starts false', () => {
      const { component } = makeComponent();
      const comp = component as unknown as { loading: () => boolean };
      expect(comp.loading()).toBe(false);
    });

    it('default role is Teacher', () => {
      const { component } = makeComponent();
      const comp = component as unknown as { role: string };
      expect(comp.role).toBe('Teacher');
    });
  });

  // ── All three roles ────────────────────────────────────────────────────────

  describe('all three roles can be created', () => {
    it.each(['Admin', 'Academic Affairs', 'Teacher'] as const)(
      'creates profile with role %s and navigates to /profiles',
      async (role) => {
        const { component, router } = makeComponent();
        const comp = component as unknown as {
          username: string;
          password: string;
          role: string;
          submit: () => Promise<void>;
        };
        comp.username = `user-${role.toLowerCase().replace(/ /g, '-')}`;
        comp.password = 'securepass9';
        comp.role = role;

        await comp.submit();
        expect(router.navigate).toHaveBeenCalledWith(['/profiles']);
      },
    );
  });
});
