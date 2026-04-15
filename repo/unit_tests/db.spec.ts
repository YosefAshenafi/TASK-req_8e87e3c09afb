import { describe, it, expect, beforeEach } from 'vitest';
import { DbService } from '../src/app/core/db.service';

describe('DbService', () => {
  let db: DbService;

  beforeEach(() => {
    db = new DbService();
  });

  describe('open()', () => {
    it('returns an IDBPDatabase instance', async () => {
      const idb = await db.open();
      expect(idb).toBeDefined();
      expect(typeof idb.get).toBe('function');
    });

    it('returns the same instance on repeated calls (singleton)', async () => {
      const a = await db.open();
      const b = await db.open();
      expect(a).toBe(b);
    });

    it('creates all 11 object stores', async () => {
      const idb = await db.open();
      const stores = Array.from(idb.objectStoreNames);
      const expected = [
        'profiles', 'workspaces', 'canvas_objects', 'comments',
        'chat', 'mutual_help', 'attachments', 'snapshots',
        'events', 'warehouse_daily', 'kv',
      ];
      for (const store of expected) {
        expect(stores).toContain(store);
      }
    });
  });

  describe('kv()', () => {
    it('returns undefined for missing key', async () => {
      const value = await db.kv<string>('missing-key');
      expect(value).toBeUndefined();
    });

    it('returns previously stored value', async () => {
      await db.setKv('myKey', { data: 42 });
      const value = await db.kv<{ data: number }>('myKey');
      expect(value).toEqual({ data: 42 });
    });
  });

  describe('setKv()', () => {
    it('stores a string value', async () => {
      await db.setKv('hello', 'world');
      const v = await db.kv<string>('hello');
      expect(v).toBe('world');
    });

    it('stores an object value', async () => {
      const obj = { a: 1, b: [2, 3] };
      await db.setKv('complex', obj);
      const v = await db.kv<typeof obj>('complex');
      expect(v).toEqual(obj);
    });

    it('overwrites existing key', async () => {
      await db.setKv('key', 'old');
      await db.setKv('key', 'new');
      const v = await db.kv<string>('key');
      expect(v).toBe('new');
    });

    it('stores null/undefined distinction', async () => {
      await db.setKv('nullKey', null);
      const v = await db.kv('nullKey');
      expect(v).toBeNull();
    });
  });
});
