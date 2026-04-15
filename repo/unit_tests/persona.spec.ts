/**
 * PersonaService unit tests.
 * Tests role management and capability checks.
 */
import { describe, it, expect } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { PrefsService } from '../src/app/core/prefs.service';
import { PersonaService } from '../src/app/auth/persona.service';

function makePersona() {
  const prefs = new PrefsService();
  const persona = new PersonaService(prefs);
  return persona;
}

describe('PersonaService', () => {
  it('role is undefined before setting', () => {
    const persona = makePersona();
    expect(persona.role).toBeUndefined();
  });

  it('setRole() stores the role and role getter returns it', () => {
    const persona = makePersona();
    persona.setRole('Admin');
    expect(persona.role).toBe('Admin');
  });

  it('setRole() can be changed', () => {
    const persona = makePersona();
    persona.setRole('Teacher');
    persona.setRole('Academic Affairs');
    expect(persona.role).toBe('Academic Affairs');
  });

  it('role$ emits undefined initially', async () => {
    const persona = makePersona();
    const val = await firstValueFrom(persona.role$);
    expect(val).toBeUndefined();
  });

  it('role$ emits the role after setRole()', async () => {
    const persona = makePersona();
    persona.setRole('Teacher');
    const val = await firstValueFrom(persona.role$);
    expect(val).toBe('Teacher');
  });

  // ── hasCap — Admin ────────────────────────────────────────────────────────

  it('Admin has all capabilities', () => {
    const persona = makePersona();
    persona.setRole('Admin');
    for (const cap of [
      'manage-profiles',
      'delete-workspace',
      'export-package',
      'import-package',
      'view-reporting',
      'moderate-board',
    ] as const) {
      expect(persona.hasCap(cap)).toBe(true);
    }
  });

  // ── hasCap — Academic Affairs ─────────────────────────────────────────────

  it('Academic Affairs has export, import, view-reporting, moderate-board', () => {
    const persona = makePersona();
    persona.setRole('Academic Affairs');
    expect(persona.hasCap('export-package')).toBe(true);
    expect(persona.hasCap('import-package')).toBe(true);
    expect(persona.hasCap('view-reporting')).toBe(true);
    expect(persona.hasCap('moderate-board')).toBe(true);
  });

  it('Academic Affairs does NOT have manage-profiles or delete-workspace', () => {
    const persona = makePersona();
    persona.setRole('Academic Affairs');
    expect(persona.hasCap('manage-profiles')).toBe(false);
    expect(persona.hasCap('delete-workspace')).toBe(false);
  });

  // ── hasCap — Teacher ──────────────────────────────────────────────────────

  it('Teacher only has export-package', () => {
    const persona = makePersona();
    persona.setRole('Teacher');
    expect(persona.hasCap('export-package')).toBe(true);
    expect(persona.hasCap('import-package')).toBe(false);
    expect(persona.hasCap('manage-profiles')).toBe(false);
    expect(persona.hasCap('delete-workspace')).toBe(false);
    expect(persona.hasCap('view-reporting')).toBe(false);
    expect(persona.hasCap('moderate-board')).toBe(false);
  });

  // ── hasCap — no role ──────────────────────────────────────────────────────

  it('hasCap returns false when no role is set', () => {
    const persona = makePersona();
    expect(persona.hasCap('export-package')).toBe(false);
    expect(persona.hasCap('manage-profiles')).toBe(false);
  });
});
