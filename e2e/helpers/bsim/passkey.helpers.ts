/**
 * BSIM Passkey Helpers for E2E Tests
 *
 * Provides functions for registering and authenticating with
 * passkeys on BSIM (Bank Simulator).
 *
 * Note: In BSIM, passkey registration happens immediately after signup
 * on the "Account Created!" screen, not on a separate security page.
 */

import { Page, expect } from '@playwright/test';
import { TestUser } from '../../fixtures/test-data';
import { getUrls, BSIM_PAGES } from '../../fixtures/urls';
import {
  WebAuthnContext,
  simulatePasskeySuccess,
  simulatePasskeyFailure,
} from '../webauthn.helpers';

/**
 * Sign up a new BSIM user AND register a passkey in one flow
 *
 * This is the primary way to register a passkey in BSIM - it happens
 * right after the signup form is submitted on the "Account Created!" screen.
 *
 * @param page - Playwright page object
 * @param user - Test user data
 * @param webauthn - WebAuthn context from setupVirtualAuthenticator
 *
 * @example
 * ```typescript
 * const webauthn = await setupVirtualAuthenticator(page);
 * const user = createTestUser();
 * await signupBsimUserWithPasskey(page, user, webauthn);
 * ```
 */
export async function signupBsimUserWithPasskey(
  page: Page,
  user: TestUser,
  webauthn: WebAuthnContext
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

  // Submit signup form
  await page.click('button[type="submit"]:has-text("Create Account")');

  // Wait for passkey prompt to appear
  await expect(
    page.getByRole('heading', { name: 'Account Created!' })
  ).toBeVisible({ timeout: 10000 });

  // Register passkey using virtual authenticator
  await simulatePasskeySuccess(webauthn, async () => {
    await page.getByRole('button', { name: 'Set Up Passkey' }).click();
  });

  // Should be redirected to dashboard
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
}

/**
 * Register a passkey during the post-signup flow
 *
 * Call this when you're already on the "Account Created!" screen
 * after signup.
 *
 * @param page - Playwright page object
 * @param webauthn - WebAuthn context from setupVirtualAuthenticator
 */
export async function registerBsimPasskeyOnSignup(
  page: Page,
  webauthn: WebAuthnContext
): Promise<void> {
  // Wait for passkey prompt to appear
  await expect(
    page.getByRole('heading', { name: 'Account Created!' })
  ).toBeVisible({ timeout: 10000 });

  // Register passkey using virtual authenticator
  await simulatePasskeySuccess(webauthn, async () => {
    await page.getByRole('button', { name: 'Set Up Passkey' }).click();
  });

  // Should be redirected to dashboard
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
}

/**
 * @deprecated In BSIM, passkeys are only registered during signup.
 * Use signupBsimUserWithPasskey() for new users, or
 * registerBsimPasskeyOnSignup() if already on the signup success screen.
 */
export async function registerBsimPasskey(
  page: Page,
  webauthn: WebAuthnContext
): Promise<void> {
  // Check if we're on the "Account Created" screen
  const accountCreatedHeading = page.getByRole('heading', { name: 'Account Created!' });

  if (await accountCreatedHeading.isVisible({ timeout: 2000 }).catch(() => false)) {
    // We're on the signup success screen - register passkey
    await simulatePasskeySuccess(webauthn, async () => {
      await page.getByRole('button', { name: 'Set Up Passkey' }).click();
    });
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  } else {
    // Not on signup screen - BSIM doesn't have a separate passkey management page
    throw new Error(
      'Passkey setup button not found. In BSIM, passkeys are registered during signup. ' +
        'Use signupBsimUserWithPasskey() instead, or call this function right after signup.'
    );
  }
}

/**
 * Login to BSIM using a passkey (passwordless)
 *
 * Requires a virtual authenticator with a previously registered credential.
 *
 * @param page - Playwright page object
 * @param webauthn - WebAuthn context with registered credential
 * @param email - Optional email to help with credential selection
 *
 * @example
 * ```typescript
 * const webauthn = await setupVirtualAuthenticator(page);
 * // ... register passkey first ...
 * await loginBsimWithPasskey(page, webauthn);
 * ```
 */
export async function loginBsimWithPasskey(
  page: Page,
  webauthn: WebAuthnContext,
  email?: string
): Promise<void> {
  const urls = getUrls();

  // Navigate to login page
  await page.goto(`${urls.bsim}${BSIM_PAGES.login}`);

  // Optionally fill email to help with credential selection
  if (email) {
    await page.fill('#email', email);
  }

  // Find and click the passkey login button
  const passkeyButton = page.getByRole('button', { name: 'Sign in with Passkey' });

  // Simulate successful passkey authentication
  await simulatePasskeySuccess(webauthn, async () => {
    await passkeyButton.click();
  });

  // Verify we reached the dashboard
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
}

/**
 * Test passkey login failure scenario
 *
 * @param page - Playwright page object
 * @param webauthn - WebAuthn context
 */
export async function testBsimPasskeyLoginFailure(
  page: Page,
  webauthn: WebAuthnContext
): Promise<void> {
  const urls = getUrls();

  // Navigate to login page
  await page.goto(`${urls.bsim}${BSIM_PAGES.login}`);

  // Find the passkey login button
  const passkeyButton = page.getByRole('button', { name: 'Sign in with Passkey' });

  // Simulate failed passkey authentication
  await simulatePasskeyFailure(
    webauthn,
    async () => {
      await passkeyButton.click();
    },
    async () => {
      // Verify error message appears
      await expect(
        page.locator('text=failed, text=error, text=could not').first()
      ).toBeVisible({ timeout: 10000 });
    }
  );
}

/**
 * Check if passkey login button is available on BSIM login page
 *
 * @param page - Playwright page object
 * @returns true if passkey login is available
 */
export async function isBsimPasskeyLoginAvailable(page: Page): Promise<boolean> {
  const urls = getUrls();

  await page.goto(`${urls.bsim}${BSIM_PAGES.login}`);

  const passkeyButton = page.getByRole('button', { name: 'Sign in with Passkey' });

  try {
    await passkeyButton.waitFor({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * @deprecated BSIM doesn't have a separate security page for passkey management
 */
export async function hasBsimPasskeyRegistered(_page: Page): Promise<boolean> {
  // In BSIM, there's no way to check if a passkey is registered
  // after the initial signup flow
  console.warn('hasBsimPasskeyRegistered: BSIM does not have a passkey management page');
  return false;
}

/**
 * @deprecated BSIM doesn't have a separate security page for passkey management
 */
export async function removeBsimPasskey(_page: Page): Promise<void> {
  throw new Error('BSIM does not have a passkey removal interface');
}
