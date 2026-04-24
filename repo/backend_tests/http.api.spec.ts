import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../backend/app';

describe('HTTP API (no-mock) — real route handlers', () => {
  let server: Server;
  let baseUrl = '';

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

  it('GET /api/health returns service status', async () => {
    const res = await fetch(`${baseUrl}/api/health`, { method: 'GET' });
    const body = await res.json() as { ok: boolean; service: string };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe('secureroom-api');
  });

  it('POST /api/auth/login returns token and role for valid credentials', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' }),
    });
    const body = await res.json() as {
      token: string;
      profile: { username: string; role: string };
    };

    expect(res.status).toBe(200);
    expect(body.token.length).toBeGreaterThan(10);
    expect(body.profile.username).toBe('admin');
    expect(body.profile.role).toBe('Admin');
  });

  it('POST /api/auth/login returns 400 when username/password are missing', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin' }),
    });
    const body = await res.json() as { error: string; detail: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation');
    expect(body.detail).toContain('username and password are required');
  });

  it('POST /api/auth/login returns 401 for bad credentials', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('BadCredentials');
  });

  it('POST /api/auth/login returns 400 for invalid JSON', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"username":"admin"',
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe('InvalidJson');
  });

  it('POST /api/workspaces creates workspace and GET /api/workspaces/:id fetches it', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'teacher', password: 'password123' }),
    });
    const loginBody = await loginRes.json() as { token: string };
    const token = loginBody.token;

    const createRes = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'HTTP Coverage Workspace' }),
    });
    const created = await createRes.json() as {
      id: string;
      name: string;
      ownerUsername: string;
    };
    expect(createRes.status).toBe(201);
    expect(created.name).toBe('HTTP Coverage Workspace');
    expect(created.ownerUsername).toBe('teacher');
    expect(created.id).toMatch(/^ws-/);

    const getRes = await fetch(`${baseUrl}/api/workspaces/${created.id}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });
    const fetched = await getRes.json() as {
      id: string;
      name: string;
      ownerUsername: string;
    };
    expect(getRes.status).toBe(200);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe('HTTP Coverage Workspace');
    expect(fetched.ownerUsername).toBe('teacher');
  });

  it('POST /api/workspaces returns 401 without bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Unauthorized Workspace' }),
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('POST /api/workspaces returns 400 when name is missing', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'teacher', password: 'password123' }),
    });
    const loginBody = await loginRes.json() as { token: string };

    const res = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${loginBody.token}`,
      },
      body: JSON.stringify({ name: '   ' }),
    });
    const body = await res.json() as { error: string; detail: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation');
    expect(body.detail).toBe('name is required');
  });

  it('POST /api/workspaces returns 400 for invalid JSON', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'teacher', password: 'password123' }),
    });
    const loginBody = await loginRes.json() as { token: string };

    const res = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${loginBody.token}`,
      },
      body: '{"name":"broken"',
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe('InvalidJson');
  });

  it('GET /api/workspaces/:id returns 401 without bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/workspaces/ws-seed-1`, { method: 'GET' });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('GET /api/workspaces/:id returns 404 when workspace does not exist', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'teacher', password: 'password123' }),
    });
    const loginBody = await loginRes.json() as { token: string };

    const res = await fetch(`${baseUrl}/api/workspaces/ws-does-not-exist`, {
      method: 'GET',
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    const body = await res.json() as { error: string; detail: string };

    expect(res.status).toBe(404);
    expect(body.error).toBe('NotFound');
    expect(body.detail).toContain('ws-does-not-exist');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`${baseUrl}/api/unknown`, { method: 'GET' });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(404);
    expect(body.error).toBe('NotFound');
  });

  // ─── Extra negative-path coverage — all real-router, no mocks ────────────────
  // Every test below boots the real createApiServer() instance and asserts
  // against the response a real client would receive.

  it('POST /api/workspaces returns 401 for a malformed Authorization header (no "Bearer ")', async () => {
    const res = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Token abc' },
      body: JSON.stringify({ name: 'Whatever' }),
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('POST /api/workspaces returns 401 for an unknown Bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer nope-not-a-real-token',
      },
      body: JSON.stringify({ name: 'Whatever' }),
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('GET /api/workspaces/:id returns 401 for an unknown Bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/workspaces/ws-seed-1`, {
      method: 'GET',
      headers: { authorization: 'Bearer garbage-token' },
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('POST /api/auth/login returns 400 when password field is the wrong type', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 12345 }),
    });
    const body = await res.json() as { error: string; detail: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation');
    expect(body.detail).toContain('username and password are required');
  });

  it('POST /api/auth/login returns 400 for a whitespace-only username', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: '   ', password: 'password123' }),
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation');
  });

  it('POST /api/auth/login issues a unique token on every successful login', async () => {
    const r1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' }),
    });
    const r2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' }),
    });
    const b1 = await r1.json() as { token: string };
    const b2 = await r2.json() as { token: string };
    expect(b1.token).not.toBe(b2.token);
  });

  it('POST /api/workspaces persists state so newly-created workspaces are gettable in the same server', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' }),
    });
    const { token } = await loginRes.json() as { token: string };

    const createRes = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'Persisted WS' }),
    });
    const { id, ownerUsername } = await createRes.json() as {
      id: string;
      ownerUsername: string;
    };
    expect(ownerUsername).toBe('admin');

    // Round-trip: GET the same workspace.
    const getRes = await fetch(`${baseUrl}/api/workspaces/${id}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });
    const fetched = await getRes.json() as { id: string; ownerUsername: string };
    expect(getRes.status).toBe(200);
    expect(fetched.id).toBe(id);
    expect(fetched.ownerUsername).toBe('admin');
  });

  it('GET on an unhandled verb/path combination returns 404 NotFound', async () => {
    // Hitting a totally different route (even a sibling-looking one) falls
    // through to the router's default 404 branch.
    const res = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    const body = await res.json() as { error: string };
    expect(res.status).toBe(404);
    expect(body.error).toBe('NotFound');
  });

  it('PUT /api/workspaces is not handled and returns 404 NotFound', async () => {
    const res = await fetch(`${baseUrl}/api/workspaces`, { method: 'PUT' });
    const body = await res.json() as { error: string };
    expect(res.status).toBe(404);
    expect(body.error).toBe('NotFound');
  });

  it('all handled responses advertise application/json content-type', async () => {
    const res = await fetch(`${baseUrl}/api/health`, { method: 'GET' });
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
