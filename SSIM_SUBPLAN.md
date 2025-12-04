# SSIM Sub-Plan: Pay with Wallet Integration

> **AI Context**: This document describes changes needed to the Store Simulator (ssim) to support wallet payments. The ssim codebase is located at `/Users/jcrombie/ai/ssim`. It uses Express.js + TypeScript backend with EJS templates, and implements OIDC client flows using `openid-client`. Review existing payment flow in `src/routes/payment.ts` and OIDC setup in `src/services/oidc.ts`.

## Overview

SSIM needs to add a "Pay with Wallet" option that:
1. Redirects users to wsim for card selection
2. Receives wallet card token + bsim card token back
3. Passes both tokens to nsim for payment authorization

This is **in addition to** the existing "Pay with Bank" flow (direct bsim auth).

## Prerequisites

- WSIM is deployed and has OIDC provider running
- NSIM has bsim routing implemented
- Existing payment flow works correctly

---

## Task 1: Add WSIM as OIDC Provider

### Context for AI
> OIDC providers are configured in `src/services/oidc.ts` or `src/config/oidc-providers.ts`. The existing bsim provider configuration is a good template. SSIM uses the `openid-client` library.

### Requirements

Add wsim as a new OIDC provider alongside existing bsim:

```typescript
// In environment/config
{
  providerId: 'wsim',
  issuer: 'https://wsim.banksim.ca',
  clientId: 'ssim-merchant',
  clientSecret: process.env.WSIM_CLIENT_SECRET,
  scope: 'openid payment:authorize',
  redirectUri: `${APP_BASE_URL}/payment/wallet-callback`,
  postLogoutRedirectUri: `${APP_BASE_URL}`,
}
```

### Implementation Hints

```typescript
// src/config/oidc-providers.ts
export const oidcProviders = [
  // Existing bsim provider for "Pay with Bank"
  {
    providerId: 'bsim',
    issuer: process.env.BSIM_AUTH_URL,
    clientId: process.env.BSIM_CLIENT_ID,
    // ...
  },
  // New wsim provider for "Pay with Wallet"
  {
    providerId: 'wsim',
    issuer: process.env.WSIM_URL,
    clientId: process.env.WSIM_CLIENT_ID,
    clientSecret: process.env.WSIM_CLIENT_SECRET,
    scope: 'openid payment:authorize',
    redirectUri: `${process.env.APP_BASE_URL}/payment/wallet-callback`,
    // Note: wsim returns both walletCardToken and cardToken in claims
  },
];
```

### Acceptance Criteria
- [ ] WSIM provider is registered and discoverable
- [ ] OIDC client can fetch wsim's well-known configuration
- [ ] Provider appears in available payment options

---

## Task 2: Checkout UI - "Pay with Wallet" Button

### Context for AI
> Checkout page is likely in `src/views/checkout.ejs` or similar. The existing "Pay with Bank" button initiates OIDC flow to bsim. Add a parallel option for wallet.

### Requirements

Add a second payment option on checkout:

```html
<!-- checkout.ejs -->
<div class="payment-options">
  <h3>Choose Payment Method</h3>

  <!-- Existing bank payment -->
  <form action="/payment/initiate" method="POST">
    <input type="hidden" name="provider" value="bsim">
    <button type="submit" class="payment-btn bank-btn">
      🏦 Pay with Bank
    </button>
  </form>

  <!-- New wallet payment -->
  <form action="/payment/initiate" method="POST">
    <input type="hidden" name="provider" value="wsim">
    <button type="submit" class="payment-btn wallet-btn">
      👛 Pay with Wallet
    </button>
  </form>
</div>
```

### Styling Suggestions

```css
.payment-options {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.payment-btn {
  padding: 1rem 2rem;
  font-size: 1.1rem;
  border-radius: 8px;
  cursor: pointer;
}

.wallet-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
}

.bank-btn {
  background: #2563eb;
  color: white;
  border: none;
}
```

### Acceptance Criteria
- [ ] Both payment buttons appear on checkout
- [ ] Clicking "Pay with Wallet" initiates wsim flow
- [ ] Clicking "Pay with Bank" still works (existing flow)

---

## Task 3: Payment Initiation Route Update

### Context for AI
> Payment initiation is in `src/routes/payment.ts`. The existing flow creates an order and redirects to bsim. Update to handle both providers.

### Requirements

Update `/payment/initiate` to handle provider selection:

```typescript
// POST /payment/initiate
router.post('/initiate', requireAuth, async (req, res) => {
  const { provider } = req.body; // 'bsim' or 'wsim'

  // Create order (existing logic)
  const order = await createOrder(req.session.cart, req.session.userInfo);

  // Store payment state
  req.session.paymentState = {
    orderId: order.id,
    provider,
    state: generateState(),
    nonce: generateNonce(),
    codeVerifier: generateCodeVerifier(),
  };

  // Get OIDC client for selected provider
  const oidcClient = await getOidcClient(provider);

  // Build authorization URL
  const authUrl = oidcClient.authorizationUrl({
    scope: 'openid payment:authorize',
    state: req.session.paymentState.state,
    nonce: req.session.paymentState.nonce,
    code_challenge: generateCodeChallenge(req.session.paymentState.codeVerifier),
    code_challenge_method: 'S256',
    // Pass payment details as claims request
    claims: JSON.stringify({
      payment: {
        amount: order.subtotal.toString(),
        currency: order.currency,
        merchantId: process.env.MERCHANT_ID,
        merchantName: process.env.MERCHANT_NAME,
        orderId: order.id,
      }
    }),
  });

  res.redirect(authUrl);
});
```

### Acceptance Criteria
- [ ] Provider selection flows to correct OIDC issuer
- [ ] Payment claims are passed correctly
- [ ] Session state tracks which provider was used

---

## Task 4: Wallet Payment Callback

### Context for AI
> Existing callback is at `/payment/callback` for bsim. Create a new callback route for wsim that handles the wallet-specific token claims.

### Requirements

Create `/payment/wallet-callback`:

```typescript
// GET /payment/wallet-callback
router.get('/wallet-callback', async (req, res) => {
  const { code, state, error } = req.query;
  const paymentState = req.session.paymentState;

  // Validate state
  if (state !== paymentState.state) {
    return res.redirect('/checkout?error=invalid_state');
  }

  // Handle errors
  if (error) {
    return res.redirect(`/checkout?error=${error}`);
  }

  try {
    // Exchange code for tokens
    const oidcClient = await getOidcClient('wsim');
    const tokenSet = await oidcClient.callback(
      `${process.env.APP_BASE_URL}/payment/wallet-callback`,
      { code, state },
      {
        state: paymentState.state,
        nonce: paymentState.nonce,
        code_verifier: paymentState.codeVerifier,
      }
    );

    // Extract tokens from claims
    const accessTokenClaims = decodeJwt(tokenSet.access_token);

    // WSIM returns BOTH tokens:
    // - walletCardToken: for NSIM routing (identifies bsim)
    // - cardToken: for actual payment authorization at bsim
    const { walletCardToken, cardToken } = accessTokenClaims;

    if (!walletCardToken || !cardToken) {
      throw new Error('Missing payment tokens in response');
    }

    // Get order
    const order = await getOrder(paymentState.orderId);

    // Call NSIM to authorize payment
    const authResult = await authorizePayment({
      merchantId: process.env.MERCHANT_ID,
      merchantName: process.env.MERCHANT_NAME,
      amount: order.subtotal,
      currency: order.currency,
      walletCardToken,  // NEW: for routing
      cardToken,        // Existing: for bsim authorization
      orderId: order.id,
    });

    // Update order with payment details
    await updateOrder(order.id, {
      status: authResult.status === 'authorized' ? 'authorized' : 'declined',
      paymentDetails: {
        transactionId: authResult.transactionId,
        authorizationCode: authResult.authorizationCode,
        walletCardToken,
        cardToken,
        provider: 'wsim',
      },
    });

    // Clear payment state
    delete req.session.paymentState;

    // Redirect to order confirmation
    res.redirect(`/orders/${order.id}`);

  } catch (err) {
    console.error('Wallet payment callback error:', err);
    res.redirect(`/checkout?error=payment_failed`);
  }
});
```

### Acceptance Criteria
- [ ] Callback exchanges code for tokens correctly
- [ ] Both walletCardToken and cardToken are extracted
- [ ] NSIM authorization includes both tokens
- [ ] Order is updated with payment details
- [ ] Error handling works correctly

---

## Task 5: Update NSIM Client

### Context for AI
> NSIM client is likely in `src/services/payment.ts` or `src/clients/nsim.ts`. Update the authorize request to include the wallet card token.

### Requirements

Update payment authorization to include `walletCardToken`:

```typescript
// src/services/payment.ts
interface AuthorizePaymentRequest {
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: string;
  cardToken: string;
  walletCardToken?: string;  // NEW: optional for wallet payments
  orderId: string;
}

export async function authorizePayment(request: AuthorizePaymentRequest) {
  const response = await fetch(`${NSIM_URL}/api/v1/payments/authorize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.NSIM_API_KEY,
    },
    body: JSON.stringify({
      merchantId: request.merchantId,
      merchantName: request.merchantName,
      amount: request.amount,
      currency: request.currency,
      cardToken: request.cardToken,
      // Include wallet token if present (for routing)
      ...(request.walletCardToken && {
        walletCardToken: request.walletCardToken
      }),
      orderId: request.orderId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Payment authorization failed: ${response.status}`);
  }

  return response.json();
}
```

### Acceptance Criteria
- [ ] Authorization request includes walletCardToken when provided
- [ ] Backward compatible with direct bsim flow (no walletCardToken)
- [ ] NSIM accepts and routes correctly

---

## Task 6: Order Details Update

### Context for AI
> Order confirmation page shows payment details. Update to show wallet vs bank payment source.

### Requirements

Display payment source on order details:

```html
<!-- order-details.ejs -->
<div class="payment-info">
  <h4>Payment Details</h4>

  <% if (order.paymentDetails.provider === 'wsim') { %>
    <p>Paid via: 👛 Digital Wallet</p>
  <% } else { %>
    <p>Paid via: 🏦 Direct Bank Payment</p>
  <% } %>

  <p>Status: <%= order.status %></p>
  <p>Transaction ID: <%= order.paymentDetails.transactionId %></p>

  <% if (order.status === 'authorized') { %>
    <form action="/payment/capture/<%= order.id %>" method="POST">
      <button type="submit">Complete Purchase</button>
    </form>
  <% } %>
</div>
```

### Acceptance Criteria
- [ ] Order shows correct payment source (wallet vs bank)
- [ ] All existing functionality still works

---

## Testing Checklist

### Unit Tests
- [ ] Provider selection in initiate route
- [ ] Token extraction from wsim response
- [ ] NSIM client with walletCardToken

### Integration Tests
- [ ] Full wallet payment flow (ssim → wsim → nsim → bsim)
- [ ] Full bank payment flow still works
- [ ] Error handling for failed wallet auth
- [ ] Error handling for declined payments

### Manual Testing
- [ ] Checkout shows both payment options
- [ ] "Pay with Wallet" redirects to wsim
- [ ] Card selection in wsim works
- [ ] Payment completes successfully
- [ ] Order confirmation shows correct info

---

## Environment Variables

Add to `.env`:

```bash
# WSIM Configuration
WSIM_URL=https://wsim.banksim.ca
WSIM_CLIENT_ID=ssim-merchant
WSIM_CLIENT_SECRET=your-wsim-client-secret

# Existing variables should remain
BSIM_AUTH_URL=https://auth.banksim.ca
BSIM_CLIENT_ID=ssim-client
# ...
```

---

## Dependencies

### Depends On (must be completed first):
1. **WSIM Core** - OIDC provider must be running
2. **NSIM Changes** - Must accept walletCardToken for routing

### Depended On By:
- None (end of the chain for this flow)

### Estimated Effort
2-3 days

---

## Sequence Diagram

```
┌──────┐          ┌──────┐          ┌──────┐          ┌──────┐          ┌──────┐
│ User │          │ SSIM │          │ WSIM │          │ NSIM │          │ BSIM │
└──┬───┘          └──┬───┘          └──┬───┘          └──┬───┘          └──┬───┘
   │                 │                 │                 │                 │
   │ Click "Pay      │                 │                 │                 │
   │ with Wallet"    │                 │                 │                 │
   │────────────────>│                 │                 │                 │
   │                 │                 │                 │                 │
   │                 │ Redirect to     │                 │                 │
   │                 │ /authorize      │                 │                 │
   │                 │────────────────>│                 │                 │
   │                 │                 │                 │                 │
   │ Card selection  │                 │                 │                 │
   │ UI              │<─ ─ ─ ─ ─ ─ ─ ─│                 │                 │
   │<────────────────│                 │                 │                 │
   │                 │                 │                 │                 │
   │ Select card     │                 │                 │                 │
   │ & authorize     │                 │                 │                 │
   │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─>│                 │                 │
   │                 │                 │                 │                 │
   │                 │                 │ Request card    │                 │
   │                 │                 │ token           │                 │
   │                 │                 │────────────────────────────────────>
   │                 │                 │                 │                 │
   │                 │                 │ cardToken       │                 │
   │                 │                 │<────────────────────────────────────
   │                 │                 │                 │                 │
   │                 │ Callback with   │                 │                 │
   │                 │ code            │                 │                 │
   │                 │<────────────────│                 │                 │
   │                 │                 │                 │                 │
   │                 │ Exchange code   │                 │                 │
   │                 │ for tokens      │                 │                 │
   │                 │────────────────>│                 │                 │
   │                 │                 │                 │                 │
   │                 │ {walletCardToken│                 │                 │
   │                 │  cardToken}     │                 │                 │
   │                 │<────────────────│                 │                 │
   │                 │                 │                 │                 │
   │                 │ Authorize       │                 │                 │
   │                 │ {walletCardToken, cardToken}      │                 │
   │                 │──────────────────────────────────>│                 │
   │                 │                 │                 │                 │
   │                 │                 │                 │ Route & auth    │
   │                 │                 │                 │────────────────>│
   │                 │                 │                 │                 │
   │                 │                 │                 │ Approved        │
   │                 │                 │                 │<────────────────│
   │                 │                 │                 │                 │
   │                 │ transactionId   │                 │                 │
   │                 │<──────────────────────────────────│                 │
   │                 │                 │                 │                 │
   │ Order           │                 │                 │                 │
   │ confirmation    │                 │                 │                 │
   │<────────────────│                 │                 │                 │
   │                 │                 │                 │                 │
```

---

## Questions for WSIM Team

1. What claims will be in the wsim access token?
2. Should ssim display card info (last 4 digits) after authorization?
3. Any specific error codes we should handle?
