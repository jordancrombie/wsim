/**
 * BSIM Credit Card Helpers for E2E Tests
 *
 * BSIM is a bank simulator that generates virtual credit cards.
 * Users don't add existing card numbers - they create new simulated cards
 * by selecting a card type and credit limit.
 */

import { Page, expect } from '@playwright/test';
import { BsimCardParams, BSIM_CARDS } from '../../fixtures/test-data';
import { getUrls, BSIM_PAGES } from '../../fixtures/urls';

/**
 * Result of creating a BSIM credit card
 */
export interface BsimCardResult {
  /** Last 4 digits of the generated card */
  last4: string;
  /** Card type (VISA, MASTERCARD, AMEX) */
  type: string;
  /** Credit limit */
  creditLimit: number;
}

/**
 * Create a credit card in BSIM (bank simulator)
 *
 * BSIM generates virtual cards - users specify card type and limit,
 * and the system generates a card number.
 *
 * @param page - Playwright page object
 * @param params - Card creation parameters (type, limit, name)
 * @returns Created card details including last 4 digits
 *
 * @example
 * ```typescript
 * await loginBsimUser(page, user.email, user.password);
 * const card = await createBsimCreditCard(page, BSIM_CARDS.visa);
 * console.log(`Created card ending in ${card.last4}`);
 * ```
 */
export async function createBsimCreditCard(
  page: Page,
  params: BsimCardParams = BSIM_CARDS.visa
): Promise<BsimCardResult> {
  const urls = getUrls();

  // Navigate to credit cards page
  await page.goto(`${urls.bsim}${BSIM_PAGES.creditCards}`);

  // Wait for page to load
  await expect(page.getByRole('heading', { name: 'Credit Cards' })).toBeVisible({ timeout: 10000 });

  // Click create card button (either main button or empty state button)
  const createButton = page.getByRole('button', { name: /Create.*Credit Card/i });
  await createButton.first().click();

  // Wait for the modal to appear
  await expect(
    page.getByRole('heading', { name: 'Create New Credit Card' })
  ).toBeVisible({ timeout: 10000 });

  // Fill credit limit if specified (default is usually 5000)
  if (params.creditLimit) {
    const creditLimitInput = page.locator('input').filter({ hasText: '' }).first();
    // Find the input near "Credit Limit" label
    const limitInput = page.getByRole('spinbutton').first();
    await limitInput.clear();
    await limitInput.fill(params.creditLimit.toString());
  }

  // Fill cardholder name if specified
  if (params.cardholderName) {
    const nameInput = page.getByPlaceholder('Your name');
    await nameInput.fill(params.cardholderName);
  }

  // Select card type from dropdown
  const cardTypeSelect = page.getByRole('combobox');
  await cardTypeSelect.selectOption(params.type);

  // Click Create Card button
  await page.getByRole('button', { name: 'Create Card' }).click();

  // Wait for success - modal should close and card should appear
  // The new card should show on the page with last 4 digits
  await expect(
    page.getByRole('heading', { name: 'Create New Credit Card' })
  ).not.toBeVisible({ timeout: 10000 });

  // Wait for the card to appear on the page
  await page.waitForTimeout(1000); // Brief wait for UI update

  // BSIM shows full card number like "4221 8683 7828 0003"
  // Find text that looks like a card number (4 groups of 4 digits)
  const pageContent = await page.content();
  const cardNumberMatch = pageContent.match(/(\d{4})\s+(\d{4})\s+(\d{4})\s+(\d{4})/);
  const last4 = cardNumberMatch ? cardNumberMatch[4] : '';

  return {
    last4,
    type: params.type,
    creditLimit: params.creditLimit || 5000,
  };
}

/**
 * Get the count of credit cards displayed on the credit cards page
 *
 * @param page - Playwright page object
 * @returns Number of cards displayed
 */
export async function getBsimCardCount(page: Page): Promise<number> {
  const urls = getUrls();

  // Navigate to credit cards page
  await page.goto(`${urls.bsim}${BSIM_PAGES.creditCards}`);

  // Wait for page to load
  await expect(page.getByRole('heading', { name: 'Credit Cards' })).toBeVisible({ timeout: 10000 });

  // Wait a moment for cards to render
  await page.waitForTimeout(1000);

  // Check for empty state
  const emptyState = page.getByText("You don't have any credit cards yet");
  if (await emptyState.isVisible().catch(() => false)) {
    return 0;
  }

  // Count full card numbers on the page (format: XXXX XXXX XXXX XXXX)
  const pageContent = await page.content();
  const cardNumbers = pageContent.match(/\d{4}\s+\d{4}\s+\d{4}\s+\d{4}/g) || [];
  return cardNumbers.length;
}

/**
 * Get the last 4 digits of all credit cards on the page
 *
 * @param page - Playwright page object
 * @returns Array of last 4 digits strings
 */
export async function getBsimCardLast4s(page: Page): Promise<string[]> {
  const urls = getUrls();

  // Navigate to credit cards page
  await page.goto(`${urls.bsim}${BSIM_PAGES.creditCards}`);

  // Wait for page to load
  await expect(page.getByRole('heading', { name: 'Credit Cards' })).toBeVisible({ timeout: 10000 });

  // Wait a moment for cards to render
  await page.waitForTimeout(1000);

  // BSIM shows full card numbers like "4221 8683 7828 0003"
  const pageContent = await page.content();
  const matches = pageContent.match(/(\d{4})\s+(\d{4})\s+(\d{4})\s+(\d{4})/g) || [];

  const last4s: string[] = [];
  for (const match of matches) {
    // Extract last 4 digits from the full card number
    const digits = match.match(/(\d{4})$/);
    if (digits) {
      last4s.push(digits[1]);
    }
  }

  return [...new Set(last4s)]; // Remove duplicates
}

/**
 * Delete a credit card by its last 4 digits
 *
 * @param page - Playwright page object
 * @param last4 - Last 4 digits of the card to delete
 */
export async function deleteBsimCreditCard(page: Page, last4: string): Promise<void> {
  const urls = getUrls();

  // Navigate to credit cards page
  await page.goto(`${urls.bsim}${BSIM_PAGES.creditCards}`);

  // Wait for page to load
  await expect(page.getByRole('heading', { name: 'Credit Cards' })).toBeVisible({ timeout: 10000 });

  // Find the card with matching last 4 digits
  const cardElement = page.locator(`text=${last4}`).first();
  await expect(cardElement).toBeVisible({ timeout: 10000 });

  // Find and click delete button near this card
  const cardContainer = cardElement.locator('..').locator('..');
  const deleteButton = cardContainer.getByRole('button', { name: /delete|remove/i });
  await deleteButton.first().click();

  // Confirm deletion if prompted
  const confirmButton = page.getByRole('button', { name: /confirm|yes|delete/i });
  try {
    await confirmButton.first().click({ timeout: 3000 });
  } catch {
    // No confirmation needed
  }

  // Verify card is removed
  await expect(cardElement).not.toBeVisible({ timeout: 10000 });
}

/**
 * Set a card as the default payment method
 *
 * @param page - Playwright page object
 * @param last4 - Last 4 digits of the card to set as default
 */
export async function setBsimDefaultCard(page: Page, last4: string): Promise<void> {
  const urls = getUrls();

  // Navigate to credit cards page
  await page.goto(`${urls.bsim}${BSIM_PAGES.creditCards}`);

  // Wait for page to load
  await expect(page.getByRole('heading', { name: 'Credit Cards' })).toBeVisible({ timeout: 10000 });

  // Find the card with matching last 4 digits
  const cardElement = page.locator(`text=${last4}`).first();
  await expect(cardElement).toBeVisible({ timeout: 10000 });

  // Find and click "Set as default" button
  const cardContainer = cardElement.locator('..').locator('..');
  const defaultButton = cardContainer.getByRole('button', { name: /set.*default|make.*default|default/i });
  await defaultButton.first().click();

  // Verify default indicator appears
  await expect(
    cardContainer.locator('text=Default, text=Primary').first()
  ).toBeVisible({ timeout: 10000 });
}

// ============================================================================
// Legacy exports for backward compatibility
// ============================================================================

/**
 * @deprecated Use createBsimCreditCard instead
 * BSIM generates cards, it doesn't accept card numbers
 */
export async function addBsimCreditCard(
  page: Page,
  params: BsimCardParams = BSIM_CARDS.visa
): Promise<BsimCardResult> {
  return createBsimCreditCard(page, params);
}
