/**
 * WSIM Passkey Helpers for E2E Tests
 *
 * Provides functions for registering and authenticating with
 * passkeys on WSIM (Wallet Simulator).
 */

import { Page, expect } from '@playwright/test';
import { getUrls, WSIM_PAGES } from '../../fixtures/urls';
import {
  WebAuthnContext,
  simulatePasskeySuccess,
  simulatePasskeyFailure,
} from '../webauthn.helpers';

/**
 * Register a passkey for the currently logged-in WSIM user
 *
 * Requires the user to be logged in and a virtual authenticator to be set up.
 *
 * @param page - Playwright page object
 * @param webauthn - WebAuthn context from setupVirtualAuthenticator
 *
 * @example
 * ```typescript
 * const webauthn = await setupVirtualAuthenticator(page);
 * await loginWsimUser(page, user.email, user.password);
 * await registerWsimPasskey(page, webauthn);
 * ```
 */
export async function registerWsimPasskey(
  page: Page,
  webauthn: WebAuthnContext
): Promise<void> {
  const urls = getUrls();

  // Navigate to passkeys settings page
  await page.goto(`${urls.wsim}${WSIM_PAGES.passkeys}`);

  // Wait for the page to load
  await expect(
    page.locator('text=Passkey, text=Security, text=Authentication').first()
  ).toBeVisible({ timeout: 10000 });

  // Find and click the passkey registration button
  const setupButton = page.locator(
    'button:has-text("Add Passkey"), button:has-text("Register Passkey"), button:has-text("Set Up Passkey"), button:has-text("Create Passkey")'
  );

  // Simulate successful passkey registration
  await simulatePasskeySuccess(webauthn, async () => {
    await setupButton.first().click();
  });

  // Verify success message or indicator
  await expect(
    page.locator('text=Passkey registered, text=Passkey added, text=successfully, text=Created').first()
  ).toBeVisible({ timeout: 10000 });
}

/**
 * Login to WSIM using a passkey (passwordless)
 *
 * Requires a virtual authenticator with a previously registered credential.
 *
 * @param page - Playwright page object
 * @param webauthn - WebAuthn context with registered credential
 *
 * @example
 * ```typescript
 * const webauthn = await setupVirtualAuthenticator(page);
 * // ... register passkey first ...
 * await logoutWsimUser(page);
 * await loginWsimWithPasskey(page, webauthn);
 * ```
 */
export async function loginWsimWithPasskey(
  page: Page,
  webauthn: WebAuthnContext
): Promise<void> {
  const urls = getUrls();

  // Navigate to login page
  await page.goto(`${urls.wsim}${WSIM_PAGES.login}`);

  // Find and click the passkey login button
  const passkeyButton = page.locator(
    'button:has-text("Sign in with Passkey"), button:has-text("Use Passkey"), button:has-text("Passkey Login"), button:has-text("Passkey")'
  );

  // Simulate successful passkey authentication
  await simulatePasskeySuccess(webauthn, async () => {
    await passkeyButton.first().click();
  });

  // Verify we reached the dashboard
  await expect(page).toHaveURL(/\/(dashboard|wallet|home)/, { timeout: 10000 });
}

/**
 * Test WSIM passkey login failure scenario
 *
 * @param page - Playwright page object
 * @param webauthn - WebAuthn context
 */
export async function testWsimPasskeyLoginFailure(
  page: Page,
  webauthn: WebAuthnContext
): Promise<void> {
  const urls = getUrls();

  // Navigate to login page
  await page.goto(`${urls.wsim}${WSIM_PAGES.login}`);

  // Find the passkey login button
  const passkeyButton = page.locator(
    'button:has-text("Sign in with Passkey"), button:has-text("Use Passkey"), button:has-text("Passkey")'
  );

  // Simulate failed passkey authentication
  await simulatePasskeyFailure(
    webauthn,
    async () => {
      await passkeyButton.first().click();
    },
    async () => {
      // Verify error message appears
      await expect(
        page.locator('text=failed, text=error, text=could not, text=cancelled').first()
      ).toBeVisible({ timeout: 10000 });
    }
  );
}

/**
 * Check if user has passkey registered in WSIM
 *
 * @param page - Playwright page object
 * @returns true if passkey is registered
 */
export async function hasWsimPasskeyRegistered(page: Page): Promise<boolean> {
  const urls = getUrls();

  await page.goto(`${urls.wsim}${WSIM_PAGES.passkeys}`);

  // Look for indicators that a passkey is registered
  const registeredIndicator = page.locator(
    'text=Passkey registered, text=Remove Passkey, text=Delete, [data-testid="passkey-item"]'
  );

  try {
    await registeredIndicator.first().waitFor({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the count of passkeys registered for the current user
 *
 * @param page - Playwright page object
 * @returns Number of passkeys registered
 */
export async function getWsimPasskeyCount(page: Page): Promise<number> {
  const urls = getUrls();

  await page.goto(`${urls.wsim}${WSIM_PAGES.passkeys}`);

  // Wait for page to load
  await expect(
    page.locator('text=Passkey, text=Security').first()
  ).toBeVisible({ timeout: 10000 });

  // Count passkey items
  const passkeyItems = page.locator(
    '[data-testid="passkey-item"], .passkey-item, [class*="passkey"]'
  );

  await page.waitForTimeout(1000);
  return await passkeyItems.count();
}

/**
 * Remove/delete a registered WSIM passkey
 *
 * @param page - Playwright page object
 * @param index - Index of passkey to remove (0-based), defaults to first
 */
export async function removeWsimPasskey(page: Page, index = 0): Promise<void> {
  const urls = getUrls();

  await page.goto(`${urls.wsim}${WSIM_PAGES.passkeys}`);

  // Find passkey items
  const passkeyItems = page.locator(
    '[data-testid="passkey-item"], .passkey-item'
  );

  // Find and click the remove button for the specified passkey
  const targetPasskey = passkeyItems.nth(index);
  const removeButton = targetPasskey.locator(
    'button:has-text("Remove"), button:has-text("Delete"), [aria-label="Delete"]'
  );

  await removeButton.first().click();

  // Confirm deletion if prompted
  const confirmButton = page.locator(
    'button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Delete")'
  );
  try {
    await confirmButton.first().click({ timeout: 3000 });
  } catch {
    // No confirmation needed
  }

  // Verify removal
  await expect(
    page.locator('text=Passkey removed, text=Passkey deleted, text=removed successfully').first()
  ).toBeVisible({ timeout: 10000 });
}

/**
 * Use passkey to authenticate a payment in WSIM
 *
 * This is used during the embedded wallet payment flow where the user
 * needs to authenticate with their passkey to confirm a payment.
 *
 * @param page - Playwright page object (can be popup or iframe)
 * @param webauthn - WebAuthn context
 * @param amount - Payment amount to verify in the prompt
 */
export async function authenticateWsimPaymentWithPasskey(
  page: Page,
  webauthn: WebAuthnContext,
  amount?: string
): Promise<void> {
  // If amount provided, verify it's displayed
  if (amount) {
    await expect(page.locator(`text=${amount}`)).toBeVisible({ timeout: 5000 });
  }

  // Find and click the authenticate/confirm button
  const authButton = page.locator(
    'button:has-text("Authenticate"), button:has-text("Confirm"), button:has-text("Pay"), button:has-text("Approve")'
  );

  // Simulate successful passkey authentication
  await simulatePasskeySuccess(webauthn, async () => {
    await authButton.first().click();
  });
}
