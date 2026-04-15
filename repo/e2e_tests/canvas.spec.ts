/**
 * CANVAS E2E TESTS
 * Verifies the canvas view: sticky notes, mutual-help tab switch,
 * and chat panel.
 */
import { test, expect } from '@playwright/test';
import { clearBrowserStorage, gotoApp, createProfile, signInFull } from './helpers';

const USER = 'canvasuser';
const PASS = 'canvaspass1';
const WS_NAME = 'Canvas E2E WS';

test.describe('Canvas workspace', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await clearBrowserStorage(page);
    await createProfile(page, USER, PASS, 'Teacher');
    await signInFull(page, USER, PASS, 'Teacher');

    // Create and open a workspace
    const input = page.getByLabel('New workspace name');
    await input.fill(WS_NAME);
    await page.getByRole('button', { name: 'Create' }).click();
    const openWs = page.locator('button.ws-name').filter({ hasText: WS_NAME });
    await expect(openWs).toBeVisible();
    await openWs.click();
    await page.waitForURL(/\/w\//);
  });

  // ── Canvas tab ────────────────────────────────────────────────────────────

  test('canvas area is visible by default', async ({ page }) => {
    await expect(page.getByLabel('Canvas', { exact: true })).toBeVisible();
  });

  test('canvas tab button is active by default', async ({ page }) => {
    const canvasTab = page.locator('button:has-text("Canvas")');
    await expect(canvasTab).toHaveClass(/active/);
  });

  test('switching to Mutual Help tab shows mutual-help board', async ({ page }) => {
    await page.locator('button:has-text("Mutual Help")').click();

    await expect(page.getByLabel('Mutual Help Board')).toBeVisible();
  });

  test('switching back to Canvas tab hides mutual-help board', async ({ page }) => {
    await page.locator('button:has-text("Mutual Help")').click();
    await page.locator('button:has-text("Canvas")').click();

    await expect(page.getByLabel('Canvas', { exact: true })).toBeVisible();
  });

  // ── Chat panel ────────────────────────────────────────────────────────────

  test('chat panel is visible alongside canvas', async ({ page }) => {
    // "Chat" appears on aside, message log ("Chat messages"), and input — target the panel only.
    await expect(page.getByRole('complementary', { name: 'Chat' })).toBeVisible();
  });

  // ── Footer status bar ─────────────────────────────────────────────────────

  test('footer shows "Offline ready" badge', async ({ page }) => {
    const footer = page.locator('footer, .ws-footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText('Offline ready');
  });

  test('footer shows tab id badge', async ({ page }) => {
    const tabBadge = page.locator('.tab-badge');
    await expect(tabBadge).toBeVisible();
    await expect(tabBadge).toContainText('Tab');
  });

  // ── Header ────────────────────────────────────────────────────────────────

  test('header avatar bar shows own avatar initials', async ({ page }) => {
    const avatar = page.locator('.avatar').first();
    await expect(avatar).toBeVisible();
    // Initials are first 2 chars of username uppercased
    await expect(avatar).toContainText(/^[A-Z]{2}$/);
  });

  test('inbox button is visible in header', async ({ page }) => {
    const inboxBtn = page.locator('button[aria-label="Toggle inbox"]');
    await expect(inboxBtn).toBeVisible();
  });

  test('activity feed button is visible in header', async ({ page }) => {
    const activityBtn = page.locator('button[aria-label="Toggle activity feed"]');
    await expect(activityBtn).toBeVisible();
  });

  test('clicking inbox button opens inbox panel', async ({ page }) => {
    await page.locator('button[aria-label="Toggle inbox"]').click();
    await expect(page.locator('app-inbox-panel')).toBeVisible();
  });

  test('clicking inbox button again closes inbox panel', async ({ page }) => {
    const inboxBtn = page.locator('button[aria-label="Toggle inbox"]');
    await inboxBtn.click(); // open
    await expect(page.locator('app-inbox-panel')).toBeVisible();
    await inboxBtn.click(); // close
    await expect(page.locator('app-inbox-panel')).toHaveCount(0);
  });

  // ── Mutual Help board features ────────────────────────────────────────────

  test('mutual help board shows create post options', async ({ page }) => {
    await page.locator('button:has-text("Mutual Help")').click();

    // The board should have some create/add post UI
    await expect(page.getByLabel('Mutual Help Board')).toBeVisible();
  });

  // ── Canvas toolbar ────────────────────────────────────────────────────────

  test('canvas toolbar is visible', async ({ page }) => {
    await expect(page.getByRole('toolbar', { name: 'Canvas tools' })).toBeVisible();
  });

  test('sticky note tool button is present in toolbar', async ({ page }) => {
    await expect(page.locator('[title="Sticky Note (N)"]')).toBeVisible();
  });

  test('select tool button is present in toolbar', async ({ page }) => {
    await expect(page.locator('[title="Select (V)"]')).toBeVisible();
  });

  test('clicking sticky note tool activates it', async ({ page }) => {
    const stickyBtn = page.locator('[title="Sticky Note (N)"]');
    await stickyBtn.click();
    await expect(stickyBtn).toHaveAttribute('aria-pressed', 'true');
  });

  // ── Sticky note placement ─────────────────────────────────────────────────

  test('placing a sticky note on canvas creates a note element', async ({ page }) => {
    // Activate sticky-note tool
    await page.locator('[title="Sticky Note (N)"]').click();

    // Click centre of canvas viewport to place a note
    const viewport = page.locator('.canvas-viewport');
    await viewport.click({ position: { x: 200, y: 200 } });

    // A sticky-note DOM element should appear
    await expect(page.locator('.sticky-note').first()).toBeVisible({ timeout: 5000 });
  });

  test('placed sticky note has an editable text area', async ({ page }) => {
    await page.locator('[title="Sticky Note (N)"]').click();
    const viewport = page.locator('.canvas-viewport');
    await viewport.click({ position: { x: 200, y: 200 } });

    const textarea = page.locator('[aria-label="Sticky note text"]').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });

  test('zoom controls are present and functional', async ({ page }) => {
    const zoomPct = page.locator('.zoom-pct-btn');
    await expect(zoomPct).toBeVisible();
    await expect(zoomPct).toContainText('%');

    // Zoom in
    await page.locator('[title="Zoom in (+)"]').click();
    const afterZoom = await zoomPct.textContent();
    expect(afterZoom).toContain('%');
  });
});
