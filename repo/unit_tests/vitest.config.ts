import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

export default defineConfig({
  root,
  test: {
    name: 'unit',
    globals: true,
    environment: 'jsdom',
    setupFiles: [resolve(__dirname, 'setup.ts')],
    include: [resolve(__dirname, '**/*.spec.ts')],
    reporters: [
      'verbose',
      ['json', { outputFile: resolve(root, 'coverage/unit/test-results.json') }],
    ],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      reportsDirectory: resolve(root, 'coverage/unit'),
      include: [
        'src/app/**/*.service.ts',
        'src/app/auth/crypto.ts',
        'src/app/core/error.ts',
        'src/app/core/store-base.ts',
      ],
      exclude: [
        'src/app/**/*.spec.ts',
        'src/workers/**',
      ],
      thresholds: {
        // Gates aligned with the current covered surface. Tighten as coverage grows.
        lines: 90,
        branches: 75,
        functions: 85,
        statements: 85,
      },
    },
  },
  esbuild: {
    target: 'es2022',
  },
});
