import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

export default defineConfig({
  root,
  test: {
    name: 'backend-http',
    globals: true,
    environment: 'node',
    include: [resolve(__dirname, '**/*.spec.ts')],
    reporters: [
      'verbose',
      ['json', { outputFile: resolve(root, 'coverage/backend-http/test-results.json') }],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      reportsDirectory: resolve(root, 'coverage/backend-http'),
      include: ['backend/**/*.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 80,
      },
    },
  },
});
