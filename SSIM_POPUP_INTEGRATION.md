# SSIM Popup Integration Guide

This document describes how SSIM (Store Simulator) can integrate with the WSIM (Wallet Simulator) embedded payment popup flow.

## Overview

The popup flow allows SSIM to open a WSIM wallet popup where users can:
1. Select a payment card from their wallet
2. Confirm the payment with their passkey (WebAuthn)
3. Return a payment token to SSIM for processing

This is an alternative to the full OIDC redirect flow, providing a smoother checkout experience.

## Integration Steps

### 1. Open the Popup

Open a popup window to the WSIM auth server's card picker endpoint:

```javascript
function openWalletPopup(paymentDetails) {
  const params = new URLSearchParams({
    origin: window.location.origin,  // Required: Your origin for postMessage
    merchantId: paymentDetails.merchantId,
    merchantName: paymentDetails.merchantName,
    amount: paymentDetails.amount.toString(),
    currency: paymentDetails.currency || 'CAD',
    orderId: paymentDetails.orderId
  });

  const popupUrl = 'https://wsim-auth-dev.banksim.ca/popup/card-picker?' + params;

  const popup = window.open(
    popupUrl,
    'wsim-wallet',
    'width=420,height=620,scrollbars=yes,resizable=yes'
  );

  return popup;
}
```

### 2. Listen for PostMessage Responses

Set up a message listener to receive the response from the popup:

```javascript
function setupWalletListener(onSuccess, onCancel, onError) {
  const handler = (event) => {
    // IMPORTANT: Verify the origin
    if (event.origin !== 'https://wsim-auth-dev.banksim.ca') {
      return;
    }

    const { type, ...data } = event.data;

    switch (type) {
      case 'wsim:card-selected':
        // Payment confirmed - process the token
        onSuccess({
          token: data.token,           // Wallet payment token
          cardToken: data.cardToken,   // BSIM card token for payment processing
          cardLast4: data.cardLast4,   // Last 4 digits (e.g., "4242")
          cardBrand: data.cardBrand,   // Card brand (e.g., "visa")
          expiresAt: data.expiresAt    // Token expiration ISO timestamp
        });
        break;

      case 'wsim:cancelled':
        // User cancelled the payment
        onCancel(data.reason);
        break;

      case 'wsim:error':
        // An error occurred
        onError({
          code: data.code,
          message: data.message
        });
        break;

      case 'wsim:auth-required':
        // User needs to authenticate (informational)
        console.log('User authentication required:', data.message);
        break;
    }
  };

  window.addEventListener('message', handler);

  // Return cleanup function
  return () => window.removeEventListener('message', handler);
}
```

### 3. Complete Example

Here's a complete integration example:

```javascript
class WsimWalletIntegration {
  constructor() {
    this.popup = null;
    this.cleanup = null;
  }

  requestPayment(paymentDetails) {
    return new Promise((resolve, reject) => {
      // Clean up any previous listener
      if (this.cleanup) {
        this.cleanup();
      }

      // Set up message listener
      this.cleanup = setupWalletListener(
        (result) => {
          this.cleanup();
          resolve(result);
        },
        (reason) => {
          this.cleanup();
          reject(new Error(`Payment cancelled: ${reason}`));
        },
        (error) => {
          this.cleanup();
          reject(new Error(`Payment error: ${error.message}`));
        }
      );

      // Open the popup
      this.popup = openWalletPopup(paymentDetails);

      // Handle popup being closed without response
      const checkClosed = setInterval(() => {
        if (this.popup && this.popup.closed) {
          clearInterval(checkClosed);
          if (this.cleanup) {
            this.cleanup();
            reject(new Error('Payment cancelled: popup closed'));
          }
        }
      }, 500);
    });
  }
}

// Usage
const wallet = new WsimWalletIntegration();

async function handleCheckout() {
  try {
    const result = await wallet.requestPayment({
      merchantId: 'ssim-merchant',
      merchantName: 'SSIM Store',
      amount: 49.99,
      currency: 'CAD',
      orderId: 'order-' + Date.now()
    });

    console.log('Payment confirmed!', result);

    // Use result.cardToken to process the payment via NSIM/BSIM
    await processPayment(result.cardToken, 49.99);

  } catch (error) {
    console.error('Payment failed:', error.message);
  }
}
```

## Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `origin` | Yes | Your site's origin (for postMessage security) |
| `merchantId` | No | Your merchant identifier |
| `merchantName` | No | Display name shown to user |
| `amount` | No | Payment amount (displayed to user) |
| `currency` | No | Currency code (default: CAD) |
| `orderId` | No | Your order reference |

## PostMessage Response Types

### `wsim:card-selected`

Sent when user successfully selects a card and confirms with passkey.

```typescript
{
  type: 'wsim:card-selected',
  token: string,        // WSIM wallet payment token
  cardToken: string,    // BSIM card token for payment processing
  cardLast4: string,    // Last 4 digits of card
  cardBrand: string,    // Card brand (visa, mastercard, etc.)
  expiresAt: string     // ISO timestamp when token expires
}
```

### `wsim:cancelled`

Sent when user cancels the payment.

```typescript
{
  type: 'wsim:cancelled',
  reason: 'user'  // Reason for cancellation
}
```

### `wsim:error`

Sent when an error occurs.

```typescript
{
  type: 'wsim:error',
  code: string,    // Error code
  message: string  // Human-readable error message
}
```

Error codes:
- `passkey_cancelled` - User cancelled passkey authentication
- `payment_failed` - Payment processing failed
- `error` - General error

### `wsim:auth-required`

Informational message when user needs to authenticate.

```typescript
{
  type: 'wsim:auth-required',
  message: string  // Description of what's needed
}
```

## Security Considerations

1. **Always verify the origin** of postMessage events matches `https://wsim-auth-dev.banksim.ca`

2. **Tokens are short-lived** - The `cardToken` expires after 5 minutes. Process payment immediately.

3. **HTTPS required** - Both SSIM and WSIM must be served over HTTPS

4. **Origin validation** - WSIM validates that your origin is in `ALLOWED_POPUP_ORIGINS`

## Environment URLs

| Environment | Popup URL |
|-------------|-----------|
| Development | `https://wsim-auth-dev.banksim.ca/popup/card-picker` |
| Production | `https://wsim-auth.banksim.ca/popup/card-picker` |

## Prerequisites

For users to complete the popup flow, they must:

1. Have a WSIM wallet account
2. Have at least one card enrolled in their wallet
3. Have registered a passkey (for passkey-protected flow)

Users without a passkey will see a simplified flow (session-based confirmation).

## Testing

To test the integration:

1. Create a WSIM account at `https://wsim-dev.banksim.ca`
2. Enroll a card from BSIM
3. Register a passkey at `https://wsim-dev.banksim.ca/settings/passkeys`
4. Trigger the popup from your SSIM checkout page

## Troubleshooting

### "Access Denied" error
- Ensure your origin is in the `ALLOWED_POPUP_ORIGINS` list
- Contact WSIM team to add your origin

### Popup blocked
- Popup must be opened in response to user action (click)
- Check browser popup blocker settings

### Passkey errors
- Ensure user has registered a passkey
- Verify WebAuthn is supported in the browser
- Check that the RP ID matches the domain

## FAQ

### Is the `/popup/card-picker` endpoint ready?

**Yes, the endpoint is fully implemented and ready for integration.** The WSIM auth server has the following popup routes:

- `GET /popup/card-picker` - Render card picker UI
- `POST /popup/passkey/options` - Generate passkey authentication options
- `POST /popup/passkey/verify` - Verify passkey and return payment token
- `POST /popup/select-card-simple` - Session-based card selection (no passkey)

### Should this be a separate button or replace the existing wallet button?

**Recommendation: Add a separate button** rather than replacing the existing wallet integration.

Benefits of separate buttons:
- Users can choose their preferred flow (popup for quick checkout, redirect for full wallet management)
- Lower risk during initial integration testing
- Easier to A/B test conversion rates
- Allows graceful degradation if popup is blocked

Suggested UI pattern:
```
┌─────────────────────────────────────────┐
│ Payment Method                          │
├─────────────────────────────────────────┤
│ [💳 Pay with WSIM Wallet]  ← Popup flow │
│                                         │
│ [🔗 Sign in to WSIM]       ← Redirect   │
└─────────────────────────────────────────┘
```

### Is passkey auth required, or is session-based auth supported too?

**Both are supported.** WSIM automatically handles both scenarios:

1. **Passkey flow** (more secure):
   - If user has registered passkeys, they'll be prompted to confirm with biometrics
   - Provides phishing-resistant authentication
   - Recommended for higher-value transactions

2. **Session-based flow** (simpler):
   - If user has no passkeys but is logged in (session cookie), they can select a card directly
   - Uses `/popup/select-card-simple` endpoint
   - Lower friction but relies on session security

The popup UI automatically detects which flow to use based on the user's passkey registration status. You don't need to handle this on the SSIM side - just listen for the `wsim:card-selected` message regardless of which flow the user went through.

### What if the popup is blocked?

Browser popup blockers may prevent the wallet popup from opening. Recommendations:

1. **Always open popup from a user action** (click event) - this is more likely to be allowed
2. **Check if popup was blocked:**
   ```javascript
   const popup = window.open(popupUrl, 'wsim-wallet', '...');
   if (!popup || popup.closed || typeof popup.closed === 'undefined') {
     // Popup was blocked - fall back to redirect flow or show message
     window.location.href = '/checkout/redirect-flow';
   }
   ```
3. **Consider showing a fallback message** asking users to allow popups for your site

## Contact

For integration support or to request your origin be added to the allowed list, contact the WSIM team.

---

*Last updated: 2024-12-05*
