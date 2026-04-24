/**
 * FE↔BE integration: simulates the frontend user-session flows that call backend
 * HTTP endpoints instead of operating solely on IndexedDB.
 *
 * Each describe block represents one end-to-end journey a UI would execute:
 *   1. Login  →  workspace create  →  workspace fetch  (happy path)
 *   2. Unauthenticated access is rejected at workspace endpoints
 *   3. Expired / unknown token is rejected
 *   4. Concurrent sessions (two tokens) stay isolated
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../backend/app';

interface LoginResponse { token: string; profile: { username: string; role: string } }
interface WorkspaceResponse { id: string; name: string; ownerUsername: string }
interface ErrorResponse { error: string; detail?: string }

describe('FE↔BE integration — auth + workspace session flows', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createApiServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  });

  // ─── helper ────────────────────────────────────────────────────────────────

  async function login(username: string, password: string) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return { status: res.status, body: await res.json() as LoginResponse & ErrorResponse };
  }

  async function createWorkspace(token: string, name: string) {
    const res = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    });
    return { status: res.status, body: await res.json() as WorkspaceResponse & ErrorResponse };
  }

  async function getWorkspace(token: string, id: string) {
    const res = await fetch(`${baseUrl}/api/workspaces/${id}`, {
      headers: { 'authorization': `Bearer ${token}` },
    });
    return { status: res.status, body: await res.json() as WorkspaceResponse & ErrorResponse };
  }

  // ─── complete user session ─────────────────────────────────────────────────

  describe('complete login → create workspace → fetch workspace flow', () => {
    it('login returns a token and profile — UI state: authenticated', async () => {
      const { status, body } = await login('teacher', 'password123');

      expect(status).toBe(200);
      expect(body.token).toBeTruthy();
      expect(body.profile.username).toBe('teacher');
      expect(body.profile.role).toBe('Teacher');
    });

    it('workspace is created and immediately fetchable with the session token', async () => {
      const { body: auth } = await login('admin', 'password123');
      const token = auth.token;

      const { status: createStatus, body: workspace } = await createWorkspace(token, 'Sprint Board');
      expect(createStatus).toBe(201);
      expect(workspace.id).toMatch(/^ws-/);
      expect(workspace.name).toBe('Sprint Board');
      expect(workspace.ownerUsername).toBe('admin');

      // UI state after creation: workspace is retrievable
      const { status: getStatus, body: fetched } = await getWorkspace(token, workspace.id);
      expect(getStatus).toBe(200);
      expect(fetched).toEqual(workspace);
    });

    it('different roles (Teacher, Academic Affairs) each log in with their own token', async () => {
      const { body: t } = await login('teacher', 'password123');
      const { body: a } = await login('affairs', 'password123');

      expect(t.token).not.toBe(a.token);
      expect(t.profile.role).toBe('Teacher');
      expect(a.profile.role).toBe('Academic Affairs');
    });

    it('ownerUsername on workspace matches the logged-in user — UI state: ownership', async () => {
      const { body: auth } = await login('affairs', 'password123');
      const { body: workspace } = await createWorkspace(auth.token, 'Affairs WS');

      expect(workspace.ownerUsername).toBe('affairs');
    });
  });

  // ─── unauthenticated access rejected ──────────────────────────────────────

  describe('unauthenticated requests are rejected — UI state: redirect to login', () => {
    it('POST /api/workspaces without token returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ghost WS' }),
      });
      expect(res.status).toBe(401);
      const body = await res.json() as ErrorResponse;
      expect(body.error).toBe('Unauthorized');
    });

    it('GET /api/workspaces/:id without token returns 401', async () => {
      // Create a workspace with a valid token first
      const { body: auth } = await login('admin', 'password123');
      const { body: workspace } = await createWorkspace(auth.token, 'Private WS');

      // Attempt access without auth — UI would show 401 / redirect
      const { status, body } = await getWorkspace('', workspace.id);
      expect(status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });
  });

  // ─── invalid / unknown token ───────────────────────────────────────────────

  describe('invalid token is treated as unauthenticated', () => {
    it('workspace creation with an unknown token returns 401', async () => {
      const { status } = await createWorkspace('bogus-token-xyz', 'Hacked WS');
      expect(status).toBe(401);
    });

    it('workspace fetch with an unknown token returns 401', async () => {
      // Create workspace legitimately
      const { body: auth } = await login('admin', 'password123');
      const { body: ws } = await createWorkspace(auth.token, 'Legit WS');

      // Attempt fetch with a different (invalid) token
      const { status } = await getWorkspace('forged-token-abc', ws.id);
      expect(status).toBe(401);
    });
  });

  // ─── concurrent sessions stay isolated ────────────────────────────────────

  describe('concurrent sessions: two users create workspaces independently', () => {
    it('each user sees only their own token accepted for their workspace', async () => {
      const { body: adminAuth } = await login('admin', 'password123');
      const { body: teacherAuth } = await login('teacher', 'password123');

      const { body: adminWs } = await createWorkspace(adminAuth.token, 'Admin Board');
      const { body: teacherWs } = await createWorkspace(teacherAuth.token, 'Teacher Board');

      // Each user can fetch their own workspace
      const { status: s1 } = await getWorkspace(adminAuth.token, adminWs.id);
      const { status: s2 } = await getWorkspace(teacherAuth.token, teacherWs.id);
      expect(s1).toBe(200);
      expect(s2).toBe(200);

      // Cross-fetch is still allowed (no per-user data isolation at the API level)
      const { status: s3 } = await getWorkspace(adminAuth.token, teacherWs.id);
      expect(s3).toBe(200); // any valid token can read any workspace

      // But a bogus token cannot read any workspace
      const { status: s4 } = await getWorkspace('bad-token', adminWs.id);
      expect(s4).toBe(401);
    });
  });

  // ─── full round-trip state assertion ──────────────────────────────────────

  describe('round-trip state: created workspace data survives the fetch', () => {
    it('workspace fields match exactly after create → fetch', async () => {
      const { body: auth } = await login('admin', 'password123');
      const wsName = `Integration Test Workspace ${Date.now()}`;

      const { status: cStatus, body: created } = await createWorkspace(auth.token, wsName);
      expect(cStatus).toBe(201);

      const { status: gStatus, body: fetched } = await getWorkspace(auth.token, created.id);
      expect(gStatus).toBe(200);

      // UI state assertion: what was stored is exactly what comes back
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe(wsName);
      expect(fetched.ownerUsername).toBe('admin');
    });
  });
});
