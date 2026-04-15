import { Injectable, Optional } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from '../core/db.service';
import { PrefsService } from '../core/prefs.service';
import { ChatService } from '../chat/chat.service';
import { AppException } from '../core/error';
import type { PersonaRole, Profile, ProfileSummary } from '../core/types';
import { generateSalt, hashPassword, verifyPassword } from './crypto';
import {
  SEVEN_DAYS_MS,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
} from './profile.model';

export type SignInResult =
  | { ok: true; profile: Profile }
  | { ok: false; reason: 'BadCredentials'; attemptsRemaining: number }
  | { ok: false; reason: 'LockedOut'; until: number };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _current$ = new BehaviorSubject<Profile | null>(null);

  constructor(
    private readonly db: DbService,
    private readonly prefs: PrefsService,
    // ChatService is @Optional to avoid a circular DI cycle (ChatService → AuthService).
    // Angular injects null when the cycle is detected; signIn/signOut guard with ?.
    @Optional() private readonly chat: ChatService | null = null,
  ) {}

  get currentProfile$(): Observable<Profile | null> {
    return this._current$.asObservable();
  }

  get currentProfile(): Profile | null {
    return this._current$.value;
  }

  async listProfiles(): Promise<ProfileSummary[]> {
    const idb = await this.db.open();
    const all = await idb.getAll('profiles');
    return all.map(p => ({
      id: p.id,
      username: p.username,
      role: p.role as PersonaRole,
      lockoutUntil: p.lockoutUntil,
    }));
  }

  async createProfile(input: {
    username: string;
    password: string;
    role: PersonaRole;
  }): Promise<Profile> {
    if (input.password.length < 8) {
      throw new AppException({ code: 'Validation', detail: 'Password must be at least 8 characters', field: 'password' });
    }

    const idb = await this.db.open();

    // Check username uniqueness
    const existing = await idb.getFromIndex('profiles', 'by_username', input.username);
    if (existing) {
      throw new AppException({ code: 'Validation', detail: 'Username already taken', field: 'username' });
    }

    const salt = generateSalt();
    const passwordHash = await hashPassword(input.password, salt);

    const profile: Profile = {
      id: uuidv4(),
      username: input.username,
      role: input.role,
      passwordHash,
      salt,
      failedAttempts: 0,
      lockoutUntil: null,
      lastSignInAt: null,
      createdAt: Date.now(),
    };

    await idb.put('profiles', profile);
    return profile;
  }

  async signIn(username: string, password: string): Promise<SignInResult> {
    const idb = await this.db.open();
    const profile = await idb.getFromIndex('profiles', 'by_username', username);

    if (!profile) {
      return { ok: false, reason: 'BadCredentials', attemptsRemaining: MAX_FAILED_ATTEMPTS };
    }

    // Check lockout
    if (profile.lockoutUntil !== null && profile.lockoutUntil > Date.now()) {
      return { ok: false, reason: 'LockedOut', until: profile.lockoutUntil };
    }

    const valid = await verifyPassword(password, profile.salt, profile.passwordHash);

    if (!valid) {
      const newAttempts = profile.failedAttempts + 1;
      const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS;
      const updated: Profile = {
        ...profile,
        failedAttempts: newAttempts,
        lockoutUntil: shouldLock ? Date.now() + LOCKOUT_DURATION_MS : null,
      };
      await idb.put('profiles', updated);

      if (shouldLock) {
        return { ok: false, reason: 'LockedOut', until: updated.lockoutUntil! };
      }
      return {
        ok: false,
        reason: 'BadCredentials',
        attemptsRemaining: MAX_FAILED_ATTEMPTS - newAttempts,
      };
    }

    // Success
    const now = Date.now();
    const updated: Profile = {
      ...profile,
      failedAttempts: 0,
      lockoutUntil: null,
      lastSignInAt: now,
    };
    await idb.put('profiles', updated);
    this._current$.next(updated);
    this.prefs.set('activeProfileId', updated.id);
    this.prefs.set('personaRole', updated.role as PersonaRole);
    await this.chat?.postSystem(`${updated.username} signed in.`);
    return { ok: true, profile: updated };
  }

  async signOut(): Promise<void> {
    const username = this._current$.value?.username;
    this._current$.next(null);
    this.prefs.set('activeProfileId', undefined);
    if (username) await this.chat?.postSystem(`${username} signed out.`);
  }

  /** Call on app boot. Signs out any profile whose lastSignInAt is older than 7 days. */
  async enforceAutoSignOut(): Promise<void> {
    const activeId = this.prefs.get('activeProfileId');
    if (!activeId) return;

    const idb = await this.db.open();
    const profile = await idb.get('profiles', activeId);
    if (!profile) {
      await this.signOut();
      return;
    }

    if (profile.lastSignInAt !== null && Date.now() - profile.lastSignInAt > SEVEN_DAYS_MS) {
      await this.signOut();
    } else {
      this._current$.next(profile);
    }
  }
}
