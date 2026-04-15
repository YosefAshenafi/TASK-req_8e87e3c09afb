import { describe, it, expect, beforeEach } from 'vitest';
import { filter, firstValueFrom, take } from 'rxjs';
import { DbService } from '../src/app/core/db.service';
import { PrefsService } from '../src/app/core/prefs.service';
import { AuthService } from '../src/app/auth/auth.service';
import { AppException } from '../src/app/core/error';
import {
  MAX_FAILED_ATTEMPTS,
  SEVEN_DAYS_MS,
} from '../src/app/auth/profile.model';

describe('AuthService', () => {
  let db: DbService;
  let prefs: PrefsService;
  let auth: AuthService;

  beforeEach(() => {
    db = new DbService();
    prefs = new PrefsService();
    auth = new AuthService(db, prefs);
  });

  // ── createProfile ──────────────────────────────────────────────────────────

  describe('createProfile()', () => {
    it('creates a profile with valid credentials', async () => {
      const profile = await auth.createProfile({
        username: 'alice',
        password: 'password123',
        role: 'Admin',
      });
      expect(profile.id).toBeTruthy();
      expect(profile.username).toBe('alice');
      expect(profile.role).toBe('Admin');
      expect(profile.failedAttempts).toBe(0);
      expect(profile.lockoutUntil).toBeNull();
      expect(profile.lastSignInAt).toBeNull();
      expect(profile.createdAt).toBeGreaterThan(0);
      expect(profile.passwordHash).toBeTruthy();
      expect(profile.salt).toBeTruthy();
    });

    it('throws Validation when password is < 8 characters', async () => {
      await expect(
        auth.createProfile({ username: 'bob', password: 'short', role: 'Teacher' }),
      ).rejects.toSatisfy(
        (e: AppException) => e.error.code === 'Validation' && e.error.field === 'password',
      );
    });

    it('throws Validation when username is already taken', async () => {
      await auth.createProfile({ username: 'alice', password: 'password123', role: 'Admin' });
      await expect(
        auth.createProfile({ username: 'alice', password: 'different1', role: 'Teacher' }),
      ).rejects.toSatisfy(
        (e: AppException) => e.error.code === 'Validation' && e.error.field === 'username',
      );
    });

    it('assigns unique ids to multiple profiles', async () => {
      const p1 = await auth.createProfile({ username: 'alice', password: 'pass1234', role: 'Admin' });
      const p2 = await auth.createProfile({ username: 'bob', password: 'pass1234', role: 'Teacher' });
      expect(p1.id).not.toBe(p2.id);
    });

    it('creates profile with all three roles', async () => {
      const admin = await auth.createProfile({ username: 'admin', password: 'pass1234', role: 'Admin' });
      const academic = await auth.createProfile({ username: 'academic', password: 'pass1234', role: 'Academic Affairs' });
      const teacher = await auth.createProfile({ username: 'teacher', password: 'pass1234', role: 'Teacher' });
      expect(admin.role).toBe('Admin');
      expect(academic.role).toBe('Academic Affairs');
      expect(teacher.role).toBe('Teacher');
    });

    it('exactly 8 characters is accepted', async () => {
      const p = await auth.createProfile({ username: 'user', password: '12345678', role: 'Admin' });
      expect(p.id).toBeTruthy();
    });
  });

  // ── signIn ─────────────────────────────────────────────────────────────────

  describe('signIn()', () => {
    beforeEach(async () => {
      await auth.createProfile({ username: 'alice', password: 'password123', role: 'Admin' });
    });

    it('returns ok:true for correct credentials', async () => {
      const result = await auth.signIn('alice', 'password123');
      expect(result.ok).toBe(true);
    });

    it('sets currentProfile after successful sign-in', async () => {
      await auth.signIn('alice', 'password123');
      expect(auth.currentProfile).not.toBeNull();
      expect(auth.currentProfile?.username).toBe('alice');
    });

    it('sets activeProfileId in prefs after sign-in', async () => {
      const result = await auth.signIn('alice', 'password123');
      if (result.ok) {
        expect(prefs.get('activeProfileId')).toBe(result.profile.id);
      }
    });

    it('returns BadCredentials for unknown username', async () => {
      const result = await auth.signIn('unknown', 'password123');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('BadCredentials');
        expect(result.attemptsRemaining).toBe(MAX_FAILED_ATTEMPTS);
      }
    });

    it('returns BadCredentials with decremented attemptsRemaining', async () => {
      const result = await auth.signIn('alice', 'wrongpass');
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === 'BadCredentials') {
        expect(result.attemptsRemaining).toBe(MAX_FAILED_ATTEMPTS - 1);
      }
    });

    it('locks account after MAX_FAILED_ATTEMPTS consecutive failures', async () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
        await auth.signIn('alice', 'wrong');
      }
      const result = await auth.signIn('alice', 'wrong');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('LockedOut');
        if (result.reason === 'LockedOut') {
          expect(result.until).toBeGreaterThan(Date.now());
        }
      }
    });

    it('returns LockedOut when account is already locked', async () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        await auth.signIn('alice', 'wrong');
      }
      // Even with correct password, account is locked
      const result = await auth.signIn('alice', 'password123');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('LockedOut');
      }
    });

    it('resets failedAttempts to 0 on successful sign-in', async () => {
      await auth.signIn('alice', 'wrong'); // increment counter
      const result = await auth.signIn('alice', 'password123');
      if (result.ok) {
        expect(result.profile.failedAttempts).toBe(0);
      }
    });

    it('updates lastSignInAt on successful sign-in', async () => {
      const before = Date.now();
      const result = await auth.signIn('alice', 'password123');
      if (result.ok) {
        expect(result.profile.lastSignInAt).toBeGreaterThanOrEqual(before);
      }
    });
  });

  // ── signOut ────────────────────────────────────────────────────────────────

  describe('signOut()', () => {
    it('clears currentProfile', async () => {
      await auth.createProfile({ username: 'alice', password: 'password123', role: 'Admin' });
      await auth.signIn('alice', 'password123');
      await auth.signOut();
      expect(auth.currentProfile).toBeNull();
    });

    it('clears activeProfileId from prefs', async () => {
      await auth.createProfile({ username: 'alice', password: 'password123', role: 'Admin' });
      await auth.signIn('alice', 'password123');
      await auth.signOut();
      expect(prefs.get('activeProfileId')).toBeUndefined();
    });

    it('is idempotent — can be called multiple times', async () => {
      await auth.signOut();
      await auth.signOut();
      expect(auth.currentProfile).toBeNull();
    });
  });

  // ── listProfiles ───────────────────────────────────────────────────────────

  describe('listProfiles()', () => {
    it('returns empty array when no profiles exist', async () => {
      const list = await auth.listProfiles();
      expect(list).toEqual([]);
    });

    it('returns summaries for all created profiles', async () => {
      await auth.createProfile({ username: 'alice', password: 'pass1234', role: 'Admin' });
      await auth.createProfile({ username: 'bob', password: 'pass1234', role: 'Teacher' });
      const list = await auth.listProfiles();
      expect(list).toHaveLength(2);
      const usernames = list.map(p => p.username);
      expect(usernames).toContain('alice');
      expect(usernames).toContain('bob');
    });

    it('summary includes id, username, role, lockoutUntil', async () => {
      await auth.createProfile({ username: 'alice', password: 'pass1234', role: 'Admin' });
      const [summary] = await auth.listProfiles();
      expect(summary).toHaveProperty('id');
      expect(summary).toHaveProperty('username', 'alice');
      expect(summary).toHaveProperty('role', 'Admin');
      expect(summary).toHaveProperty('lockoutUntil');
    });
  });

  // ── enforceAutoSignOut ─────────────────────────────────────────────────────

  describe('enforceAutoSignOut()', () => {
    it('does nothing when no activeProfileId in prefs', async () => {
      await auth.enforceAutoSignOut();
      expect(auth.currentProfile).toBeNull();
    });

    it('signs out if the stored profile id does not exist in DB', async () => {
      prefs.set('activeProfileId', 'ghost-id');
      await auth.enforceAutoSignOut();
      expect(auth.currentProfile).toBeNull();
    });

    it('signs out if lastSignInAt is older than 7 days', async () => {
      const profile = await auth.createProfile({
        username: 'alice', password: 'pass1234', role: 'Admin',
      });
      const idb = await db.open();
      await idb.put('profiles', { ...profile, lastSignInAt: Date.now() - SEVEN_DAYS_MS - 1000 });
      prefs.set('activeProfileId', profile.id);

      await auth.enforceAutoSignOut();
      expect(auth.currentProfile).toBeNull();
    });

    it('restores session if lastSignInAt is recent', async () => {
      const profile = await auth.createProfile({
        username: 'alice', password: 'pass1234', role: 'Admin',
      });
      const idb = await db.open();
      await idb.put('profiles', { ...profile, lastSignInAt: Date.now() - 60_000 });
      prefs.set('activeProfileId', profile.id);

      await auth.enforceAutoSignOut();
      expect(auth.currentProfile?.id).toBe(profile.id);
    });

    it('restores session if lastSignInAt is null (never expires without sign-in)', async () => {
      const profile = await auth.createProfile({
        username: 'alice', password: 'pass1234', role: 'Admin',
      });
      // lastSignInAt is null initially
      prefs.set('activeProfileId', profile.id);

      await auth.enforceAutoSignOut();
      // lastSignInAt is null → condition `profile.lastSignInAt !== null` is false → no sign-out
      expect(auth.currentProfile?.id).toBe(profile.id);
    });
  });

  // ── currentProfile$ observable ─────────────────────────────────────────────

  describe('currentProfile$', () => {
    it('emits null initially', async () => {
      const val = await firstValueFrom(auth.currentProfile$);
      expect(val).toBeNull();
    });

    it('emits the profile after sign-in', async () => {
      await auth.createProfile({ username: 'alice', password: 'pass1234', role: 'Admin' });
      await auth.signIn('alice', 'pass1234');
      const p = await firstValueFrom(
        auth.currentProfile$.pipe(filter((x): x is NonNullable<typeof x> => x !== null), take(1)),
      );
      expect(p.username).toBe('alice');
    });
  });
});
