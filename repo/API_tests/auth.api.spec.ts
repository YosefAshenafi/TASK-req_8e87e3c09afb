/**
 * AUTH API TESTS
 * Real end-to-end tests using actual IndexedDB (fake-indexeddb) and
 * actual PBKDF2 hashing. No mocking of service methods.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeFullContext, signUp } from './helpers';
import { MAX_FAILED_ATTEMPTS, SEVEN_DAYS_MS } from '../src/app/auth/profile.model';
import type { FullContext } from './helpers';

describe('Auth API — full lifecycle', () => {
  let ctx: FullContext;

  beforeEach(() => {
    ctx = makeFullContext();
  });

  // ── Registration flow ──────────────────────────────────────────────────────

  it('registers a new profile and retrieves it in the list', async () => {
    const profile = await ctx.auth.createProfile({
      username: 'alice',
      password: 'securepass1',
      role: 'Admin',
    });

    const list = await ctx.auth.listProfiles();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(profile.id);
    expect(list[0].username).toBe('alice');
    expect(list[0].role).toBe('Admin');
  });

  it('registers multiple profiles with different roles', async () => {
    await ctx.auth.createProfile({ username: 'admin1', password: 'pass1234', role: 'Admin' });
    await ctx.auth.createProfile({ username: 'teacher1', password: 'pass1234', role: 'Teacher' });
    await ctx.auth.createProfile({ username: 'academic1', password: 'pass1234', role: 'Academic Affairs' });

    const list = await ctx.auth.listProfiles();
    expect(list).toHaveLength(3);
    expect(list.map(p => p.role)).toContain('Admin');
    expect(list.map(p => p.role)).toContain('Teacher');
    expect(list.map(p => p.role)).toContain('Academic Affairs');
  });

  it('rejects profile creation when password is too short', async () => {
    await expect(
      ctx.auth.createProfile({ username: 'tiny-pass', password: 'short', role: 'Admin' }),
    ).rejects.toSatisfy(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.error?.code === 'Validation' && e.error?.field === 'password',
    );
  });

  it('rejects duplicate usernames', async () => {
    await ctx.auth.createProfile({ username: 'alice', password: 'securepass1', role: 'Admin' });

    await expect(
      ctx.auth.createProfile({ username: 'alice', password: 'anotherpass1', role: 'Teacher' }),
    ).rejects.toSatisfy(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.error?.code === 'Validation' && e.error?.field === 'username',
    );
  });

  // ── Sign-in flow ───────────────────────────────────────────────────────────

  it('complete sign-up → sign-in → verify session flow', async () => {
    const profile = await ctx.auth.createProfile({
      username: 'alice',
      password: 'securepass1',
      role: 'Admin',
    });

    const result = await ctx.auth.signIn('alice', 'securepass1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.id).toBe(profile.id);
    }

    // Session is stored in prefs
    expect(ctx.prefs.get('activeProfileId')).toBe(profile.id);
    expect(ctx.auth.currentProfile?.username).toBe('alice');
  });

  it('sign-in fails for non-existent user and never exposes internal details', async () => {
    const result = await ctx.auth.signIn('nobody', 'anything');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('BadCredentials');
    }
  });

  it('sign-in fails with wrong password — increments failedAttempts', async () => {
    await ctx.auth.createProfile({ username: 'alice', password: 'correct1', role: 'Admin' });

    const r1 = await ctx.auth.signIn('alice', 'wrong1');
    expect(r1.ok).toBe(false);
    if (!r1.ok && r1.reason === 'BadCredentials') {
      expect(r1.attemptsRemaining).toBe(2);
    }

    const r2 = await ctx.auth.signIn('alice', 'wrong2');
    if (!r2.ok && r2.reason === 'BadCredentials') {
      expect(r2.attemptsRemaining).toBe(1);
    }
  });

  // ── Lockout flow ───────────────────────────────────────────────────────────

  it('lockout flow: 3 wrong attempts → locked → correct password rejected', async () => {
    await ctx.auth.createProfile({ username: 'alice', password: 'correct1', role: 'Admin' });

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await ctx.auth.signIn('alice', 'wrong');
    }

    // Even correct password is rejected while locked
    const locked = await ctx.auth.signIn('alice', 'correct1');
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.reason).toBe('LockedOut');
      if (locked.reason === 'LockedOut') {
        expect(locked.until).toBeGreaterThan(Date.now());
      }
    }

    // The profile in DB shows lockoutUntil set
    const profiles = await ctx.auth.listProfiles();
    expect(profiles[0].lockoutUntil).toBeGreaterThan(Date.now());
  });

  // ── Sign-out flow ──────────────────────────────────────────────────────────

  it('sign-out clears session state completely', async () => {
    await signUp(ctx.auth, 'alice');

    await ctx.auth.signOut();

    expect(ctx.auth.currentProfile).toBeNull();
    expect(ctx.prefs.get('activeProfileId')).toBeUndefined();
  });

  // ── Auto sign-out flow ─────────────────────────────────────────────────────

  it('enforceAutoSignOut: expires session older than 7 days', async () => {
    const profile = await ctx.auth.createProfile({
      username: 'alice', password: 'pass1234', role: 'Admin',
    });
    const idb = await ctx.db.open();
    await idb.put('profiles', {
      ...profile,
      lastSignInAt: Date.now() - SEVEN_DAYS_MS - 1000,
    });
    ctx.prefs.set('activeProfileId', profile.id);

    await ctx.auth.enforceAutoSignOut();

    expect(ctx.auth.currentProfile).toBeNull();
    expect(ctx.prefs.get('activeProfileId')).toBeUndefined();
  });

  it('enforceAutoSignOut: preserves recent session', async () => {
    const profile = await ctx.auth.createProfile({
      username: 'alice', password: 'pass1234', role: 'Admin',
    });
    const idb = await ctx.db.open();
    await idb.put('profiles', {
      ...profile,
      lastSignInAt: Date.now() - 60_000, // 1 minute ago
    });
    ctx.prefs.set('activeProfileId', profile.id);

    await ctx.auth.enforceAutoSignOut();

    expect(ctx.auth.currentProfile?.id).toBe(profile.id);
  });

  it('enforceAutoSignOut: signs out when stored profile no longer exists', async () => {
    const profile = await ctx.auth.createProfile({
      username: 'orphaned', password: 'pass1234', role: 'Admin',
    });
    ctx.prefs.set('activeProfileId', profile.id);
    const idb = await ctx.db.open();
    await idb.delete('profiles', profile.id);

    await ctx.auth.enforceAutoSignOut();

    expect(ctx.auth.currentProfile).toBeNull();
    expect(ctx.prefs.get('activeProfileId')).toBeUndefined();
  });

  // ── Password hashing ───────────────────────────────────────────────────────

  it('password is stored hashed — not in plaintext', async () => {
    await ctx.auth.createProfile({ username: 'alice', password: 'securepass1', role: 'Admin' });
    const idb = await ctx.db.open();
    const stored = await idb.getFromIndex('profiles', 'by_username', 'alice');
    expect(stored?.passwordHash).not.toBe('securepass1');
    expect(stored?.salt).toBeTruthy();
  });
});
