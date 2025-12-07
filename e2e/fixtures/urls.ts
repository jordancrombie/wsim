/**
 * Environment-aware URL configuration for E2E tests
 *
 * Usage:
 *   const urls = getUrls();
 *   await page.goto(urls.bsim);
 *
 * Set TEST_ENV=dev or TEST_ENV=prod to switch environments
 */

export interface EnvironmentUrls {
  /** BSIM main application */
  bsim: string;
  /** BSIM auth server (OIDC) */
  bsimAuth: string;
  /** WSIM wallet frontend */
  wsim: string;
  /** WSIM auth/backend server */
  wsimAuth: string;
  /** NSIM payment gateway */
  nsim: string;
  /** SSIM store simulator */
  ssim: string;
}

const environments: Record<string, EnvironmentUrls> = {
  dev: {
    bsim: 'https://dev.banksim.ca',
    bsimAuth: 'https://auth-dev.banksim.ca',
    wsim: 'https://wsim-dev.banksim.ca',
    wsimAuth: 'https://wsim-auth-dev.banksim.ca',
    nsim: 'https://payment-dev.banksim.ca',
    ssim: 'https://ssim-dev.banksim.ca',
  },
  prod: {
    bsim: 'https://banksim.ca',
    bsimAuth: 'https://auth.banksim.ca',
    wsim: 'https://wsim.banksim.ca',
    wsimAuth: 'https://wsim-auth.banksim.ca',
    nsim: 'https://payment.banksim.ca',
    ssim: 'https://ssim.banksim.ca',
  },
  local: {
    bsim: 'http://localhost:3000',
    bsimAuth: 'http://localhost:3001',
    wsim: 'http://localhost:3003',
    wsimAuth: 'http://localhost:3004',
    nsim: 'http://localhost:3006',
    ssim: 'http://localhost:3005',
  },
};

/**
 * Get URLs for the current test environment
 *
 * @returns Environment URLs based on TEST_ENV (defaults to 'dev')
 */
export function getUrls(): EnvironmentUrls {
  const env = process.env.TEST_ENV || 'dev';

  if (!environments[env]) {
    throw new Error(
      `Unknown TEST_ENV: ${env}. Valid options: ${Object.keys(environments).join(', ')}`
    );
  }

  return environments[env];
}

/**
 * Get the current environment name
 */
export function getEnvironment(): string {
  return process.env.TEST_ENV || 'dev';
}

/**
 * BSIM page paths
 */
export const BSIM_PAGES = {
  home: '/',
  login: '/login',
  signup: '/signup',
  dashboard: '/dashboard',
  accounts: '/dashboard/accounts',
  creditCards: '/dashboard/credit-cards',
  transfer: '/dashboard/transfer',
  // Note: BSIM doesn't have a separate security page - passkey setup is during signup
} as const;

/**
 * WSIM page paths
 */
export const WSIM_PAGES = {
  home: '/',
  login: '/login',
  enroll: '/enroll',
  dashboard: '/dashboard',
  wallet: '/wallet',
  profile: '/profile',
  settings: '/settings',
  passkeys: '/settings/passkeys',
  banks: '/banks',
} as const;

/**
 * SSIM page paths
 */
export const SSIM_PAGES = {
  home: '/',
  login: '/login',
  products: '/products',
  cart: '/cart',
  checkout: '/checkout',
  orders: '/orders',
} as const;
