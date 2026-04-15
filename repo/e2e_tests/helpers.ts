import { type Page, expect } from '@playwright/test';

/** Clear all IndexedDB databases and localStorage for a fresh-start test. */
export async function clearBrowserStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    // Delete the secureroom IndexedDB
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('secureroom');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error('Failed to delete IDB'));
      req.onblocked = () => {
        // May be blocked by open connections; resolve anyway
        resolve();
      };
    });
  });
  // Reload to start fresh
  await page.reload({ waitUntil: 'networkidle' });
}

/** Navigate to the app and wait for the profiles list page. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForURL(/\/profiles/);
}

/** Create a new profile via the UI. Returns the username used. */
export async function createProfile(
  page: Page,
  username: string,
  password: string,
  role: 'Admin' | 'Academic Affairs' | 'Teacher' = 'Admin',
): Promise<void> {
  await page.goto('/profiles/new');
  await page.waitForSelector('[data-testid="username-input"], input[name="username"], input[type="text"]');

  // Fill username
  const usernameInput = page.locator('input').first();
  await usernameInput.fill(username);

  // Fill password
  const passwordInputs = page.locator('input[type="password"]');
  await passwordInputs.first().fill(password);
  if ((await passwordInputs.count()) > 1) {
    await passwordInputs.nth(1).fill(password);
  }

  // Select role if there's a role selector
  const roleSelect = page.locator('select');
  if ((await roleSelect.count()) > 0) {
    await roleSelect.selectOption(role);
  }

  // Submit
  const submitButton = page.locator('button[type="submit"], button').last();
  await submitButton.click();

  // Wait for navigation AWAY from /profiles/new to the list or sign-in page.
  // A regex like /\/profiles|\/sign-in/ matches /profiles/new too (it's still a
  // substring), so waitForURL would return immediately — before the form had
  // even submitted. Use a precise predicate that excludes the create page.
  await page.waitForURL((url) => {
    const path = new URL(url).pathname;
    return path === '/profiles' || path.startsWith('/sign-in');
  });
}

/** Sign in as an existing profile. Lands on /persona. */
export async function signIn(page: Page, username: string, password: string): Promise<void> {
  // Find the profile in the list
  await page.goto('/profiles');
  await page.waitForLoadState('networkidle');

  // Look for a button with the username
  const profileLink = page.locator(`text=${username}`).first();
  await profileLink.waitFor({ state: 'visible' });
  await profileLink.click();

  // Enter password on sign-in page
  await page.waitForURL(/\/sign-in/);
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(password);

  const signInButton = page.locator('button[type="submit"], button').last();
  await signInButton.click();

  // Wait for navigation to persona or workspace area
  await page.waitForURL(/\/workspaces|\/persona/);
}

/** Select a persona role on the /persona page and wait for /workspaces. */
export async function selectPersona(
  page: Page,
  role: 'Admin' | 'Academic Affairs' | 'Teacher' = 'Teacher',
): Promise<void> {
  await page.waitForURL(/\/persona/);
  await page.locator(`text=${role}`).first().click();
  await page.waitForURL(/\/workspaces/);
}

/** Full sign-in flow: sign in and select persona role. Lands on /workspaces. */
export async function signInFull(
  page: Page,
  username: string,
  password: string,
  role: 'Admin' | 'Academic Affairs' | 'Teacher' = 'Teacher',
): Promise<void> {
  await signIn(page, username, password);
  if (page.url().includes('/persona')) {
    await selectPersona(page, role);
  }
}
