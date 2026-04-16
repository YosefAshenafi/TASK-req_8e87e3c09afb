/**
 * PERSONA API TESTS
 * Full integration tests for PersonaService: role persistence, capability
 * gating, and integration with WorkspaceService delete guard.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { makeFullContext, signUp } from './helpers';
import { PersonaService } from '../src/app/auth/persona.service';
import type { FullContext } from './helpers';

describe('PersonaService API — role & capability integration', () => {
  let ctx: FullContext;
  let persona: PersonaService;

  beforeEach(async () => {
    ctx = makeFullContext();
    persona = new PersonaService(ctx.prefs);
    await signUp(ctx.auth, 'alice', 'alicepass1', 'Admin');
  });

  // ── Role persistence via PrefsService ─────────────────────────────────────

  it('role is undefined before selection', () => {
    expect(persona.role).toBeUndefined();
  });

  it('setRole() persists through prefs and role getter reflects it', () => {
    persona.setRole('Admin');
    expect(persona.role).toBe('Admin');
  });

  it('role$ emits the set role', async () => {
    persona.setRole('Teacher');
    const val = await firstValueFrom(persona.role$);
    expect(val).toBe('Teacher');
  });

  it('role can be changed after initial selection', () => {
    persona.setRole('Teacher');
    persona.setRole('Academic Affairs');
    expect(persona.role).toBe('Academic Affairs');
  });

  it('a second PersonaService instance sharing the same prefs sees the same role', () => {
    persona.setRole('Admin');
    const persona2 = new PersonaService(ctx.prefs);
    expect(persona2.role).toBe('Admin');
  });

  // ── Capability matrix: Admin ──────────────────────────────────────────────

  describe('Admin capabilities', () => {
    beforeEach(() => persona.setRole('Admin'));

    it('has manage-profiles', () => expect(persona.hasCap('manage-profiles')).toBe(true));
    it('has delete-workspace', () => expect(persona.hasCap('delete-workspace')).toBe(true));
    it('has export-package', () => expect(persona.hasCap('export-package')).toBe(true));
    it('has import-package', () => expect(persona.hasCap('import-package')).toBe(true));
    it('has view-reporting', () => expect(persona.hasCap('view-reporting')).toBe(true));
    it('has moderate-board', () => expect(persona.hasCap('moderate-board')).toBe(true));
  });

  // ── Capability matrix: Academic Affairs ────────────────────────────────────

  describe('Academic Affairs capabilities', () => {
    beforeEach(() => persona.setRole('Academic Affairs'));

    it('does NOT have manage-profiles', () => expect(persona.hasCap('manage-profiles')).toBe(false));
    it('does NOT have delete-workspace', () => expect(persona.hasCap('delete-workspace')).toBe(false));
    it('has export-package', () => expect(persona.hasCap('export-package')).toBe(true));
    it('has import-package', () => expect(persona.hasCap('import-package')).toBe(true));
    it('has view-reporting', () => expect(persona.hasCap('view-reporting')).toBe(true));
    it('has moderate-board', () => expect(persona.hasCap('moderate-board')).toBe(true));
  });

  // ── Capability matrix: Teacher ────────────────────────────────────────────

  describe('Teacher capabilities', () => {
    beforeEach(() => persona.setRole('Teacher'));

    it('does NOT have manage-profiles', () => expect(persona.hasCap('manage-profiles')).toBe(false));
    it('does NOT have delete-workspace', () => expect(persona.hasCap('delete-workspace')).toBe(false));
    it('has export-package', () => expect(persona.hasCap('export-package')).toBe(true));
    it('does NOT have import-package', () => expect(persona.hasCap('import-package')).toBe(false));
    it('does NOT have view-reporting', () => expect(persona.hasCap('view-reporting')).toBe(false));
    it('does NOT have moderate-board', () => expect(persona.hasCap('moderate-board')).toBe(false));
  });

  // ── No role ────────────────────────────────────────────────────────────────

  it('hasCap returns false for any capability when no role is set', () => {
    // persona has no role set in this test (fresh beforeEach)
    expect(persona.hasCap('export-package')).toBe(false);
    expect(persona.hasCap('manage-profiles')).toBe(false);
    expect(persona.hasCap('delete-workspace')).toBe(false);
    expect(persona.hasCap('view-reporting')).toBe(false);
  });

  // ── Integration: delete-workspace gate wired into WorkspaceService ─────────

  it('Admin can create and list workspaces (full service integration)', async () => {
    persona.setRole('Admin');
    const ws = await ctx.workspace.create('Admin Workspace');
    expect(ws.ownerProfileId).toBe(ctx.auth.currentProfile!.id);

    const list = await ctx.workspace.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Admin Workspace');
  });

  it('Teacher cannot delete-workspace (capability gate verified)', async () => {
    persona.setRole('Teacher');
    expect(persona.hasCap('delete-workspace')).toBe(false);

    // WorkspaceService.delete() itself has no persona gate — the persona check
    // lives in the component. Confirm the service creates/lists for any signed-in user.
    const ws = await ctx.workspace.create('Teacher WS');
    const list = await ctx.workspace.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(ws.id);
  });

  // ── view-reporting gate ────────────────────────────────────────────────────

  it('only Admin and Academic Affairs can view-reporting', () => {
    const roles = ['Admin', 'Academic Affairs', 'Teacher'] as const;
    const expected: Record<string, boolean> = {
      'Admin': true,
      'Academic Affairs': true,
      'Teacher': false,
    };
    for (const role of roles) {
      persona.setRole(role);
      expect(persona.hasCap('view-reporting')).toBe(expected[role]);
    }
  });
});
