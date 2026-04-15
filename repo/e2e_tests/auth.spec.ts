/**
 * AUTH E2E TESTS
 * Profile creation, sign-in, wrong-password error, and lockout flow.
 */
import { test, expect } from '@playwright/test';
import { clearBrowserStorage, gotoApp, createProfile, signIn, signInFull } from './helpers';

test.describe('Auth flow', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await clearBrowserStorage(page);
  });

  // ── Profile creation ──────────────────────────────────────────────────────

  test('creates a new profile and appears in the list', async ({ page }) => {
    await createProfile(page, 'alice', 'password123', 'Teacher');

    // Back on profiles list
    await page.waitForURL(/\/profiles/);
    await expect(page.locator('text=alice')).toBeVisible();
  });

  test('create-profile form shows role options', async ({ page }) => {
    await page.goto('/profiles/new');
    const select = page.locator('select[name="role"]');
    await expect(select).toBeVisible();

    const options = select.locator('option');
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveText('Admin');
    await expect(options.nth(1)).toHaveText('Academic Affairs');
    await expect(options.nth(2)).toHaveText('Teacher');
  });

  test('shows error when password is too short', async ({ page }) => {
    await page.goto('/profiles/new');
    await page.locator('input[name="username"]').fill('shortpass');
    await page.locator('input[type="password"]').first().fill('abc');
    await page.locator('button[type="submit"]').click();

    // Should show an error and stay on create page
    await expect(page.locator('[role="alert"], .error')).toBeVisible();
    expect(page.url()).toMatch(/\/profiles\/new/);
  });

  test('shows error for duplicate username', async ({ page }) => {
    await createProfile(page, 'dupuser', 'password123');

    // Try to create again with same username
    await page.goto('/profiles/new');
    await page.locator('input[name="username"]').fill('dupuser');
    await page.locator('input[type="password"]').first().fill('password123');
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('[role="alert"], .error')).toBeVisible();
  });

  // ── Sign-in flow ──────────────────────────────────────────────────────────

  test('sign in with correct password navigates to persona page', async ({ page }) => {
    await createProfile(page, 'bob', 'securepass1');
    await signIn(page, 'bob', 'securepass1');
    await page.waitForURL(/\/persona|\/workspaces/);
    expect(page.url()).toMatch(/\/persona|\/workspaces/);
  });

  test('sign in → select persona → lands on workspaces', async ({ page }) => {
    await createProfile(page, 'carol', 'securepass2');
    await signInFull(page, 'carol', 'securepass2', 'Teacher');

    await expect(page.locator('h1:has-text("Workspaces")')).toBeVisible();
  });

  test('sign in with wrong password shows error message', async ({ page }) => {
    await createProfile(page, 'dave', 'correctpass');

    // Navigate to sign-in manually
    await page.goto('/profiles');
    await page.waitForLoadState('networkidle');
    await page.locator('text=dave').first().click();
    await page.waitForURL(/\/sign-in/);

    await page.locator('input[type="password"]').fill('wrongpass!');
    await page.locator('button[type="submit"], button').last().click();

    await expect(page.locator('[role="alert"], .error')).toBeVisible();
    await expect(page.locator('[role="alert"], .error')).toContainText(/incorrect|attempt/i);

    // Should still be on sign-in page
    expect(page.url()).toMatch(/\/sign-in/);
  });

  test('persona page shows welcome message with username', async ({ page }) => {
    await createProfile(page, 'frank', 'passfrank1');
    await signIn(page, 'frank', 'passfrank1');
    await page.waitForURL(/\/persona/);

    await expect(page.locator('text=frank')).toBeVisible();
    await expect(page.locator('h2:has-text("Choose")')).toBeVisible();
  });

  test('persona page shows all three role buttons', async ({ page }) => {
    await createProfile(page, 'grace', 'passgrce1');
    await signIn(page, 'grace', 'passgrce1');
    await page.waitForURL(/\/persona/);

    await expect(page.locator('text=Admin')).toBeVisible();
    await expect(page.locator('text=Academic Affairs')).toBeVisible();
    await expect(page.locator('text=Teacher')).toBeVisible();
  });

  // ── Lockout flow ──────────────────────────────────────────────────────────

  test('account lockout appears after 3 failed attempts', async ({ page }) => {
    await createProfile(page, 'lockme', 'realpassword1');

    await page.goto('/profiles');
    await page.waitForLoadState('networkidle');
    await page.locator('text=lockme').first().click();
    await page.waitForURL(/\/sign-in/);

    // Fail 3 times — sign-in is IndexedDB-only (no HTTP), so never use waitForResponse here.
    for (let i = 0; i < 3; i++) {
      await page.locator('input[type="password"]').fill('wrongpass');
      await page.locator('button[type="submit"]').click();
      if (i < 2) {
        await expect(page.locator('.error')).toBeVisible();
      } else {
        await expect(page.locator('.lockout-banner')).toBeVisible();
      }
    }
  });

  test('locked profile shows lockout badge on profiles list', async ({ page }) => {
    await createProfile(page, 'lockbadge', 'realpass12');

    // Trigger lockout
    await page.goto('/profiles');
    await page.waitForLoadState('networkidle');
    await page.locator('text=lockbadge').first().click();
    await page.waitForURL(/\/sign-in/);

    for (let i = 0; i < 3; i++) {
      await page.locator('input[type="password"]').fill('bad');
      await page.locator('button[type="submit"]').click();
      if (i < 2) {
        await expect(page.locator('.error')).toBeVisible();
      } else {
        await expect(page.locator('.lockout-banner')).toBeVisible();
      }
    }

    // Go back to profiles list
    await page.goto('/profiles');
    await page.waitForLoadState('networkidle');

    // Badge lives inside the locked profile card — avoid combining selectors (strict mode: 2 matches).
    await expect(page.locator('.lockout-badge')).toBeVisible({ timeout: 5000 });
  });
});
