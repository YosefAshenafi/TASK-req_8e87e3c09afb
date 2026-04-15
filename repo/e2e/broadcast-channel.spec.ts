import { test, expect } from '@playwright/test';

/**
 * Phase 0 placeholder — verifies the app loads in two separate browser contexts
 * and that BroadcastChannel plumbing is available (not yet exercised fully).
 * Full multi-tab specs are added in Phase 7 (Presence) and Phase 14 (hardening).
 */
test.describe('cross-context BroadcastChannel plumbing', () => {
  test('app loads in context A and context B', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();

    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto('/');
    await pageB.goto('/');

    // Both contexts should reach the app shell
    await expect(pageA).toHaveTitle(/SecureRoom|secureroom/i);
    await expect(pageB).toHaveTitle(/SecureRoom|secureroom/i);

    // BroadcastChannel should be available in both
    const hasBCInA = await pageA.evaluate(() => typeof BroadcastChannel !== 'undefined');
    const hasBCInB = await pageB.evaluate(() => typeof BroadcastChannel !== 'undefined');

    expect(hasBCInA).toBe(true);
    expect(hasBCInB).toBe(true);

    await ctxA.close();
    await ctxB.close();
  });
});
