/**
 * WebAuthn Virtual Authenticator Helpers for E2E Testing
 *
 * These helpers use Chrome DevTools Protocol (CDP) to create and manage
 * virtual WebAuthn authenticators for testing passkey flows.
 *
 * IMPORTANT: Only works with Chromium browser. Tests using these helpers
 * should skip on WebKit/Firefox using:
 *
 *   test.skip(({ browserName }) => browserName !== 'chromium', 'WebAuthn requires Chromium');
 *
 * Adapted from BSIM E2E test suite.
 */

import { Page, CDPSession } from '@playwright/test';

/**
 * Context returned from setting up a virtual authenticator
 */
export interface WebAuthnContext {
  client: CDPSession;
  authenticatorId: string;
}

/**
 * Credential info returned from the virtual authenticator
 */
export interface VirtualCredential {
  credentialId: string;
  isResidentCredential: boolean;
  rpId: string;
  privateKey: string;
  userHandle: string;
  signCount: number;
}

/**
 * Set up a virtual WebAuthn authenticator for passkey testing.
 *
 * Creates a CTAP2 platform authenticator that simulates Touch ID, Face ID,
 * Windows Hello, etc. Credentials are discoverable (resident keys) for
 * passwordless login support.
 *
 * @param page - Playwright page object
 * @returns WebAuthn context with CDP client and authenticator ID
 *
 * @example
 * ```typescript
 * const webauthn = await setupVirtualAuthenticator(page);
 * // ... perform passkey operations
 * await teardownVirtualAuthenticator(webauthn);
 * ```
 */
export async function setupVirtualAuthenticator(page: Page): Promise<WebAuthnContext> {
  // Create CDP session for the page
  const client = await page.context().newCDPSession(page);

  // Enable WebAuthn environment
  await client.send('WebAuthn.enable');

  // Add virtual authenticator with platform authenticator settings
  const result = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: false,
    },
  });

  return {
    client,
    authenticatorId: result.authenticatorId,
  };
}

/**
 * Simulate a successful passkey operation (registration or authentication).
 *
 * Enables automatic presence simulation, triggers the action, waits for
 * the WebAuthn operation to complete, then disables simulation.
 *
 * @param context - WebAuthn context from setupVirtualAuthenticator
 * @param triggerAction - Async function that triggers the passkey prompt (e.g., clicking a button)
 *
 * @example
 * ```typescript
 * await simulatePasskeySuccess(webauthn, async () => {
 *   await page.getByRole('button', { name: 'Set Up Passkey' }).click();
 * });
 * ```
 */
export async function simulatePasskeySuccess(
  context: WebAuthnContext,
  triggerAction: () => Promise<void>
): Promise<void> {
  const { client, authenticatorId } = context;

  // Set up promise to wait for operation completion
  const operationCompleted = new Promise<void>((resolve) => {
    const onCredentialAdded = () => {
      client.off('WebAuthn.credentialAdded', onCredentialAdded);
      client.off('WebAuthn.credentialAsserted', onCredentialAsserted);
      resolve();
    };
    const onCredentialAsserted = () => {
      client.off('WebAuthn.credentialAdded', onCredentialAdded);
      client.off('WebAuthn.credentialAsserted', onCredentialAsserted);
      resolve();
    };
    client.on('WebAuthn.credentialAdded', onCredentialAdded);
    client.on('WebAuthn.credentialAsserted', onCredentialAsserted);
  });

  // Ensure user verification succeeds
  await client.send('WebAuthn.setUserVerified', {
    authenticatorId,
    isUserVerified: true,
  });

  // Enable automatic presence simulation (auto-respond to prompts)
  await client.send('WebAuthn.setAutomaticPresenceSimulation', {
    authenticatorId,
    enabled: true,
  });

  // Trigger the action that initiates the WebAuthn operation
  await triggerAction();

  // Wait for the operation to complete
  await operationCompleted;

  // Disable automatic simulation
  await client.send('WebAuthn.setAutomaticPresenceSimulation', {
    authenticatorId,
    enabled: false,
  });
}

/**
 * Simulate a failed passkey operation (user cancelled or verification failed).
 *
 * Sets user verification to false, triggers the action, and allows checking
 * for error states.
 *
 * @param context - WebAuthn context from setupVirtualAuthenticator
 * @param triggerAction - Async function that triggers the passkey prompt
 * @param verifyError - Async function to verify the error state in the UI
 *
 * @example
 * ```typescript
 * await simulatePasskeyFailure(webauthn,
 *   async () => {
 *     await page.getByRole('button', { name: 'Sign in with Passkey' }).click();
 *   },
 *   async () => {
 *     await expect(page.getByText('Authentication failed')).toBeVisible();
 *   }
 * );
 * ```
 */
export async function simulatePasskeyFailure(
  context: WebAuthnContext,
  triggerAction: () => Promise<void>,
  verifyError: () => Promise<void>
): Promise<void> {
  const { client, authenticatorId } = context;

  // Set user verification to fail
  await client.send('WebAuthn.setUserVerified', {
    authenticatorId,
    isUserVerified: false,
  });

  // Enable automatic presence simulation
  await client.send('WebAuthn.setAutomaticPresenceSimulation', {
    authenticatorId,
    enabled: true,
  });

  // Trigger the action
  await triggerAction();

  // Verify the error state
  await verifyError();

  // Disable automatic simulation
  await client.send('WebAuthn.setAutomaticPresenceSimulation', {
    authenticatorId,
    enabled: false,
  });

  // Reset user verification to true for subsequent operations
  await client.send('WebAuthn.setUserVerified', {
    authenticatorId,
    isUserVerified: true,
  });
}

/**
 * Get all credentials stored in the virtual authenticator.
 *
 * @param context - WebAuthn context from setupVirtualAuthenticator
 * @returns Array of credentials with their metadata
 *
 * @example
 * ```typescript
 * const credentials = await getStoredCredentials(webauthn);
 * expect(credentials).toHaveLength(1);
 * expect(credentials[0].signCount).toBe(0);
 * ```
 */
export async function getStoredCredentials(
  context: WebAuthnContext
): Promise<VirtualCredential[]> {
  const { client, authenticatorId } = context;
  const result = await client.send('WebAuthn.getCredentials', { authenticatorId });
  return result.credentials as VirtualCredential[];
}

/**
 * Clear all credentials from the virtual authenticator.
 *
 * Useful for simulating a new device or testing "no passkey registered" scenarios.
 *
 * @param context - WebAuthn context from setupVirtualAuthenticator
 *
 * @example
 * ```typescript
 * await clearCredentials(webauthn);
 * const credentials = await getStoredCredentials(webauthn);
 * expect(credentials).toHaveLength(0);
 * ```
 */
export async function clearCredentials(context: WebAuthnContext): Promise<void> {
  const { client, authenticatorId } = context;
  const credentials = await getStoredCredentials(context);

  for (const cred of credentials) {
    await client.send('WebAuthn.removeCredential', {
      authenticatorId,
      credentialId: cred.credentialId,
    });
  }
}

/**
 * Clean up the virtual authenticator.
 *
 * Should be called in afterEach or a finally block to ensure cleanup even if tests fail.
 *
 * @param context - WebAuthn context from setupVirtualAuthenticator
 *
 * @example
 * ```typescript
 * let webauthn: WebAuthnContext;
 *
 * test.beforeEach(async ({ page }) => {
 *   webauthn = await setupVirtualAuthenticator(page);
 * });
 *
 * test.afterEach(async () => {
 *   if (webauthn) {
 *     await teardownVirtualAuthenticator(webauthn);
 *   }
 * });
 * ```
 */
export async function teardownVirtualAuthenticator(context: WebAuthnContext): Promise<void> {
  const { client, authenticatorId } = context;

  try {
    await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await client.send('WebAuthn.disable');
  } catch {
    // Ignore errors during cleanup
  }
}
