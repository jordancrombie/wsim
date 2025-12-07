/**
 * WSIM Enrollment Helpers for E2E Tests
 *
 * Provides functions for enrolling in WSIM (Wallet Simulator)
 * via the BSIM OAuth flow.
 */

import { Page, expect } from '@playwright/test';
import { getUrls, WSIM_PAGES } from '../../fixtures/urls';

export interface EnrollmentOptions {
  /** Skip the password setup step (use passkey-only authentication) */
  skipPassword?: boolean;
  /** Password to set during enrollment (if not skipping) */
  password?: string;
  /** Select all available cards during enrollment */
  selectAllCards?: boolean;
  /** Specific card last4 digits to select */
  selectCards?: string[];
  /** BSIM email for OAuth login */
  bsimEmail?: string;
  /** BSIM password for OAuth login */
  bsimPassword?: string;
}

/**
 * Complete the WSIM enrollment flow via BSIM OAuth
 *
 * Prerequisites:
 * - User must be logged into BSIM in the same browser context
 * - User must have credit cards added to their BSIM account
 *
 * @param page - Playwright page object
 * @param options - Enrollment options
 *
 * @example
 * ```typescript
 * // First, login to BSIM
 * await loginBsimUser(page, user.email, user.password);
 *
 * // Then enroll in WSIM
 * await enrollWsimUser(page, {
 *   skipPassword: true,
 *   selectAllCards: true
 * });
 * ```
 */
export async function enrollWsimUser(
  page: Page,
  options: EnrollmentOptions = {}
): Promise<void> {
  const urls = getUrls();
  const {
    skipPassword = true,
    password = 'WalletPass123!',
    selectAllCards = true,
    selectCards = [],
    bsimEmail,
    bsimPassword,
  } = options;

  // Step 1: Navigate to WSIM enrollment page
  await page.goto(`${urls.wsim}${WSIM_PAGES.enroll}`);

  // Wait for enrollment page to load
  // WSIM shows "Enroll in Wallet" h1 header
  await expect(
    page.getByRole('heading', { name: 'Enroll in Wallet' })
  ).toBeVisible({ timeout: 10000 });

  // Step 2: Password setup (or skip)
  if (skipPassword) {
    // Look for "Skip for now (use passkey later)" link
    const skipButton = page.getByText(/skip for now/i);
    await skipButton.click({ timeout: 5000 });
  } else {
    // Fill password fields
    const passwordInput = page.getByPlaceholder(/at least 8 characters/i);
    const confirmInput = page.getByPlaceholder(/re-enter your password/i);

    await passwordInput.fill(password);
    await confirmInput.fill(password);

    // Continue to next step
    const continueButton = page.getByRole('button', { name: /Continue to Bank Selection/i });
    await continueButton.click();
  }

  // Step 3: Bank selection - Select BSIM bank
  await expect(
    page.getByRole('heading', { name: 'Select Your Bank' })
  ).toBeVisible({ timeout: 10000 });

  // Click on Bank Simulator option
  const bankOption = page.getByText('Bank Simulator');
  await bankOption.click();

  // Step 4: BSIM OAuth login flow
  // After selecting bank, we're redirected to BSIM's OAuth login page
  // Wait for the BSIM login page to appear
  await expect(
    page.getByRole('heading', { name: 'Sign in to continue' })
  ).toBeVisible({ timeout: 10000 });

  // Fill BSIM credentials
  if (!bsimEmail || !bsimPassword) {
    throw new Error(
      'BSIM OAuth login required. Pass bsimEmail and bsimPassword in enrollment options.'
    );
  }

  const emailInput = page.getByPlaceholder('you@example.com');
  const passwordInput = page.getByLabel('Password');

  await emailInput.fill(bsimEmail);
  await passwordInput.fill(bsimPassword);

  // Click Sign In
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Step 5: OAuth consent screen (after login)
  // Wait for consent or automatic redirect to card selection
  await page.waitForTimeout(2000);

  const consentButton = page.getByRole('button', { name: /Allow|Authorize|Approve|Grant/i });
  if (await consentButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await consentButton.click();
  }

  // Step 6: Card selection
  // Wait for card selection page to appear - BSIM shows "Add Cards to Wallet"
  await expect(
    page.getByRole('heading', { name: /Add Cards|Select Cards|Choose Cards/i })
  ).toBeVisible({ timeout: 15000 });

  if (selectAllCards) {
    // Click "Select All Cards" checkbox
    const selectAllCheckbox = page.getByText('Select All Cards');
    await selectAllCheckbox.click();
  } else if (selectCards.length > 0) {
    // Select specific cards by last 4 digits
    for (const last4 of selectCards) {
      const cardRow = page.locator(`text=${last4}`).locator('..').locator('..');
      const checkbox = cardRow.locator('input[type="checkbox"]');
      if (!(await checkbox.isChecked())) {
        await checkbox.click();
      }
    }
  }

  // Step 7: Complete enrollment - look for button at bottom
  // The button might say "Enroll Cards", "Add Cards", "Continue", etc.
  const completeButton = page.getByRole('button', { name: /Enroll|Add|Continue|Complete|Finish|Done|Import/i });
  await completeButton.click();

  // Verify enrollment success - should redirect to dashboard or show success
  await expect(page).toHaveURL(/\/(dashboard|wallet|home)/, { timeout: 15000 });
}

/**
 * Check if user is already enrolled in WSIM
 *
 * @param page - Playwright page object
 * @returns true if enrolled
 */
export async function isWsimEnrolled(page: Page): Promise<boolean> {
  const urls = getUrls();

  try {
    await page.goto(`${urls.wsim}${WSIM_PAGES.dashboard}`);
    // If we can access dashboard, we're enrolled
    await expect(page).toHaveURL(/\/(dashboard|wallet)/, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the count of cards in the WSIM wallet
 *
 * @param page - Playwright page object
 * @returns Number of cards in wallet
 */
export async function getWsimCardCount(page: Page): Promise<number> {
  const urls = getUrls();

  await page.goto(`${urls.wsim}${WSIM_PAGES.wallet}`);

  // Wait for wallet page to load - WSIM shows "My Wallet" heading
  await expect(
    page.getByRole('heading', { name: /My Wallet/i })
  ).toBeVisible({ timeout: 10000 });

  await page.waitForTimeout(1000);

  // Count cards by looking for masked card numbers (****XXXX pattern)
  const pageContent = await page.content();
  const cardMatches = pageContent.match(/\*{4}\d{4}/g) || [];
  return cardMatches.length;
}

/**
 * Get the last 4 digits of all cards in the WSIM wallet
 *
 * @param page - Playwright page object
 * @returns Array of last 4 digits strings
 */
export async function getWsimCardLast4s(page: Page): Promise<string[]> {
  const urls = getUrls();

  await page.goto(`${urls.wsim}${WSIM_PAGES.wallet}`);

  // Wait for wallet page to load - WSIM shows "My Wallet" heading
  await expect(
    page.getByRole('heading', { name: /My Wallet/i })
  ).toBeVisible({ timeout: 10000 });

  await page.waitForTimeout(1000);

  // WSIM shows cards as "****XXXX" pattern
  const pageContent = await page.content();
  const matches = pageContent.match(/\*{4}(\d{4})/g) || [];

  const last4s: string[] = [];
  for (const match of matches) {
    const digits = match.match(/(\d{4})$/);
    if (digits) {
      last4s.push(digits[1]);
    }
  }

  return [...new Set(last4s)]; // Remove duplicates
}

/**
 * Add another bank to an existing WSIM wallet
 *
 * @param page - Playwright page object
 * @param bankName - Name of the bank to add (e.g., "BankSim")
 */
export async function addBankToWsim(page: Page, bankName: string): Promise<void> {
  const urls = getUrls();

  // Navigate to banks page
  await page.goto(`${urls.wsim}${WSIM_PAGES.banks}`);

  // Click add bank button
  const addButton = page.locator(
    'button:has-text("Add Bank"), button:has-text("Connect Bank"), button:has-text("Link Bank")'
  );
  await addButton.first().click();

  // Select the specified bank
  const bankOption = page.locator(`button:has-text("${bankName}"), text=${bankName}`);
  await bankOption.first().click();

  // Complete OAuth flow (assuming user is logged into the bank)
  const consentButton = page.locator(
    'button:has-text("Allow"), button:has-text("Authorize")'
  );
  if (await consentButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await consentButton.first().click();
  }

  // Verify success
  await expect(
    page.locator(`text=${bankName}, text=Connected, text=Linked`).first()
  ).toBeVisible({ timeout: 15000 });
}
