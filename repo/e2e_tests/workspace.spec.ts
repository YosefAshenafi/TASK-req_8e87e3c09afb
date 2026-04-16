/**
 * WORKSPACE E2E TESTS
 * Create, open, rename, and delete workspaces via the UI.
 */
import { test, expect } from '@playwright/test';
import { clearBrowserStorage, gotoApp, createProfile, signInFull } from './helpers';

const USER = 'wsuser';
const PASS = 'workpass1';

test.describe('Workspace management', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await clearBrowserStorage(page);
    // Use Admin so delete-flow tests can see persona-gated delete controls.
    await createProfile(page, USER, PASS, 'Admin');
    await signInFull(page, USER, PASS, 'Admin');
    // Now on /workspaces
  });

  // ── Create workspace ──────────────────────────────────────────────────────

  test('empty workspace list shows empty state', async ({ page }) => {
    await expect(page.locator('text=No workspaces yet')).toBeVisible();
  });

  test('creates a workspace and it appears in the list', async ({ page }) => {
    await page.getByLabel('New workspace name').fill('My First Workspace');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.locator('text=My First Workspace')).toBeVisible();
  });

  test('creates a workspace using Enter key', async ({ page }) => {
    const input = page.getByLabel('New workspace name');
    await input.fill('Enter Key Workspace');
    await input.press('Enter');

    await expect(page.locator('text=Enter Key Workspace')).toBeVisible();
  });

  test('Create button is disabled when input is empty', async ({ page }) => {
    const createBtn = page.getByRole('button', { name: 'Create' });
    await expect(createBtn).toBeDisabled();
  });

  test('multiple workspaces appear in the list', async ({ page }) => {
    const input = page.getByLabel('New workspace name');

    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      await input.fill(name);
      await expect(page.getByRole('button', { name: 'Create' })).toBeEnabled();
      await page.getByRole('button', { name: 'Create' }).click();
      // Workspace title shares the row with a date — use the list row button, not exact full text.
      await expect(page.locator('button.ws-name').filter({ hasText: name })).toBeVisible();
    }
  });

  // ── Open workspace ────────────────────────────────────────────────────────

  test('clicking a workspace navigates to /w/:id', async ({ page }) => {
    await page.getByLabel('New workspace name').fill('Open Me');
    await page.getByRole('button', { name: 'Create' }).click();

    await page.locator('button.ws-name').filter({ hasText: 'Open Me' }).click();
    await page.waitForURL(/\/w\//);
    expect(page.url()).toMatch(/\/w\//);
  });

  test('workspace layout shows workspace name in header', async ({ page }) => {
    await page.getByLabel('New workspace name').fill('Layout Test');
    await page.getByRole('button', { name: 'Create' }).click();

    await page.locator('button.ws-name').filter({ hasText: 'Layout Test' }).click();
    await page.waitForURL(/\/w\//);

    await expect(page.locator('.ws-title')).toHaveText('Layout Test', { timeout: 15000 });
  });

  test('workspace layout has Canvas and Mutual Help tabs', async ({ page }) => {
    await page.getByLabel('New workspace name').fill('Tab Test');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.locator('button.ws-name').filter({ hasText: 'Tab Test' }).click();
    await page.waitForURL(/\/w\//);

    await expect(page.locator('button:has-text("Canvas")')).toBeVisible();
    await expect(page.locator('button:has-text("Mutual Help")')).toBeVisible();
  });

  test('back link in workspace returns to /workspaces', async ({ page }) => {
    await page.getByLabel('New workspace name').fill('Back Test');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.locator('button.ws-name').filter({ hasText: 'Back Test' }).click();
    await page.waitForURL(/\/w\//);

    await page.locator('a[aria-label="Back to workspaces"], a:has-text("←")').first().click();
    await page.waitForURL(/\/workspaces/);
    expect(page.url()).toMatch(/\/workspaces/);
  });

  // ── Rename workspace ──────────────────────────────────────────────────────

  test('renames a workspace via the rename dialog', async ({ page }) => {
    await page.getByLabel('New workspace name').fill('To Rename');
    await page.getByRole('button', { name: 'Create' }).click();

    // Click rename (✏) button
    await page.locator('button[aria-label="Rename"]').first().click();

    // Rename dialog should appear
    const renameInput = page.locator('[role="dialog"] input, .rename-card input');
    await renameInput.clear();
    await renameInput.fill('Renamed!');
    await page.locator('[role="dialog"] button:has-text("Save"), .rename-card button:has-text("Save")').click();

    await expect(page.locator('text=Renamed!')).toBeVisible();
    await expect(page.locator('text=To Rename')).not.toBeVisible();
  });

  test('cancel rename dialog keeps original name', async ({ page }) => {
    await page.getByLabel('New workspace name').fill('Keep Name');
    await page.getByRole('button', { name: 'Create' }).click();

    await page.locator('button[aria-label="Rename"]').first().click();

    const renameInput = page.locator('[role="dialog"] input, .rename-card input');
    await renameInput.clear();
    await renameInput.fill('Changed');
    await page.locator('[role="dialog"] button:has-text("Cancel"), .rename-card button:has-text("Cancel")').click();

    await expect(page.locator('text=Keep Name')).toBeVisible();
  });

  // ── Delete workspace ──────────────────────────────────────────────────────

  test('deletes a workspace and it disappears from the list', async ({ page }) => {
    await page.getByLabel('New workspace name').fill('To Delete');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.locator('text=To Delete')).toBeVisible();

    // Accept the confirm dialog
    page.on('dialog', dialog => dialog.accept());
    await page.locator('button[aria-label="Delete"]').first().click();

    await expect(page.locator('text=To Delete')).not.toBeVisible();
  });

  test('cancelling delete keeps the workspace', async ({ page }) => {
    await page.getByLabel('New workspace name').fill('Keep This');
    await page.getByRole('button', { name: 'Create' }).click();

    // Dismiss confirm dialog
    page.on('dialog', dialog => dialog.dismiss());
    await page.locator('button[aria-label="Delete"]').first().click();

    await expect(page.locator('text=Keep This')).toBeVisible();
  });
});
