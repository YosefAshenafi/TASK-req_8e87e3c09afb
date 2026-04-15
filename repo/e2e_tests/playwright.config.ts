import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:8080';

// When running e2e inside Docker, BASE_URL is typically http://prod:8080.
// Chromium treats origins like `http://prod:8080` as non-secure, which disables
// `window.crypto.subtle` — the app's PBKDF2 password hashing then throws.
// Whitelist the BASE_URL origin so SubtleCrypto is available.
const launchArgs = [`--unsafely-treat-insecure-origin-as-secure=${BASE_URL}`];

// Playwright requires each reporter to be a [name, options] tuple when using multiple reporters.
const consoleReporter: [string, Record<string, unknown>] = process.env['CI']
  ? ['github', {}]
  : ['list', {}];

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: [
    consoleReporter,
    ['json', { outputFile: 'coverage/e2e/results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: { args: launchArgs },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: launchArgs } },
    },
  ],
});
