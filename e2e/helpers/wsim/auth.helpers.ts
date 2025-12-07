/**
 * WSIM Authentication Helpers for E2E Tests
 *
 * Provides functions for logging in and managing
 * authentication state on WSIM (Wallet Simulator).
 */

import { Page, expect } from '@playwright/test';
import { getUrls, WSIM_PAGES } from '../../fixtures/urls';

/**
 * Login to WSIM with email and password
 *
 * @param page - Playwright page object
 * @param email - User email
 * @param password - User password (set during enrollment)
 *
 * @example
 * ```typescript
 * await loginWsimUser(page, 'user@example.com', 'WalletPass123!');
 * ```
 */
export async function loginWsimUser(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  const urls = getUrls();

  // Navigate to login page
  await page.goto(`${urls.wsim}${WSIM_PAGES.login}`);

  // Wait for login form to load
  await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible({
    timeout: 10000,
  });

  // Fill in credentials
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);

  // Submit login form
  const submitButton = page.locator(
    'button[type="submit"], button:has-text("Login"), button:has-text("Sign in")'
  );
  await submitButton.first().click();

  // Verify we reached the dashboard
  await expect(page).toHaveURL(/\/(dashboard|wallet|home)/, { timeout: 10000 });
}

/**
 * Logout the current WSIM user
 *
 * @param page - Playwright page object
 */
export async function logoutWsimUser(page: Page): Promise<void> {
  // Look for logout button in the header or profile menu
  const logoutButton = page.locator(
    'button:has-text("Logout"), button:has-text("Sign out"), button:has-text("Log out"), a:has-text("Logout")'
  );

  // If not visible, might need to open profile menu first
  if (!(await logoutButton.first().isVisible().catch(() => false))) {
    const profileButton = page.locator(
      'button:has-text("Profile"), [aria-label="Profile"], [data-testid="profile-menu"]'
    );
    if (await profileButton.first().isVisible().catch(() => false)) {
      await profileButton.first().click();
      await page.waitForTimeout(500);
    }
  }

  await logoutButton.first().click();

  // Verify we're redirected to login or home
  await expect(page).toHaveURL(/\/(login|home)?$/, { timeout: 10000 });
}

/**
 * Check if user is logged into WSIM
 *
 * @param page - Playwright page object
 * @returns true if logged in
 */
export async function isWsimLoggedIn(page: Page): Promise<boolean> {
  const urls = getUrls();

  try {
    await page.goto(`${urls.wsim}${WSIM_PAGES.dashboard}`);
    // If we can access dashboard without redirect, we're logged in
    await expect(page).toHaveURL(/\/(dashboard|wallet)/, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear WSIM authentication state
 *
 * @param page - Playwright page object
 */
export async function clearWsimAuthState(page: Page): Promise<void> {
  const urls = getUrls();

  // Navigate to WSIM domain first
  await page.goto(urls.wsim);

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // Also clear cookies for session-based auth
  const context = page.context();
  await context.clearCookies();
}

/**
 * Verify user is on the WSIM dashboard with expected elements
 *
 * @param page - Playwright page object
 */
export async function verifyWsimDashboard(page: Page): Promise<void> {
  // Check we're on dashboard/wallet page
  await expect(page).toHaveURL(/\/(dashboard|wallet)/, { timeout: 10000 });

  // WSIM shows "My Wallet" heading on the wallet page
  await expect(
    page.getByRole('heading', { name: /My Wallet|Wallet|Dashboard/i })
  ).toBeVisible({ timeout: 10000 });
}

/**
 * Navigate to WSIM profile/settings
 *
 * @param page - Playwright page object
 */
export async function navigateToWsimProfile(page: Page): Promise<void> {
  const urls = getUrls();
  await page.goto(`${urls.wsim}${WSIM_PAGES.profile}`);
  await expect(page).toHaveURL(/\/profile/);
}

/**
 * Navigate to WSIM settings
 *
 * @param page - Playwright page object
 */
export async function navigateToWsimSettings(page: Page): Promise<void> {
  const urls = getUrls();
  await page.goto(`${urls.wsim}${WSIM_PAGES.settings}`);
  await expect(page).toHaveURL(/\/settings/);
}

/**
 * Get current user info from WSIM
 *
 * @param page - Playwright page object
 * @returns User info object or null if not logged in
 */
export async function getWsimCurrentUser(
  page: Page
): Promise<{ email: string; name?: string } | null> {
  const urls = getUrls();

  try {
    await page.goto(`${urls.wsim}${WSIM_PAGES.profile}`);

    // Look for email display
    const emailElement = page.locator('[data-testid="user-email"], text=@').first();
    const email = await emailElement.textContent();

    // Look for name display
    const nameElement = page.locator('[data-testid="user-name"]').first();
    const name = await nameElement.textContent().catch(() => undefined);

    return { email: email || '', name: name || undefined };
  } catch {
    return null;
  }
}
