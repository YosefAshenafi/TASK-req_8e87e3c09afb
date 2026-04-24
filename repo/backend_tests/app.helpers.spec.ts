import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody, getAuthUsername } from '../backend/app';
import type { AppState } from '../backend/app';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRes() {
  const writeHead = vi.fn();
  const end = vi.fn();
  return { writeHead, end } as unknown as ServerResponse & {
    writeHead: typeof writeHead;
    end: typeof end;
  };
}

function makeReq(bodyChunks: string[]): IncomingMessage {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of bodyChunks) {
        yield Buffer.from(chunk);
      }
    },
  } as unknown as IncomingMessage;
}

function makeReqWithHeaders(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function makeState(tokenMap: Record<string, string> = {}): AppState {
  return {
    users: [],
    workspaces: new Map(),
    tokens: new Map(Object.entries(tokenMap)),
  };
}

// ─── sendJson ─────────────────────────────────────────────────────────────────

describe('sendJson', () => {
  it('calls writeHead with the given status code', () => {
    const res = makeRes();
    sendJson(res, 200, { ok: true });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });

  it('sets content-type to application/json with charset', () => {
    const res = makeRes();
    sendJson(res, 200, {});
    expect(res.writeHead).toHaveBeenCalledWith(
      expect.any(Number),
      { 'content-type': 'application/json; charset=utf-8' },
    );
  });

  it('calls end with JSON-serialized payload', () => {
    const res = makeRes();
    const payload = { id: 'ws-1', name: 'Test Workspace' };
    sendJson(res, 201, payload);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(payload));
  });

  it('serializes nested structures correctly', () => {
    const res = makeRes();
    const payload = { data: { nested: [1, 2, 3] }, flag: true };
    sendJson(res, 200, payload);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(payload));
  });

  it('uses 4xx status codes correctly', () => {
    const res = makeRes();
    sendJson(res, 401, { error: 'Unauthorized' });
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Unauthorized' }));
  });

  it('serializes null payload', () => {
    const res = makeRes();
    sendJson(res, 200, null);
    expect(res.end).toHaveBeenCalledWith('null');
  });

  it('calls writeHead exactly once and end exactly once', () => {
    const res = makeRes();
    sendJson(res, 200, { ok: true });
    expect(res.writeHead).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

// ─── readJsonBody ─────────────────────────────────────────────────────────────

describe('readJsonBody', () => {
  it('returns empty object for an empty body (no chunks)', async () => {
    const req = makeReq([]);
    const result = await readJsonBody(req);
    expect(result).toEqual({});
  });

  it('parses a complete JSON object from a single chunk', async () => {
    const req = makeReq(['{"username":"alice","password":"secret123"}']);
    const result = await readJsonBody(req);
    expect(result).toEqual({ username: 'alice', password: 'secret123' });
  });

  it('concatenates multiple chunks before parsing', async () => {
    const req = makeReq(['{"user', 'name":"bob"}']);
    const result = await readJsonBody(req);
    expect(result).toEqual({ username: 'bob' });
  });

  it('handles three or more chunks', async () => {
    const req = makeReq(['{"a":', '1,', '"b":2}']);
    const result = await readJsonBody(req);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('throws SyntaxError when body is invalid JSON', async () => {
    const req = makeReq(['not valid json at all']);
    await expect(readJsonBody(req)).rejects.toThrow(SyntaxError);
  });

  it('throws SyntaxError for malformed partial JSON', async () => {
    const req = makeReq(['{"key": ']);
    await expect(readJsonBody(req)).rejects.toThrow(SyntaxError);
  });

  it('parses arrays and primitive-value payloads', async () => {
    const req = makeReq(['{"items":[1,2,3],"active":true}']);
    const result = await readJsonBody(req);
    expect(result).toEqual({ items: [1, 2, 3], active: true });
  });

  it('handles Buffer chunks (non-string input)', async () => {
    const raw = JSON.stringify({ name: 'workspace-x' });
    const req = {
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(raw, 'utf8');
      },
    } as unknown as IncomingMessage;
    const result = await readJsonBody(req);
    expect(result).toEqual({ name: 'workspace-x' });
  });
});

// ─── getAuthUsername ──────────────────────────────────────────────────────────

describe('getAuthUsername', () => {
  it('returns null when Authorization header is absent', () => {
    const req = makeReqWithHeaders({});
    expect(getAuthUsername(req, makeState())).toBeNull();
  });

  it('returns null when Authorization header does not start with "Bearer "', () => {
    const req = makeReqWithHeaders({ authorization: 'Basic dXNlcjpwYXNz' });
    expect(getAuthUsername(req, makeState())).toBeNull();
  });

  it('returns null when Authorization is "Bearer" with no token (empty string after prefix)', () => {
    const req = makeReqWithHeaders({ authorization: 'Bearer ' });
    // State has no empty-string key, so lookup returns undefined → null
    expect(getAuthUsername(req, makeState({ 'valid-token': 'alice' }))).toBeNull();
  });

  it('returns null when the token is not in the state', () => {
    const req = makeReqWithHeaders({ authorization: 'Bearer unknown-token' });
    const state = makeState({ 'valid-token': 'alice' });
    expect(getAuthUsername(req, state)).toBeNull();
  });

  it('returns the username for a valid token', () => {
    const req = makeReqWithHeaders({ authorization: 'Bearer my-valid-token' });
    const state = makeState({ 'my-valid-token': 'alice' });
    expect(getAuthUsername(req, state)).toBe('alice');
  });

  it('trims whitespace from the extracted token before lookup', () => {
    const req = makeReqWithHeaders({ authorization: 'Bearer   trimmed-token   ' });
    const state = makeState({ 'trimmed-token': 'bob' });
    expect(getAuthUsername(req, state)).toBe('bob');
  });

  it('is case-sensitive for token values', () => {
    const req = makeReqWithHeaders({ authorization: 'Bearer TOKEN-uppercase' });
    const state = makeState({ 'token-uppercase': 'carol' });
    expect(getAuthUsername(req, state)).toBeNull();
  });

  it('returns correct username from a multi-token state', () => {
    const req = makeReqWithHeaders({ authorization: 'Bearer token-b' });
    const state = makeState({
      'token-a': 'alice',
      'token-b': 'bob',
      'token-c': 'carol',
    });
    expect(getAuthUsername(req, state)).toBe('bob');
  });
});
