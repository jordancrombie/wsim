/**
 * Global Setup for E2E Tests
 *
 * Runs before all tests to:
 * - Clean up test users from previous runs
 * - Verify environment connectivity
 *
 * Test users are identified by email pattern: *@testuser.banksim.ca
 */

import { getUrls, getEnvironment } from './fixtures/urls';

async function globalSetup() {
  const urls = getUrls();
  const env = getEnvironment();

  console.log(`\n🚀 E2E Test Global Setup`);
  console.log(`   Environment: ${env}`);
  console.log(`   BSIM: ${urls.bsim}`);
  console.log(`   WSIM: ${urls.wsim}`);
  console.log(`   NSIM: ${urls.nsim}`);
  console.log('');

  // Clean up BSIM test users
  await cleanupBsimTestUsers(urls.bsim);

  // Clean up WSIM test users (if endpoint exists)
  await cleanupWsimTestUsers(urls.wsimAuth);

  console.log('✅ Global setup complete\n');
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
      console.log(`   🧹 BSIM cleanup: ${result.deletedCount || 0} test users removed`);
    } else if (response.status === 404) {
      console.log('   ⚠️  BSIM cleanup endpoint not found (dev-only feature)');
    } else {
      console.log(`   ⚠️  BSIM cleanup returned ${response.status}`);
    }
  } catch (error) {
    // Cleanup endpoint may not exist in all environments
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
      console.log(`   🧹 WSIM cleanup: ${result.deletedCount || 0} test users removed`);
    } else if (response.status === 404) {
      console.log('   ⚠️  WSIM cleanup endpoint not found (may need to add)');
    } else {
      console.log(`   ⚠️  WSIM cleanup returned ${response.status}`);
    }
  } catch (error) {
    // Cleanup endpoint may not exist yet
    console.log('   ⚠️  WSIM cleanup endpoint not available');
  }
}

export default globalSetup;
