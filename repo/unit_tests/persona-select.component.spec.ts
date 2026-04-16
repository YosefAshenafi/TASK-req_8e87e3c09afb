/**
 * PersonaSelectComponent — logic unit tests.
 * Pure constructor injection; no Angular TestBed required.
 * Tests role descriptions, selectRole navigation, and role list completeness.
 */
import { describe, it, expect, vi } from 'vitest';
import { Router } from '@angular/router';
import { DbService } from '../src/app/core/db.service';
import { PrefsService } from '../src/app/core/prefs.service';
import { AuthService } from '../src/app/auth/auth.service';
import { PersonaService } from '../src/app/auth/persona.service';
import { PersonaSelectComponent } from '../src/app/auth/pages/persona-select.component';
import type { PersonaRole } from '../src/app/core/types';

function makeRouter(): Router {
  return { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router;
}

function makeComponent() {
  const db = new DbService();
  const prefs = new PrefsService();
  const auth = new AuthService(db, prefs);
  const persona = new PersonaService(prefs);
  const router = makeRouter();
  const component = new PersonaSelectComponent(auth, persona, router);
  return { component, auth, persona, router, prefs };
}

// Cast to expose protected members in tests
type Exposed = {
  roles: PersonaRole[];
  description: (role: PersonaRole) => string;
  selectRole: (role: PersonaRole) => void;
};

describe('PersonaSelectComponent', () => {
  // ── roles array ────────────────────────────────────────────────────────────

  describe('roles', () => {
    it('exposes exactly the three supported roles', () => {
      const { component } = makeComponent();
      const exposed = component as unknown as Exposed;
      expect(exposed.roles).toEqual(['Admin', 'Academic Affairs', 'Teacher']);
    });

    it('contains Admin', () => {
      const { component } = makeComponent();
      expect((component as unknown as Exposed).roles).toContain('Admin');
    });

    it('contains Academic Affairs', () => {
      const { component } = makeComponent();
      expect((component as unknown as Exposed).roles).toContain('Academic Affairs');
    });

    it('contains Teacher', () => {
      const { component } = makeComponent();
      expect((component as unknown as Exposed).roles).toContain('Teacher');
    });
  });

  // ── description() ─────────────────────────────────────────────────────────

  describe('description()', () => {
    it('returns a non-empty description for Admin', () => {
      const { component } = makeComponent();
      const desc = (component as unknown as Exposed).description('Admin');
      expect(desc.length).toBeGreaterThan(0);
      expect(desc.toLowerCase()).toContain('full');
    });

    it('returns a non-empty description for Academic Affairs', () => {
      const { component } = makeComponent();
      const desc = (component as unknown as Exposed).description('Academic Affairs');
      expect(desc.length).toBeGreaterThan(0);
      expect(desc.toLowerCase()).toContain('moderate');
    });

    it('returns a non-empty description for Teacher', () => {
      const { component } = makeComponent();
      const desc = (component as unknown as Exposed).description('Teacher');
      expect(desc.length).toBeGreaterThan(0);
      expect(desc.toLowerCase()).toContain('create');
    });

    it('returns different descriptions for each role', () => {
      const { component } = makeComponent();
      const exposed = component as unknown as Exposed;
      const descriptions = exposed.roles.map(r => exposed.description(r));
      const unique = new Set(descriptions);
      expect(unique.size).toBe(3);
    });
  });

  // ── selectRole() ──────────────────────────────────────────────────────────

  describe('selectRole()', () => {
    it('sets the persona role via PersonaService', () => {
      const { component, persona } = makeComponent();
      expect(persona.role).toBeUndefined();

      (component as unknown as Exposed).selectRole('Admin');

      expect(persona.role).toBe('Admin');
    });

    it('sets Academic Affairs role correctly', () => {
      const { component, persona } = makeComponent();
      (component as unknown as Exposed).selectRole('Academic Affairs');
      expect(persona.role).toBe('Academic Affairs');
    });

    it('sets Teacher role correctly', () => {
      const { component, persona } = makeComponent();
      (component as unknown as Exposed).selectRole('Teacher');
      expect(persona.role).toBe('Teacher');
    });

    it('navigates to /workspaces after role selection', () => {
      const { component, router } = makeComponent();
      (component as unknown as Exposed).selectRole('Admin');
      expect(router.navigate).toHaveBeenCalledWith(['/workspaces']);
    });

    it('navigates to /workspaces regardless of which role is selected', () => {
      for (const role of ['Admin', 'Academic Affairs', 'Teacher'] as PersonaRole[]) {
        const { component, router } = makeComponent();
        (component as unknown as Exposed).selectRole(role);
        expect(router.navigate).toHaveBeenCalledWith(['/workspaces']);
      }
    });

    it('navigates exactly once per call', () => {
      const { component, router } = makeComponent();
      (component as unknown as Exposed).selectRole('Teacher');
      expect(router.navigate).toHaveBeenCalledTimes(1);
    });

    it('overwrites role on repeated calls', () => {
      const { component, persona } = makeComponent();
      const exposed = component as unknown as Exposed;
      exposed.selectRole('Teacher');
      exposed.selectRole('Admin');
      expect(persona.role).toBe('Admin');
    });
  });

  // ── auth exposure ──────────────────────────────────────────────────────────

  describe('auth reference', () => {
    it('exposes the AuthService instance on the component', () => {
      const { component, auth } = makeComponent();
      // Template accesses auth.currentProfile — verify the reference is the same instance
      expect((component as unknown as { auth: AuthService }).auth).toBe(auth);
    });
  });
});
