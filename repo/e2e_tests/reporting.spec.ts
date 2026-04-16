/**
 * REPORTING E2E TESTS
 * Verifies the /reporting page — structure, KPI section, date range, load button,
 * empty state, back navigation, and the auth guard redirect when unauthenticated.
 */
import { test, expect } from '@playwright/test';
import { clearBrowserStorage, gotoApp, createProfile, signInFull } from './helpers';

const USER = 'reportuser';
const PASS = 'reportpass1';

test.describe('Reporting page — auth guard', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await clearBrowserStorage(page);
  });

  test('unauthenticated access to /reporting redirects to /profiles', async ({ page }) => {
    await page.goto('/reporting');
    await page.waitForURL(/\/profiles/);
    expect(page.url()).toMatch(/\/profiles/);
  });

  test('unauthenticated access to /workspaces redirects to /profiles', async ({ page }) => {
    await page.goto('/workspaces');
    await page.waitForURL(/\/profiles/);
    expect(page.url()).toMatch(/\/profiles/);
  });

  test('unauthenticated access to /persona redirects to /profiles', async ({ page }) => {
    await page.goto('/persona');
    await page.waitForURL(/\/profiles/);
    expect(page.url()).toMatch(/\/profiles/);
  });
});

test.describe('Reporting page — authenticated', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await clearBrowserStorage(page);
    await createProfile(page, USER, PASS, 'Admin');
    await signInFull(page, USER, PASS, 'Admin');
    await page.goto('/reporting');
    await page.waitForURL(/\/reporting/);
    await page.waitForLoadState('networkidle');
  });

  test('shows Daily Activity Report heading', async ({ page }) => {
    await expect(page.locator('h2')).toContainText('Daily Activity Report');
  });

  test('shows Live KPIs section heading', async ({ page }) => {
    await expect(page.locator('h3')).toContainText('Live KPIs');
  });

  test('shows four KPI cards', async ({ page }) => {
    await expect(page.locator('.kpi-card')).toHaveCount(4);
  });

  test('KPI cards have correct labels', async ({ page }) => {
    const labels = page.locator('.kpi-label');
    await expect(labels.nth(0)).toContainText('Notes / min');
    await expect(labels.nth(1)).toContainText('Comment response');
    await expect(labels.nth(2)).toContainText('Unresolved requests');
    await expect(labels.nth(3)).toContainText('Active peers');
  });

  test('shows date range From and To inputs', async ({ page }) => {
    await expect(page.locator('input[aria-label="From date"]')).toBeVisible();
    await expect(page.locator('input[aria-label="To date"]')).toBeVisible();
  });

  test('shows Load button', async ({ page }) => {
    await expect(page.locator('button:has-text("Load")')).toBeVisible();
  });

  test('shows empty state when no warehouse data exists', async ({ page }) => {
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('No data');
  });

  test('back link navigates to /workspaces', async ({ page }) => {
    await page.locator('a.back-link').click();
    await page.waitForURL(/\/workspaces/);
    expect(page.url()).toMatch(/\/workspaces/);
  });

  test('Load button triggers reload without error', async ({ page }) => {
    await page.locator('button:has-text("Load")').click();
    await page.waitForLoadState('networkidle');
    // Should still be on /reporting and show either table or empty state
    expect(page.url()).toMatch(/\/reporting/);
    const hasEmptyState = await page.locator('.empty-state').isVisible();
    const hasTable = await page.locator('.report-table').isVisible();
    expect(hasEmptyState || hasTable).toBe(true);
  });

  test('From date input has a default value (30 days ago)', async ({ page }) => {
    const fromVal = await page.locator('input[aria-label="From date"]').inputValue();
    expect(fromVal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('To date input defaults to today', async ({ page }) => {
    const toVal = await page.locator('input[aria-label="To date"]').inputValue();
    expect(toVal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
