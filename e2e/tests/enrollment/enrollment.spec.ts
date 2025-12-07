/**
 * WSIM Enrollment Tests
 *
 * Tests the complete WSIM enrollment flow:
 * 1. Start with a BSIM user (with cards)
 * 2. Enroll in WSIM via BSIM OAuth
 * 3. Import cards from BSIM
 * 4. Register WSIM passkey
 * 5. Verify passkey login works
 *
 * Tests run in serial mode as each test builds on the previous.
 */

import { test, expect } from '@playwright/test';
import { createTestUser, BSIM_CARDS, TestUser } from '../../fixtures/test-data';
import {
  signupBsimUser,
  loginBsimUser,
  logoutBsimUser,
} from '../../helpers/bsim/auth.helpers';
import { addBsimCreditCard } from '../../helpers/bsim/cards.helpers';
import {
  enrollWsimUser,
  getWsimCardCount,
  getWsimCardLast4s,
} from '../../helpers/wsim/enroll.helpers';
import {
  loginWsimUser,
  logoutWsimUser,
  isWsimLoggedIn,
  verifyWsimDashboard,
} from '../../helpers/wsim/auth.helpers';
import {
  registerWsimPasskey,
  loginWsimWithPasskey,
  hasWsimPasskeyRegistered,
} from '../../helpers/wsim/passkey.helpers';
import {
  setupVirtualAuthenticator,
  teardownVirtualAuthenticator,
  getStoredCredentials,
} from '../../helpers/webauthn.helpers';

// Run tests serially
test.describe.configure({ mode: 'serial' });

test.describe('WSIM Enrollment Flow', () => {
  let testUser: TestUser;
  const walletPassword = 'WalletPass123!';

  // Set up BSIM user with cards before running enrollment tests
  test.beforeAll(async ({ browser }) => {
    // Create test user
    testUser = createTestUser();
    console.log(`Creating BSIM user for WSIM enrollment: ${testUser.email}`);

    // Create a page to set up the BSIM user
    const page = await browser.newPage();

    try {
      // Sign up BSIM user
      await signupBsimUser(page, testUser, { skipPasskeyPrompt: true });

      // Create credit cards in BSIM
      await addBsimCreditCard(page, BSIM_CARDS.visa);
      await addBsimCreditCard(page, BSIM_CARDS.mastercard);

      console.log('BSIM user setup complete with 2 cards');
    } finally {
      await page.close();
    }
  });

  test('enroll in WSIM via BSIM OAuth (skip password)', async ({ page }) => {
    // Enroll in WSIM, skipping password setup
    // OAuth flow will prompt for BSIM login
    await enrollWsimUser(page, {
      skipPassword: true,
      selectAllCards: true,
      bsimEmail: testUser.email,
      bsimPassword: testUser.password,
    });

    // Verify we're on WSIM dashboard
    await verifyWsimDashboard(page);

    // Verify cards were imported
    const cardCount = await getWsimCardCount(page);
    expect(cardCount).toBeGreaterThanOrEqual(2);

    // BSIM generates card numbers, so we just verify we have cards imported
    // We can't predict the last 4 digits since they're randomly generated
    const last4s = await getWsimCardLast4s(page);
    expect(last4s.length).toBeGreaterThanOrEqual(2);

    console.log(`WSIM enrollment complete with ${cardCount} cards: ${last4s.join(', ')}`);
  });

  test('register WSIM passkey after enrollment', async ({ page, browserName }) => {
    // Skip on non-Chromium browsers
    test.skip(
      browserName !== 'chromium',
      'WebAuthn virtual authenticator requires Chromium'
    );

    // Check if already enrolled or need to enroll
    const enrolled = await isWsimLoggedIn(page);
    if (!enrolled) {
      await enrollWsimUser(page, {
        skipPassword: true,
        selectAllCards: true,
        bsimEmail: testUser.email,
        bsimPassword: testUser.password,
      });
    }

    // Set up virtual authenticator
    const webauthn = await setupVirtualAuthenticator(page);

    try {
      // Register passkey
      await registerWsimPasskey(page, webauthn);

      // Verify credential was stored
      const credentials = await getStoredCredentials(webauthn);
      expect(credentials.length).toBeGreaterThan(0);

      // Verify passkey is registered
      const hasPasskey = await hasWsimPasskeyRegistered(page);
      expect(hasPasskey).toBe(true);

      console.log('WSIM passkey registered successfully');
    } finally {
      await teardownVirtualAuthenticator(webauthn);
    }
  });

  test('login to WSIM with passkey', async ({ page, browserName }) => {
    // Skip on non-Chromium browsers
    test.skip(
      browserName !== 'chromium',
      'WebAuthn virtual authenticator requires Chromium'
    );

    // Set up virtual authenticator
    const webauthn = await setupVirtualAuthenticator(page);

    try {
      // First, ensure we're enrolled in WSIM
      const enrolled = await isWsimLoggedIn(page);
      if (!enrolled) {
        await enrollWsimUser(page, {
          skipPassword: true,
          selectAllCards: true,
          bsimEmail: testUser.email,
          bsimPassword: testUser.password,
        });
      }

      // Register a fresh passkey for this session
      await registerWsimPasskey(page, webauthn);

      // Logout from WSIM
      await logoutWsimUser(page);

      // Now test passkey login
      await loginWsimWithPasskey(page, webauthn);

      // Verify we reached dashboard
      await verifyWsimDashboard(page);

      console.log('WSIM passkey login successful');
    } finally {
      await teardownVirtualAuthenticator(webauthn);
    }
  });

  test('verify WSIM cards after re-login', async ({ page, browserName }) => {
    // Skip on non-Chromium browsers for consistency
    test.skip(
      browserName !== 'chromium',
      'WebAuthn virtual authenticator requires Chromium'
    );

    // Set up virtual authenticator for passkey operations
    const webauthn = await setupVirtualAuthenticator(page);

    try {
      // Ensure enrolled
      const enrolled = await isWsimLoggedIn(page);
      if (!enrolled) {
        await enrollWsimUser(page, {
          skipPassword: true,
          selectAllCards: true,
          bsimEmail: testUser.email,
          bsimPassword: testUser.password,
        });
      } else {
        // Navigate to WSIM to verify
        await verifyWsimDashboard(page);
      }

      // Verify cards are still there
      const cardCount = await getWsimCardCount(page);
      expect(cardCount).toBeGreaterThanOrEqual(2);

      const last4s = await getWsimCardLast4s(page);
      console.log(`WSIM cards verified: ${last4s.join(', ')}`);

      // Verify we have the expected number of cards
      // BSIM generates card numbers, so we just verify count not specific values
      expect(last4s.length).toBeGreaterThanOrEqual(2);
    } finally {
      await teardownVirtualAuthenticator(webauthn);
    }
  });
});

test.describe('WSIM Enrollment with Password', () => {
  let testUser: TestUser;
  const walletPassword = 'WalletPass456!';

  // Set up BSIM user with cards
  test.beforeAll(async ({ browser }) => {
    testUser = createTestUser();
    console.log(`Creating BSIM user for password enrollment: ${testUser.email}`);

    const page = await browser.newPage();

    try {
      await signupBsimUser(page, testUser, { skipPasskeyPrompt: true });
      await addBsimCreditCard(page, BSIM_CARDS.visa);
    } finally {
      await page.close();
    }
  });

  test('enroll in WSIM with password', async ({ page }) => {
    // Enroll with password
    await enrollWsimUser(page, {
      skipPassword: false,
      password: walletPassword,
      selectAllCards: true,
      bsimEmail: testUser.email,
      bsimPassword: testUser.password,
    });

    // Verify enrollment
    await verifyWsimDashboard(page);
  });

  test('login to WSIM with password', async ({ page }) => {
    // First login to BSIM (for context)
    await loginBsimUser(page, testUser.email, testUser.password);

    // Logout from WSIM if logged in
    if (await isWsimLoggedIn(page)) {
      await logoutWsimUser(page);
    }

    // Login with password
    await loginWsimUser(page, testUser.email, walletPassword);

    // Verify dashboard
    await verifyWsimDashboard(page);
  });
});
