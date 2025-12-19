/**
 * OrderDetails - Enhanced purchase information for mobile payment approval screen
 *
 * This structure allows merchants to provide itemized order information
 * that will be displayed on the mwsim approval screen.
 *
 * All fields are optional for backward compatibility. The merchant's `amount`
 * field remains authoritative for the actual payment total.
 */

export interface OrderLineItem {
  /** Product/service name */
  name: string;
  /** Quantity (supports decimals for weight-based items) */
  quantity: number;
  /** Price per unit (raw number, client handles formatting) */
  unitPrice: number;
  /** Optional SKU/product code */
  sku?: string;
  /** Optional product image URL (deferred to v2) */
  imageUrl?: string;
}

export interface OrderShipping {
  /** Shipping method name (e.g., "Standard", "Express", "Free Shipping") */
  method?: string;
  /** Shipping cost (0 for free shipping) */
  amount: number;
}

export interface OrderTax {
  /** Tax amount */
  amount: number;
  /** Tax rate as decimal (e.g., 0.13 for 13%) */
  rate?: number;
  /** Tax label (e.g., "HST", "GST", "Sales Tax") */
  label?: string;
}

export interface OrderDiscount {
  /** Promo/discount code */
  code?: string;
  /** Human-readable description */
  description?: string;
  /** Discount amount (positive number, displayed as negative) */
  amount: number;
}

export interface OrderFee {
  /** Fee label (e.g., "Service Fee", "Environmental Fee") */
  label: string;
  /** Fee amount */
  amount: number;
}

export interface OrderDetails {
  /** Schema version (default: 1) */
  version?: number;
  /** Line items (products/services) */
  items?: OrderLineItem[];
  /** Subtotal before tax/shipping/discounts */
  subtotal?: number;
  /** Shipping information */
  shipping?: OrderShipping;
  /** Tax information */
  tax?: OrderTax;
  /** Applied discounts */
  discounts?: OrderDiscount[];
  /** Additional fees */
  fees?: OrderFee[];
}

// =============================================================================
// Validation Constants
// =============================================================================

export const ORDER_DETAILS_LIMITS = {
  MAX_ITEMS: 50,
  MAX_DISCOUNTS: 10,
  MAX_FEES: 10,
  MAX_ITEM_NAME_LENGTH: 100,
  MAX_DISCOUNT_CODE_LENGTH: 50,
  MAX_FEE_LABEL_LENGTH: 50,
  MAX_SHIPPING_METHOD_LENGTH: 50,
  MAX_TAX_LABEL_LENGTH: 20,
} as const;

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validates the structure and constraints of orderDetails.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateOrderDetails(orderDetails: unknown): string | null {
  if (orderDetails === null || orderDetails === undefined) {
    return null; // null/undefined is valid (optional field)
  }

  if (typeof orderDetails !== 'object' || Array.isArray(orderDetails)) {
    return 'orderDetails must be an object';
  }

  const details = orderDetails as Record<string, unknown>;

  // Validate version
  if (details.version !== undefined && typeof details.version !== 'number') {
    return 'orderDetails.version must be a number';
  }

  // Validate items
  if (details.items !== undefined) {
    if (!Array.isArray(details.items)) {
      return 'orderDetails.items must be an array';
    }
    if (details.items.length > ORDER_DETAILS_LIMITS.MAX_ITEMS) {
      return `orderDetails.items exceeds maximum of ${ORDER_DETAILS_LIMITS.MAX_ITEMS} items`;
    }
    for (let i = 0; i < details.items.length; i++) {
      const itemError = validateLineItem(details.items[i], i);
      if (itemError) return itemError;
    }
  }

  // Validate subtotal
  if (details.subtotal !== undefined && typeof details.subtotal !== 'number') {
    return 'orderDetails.subtotal must be a number';
  }

  // Validate shipping
  if (details.shipping !== undefined) {
    const shippingError = validateShipping(details.shipping);
    if (shippingError) return shippingError;
  }

  // Validate tax
  if (details.tax !== undefined) {
    const taxError = validateTax(details.tax);
    if (taxError) return taxError;
  }

  // Validate discounts
  if (details.discounts !== undefined) {
    if (!Array.isArray(details.discounts)) {
      return 'orderDetails.discounts must be an array';
    }
    if (details.discounts.length > ORDER_DETAILS_LIMITS.MAX_DISCOUNTS) {
      return `orderDetails.discounts exceeds maximum of ${ORDER_DETAILS_LIMITS.MAX_DISCOUNTS} discounts`;
    }
    for (let i = 0; i < details.discounts.length; i++) {
      const discountError = validateDiscount(details.discounts[i], i);
      if (discountError) return discountError;
    }
  }

  // Validate fees
  if (details.fees !== undefined) {
    if (!Array.isArray(details.fees)) {
      return 'orderDetails.fees must be an array';
    }
    if (details.fees.length > ORDER_DETAILS_LIMITS.MAX_FEES) {
      return `orderDetails.fees exceeds maximum of ${ORDER_DETAILS_LIMITS.MAX_FEES} fees`;
    }
    for (let i = 0; i < details.fees.length; i++) {
      const feeError = validateFee(details.fees[i], i);
      if (feeError) return feeError;
    }
  }

  return null;
}

function validateLineItem(item: unknown, index: number): string | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return `orderDetails.items[${index}] must be an object`;
  }

  const lineItem = item as Record<string, unknown>;

  // Required: name
  if (typeof lineItem.name !== 'string') {
    return `orderDetails.items[${index}].name is required and must be a string`;
  }
  if (lineItem.name.length > ORDER_DETAILS_LIMITS.MAX_ITEM_NAME_LENGTH) {
    return `orderDetails.items[${index}].name exceeds maximum length of ${ORDER_DETAILS_LIMITS.MAX_ITEM_NAME_LENGTH}`;
  }

  // Required: quantity
  if (typeof lineItem.quantity !== 'number') {
    return `orderDetails.items[${index}].quantity is required and must be a number`;
  }
  if (lineItem.quantity <= 0) {
    return `orderDetails.items[${index}].quantity must be greater than 0`;
  }

  // Required: unitPrice
  if (typeof lineItem.unitPrice !== 'number') {
    return `orderDetails.items[${index}].unitPrice is required and must be a number`;
  }
  if (lineItem.unitPrice < 0) {
    return `orderDetails.items[${index}].unitPrice must be >= 0`;
  }

  // Optional: sku
  if (lineItem.sku !== undefined && typeof lineItem.sku !== 'string') {
    return `orderDetails.items[${index}].sku must be a string`;
  }

  // Optional: imageUrl
  if (lineItem.imageUrl !== undefined && typeof lineItem.imageUrl !== 'string') {
    return `orderDetails.items[${index}].imageUrl must be a string`;
  }

  return null;
}

function validateShipping(shipping: unknown): string | null {
  if (typeof shipping !== 'object' || shipping === null || Array.isArray(shipping)) {
    return 'orderDetails.shipping must be an object';
  }

  const ship = shipping as Record<string, unknown>;

  // Required: amount
  if (typeof ship.amount !== 'number') {
    return 'orderDetails.shipping.amount is required and must be a number';
  }
  if (ship.amount < 0) {
    return 'orderDetails.shipping.amount must be >= 0';
  }

  // Optional: method
  if (ship.method !== undefined) {
    if (typeof ship.method !== 'string') {
      return 'orderDetails.shipping.method must be a string';
    }
    if (ship.method.length > ORDER_DETAILS_LIMITS.MAX_SHIPPING_METHOD_LENGTH) {
      return `orderDetails.shipping.method exceeds maximum length of ${ORDER_DETAILS_LIMITS.MAX_SHIPPING_METHOD_LENGTH}`;
    }
  }

  return null;
}

function validateTax(tax: unknown): string | null {
  if (typeof tax !== 'object' || tax === null || Array.isArray(tax)) {
    return 'orderDetails.tax must be an object';
  }

  const t = tax as Record<string, unknown>;

  // Required: amount
  if (typeof t.amount !== 'number') {
    return 'orderDetails.tax.amount is required and must be a number';
  }
  if (t.amount < 0) {
    return 'orderDetails.tax.amount must be >= 0';
  }

  // Optional: rate
  if (t.rate !== undefined) {
    if (typeof t.rate !== 'number') {
      return 'orderDetails.tax.rate must be a number';
    }
    if (t.rate < 0 || t.rate > 1) {
      return 'orderDetails.tax.rate must be between 0 and 1';
    }
  }

  // Optional: label
  if (t.label !== undefined) {
    if (typeof t.label !== 'string') {
      return 'orderDetails.tax.label must be a string';
    }
    if (t.label.length > ORDER_DETAILS_LIMITS.MAX_TAX_LABEL_LENGTH) {
      return `orderDetails.tax.label exceeds maximum length of ${ORDER_DETAILS_LIMITS.MAX_TAX_LABEL_LENGTH}`;
    }
  }

  return null;
}

function validateDiscount(discount: unknown, index: number): string | null {
  if (typeof discount !== 'object' || discount === null || Array.isArray(discount)) {
    return `orderDetails.discounts[${index}] must be an object`;
  }

  const disc = discount as Record<string, unknown>;

  // Required: amount
  if (typeof disc.amount !== 'number') {
    return `orderDetails.discounts[${index}].amount is required and must be a number`;
  }
  if (disc.amount <= 0) {
    return `orderDetails.discounts[${index}].amount must be greater than 0`;
  }

  // Optional: code
  if (disc.code !== undefined) {
    if (typeof disc.code !== 'string') {
      return `orderDetails.discounts[${index}].code must be a string`;
    }
    if (disc.code.length > ORDER_DETAILS_LIMITS.MAX_DISCOUNT_CODE_LENGTH) {
      return `orderDetails.discounts[${index}].code exceeds maximum length of ${ORDER_DETAILS_LIMITS.MAX_DISCOUNT_CODE_LENGTH}`;
    }
  }

  // Optional: description
  if (disc.description !== undefined && typeof disc.description !== 'string') {
    return `orderDetails.discounts[${index}].description must be a string`;
  }

  return null;
}

function validateFee(fee: unknown, index: number): string | null {
  if (typeof fee !== 'object' || fee === null || Array.isArray(fee)) {
    return `orderDetails.fees[${index}] must be an object`;
  }

  const f = fee as Record<string, unknown>;

  // Required: label
  if (typeof f.label !== 'string') {
    return `orderDetails.fees[${index}].label is required and must be a string`;
  }
  if (f.label.length > ORDER_DETAILS_LIMITS.MAX_FEE_LABEL_LENGTH) {
    return `orderDetails.fees[${index}].label exceeds maximum length of ${ORDER_DETAILS_LIMITS.MAX_FEE_LABEL_LENGTH}`;
  }

  // Required: amount
  if (typeof f.amount !== 'number') {
    return `orderDetails.fees[${index}].amount is required and must be a number`;
  }
  if (f.amount < 0) {
    return `orderDetails.fees[${index}].amount must be >= 0`;
  }

  return null;
}

/**
 * Logs a warning if the calculated total from orderDetails doesn't match the amount.
 * This is for debugging only - the merchant's amount is always authoritative.
 */
export function checkOrderDetailsConsistency(
  amount: number,
  orderDetails: OrderDetails | null | undefined
): void {
  if (!orderDetails) return;

  let calculated = orderDetails.subtotal ?? 0;

  // Add shipping
  if (orderDetails.shipping) {
    calculated += orderDetails.shipping.amount;
  }

  // Add tax
  if (orderDetails.tax) {
    calculated += orderDetails.tax.amount;
  }

  // Subtract discounts
  if (orderDetails.discounts) {
    for (const discount of orderDetails.discounts) {
      calculated -= discount.amount;
    }
  }

  // Add fees
  if (orderDetails.fees) {
    for (const fee of orderDetails.fees) {
      calculated += fee.amount;
    }
  }

  const diff = Math.abs(calculated - amount);
  if (diff > 0.01) {
    console.warn(
      `[Mobile Payment] orderDetails total mismatch: calculated=${calculated.toFixed(2)}, amount=${amount.toFixed(2)}, diff=${diff.toFixed(2)}`
    );
  }
}
