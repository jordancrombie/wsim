/**
 * Global Teardown for E2E Tests
 *
 * Runs after all tests to:
 * - Clean up test users created during this run
 * - Generate test summary
 *
 * Test users are identified by email pattern: *@testuser.banksim.ca
 */

import { getUrls, getEnvironment } from './fixtures/urls';

async function globalTeardown() {
  const urls = getUrls();
  const env = getEnvironment();

  console.log(`\n🏁 E2E Test Global Teardown`);
  console.log(`   Environment: ${env}`);
  console.log('');

  // Clean up BSIM test users
  await cleanupBsimTestUsers(urls.bsim);

  // Clean up WSIM test users
  await cleanupWsimTestUsers(urls.wsimAuth);

  console.log('✅ Global teardown complete\n');
}

/**
 * Clean up test users from BSIM
 */
async function cleanupBsimTestUsers(bsimUrl: string): Promise<void> {
  const cleanupUrl = `${bsimUrl}/api/test-cleanup/users`;
  const cleanupKey = process.env.TEST_CLEANUP_KEY || 'bsim-test-cleanup-secret-key';

  try {
    const response = await fetch(cleanupUrl, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Cleanup-Key': cleanupKey,
      },
    });

    if (response.ok) {
      const result = await response.json().catch(() => ({}));
      const deleted = result.deletedCount || 0;
      const emails = result.deletedEmails || [];

      console.log(`   🧹 BSIM cleanup: ${deleted} test users removed`);
      if (emails.length > 0 && emails.length <= 5) {
        emails.forEach((email: string) => console.log(`      - ${email}`));
      } else if (emails.length > 5) {
        console.log(`      (${emails.length} emails removed)`);
      }
    } else if (response.status === 404) {
      console.log('   ⚠️  BSIM cleanup endpoint not found');
    } else {
      console.log(`   ⚠️  BSIM cleanup returned ${response.status}`);
    }
  } catch (error) {
    console.log('   ⚠️  BSIM cleanup endpoint not available');
  }
}

/**
 * Clean up test users from WSIM
 */
async function cleanupWsimTestUsers(wsimAuthUrl: string): Promise<void> {
  const cleanupUrl = `${wsimAuthUrl}/api/test-cleanup/users`;
  const cleanupKey = process.env.TEST_CLEANUP_KEY || 'wsim-test-cleanup-secret-key';

  try {
    const response = await fetch(cleanupUrl, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Cleanup-Key': cleanupKey,
      },
    });

    if (response.ok) {
      const result = await response.json().catch(() => ({}));
      const deleted = result.deletedCount || 0;
      const emails = result.deletedEmails || [];

      console.log(`   🧹 WSIM cleanup: ${deleted} test users removed`);
      if (emails.length > 0 && emails.length <= 5) {
        emails.forEach((email: string) => console.log(`      - ${email}`));
      } else if (emails.length > 5) {
        console.log(`      (${emails.length} emails removed)`);
      }
    } else if (response.status === 404) {
      console.log('   ⚠️  WSIM cleanup endpoint not found');
    } else {
      console.log(`   ⚠️  WSIM cleanup returned ${response.status}`);
    }
  } catch (error) {
    console.log('   ⚠️  WSIM cleanup endpoint not available');
  }
}

export default globalTeardown;
