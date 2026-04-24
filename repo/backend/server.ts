import { createApiServer } from './app';

const port = Number(process.env['PORT'] ?? 3001);
const host = process.env['HOST'] ?? '0.0.0.0';

const server = createApiServer();

server.on('error', (err: Error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err.message);
  process.exit(1);
});

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`SecureRoom API listening on http://${host}:${port}`);
});
