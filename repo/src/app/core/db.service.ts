import { Injectable } from '@angular/core';
import { openDB, IDBPDatabase, DBSchema } from 'idb';
import type { JsonPatch } from './types';

// ── IndexedDB Schema ────────────────────────────────────────────────────────

export interface SecureRoomDB extends DBSchema {
  profiles: {
    key: string;
    value: {
      id: string;
      username: string;
      role: 'Admin' | 'Academic Affairs' | 'Teacher';
      passwordHash: string;
      salt: string;
      failedAttempts: number;
      lockoutUntil: number | null;
      lastSignInAt: number | null;
      createdAt: number;
    };
    indexes: { by_username: string };
  };

  workspaces: {
    key: string;
    value: {
      id: string;
      name: string;
      ownerProfileId: string;
      createdAt: number;
      updatedAt: number;
      version: number;
    };
    indexes: { by_name: string; by_owner: string };
  };

  canvas_objects: {
    key: string;
    value: {
      id: string;
      workspaceId: string;
      type: 'rectangle' | 'circle' | 'arrow' | 'connector' | 'freehand' | 'sticky-note';
      x: number;
      y: number;
      width: number;
      height: number;
      text?: string;
      color?: string;
      strokeColor?: string;
      zIndex: number;
      tags?: string[];
      version: number;
      createdAt: number;
      updatedAt: number;
      lastEditedBy: string;
    };
    indexes: { by_workspace: string };
  };

  comments: {
    key: string;
    value: {
      id: string;
      workspaceId: string;
      targetId: string;
      replies: Array<{
        id: string;
        authorId: string;
        body: string;
        mentions: string[];
        createdAt: number;
      }>;
      readBy: string[];
      createdAt: number;
      updatedAt: number;
      version: number;
    };
    indexes: { by_workspace: string; by_target: string };
  };

  chat: {
    key: string;
    value: {
      id: string;
      workspaceId: string;
      type: 'user' | 'system';
      authorId?: string;
      body: string;
      createdAt: number;
    };
    indexes: { by_workspace_createdAt: [string, number] };
  };

  mutual_help: {
    key: string;
    value: {
      id: string;
      workspaceId: string;
      status: 'draft' | 'active' | 'expired' | 'withdrawn' | 'resolved';
      type: 'request' | 'offer';
      category: string;
      title: string;
      description: string;
      tags: string[];
      timeWindow?: string;
      budget?: string;
      urgency: 'low' | 'medium' | 'high';
      attachmentIds: string[];
      authorId: string;
      pinned: boolean;
      expiresAt: number;
      createdAt: number;
      updatedAt: number;
      version: number;
    };
    indexes: { by_workspace: string; by_status: string };
  };

  attachments: {
    key: string;
    value: {
      id: string;
      workspaceId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      blob: Blob;
      uploadedAt: number;
    };
  };

  snapshots: {
    key: [string, number];
    value: {
      workspaceId: string;
      seq: number;
      isCheckpoint: boolean;
      data?: string;   // full JSON for checkpoints
      patch?: JsonPatch; // RFC 6902 patches for non-checkpoints
      createdAt: number;
    };
    indexes: { by_workspace: string };
  };

  events: {
    key: string;
    value: {
      id: string;
      workspaceId: string;
      type: string;
      payload: unknown;
      at: number;
      rolledUp: boolean;
    };
    indexes: { by_workspace: string; by_rolledUp: number };
  };

  warehouse_daily: {
    key: [string, string];
    value: {
      date: string;       // YYYY-MM-DD
      workspaceId: string;
      notesCreated: number;
      commentsAdded: number;
      chatMessagesSent: number;
      mutualHelpPublished: number;
      activeProfiles: string[];
      computedAt: number;
    };
    indexes: { by_workspace: string };
  };

  kv: {
    key: string;
    value: {
      key: string;
      value: unknown;
      updatedAt: number;
    };
  };
}

const DB_NAME = 'secureroom';
const DB_VERSION = 1;

@Injectable({ providedIn: 'root' })
export class DbService {
  private _db: IDBPDatabase<SecureRoomDB> | null = null;
  private _openPromise: Promise<IDBPDatabase<SecureRoomDB>> | null = null;

  async open(): Promise<IDBPDatabase<SecureRoomDB>> {
    if (this._db) return this._db;
    if (this._openPromise) return this._openPromise;

    this._openPromise = openDB<SecureRoomDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // profiles
        if (!db.objectStoreNames.contains('profiles')) {
          const profiles = db.createObjectStore('profiles', { keyPath: 'id' });
          profiles.createIndex('by_username', 'username', { unique: true });
        }

        // workspaces
        if (!db.objectStoreNames.contains('workspaces')) {
          const workspaces = db.createObjectStore('workspaces', { keyPath: 'id' });
          workspaces.createIndex('by_name', 'name');
          workspaces.createIndex('by_owner', 'ownerProfileId');
        }

        // canvas_objects
        if (!db.objectStoreNames.contains('canvas_objects')) {
          const canvas = db.createObjectStore('canvas_objects', { keyPath: 'id' });
          canvas.createIndex('by_workspace', 'workspaceId');
        }

        // comments
        if (!db.objectStoreNames.contains('comments')) {
          const comments = db.createObjectStore('comments', { keyPath: 'id' });
          comments.createIndex('by_workspace', 'workspaceId');
          comments.createIndex('by_target', 'targetId');
        }

        // chat
        if (!db.objectStoreNames.contains('chat')) {
          const chat = db.createObjectStore('chat', { keyPath: 'id' });
          chat.createIndex('by_workspace_createdAt', ['workspaceId', 'createdAt']);
        }

        // mutual_help
        if (!db.objectStoreNames.contains('mutual_help')) {
          const mh = db.createObjectStore('mutual_help', { keyPath: 'id' });
          mh.createIndex('by_workspace', 'workspaceId');
          mh.createIndex('by_status', 'status');
        }

        // attachments
        if (!db.objectStoreNames.contains('attachments')) {
          db.createObjectStore('attachments', { keyPath: 'id' });
        }

        // snapshots — compound key [workspaceId, seq]
        if (!db.objectStoreNames.contains('snapshots')) {
          const snaps = db.createObjectStore('snapshots', { keyPath: ['workspaceId', 'seq'] });
          snaps.createIndex('by_workspace', 'workspaceId');
        }

        // events
        if (!db.objectStoreNames.contains('events')) {
          const events = db.createObjectStore('events', { keyPath: 'id' });
          events.createIndex('by_workspace', 'workspaceId');
          events.createIndex('by_rolledUp', 'rolledUp');
        }

        // warehouse_daily — compound key [date, workspaceId]
        if (!db.objectStoreNames.contains('warehouse_daily')) {
          const wd = db.createObjectStore('warehouse_daily', {
            keyPath: ['date', 'workspaceId'],
          });
          wd.createIndex('by_workspace', 'workspaceId');
        }

        // kv
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: 'key' });
        }
      },
    });

    this._db = await this._openPromise;
    return this._db;
  }

  async kv<T>(key: string): Promise<T | undefined> {
    const db = await this.open();
    const row = await db.get('kv', key);
    return row?.value as T | undefined;
  }

  async setKv<T>(key: string, value: T): Promise<void> {
    const db = await this.open();
    await db.put('kv', { key, value, updatedAt: Date.now() });
  }
}
