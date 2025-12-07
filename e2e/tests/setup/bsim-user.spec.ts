/**
 * BSIM User Setup Tests
 *
 * Creates a BSIM user account with passkey and credit cards.
 * This is a prerequisite for WSIM enrollment tests.
 *
 * Tests run in serial mode as each test builds on the previous.
 *
 * Note: In BSIM, passkey registration happens during signup, not after.
 */

import { test, expect } from '@playwright/test';
import { createTestUser, BSIM_CARDS, TestUser } from '../../fixtures/test-data';
import {
  signupBsimUser,
  loginBsimUser,
  logoutBsimUser,
  verifyBsimDashboard,
} from '../../helpers/bsim/auth.helpers';
import {
  signupBsimUserWithPasskey,
  loginBsimWithPasskey,
} from '../../helpers/bsim/passkey.helpers';
import {
  addBsimCreditCard,
  getBsimCardCount,
} from '../../helpers/bsim/cards.helpers';
import {
  setupVirtualAuthenticator,
  teardownVirtualAuthenticator,
  getStoredCredentials,
} from '../../helpers/webauthn.helpers';

// Run tests serially - each depends on the previous
test.describe.configure({ mode: 'serial' });

test.describe('BSIM User Setup (Password Only)', () => {
  // Shared test user across all tests in this describe block
  let testUser: TestUser;

  // Create test user data before any tests run
  test.beforeAll(async () => {
    testUser = createTestUser();
    console.log(`Created test user: ${testUser.email}`);
  });

  test('create BSIM account', async ({ page }) => {
    // Sign up new user (skip passkey)
    await signupBsimUser(page, testUser, { skipPasskeyPrompt: true });

    // Verify we're on the dashboard
    await verifyBsimDashboard(page);

    // Store user email in test info for debugging
    test.info().annotations.push({
      type: 'test-user',
      description: testUser.email,
    });
  });

  test('login with password after logout', async ({ page }) => {
    // Login with the test user
    await loginBsimUser(page, testUser.email, testUser.password);

    // Verify dashboard
    await verifyBsimDashboard(page);

    // Logout
    await logoutBsimUser(page);
  });

  test('add Visa credit card', async ({ page }) => {
    // Login
    await loginBsimUser(page, testUser.email, testUser.password);

    // Create Visa card in BSIM
    await addBsimCreditCard(page, BSIM_CARDS.visa);

    // Verify card count
    const cardCount = await getBsimCardCount(page);
    expect(cardCount).toBeGreaterThanOrEqual(1);
  });

  test('add Mastercard credit card', async ({ page }) => {
    // Login
    await loginBsimUser(page, testUser.email, testUser.password);

    // Create Mastercard in BSIM
    await addBsimCreditCard(page, BSIM_CARDS.mastercard);

    // Verify we now have at least 2 cards
    const cardCount = await getBsimCardCount(page);
    expect(cardCount).toBeGreaterThanOrEqual(2);
  });

  test('verify final state: user with cards', async ({ page }) => {
    // Login
    await loginBsimUser(page, testUser.email, testUser.password);

    // Verify we have cards
    const cardCount = await getBsimCardCount(page);
    expect(cardCount).toBeGreaterThanOrEqual(2);

    // Log final state
    console.log(`BSIM User Setup Complete:`);
    console.log(`  Email: ${testUser.email}`);
    console.log(`  Cards: ${cardCount}`);

    // Store for downstream tests
    test.info().annotations.push({
      type: 'setup-complete',
      description: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
        cardCount,
      }),
    });
  });
});

test.describe('BSIM User Setup (With Passkey)', () => {
  // Skip entire suite on non-Chromium browsers
  test.skip(({ browserName }) => browserName !== 'chromium',
    'WebAuthn virtual authenticator requires Chromium');

  let testUser: TestUser;

  test.beforeAll(async () => {
    testUser = createTestUser({ firstName: 'Passkey', lastName: 'User' });
    console.log(`Created passkey test user: ${testUser.email}`);
  });

  test('create BSIM account with passkey', async ({ page }) => {
    // Set up virtual authenticator
    const webauthn = await setupVirtualAuthenticator(page);

    try {
      // Sign up with passkey registration
      await signupBsimUserWithPasskey(page, testUser, webauthn);

      // Verify credential was stored
      const credentials = await getStoredCredentials(webauthn);
      expect(credentials.length).toBe(1);
      expect(credentials[0].isResidentCredential).toBe(true);

      // Verify we're on dashboard
      await verifyBsimDashboard(page);
    } finally {
      await teardownVirtualAuthenticator(webauthn);
    }
  });

  test('login with passkey', async ({ page }) => {
    // Set up fresh virtual authenticator
    const webauthn = await setupVirtualAuthenticator(page);

    try {
      // Re-register passkey (fresh authenticator doesn't have the credential)
      await signupBsimUserWithPasskey(
        page,
        createTestUser({ firstName: 'Passkey', lastName: 'Login' }),
        webauthn
      );

      // Logout
      await logoutBsimUser(page);

      // Login with passkey
      await loginBsimWithPasskey(page, webauthn);

      // Verify we reached dashboard
      await verifyBsimDashboard(page);

      // Verify sign count increased (proves authentication happened)
      const credentials = await getStoredCredentials(webauthn);
      expect(credentials[0].signCount).toBeGreaterThan(0);
    } finally {
      await teardownVirtualAuthenticator(webauthn);
    }
  });

  test('add credit cards to passkey user', async ({ page }) => {
    // Set up virtual authenticator for passkey login
    const webauthn = await setupVirtualAuthenticator(page);
    const passkeyUser = createTestUser({ firstName: 'Card', lastName: 'User' });

    try {
      // Create user with passkey
      await signupBsimUserWithPasskey(page, passkeyUser, webauthn);

      // Create credit cards in BSIM
      await addBsimCreditCard(page, BSIM_CARDS.visa);
      await addBsimCreditCard(page, BSIM_CARDS.mastercard);

      // Verify cards
      const cardCount = await getBsimCardCount(page);
      expect(cardCount).toBeGreaterThanOrEqual(2);

      console.log(`Passkey user with cards created: ${passkeyUser.email}`);
    } finally {
      await teardownVirtualAuthenticator(webauthn);
    }
  });
});
