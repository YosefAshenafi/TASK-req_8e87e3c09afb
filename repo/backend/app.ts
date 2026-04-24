import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

type Role = 'Admin' | 'Academic Affairs' | 'Teacher';

interface UserRecord {
  username: string;
  password: string;
  role: Role;
}

interface WorkspaceRecord {
  id: string;
  name: string;
  ownerUsername: string;
}

export interface AppState {
  users: UserRecord[];
  workspaces: Map<string, WorkspaceRecord>;
  tokens: Map<string, string>;
}

const seedUsers: UserRecord[] = [
  { username: 'admin', password: 'password123', role: 'Admin' },
  { username: 'affairs', password: 'password123', role: 'Academic Affairs' },
  { username: 'teacher', password: 'password123', role: 'Teacher' },
];

function makeState(): AppState {
  return {
    users: [...seedUsers],
    workspaces: new Map<string, WorkspaceRecord>([
      ['ws-seed-1', { id: 'ws-seed-1', name: 'Seed Workspace', ownerUsername: 'admin' }],
    ]),
    tokens: new Map<string, string>(),
  };
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

export function getAuthUsername(req: IncomingMessage, state: AppState): string | null {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  return state.tokens.get(token) ?? null;
}

export function createApiServer(state = makeState()) {
  return createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (method === 'GET' && path === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'secureroom-api' });
      return;
    }

    if (method === 'POST' && path === '/api/auth/login') {
      try {
        const body = await readJsonBody(req);
        const username = typeof body['username'] === 'string' ? body['username'].trim() : '';
        const password = typeof body['password'] === 'string' ? body['password'] : '';
        if (!username || !password) {
          sendJson(res, 400, { error: 'Validation', detail: 'username and password are required' });
          return;
        }
        const user = state.users.find(u => u.username === username && u.password === password);
        if (!user) {
          sendJson(res, 401, { error: 'BadCredentials' });
          return;
        }
        const token = randomUUID();
        state.tokens.set(token, user.username);
        sendJson(res, 200, {
          token,
          profile: { username: user.username, role: user.role },
        });
      } catch {
        sendJson(res, 400, { error: 'InvalidJson' });
      }
      return;
    }

    if (method === 'POST' && path === '/api/workspaces') {
      const username = getAuthUsername(req, state);
      if (!username) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      try {
        const body = await readJsonBody(req);
        const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
        if (!name) {
          sendJson(res, 400, { error: 'Validation', detail: 'name is required' });
          return;
        }
        const id = `ws-${randomUUID()}`;
        const workspace: WorkspaceRecord = { id, name, ownerUsername: username };
        state.workspaces.set(id, workspace);
        sendJson(res, 201, workspace);
      } catch {
        sendJson(res, 400, { error: 'InvalidJson' });
      }
      return;
    }

    if (method === 'GET' && path.startsWith('/api/workspaces/')) {
      const username = getAuthUsername(req, state);
      if (!username) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      const id = path.slice('/api/workspaces/'.length);
      if (!id) {
        sendJson(res, 404, { error: 'NotFound' });
        return;
      }
      const workspace = state.workspaces.get(id);
      if (!workspace) {
        sendJson(res, 404, { error: 'NotFound', detail: `workspace ${id} not found` });
        return;
      }
      sendJson(res, 200, workspace);
      return;
    }

    sendJson(res, 404, { error: 'NotFound' });
  });
}

