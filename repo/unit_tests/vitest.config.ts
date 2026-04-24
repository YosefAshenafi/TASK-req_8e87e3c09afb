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
        // Component files that have dedicated unit test coverage
        'src/app/auth/pages/profiles-list.component.ts',
        'src/app/auth/pages/sign-in.component.ts',
        'src/app/auth/pages/create-profile.component.ts',
        'src/app/auth/pages/persona-select.component.ts',
        'src/app/workspace/workspaces-list.component.ts',
        'src/app/inbox/inbox-panel.component.ts',
        'src/app/import-export/package-import-conflict-dialog.component.ts',
        'src/app/reporting/report.page.ts',
        // F-coverage: dedicated deep specs per component.
        'src/app/chat/chat-panel.component.ts',
        'src/app/comments/comment-drawer.component.ts',
        'src/app/mutual-help/mutual-help-board.component.ts',
        'src/app/mutual-help/mutual-help-form.component.ts',
        'src/app/presence/activity-feed.component.ts',
        'src/app/snapshot/snapshot-panel.component.ts',
        'src/app/import-export/note-import-wizard.component.ts',
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
