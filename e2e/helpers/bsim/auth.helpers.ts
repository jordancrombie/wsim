/**
 * BSIM Authentication Helpers for E2E Tests
 *
 * Provides functions for signing up, logging in, and managing
 * authentication state on BSIM (Bank Simulator).
 */

import { Page, expect } from '@playwright/test';
import { TestUser } from '../../fixtures/test-data';
import { getUrls, BSIM_PAGES } from '../../fixtures/urls';

/**
 * Complete the full signup flow for a new BSIM user
 *
 * @param page - Playwright page object
 * @param user - Test user data
 * @param options - Additional options
 *
 * @example
 * ```typescript
 * const user = createTestUser();
 * await signupBsimUser(page, user);
 * ```
 */
export async function signupBsimUser(
  page: Page,
  user: TestUser,
  options: {
    skipPasskeyPrompt?: boolean;
  } = { skipPasskeyPrompt: true }
): Promise<void> {
  const urls = getUrls();

  // Navigate to signup page
  await page.goto(`${urls.bsim}${BSIM_PAGES.signup}`);

  // Step 1: Account Information
  await page.fill('#firstName', user.firstName);
  await page.fill('#lastName', user.lastName);
  await page.fill('#email', user.email);
  await page.fill('#password', user.password);
  await page.fill('#confirmPassword', user.password);

  // Click continue to step 2
  await page.click('button[type="submit"]');

  // Wait for step 2 to load
  await expect(page.locator('text=Customer Information')).toBeVisible({ timeout: 10000 });

  // Step 2: Customer Information (optional fields)
  if (user.phone) {
    await page.fill('#phone', user.phone);
  }
  if (user.address) {
    await page.fill('#address', user.address.street);
    await page.fill('#city', user.address.city);
    // Province/state may be a select or input
    const stateSelect = page.locator('#state');
    if (await stateSelect.isVisible()) {
      await stateSelect.selectOption(user.address.province);
    }
    await page.fill('#postalCode', user.address.postalCode);
  }

  // Submit signup form
  await page.click('button[type="submit"]:has-text("Create Account")');

  // Handle passkey prompt if it appears
  if (options.skipPasskeyPrompt) {
    // Look for "Skip for now" or similar button, but don't fail if not present
    const skipButton = page.locator(
      'button:has-text("Skip"), button:has-text("skip"), button:has-text("later"), button:has-text("Later"), button:has-text("Not now")'
    );
    try {
      await skipButton.first().click({ timeout: 3000 });
    } catch {
      // Passkey prompt didn't appear, that's fine
    }
  }

  // Verify we reached the dashboard
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
}

/**
 * Login to BSIM with email and password
 *
 * @param page - Playwright page object
 * @param email - User email
 * @param password - User password
 *
 * @example
 * ```typescript
 * await loginBsimUser(page, 'user@example.com', 'password123');
 * ```
 */
export async function loginBsimUser(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  const urls = getUrls();

  // Navigate to login page
  await page.goto(`${urls.bsim}${BSIM_PAGES.login}`);

  // Fill in credentials
  await page.fill('#email', email);
  await page.fill('#password', password);

  // Submit login form
  await page.click('button[type="submit"]');

  // Verify we reached the dashboard
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
}

/**
 * Logout the current BSIM user
 *
 * @param page - Playwright page object
 */
export async function logoutBsimUser(page: Page): Promise<void> {
  // Look for logout button in the dashboard header
  const logoutButton = page.locator(
    'button:has-text("Logout"), button:has-text("Sign out"), button:has-text("Log out")'
  );
  await logoutButton.first().click();

  // Verify we're redirected to home or login
  await expect(page).toHaveURL(/\/(login)?$/, { timeout: 10000 });
}

/**
 * Check if user is logged into BSIM by verifying dashboard access
 *
 * @param page - Playwright page object
 * @returns true if logged in, false otherwise
 */
export async function isBsimLoggedIn(page: Page): Promise<boolean> {
  const urls = getUrls();

  try {
    await page.goto(`${urls.bsim}${BSIM_PAGES.dashboard}`);
    // If we can access dashboard without redirect, we're logged in
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear BSIM authentication state (localStorage token)
 *
 * @param page - Playwright page object
 */
export async function clearBsimAuthState(page: Page): Promise<void> {
  const urls = getUrls();

  // Navigate to BSIM domain first to ensure we're in the right context
  await page.goto(urls.bsim);

  await page.evaluate(() => {
    localStorage.removeItem('token');
    localStorage.clear();
    sessionStorage.clear();
  });
}

/**
 * Get the current BSIM auth token from localStorage
 *
 * @param page - Playwright page object
 * @returns The auth token or null if not found
 */
export async function getBsimAuthToken(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    return localStorage.getItem('token');
  });
}

/**
 * Verify user is on the BSIM dashboard with expected elements
 *
 * @param page - Playwright page object
 * @param userName - Expected user name to display (optional)
 */
export async function verifyBsimDashboard(
  page: Page,
  userName?: string
): Promise<void> {
  // Check we're on dashboard
  await expect(page).toHaveURL(/\/dashboard/);

  // If userName provided, verify it's displayed
  if (userName) {
    await expect(page.locator(`text=${userName}`)).toBeVisible();
  }

  // Verify navigation sidebar elements (use first() to handle multiple matches)
  await expect(page.locator('text=Accounts').first()).toBeVisible();
  await expect(page.locator('text=Credit Cards').first()).toBeVisible();
}

/**
 * Navigate to BSIM security settings
 *
 * @param page - Playwright page object
 */
export async function navigateToBsimSecurity(page: Page): Promise<void> {
  const urls = getUrls();
  await page.goto(`${urls.bsim}${BSIM_PAGES.security}`);
  await expect(page).toHaveURL(/\/security/);
}
