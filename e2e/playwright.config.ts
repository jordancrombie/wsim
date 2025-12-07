import { defineConfig, devices } from '@playwright/test';

/**
 * NSIM E2E Test Configuration
 *
 * Supports multiple environments via TEST_ENV:
 * - dev (default): https://*-dev.banksim.ca
 * - prod: https://*.banksim.ca
 *
 * Run with: TEST_ENV=dev npm test
 */
export default defineConfig({
  testDir: './tests',

  // Run tests in serial within files (many tests depend on previous state)
  fullyParallel: false,

  // Fail CI if test.only() is left in code
  forbidOnly: !!process.env.CI,

  // Retry failed tests in CI
  retries: process.env.CI ? 2 : 0,

  // Single worker for serial test execution
  workers: process.env.CI ? 1 : 1,

  // Reporter configuration
  reporter: [
    ['html', { open: 'never' }],
    ['list']
  ],

  // Global setup and teardown for test data cleanup
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  // Shared settings for all projects
  use: {
    // Collect trace on first retry for debugging
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on first retry
    video: 'on-first-retry',

    // Default action timeout
    actionTimeout: 10000,

    // Navigation timeout
    navigationTimeout: 30000,
  },

  // Test timeout (60 seconds per test)
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 10000
  },

  // Browser projects
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Chromium supports WebAuthn virtual authenticators via CDP
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        // Note: WebAuthn tests will be skipped on WebKit
      },
    },
    // Firefox excluded - no CDP support for WebAuthn virtual authenticators
  ],

  // Output directory for test artifacts
  outputDir: 'test-results/',
});
