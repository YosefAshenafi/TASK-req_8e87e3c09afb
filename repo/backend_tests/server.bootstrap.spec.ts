import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Captured 'on' handlers so tests can fire events after the module loads
let capturedHandlers: Record<string, (...args: unknown[]) => void> = {};

const onMock = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
  capturedHandlers[event] = handler;
});

const listenMock = vi.fn((_port: number, _host: string, cb?: () => void) => {
  cb?.();
});

const createApiServerMock = vi.fn(() => ({ listen: listenMock, on: onMock }));

vi.mock('../backend/app', () => ({
  createApiServer: createApiServerMock,
}));

describe('backend/server bootstrap', () => {
  const originalPort = process.env['PORT'];
  const originalHost = process.env['HOST'];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    capturedHandlers = {};
    process.env['PORT'] = '0';
    process.env['HOST'] = '127.0.0.1';
  });

  afterEach(() => {
    if (originalPort === undefined) delete process.env['PORT'];
    else process.env['PORT'] = originalPort;
    if (originalHost === undefined) delete process.env['HOST'];
    else process.env['HOST'] = originalHost;
  });

  // ─── happy path ─────────────────────────────────────────────────────────────

  it('creates API server and calls listen with configured host/port', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('../backend/server');

    expect(createApiServerMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith(0, '127.0.0.1', expect.any(Function));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('SecureRoom API listening on http://127.0.0.1:0'),
    );

    logSpy.mockRestore();
  });

  it('registers an error event listener before calling listen', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('../backend/server');

    expect(onMock).toHaveBeenCalledWith('error', expect.any(Function));

    logSpy.mockRestore();
  });

  it('uses PORT=3001 and HOST=0.0.0.0 as defaults when env vars are absent', async () => {
    delete process.env['PORT'];
    delete process.env['HOST'];
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('../backend/server');

    expect(listenMock).toHaveBeenCalledWith(3001, '0.0.0.0', expect.any(Function));

    logSpy.mockRestore();
  });

  // ─── error path ─────────────────────────────────────────────────────────────

  it('calls process.exit(1) when the server emits an error event', async () => {
    // listen never calls its callback — simulates a bind failure before ready
    listenMock.mockImplementationOnce(() => {});

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('../backend/server');

    const errorHandler = capturedHandlers['error'];
    expect(errorHandler).toBeDefined();

    errorHandler(new Error('EADDRINUSE: address already in use :::3001'));

    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('logs the error message to console.error on listen failure', async () => {
    listenMock.mockImplementationOnce(() => {});

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('../backend/server');

    const errorHandler = capturedHandlers['error'];
    errorHandler(new Error('listen ENOTSUP'));

    expect(errorSpy).toHaveBeenCalledWith('Failed to start server:', 'listen ENOTSUP');

    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('does NOT log a success message when the server fails to start', async () => {
    listenMock.mockImplementationOnce(() => {});

    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('../backend/server');

    const errorHandler = capturedHandlers['error'];
    errorHandler(new Error('EADDRINUSE'));

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('listening'));

    logSpy.mockRestore();
  });
});
