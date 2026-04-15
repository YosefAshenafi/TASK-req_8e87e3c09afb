import { describe, it, expect } from 'vitest';
import {
  generateSalt,
  hashPassword,
  verifyPassword,
} from '../src/app/auth/crypto';

describe('crypto utilities', () => {
  describe('generateSalt()', () => {
    it('returns a non-empty base64 string', () => {
      const salt = generateSalt();
      expect(typeof salt).toBe('string');
      expect(salt.length).toBeGreaterThan(0);
    });

    it('produces unique salts on each call', () => {
      const s1 = generateSalt();
      const s2 = generateSalt();
      expect(s1).not.toBe(s2);
    });

    it('is valid base64', () => {
      const salt = generateSalt();
      // base64 characters only
      expect(salt).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });
  });

  describe('hashPassword()', () => {
    it('returns a base64 string', async () => {
      const salt = generateSalt();
      const hash = await hashPassword('mypassword', salt);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('is deterministic — same input produces same hash', async () => {
      const salt = generateSalt();
      const h1 = await hashPassword('secret', salt);
      const h2 = await hashPassword('secret', salt);
      expect(h1).toBe(h2);
    });

    it('produces different hash for different passwords', async () => {
      const salt = generateSalt();
      const h1 = await hashPassword('password1', salt);
      const h2 = await hashPassword('password2', salt);
      expect(h1).not.toBe(h2);
    });

    it('produces different hash for different salts', async () => {
      const h1 = await hashPassword('password', generateSalt());
      const h2 = await hashPassword('password', generateSalt());
      expect(h1).not.toBe(h2);
    });
  });

  describe('verifyPassword()', () => {
    it('returns true for correct password', async () => {
      const salt = generateSalt();
      const hash = await hashPassword('correct', salt);
      const result = await verifyPassword('correct', salt, hash);
      expect(result).toBe(true);
    });

    it('returns false for wrong password', async () => {
      const salt = generateSalt();
      const hash = await hashPassword('correct', salt);
      const result = await verifyPassword('wrong', salt, hash);
      expect(result).toBe(false);
    });

    it('returns false for empty password against non-empty hash', async () => {
      const salt = generateSalt();
      const hash = await hashPassword('correct', salt);
      const result = await verifyPassword('', salt, hash);
      expect(result).toBe(false);
    });

    it('is consistent across multiple calls', async () => {
      const salt = generateSalt();
      const hash = await hashPassword('mypass', salt);
      const r1 = await verifyPassword('mypass', salt, hash);
      const r2 = await verifyPassword('mypass', salt, hash);
      expect(r1).toBe(true);
      expect(r2).toBe(true);
    });
  });
});
