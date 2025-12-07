import { randomUUID } from 'crypto';

/**
 * Test data generators and fixtures for E2E tests
 *
 * All test data uses unique identifiers to prevent collisions
 * when tests run in parallel or across multiple CI runs.
 */

// ============================================================================
// Types
// ============================================================================

export interface TestUser {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  address?: {
    street: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
  };
}

/**
 * Card input for adding real cards (e.g., SSIM checkout)
 */
export interface TestCard {
  number: string;
  expiry: string;
  cvv: string;
  name: string;
  type?: 'visa' | 'mastercard' | 'amex';
}

/**
 * BSIM Card creation parameters
 * BSIM is a bank simulator that generates virtual cards
 */
export interface BsimCardParams {
  /** Card type - value must match BSIM dropdown option */
  type: string;
  /** Credit limit in dollars (default: 5000) */
  creditLimit?: number;
  /** Cardholder name (optional, uses account name if not provided) */
  cardholderName?: string;
}

export interface TestMerchant {
  id: string;
  name: string;
  apiKey: string;
}

// ============================================================================
// Email Generation
// ============================================================================

/**
 * Generate a unique test email address
 *
 * Format: {prefix}-{uuid}@testuser.banksim.ca
 *
 * The @testuser.banksim.ca domain allows easy identification
 * and cleanup of test accounts.
 *
 * @param prefix - Optional prefix for the email (default: 'e2e')
 */
export function generateTestEmail(prefix = 'e2e'): string {
  const uuid = randomUUID().slice(0, 8); // Short UUID for readability
  return `${prefix}-${uuid}@testuser.banksim.ca`;
}

/**
 * Generate a unique test admin email
 */
export function generateTestAdminEmail(): string {
  const uuid = randomUUID().slice(0, 8);
  return `test-admin-${uuid}@testadmin.banksim.ca`;
}

// ============================================================================
// User Generation
// ============================================================================

/**
 * Create a test user with sensible defaults
 *
 * @param overrides - Optional field overrides
 */
export function createTestUser(overrides?: Partial<TestUser>): TestUser {
  return {
    email: generateTestEmail(),
    password: 'TestPassword123!',
    firstName: 'E2E',
    lastName: 'TestUser',
    phone: '604-555-0100',
    address: {
      street: '123 Test Street',
      city: 'Vancouver',
      province: 'BC',
      postalCode: 'V6B 1A1',
      country: 'Canada',
    },
    ...overrides,
  };
}

/**
 * Pre-built test user templates
 */
export const TEST_USERS = {
  /** Standard user with full profile */
  standard: () => createTestUser(),

  /** Minimal user with only required fields */
  minimal: () =>
    createTestUser({
      phone: undefined,
      address: undefined,
    }),

  /** User in Toronto */
  toronto: () =>
    createTestUser({
      address: {
        street: '100 King Street West',
        city: 'Toronto',
        province: 'ON',
        postalCode: 'M5X 1A1',
        country: 'Canada',
      },
    }),
};

// ============================================================================
// Card Generation
// ============================================================================

/**
 * Test card numbers (Stripe/BSIM test cards)
 *
 * These cards work in test environments and trigger specific behaviors.
 */
export const TEST_CARDS = {
  /** Visa card - always approves */
  visa: {
    number: '4111111111111111',
    expiry: '12/28',
    cvv: '123',
    name: 'E2E Test User',
    type: 'visa' as const,
  },

  /** Mastercard - always approves */
  mastercard: {
    number: '5555555555554444',
    expiry: '12/28',
    cvv: '123',
    name: 'E2E Test User',
    type: 'mastercard' as const,
  },

  /** Amex - always approves */
  amex: {
    number: '378282246310005',
    expiry: '12/28',
    cvv: '1234',
    name: 'E2E Test User',
    type: 'amex' as const,
  },

  /** Card that always declines */
  declined: {
    number: '4000000000000002',
    expiry: '12/28',
    cvv: '123',
    name: 'E2E Test User',
    type: 'visa' as const,
  },

  /** Card with insufficient funds */
  insufficientFunds: {
    number: '4000000000009995',
    expiry: '12/28',
    cvv: '123',
    name: 'E2E Test User',
    type: 'visa' as const,
  },

  /** Expired card */
  expired: {
    number: '4000000000000069',
    expiry: '12/20',
    cvv: '123',
    name: 'E2E Test User',
    type: 'visa' as const,
  },
};

/**
 * Create a test card with custom values
 */
export function createTestCard(overrides?: Partial<TestCard>): TestCard {
  return {
    ...TEST_CARDS.visa,
    ...overrides,
  };
}

/**
 * BSIM Card creation templates
 * Use these with createBsimCreditCard() helper
 *
 * Note: BSIM dropdown options are typically "VISA", "Mastercard", "Amex"
 * (mixed case for Mastercard/Amex, uppercase for VISA)
 */
export const BSIM_CARDS: Record<string, BsimCardParams> = {
  /** Default Visa card with $5000 limit */
  visa: {
    type: 'VISA',
    creditLimit: 5000,
  },

  /** Mastercard with $5000 limit */
  mastercard: {
    type: 'Mastercard',
    creditLimit: 5000,
  },

  /** Amex with $10000 limit */
  amex: {
    type: 'Amex',
    creditLimit: 10000,
  },

  /** Low limit Visa for testing insufficient funds */
  lowLimit: {
    type: 'VISA',
    creditLimit: 100,
  },

  /** High limit card for large purchases */
  highLimit: {
    type: 'VISA',
    creditLimit: 50000,
  },
};

// ============================================================================
// Merchant / Payment Data
// ============================================================================

/**
 * Test merchant for payment tests
 */
export const TEST_MERCHANT: TestMerchant = {
  id: 'test-merchant-e2e',
  name: 'E2E Test Store',
  apiKey: process.env.NSIM_API_KEY || 'test-api-key',
};

/**
 * Generate a unique order ID
 */
export function generateOrderId(): string {
  return `order-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/**
 * Generate a unique transaction reference
 */
export function generateTransactionRef(): string {
  return `txn-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

// ============================================================================
// Timeouts
// ============================================================================

/**
 * Standard timeouts for different operation types
 */
export const TIMEOUTS = {
  /** Quick UI interactions */
  short: 5000,

  /** Standard page loads, form submissions */
  standard: 10000,

  /** Long operations (OAuth flows, multi-step processes) */
  long: 30000,

  /** Very long operations (file uploads, heavy processing) */
  extended: 60000,
} as const;

// ============================================================================
// Test Data Cleanup
// ============================================================================

/**
 * Pattern for identifying test user emails
 */
export const TEST_EMAIL_PATTERN = /@testuser\.banksim\.ca$/;

/**
 * Pattern for identifying test admin emails
 */
export const TEST_ADMIN_EMAIL_PATTERN = /@testadmin\.banksim\.ca$/;

/**
 * Check if an email is a test email
 */
export function isTestEmail(email: string): boolean {
  return TEST_EMAIL_PATTERN.test(email) || TEST_ADMIN_EMAIL_PATTERN.test(email);
}
