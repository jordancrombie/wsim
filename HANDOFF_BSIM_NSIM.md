# BSIM/NSIM Team Handoff - Wallet Payment Integration

> **Date**: 2025-12-05
> **Status**: WSIM flow complete - Merchant mismatch issue on NSIM side
> **Priority**: High
> **WSIM Team**: Standing by to assist

---

## Summary

**UPDATE**: The WSIM → SSIM payment flow is now fully working! JWT tokens with payment claims are being issued correctly. The current blocker is a **"Merchant mismatch"** error from NSIM.

### Previous Issue (RESOLVED)
- ~~"Invalid card token" error~~ - Fixed by BSIM team

### Current Issue
- **"Merchant mismatch"** error from NSIM when authorizing payment

---

## What's Working (WSIM/SSIM Side) ✅

1. **SSIM Checkout** - "Pay with Wallet" button appears and initiates OIDC flow to WSIM
2. **WSIM Login** - User authenticates with email (passthrough auth via BSIM enrollment)
3. **WSIM Card Selection** - User selects enrolled card for payment (fresh consent for each payment)
4. **WSIM Token Generation** - WSIM requests card token from BSIM via `/api/wallet/tokens`
5. **WSIM JWT Access Token** - Issues JWT with `wallet_card_token` and `card_token` claims
6. **SSIM Token Extraction** - Successfully extracts both tokens from WSIM JWT
7. **SSIM Calls NSIM** - Payment authorization request sent to NSIM

---

## Current Issue: Merchant Mismatch

### NSIM Response

```json
{
  "transactionId": "53fb32d2-5aed-4179-9c43-c2fe2c83e7ad",
  "status": "declined",
  "declineReason": "Merchant mismatch",
  "timestamp": "2025-12-05T19:56:00.252Z"
}
```

### Root Cause

There's a merchant ID mismatch between what's in the BSIM card token and what SSIM sends:

**In the BSIM card token** (created when WSIM requests token):
```json
{
  "type": "wallet_payment_token",
  "merchantId": "ssim-merchant",   // <-- WSIM passes this (OAuth client_id)
  ...
}
```

**In SSIM's payment claims** (sent to WSIM during authorization):
```json
{
  "payment": {
    "merchantId": "ssim-client",   // <-- SSIM sends this
    ...
  }
}
```

The mismatch: `"ssim-merchant"` vs `"ssim-client"`

### Where the IDs Come From

1. **`ssim-merchant`** - This is SSIM's OAuth client_id registered in WSIM. WSIM passes this to BSIM when requesting a card token.

2. **`ssim-client`** - This is what SSIM sends in its payment claims. It appears to be SSIM's client_id for BSIM.

---

## Detailed Flow & Logs

### 1. SSIM Initiates Payment

SSIM sends payment claims with `merchantId: "ssim-client"`:

```
claims={"payment":{"amount":"79.99","currency":"CAD","merchantId":"ssim-client","orderId":"order-..."}}
```

### 2. WSIM Requests Card Token from BSIM

WSIM calls BSIM's `/api/wallet/tokens` with the OAuth client_id as merchant:

```
[Interaction] Requesting card token for card 7d8e4006...
```

Passes: `merchantId: "ssim-merchant"` (the OAuth client_id)

### 3. BSIM Returns Card Token

The card token JWT contains:

```json
{
  "type": "wallet_payment_token",
  "cardId": "b7e28da9-0c97-4651-b1f8-821c740ab62b",
  "merchantId": "ssim-merchant",  // <-- Embedded in token
  "currency": "CAD",
  ...
}
```

### 4. WSIM Issues JWT to SSIM

```json
{
  "wallet_card_token": "wsim_bsim_054643f39bd6",
  "card_token": "eyJhbG...",  // Contains merchantId: "ssim-merchant"
  "payment_currency": null,
  "scope": "openid payment:authorize",
  "client_id": "ssim-merchant",
  ...
}
```

### 5. SSIM Extracts Tokens and Calls NSIM

```
[Payment] WSIM JWT payload: {
  "wallet_card_token": "wsim_bsim_054643f39bd6",
  "card_token": "eyJhbG...",
  ...
}
[Payment] Extracted wallet_card_token and card_token from WSIM JWT
[Payment] Authorizing wallet payment via NSIM...
```

### 6. NSIM Declines with Merchant Mismatch

```json
{
  "status": "declined",
  "declineReason": "Merchant mismatch"
}
```

---

## Proposed Fixes

### Option 1: SSIM uses consistent merchant ID

SSIM should use `ssim-merchant` (its WSIM OAuth client_id) as the merchantId in payment claims, OR register with BSIM using a consistent ID.

**Files to check:**
- `ssim/src/routes/payment.ts` - Where payment claims are constructed

### Option 2: WSIM passes through SSIM's merchantId

WSIM could use the merchantId from SSIM's payment claims instead of the OAuth client_id when requesting the card token from BSIM.

**Current code in WSIM** (`auth-server/src/routes/interaction.ts`):
```typescript
const tokenResult = await requestCardToken(
  walletCardId,
  paymentDetails.merchantId || details.params.client_id as string,  // Falls back to client_id
  ...
);
```

### Option 3: NSIM/BSIM relaxes merchant validation

NSIM could be configured to accept payments where the calling merchant is authorized by the wallet, even if IDs don't match exactly.

---

## Files Changed (WSIM Side)

### WSIM Auth Server
- [auth-server/src/oidc-config.ts](auth-server/src/oidc-config.ts)
  - Resource indicators for JWT tokens
  - `loadExistingGrant` to force fresh consent for payments
  - `extraTokenClaims` to add payment claims to JWT

- [auth-server/src/routes/interaction.ts](auth-server/src/routes/interaction.ts)
  - Card selection and token request
  - Payment context storage

### WSIM Backend
- [backend/src/routes/payment.ts](backend/src/routes/payment.ts)
  - Payment context storage/retrieval endpoints
  - Card token request to BSIM

### SSIM
- [ssim/src/routes/payment.ts](../ssim/src/routes/payment.ts)
  - Wallet callback and NSIM authorization call

---

## How to Test

1. Go to https://ssim-dev.banksim.ca/checkout
2. Add items to cart
3. Click "Pay with Wallet"
4. Enter email for WSIM user with enrolled cards (e.g., testuser5@banksim.ca)
5. Select a card and click "Authorize Payment"
6. Observe error: "Payment declined: Merchant mismatch"

---

## Contact

WSIM team is standing by to assist with debugging. We can:
- Adjust which merchantId is passed to BSIM (Option 2)
- Add additional logging
- Help trace the flow end-to-end

Let us know which fix approach you'd like to take!
