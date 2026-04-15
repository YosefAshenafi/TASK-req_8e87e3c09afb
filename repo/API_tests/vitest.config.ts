import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

export default defineConfig({
  root,
  test: {
    name: 'api',
    globals: true,
    environment: 'jsdom',
    setupFiles: [resolve(__dirname, 'setup.ts')],
    include: [resolve(__dirname, '**/*.spec.ts')],
    reporters: [
      'verbose',
      ['json', { outputFile: resolve(root, 'coverage/api/test-results.json') }],
    ],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      reportsDirectory: resolve(root, 'coverage/api'),
      include: [
        // API surface covered by integration/API lifecycle tests
        'src/app/auth/auth.service.ts',
        'src/app/chat/chat.service.ts',
        'src/app/comments/comment.service.ts',
        'src/app/canvas/canvas.service.ts',
        'src/app/workspace/workspace.service.ts',
        'src/app/import-export/note-import.service.ts',
        'src/app/mutual-help/mutual-help.service.ts',
        'src/app/snapshot/snapshot.service.ts',
        'src/app/auth/crypto.ts',
        'src/app/core/error.ts',
      ],
      exclude: [
        'src/app/**/*.spec.ts',
        'src/workers/**',
      ],
      thresholds: {
        perFile: true,
        lines: 90,
      },
    },
  },
  esbuild: {
    target: 'es2022',
  },
});
