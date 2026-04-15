/**
 * APP SHELL E2E TESTS
 * Verifies the basic shell: app loads, redirects, and title.
 */
import { test, expect } from '@playwright/test';
import { clearBrowserStorage, gotoApp } from './helpers';

test.describe('App shell', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await clearBrowserStorage(page);
  });

  test('root "/" redirects to /profiles', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/profiles/);
    expect(page.url()).toMatch(/\/profiles/);
  });

  test('profiles page shows heading and create button', async ({ page }) => {
    await page.goto('/profiles');
    await page.waitForLoadState('networkidle');

    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('SecureRoom');

    const createLink = page.locator('a[href="/profiles/new"], a:has-text("Create new profile")');
    await expect(createLink).toBeVisible();
  });

  test('unknown route falls back to /profiles', async ({ page }) => {
    await page.goto('/does-not-exist-xyz');
    await page.waitForURL(/\/profiles/);
    expect(page.url()).toMatch(/\/profiles/);
  });

  test('profiles/new page shows the create profile form', async ({ page }) => {
    await page.goto('/profiles/new');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2')).toContainText('Create profile');
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('select[name="role"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('back link on create-profile navigates to /profiles', async ({ page }) => {
    await page.goto('/profiles/new');
    await page.locator('a:has-text("Back")').click();
    await page.waitForURL(/\/profiles$/);
    expect(page.url()).toMatch(/\/profiles$/);
  });

  test('empty profiles list shows empty state message', async ({ page }) => {
    await page.goto('/profiles');
    await page.waitForLoadState('networkidle');

    const emptyState = page.locator('text=No profiles yet');
    await expect(emptyState).toBeVisible();
  });
});
