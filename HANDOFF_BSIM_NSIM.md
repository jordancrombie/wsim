# BSIM/NSIM Team Handoff - Wallet Payment Token Validation Issue

> **Date**: 2025-12-05
> **Status**: Blocking E2E wallet payment flow
> **Priority**: High
> **WSIM Team**: Standing by to assist

---

## Summary

The WSIM → SSIM payment flow is working correctly up to the point where SSIM sends the payment authorization to NSIM. NSIM is rejecting the card token with "Invalid card token" error.

## What's Working (WSIM/SSIM Side)

1. **SSIM Checkout** - "Pay with Wallet" button appears and initiates OIDC flow to WSIM
2. **WSIM Login** - User authenticates with email (passthrough auth via BSIM enrollment)
3. **WSIM Card Selection** - User selects enrolled card for payment
4. **WSIM Token Generation** - WSIM requests card token from BSIM via `/api/wallet/request-token`
5. **WSIM JWT Access Token** - Issues JWT with `wallet_card_token` and `card_token` claims
6. **SSIM Token Extraction** - Successfully extracts both tokens from WSIM JWT

## What's Failing (NSIM Side)

NSIM declines the payment with "Invalid card token" when SSIM calls `POST /api/v1/payments/authorize`.

## Detailed Flow & Logs

### 1. WSIM Requests Card Token from BSIM

```
[Interaction] Requesting card token for card 7d8e4006...
```

WSIM calls BSIM's `/api/wallet/request-token` endpoint with:
- `walletCardId` - WSIM's card ID
- `merchantId` - "ssim-merchant"
- `amount`, `currency` - Payment details

### 2. BSIM Returns Card Token

The card token is a JWT with type `wallet_payment_token`:

```json
{
  "type": "wallet_payment_token",
  "cardId": "b7e28da9-0c97-4651-b1f8-821c740ab62b",
  "fiUserRef": "12f82271-6b15-476a-a564-efffe085b8f0",
  "walletId": "wsim-wallet",
  "merchantId": "ssim-merchant",
  "currency": "CAD",
  "iat": 1764960561,
  "exp": 1764960861,
  "jti": "d05a77fd53ffc13eefb0b9c7718a8321"
}
```

**Note**: 5-minute TTL (`exp - iat = 300 seconds`)

### 3. WSIM Issues JWT Access Token to SSIM

```json
{
  "wallet_card_token": "wsim_bsim_054643f39bd6",
  "card_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoid2FsbGV0X3BheW1lbnRfdG9rZW4iLCJjYXJkSWQiOiJiN2UyOGRhOS0wYzk3LTQ2NTEtYjFmOC04MjFjNzQwYWI2MmIiLCJmaVVzZXJSZWYiOiIxMmY4MjI3MS02YjE1LTQ3NmEtYTU2NC1lZmZmZTA4NWI4ZjAiLCJ3YWxsZXRJZCI6IndzaW0td2FsbGV0IiwibWVyY2hhbnRJZCI6InNzaW0tbWVyY2hhbnQiLCJjdXJyZW5jeSI6IkNBRCIsImlhdCI6MTc2NDk2MDU2MSwiZXhwIjoxNzY0OTYwODYxLCJqdGkiOiJkMDVhNzdmZDUzZmZjMTNlZWZiMGI5Yzc3MThhODMyMSJ9.pxsqWqgKpADmPJLvQYoaFdqFw3SjZrap8j5MqSV1Mdo",
  "aud": "urn:wsim:payment-api"
}
```

### 4. SSIM Calls NSIM

SSIM logs show successful extraction and call to NSIM:

```
[Payment] Extracted wallet_card_token and card_token from WSIM JWT
[Payment] Authorizing wallet payment via NSIM...
[PaymentService] POST https://payment-dev.banksim.ca/api/v1/payments/authorize
```

Request body includes:
- `walletCardToken`: `"wsim_bsim_054643f39bd6"` (for routing to correct BSIM)
- `cardToken`: `"eyJhbG..."` (BSIM-issued JWT for authorization)
- `amount`, `currency`, `merchantId`, `orderId`

### 5. NSIM Response

```json
{
  "transactionId": "81e65247-8fe5-40e4-9dd3-c890995d4c4f",
  "status": "declined",
  "declineReason": "Invalid card token",
  "timestamp": "2025-12-05T18:55:55.079Z"
}
```

---

## Possible Causes

### 1. Token Expiration
The card token has a 5-minute TTL. If there's any delay between:
- WSIM requesting the token from BSIM
- User completing card selection
- SSIM receiving callback and calling NSIM

...the token may have expired.

### 2. Token Type Not Recognized
The card token has `"type": "wallet_payment_token"`. NSIM may only recognize `"payment_token"` or similar types from direct BSIM payment flows.

### 3. Signature Validation
NSIM needs the correct secret to validate BSIM card tokens. If using a different secret or validation method for wallet tokens, this could fail.

### 4. Routing Issue
The `walletCardToken` format is `wsim_bsim_{uniqueId}`. NSIM should:
1. Parse the prefix to extract `bsim` as the target BSIM ID
2. Route to the correct BSIM for token validation
3. Use BSIM-specific API credentials

---

## Proposed Troubleshooting Steps

### For BSIM Team:

1. **Review `/api/wallet/request-token` endpoint**
   - Confirm token is signed with correct secret
   - Check if `wallet_payment_token` type is handled correctly downstream
   - Consider increasing TTL if 5 minutes is too short

2. **Check token validation logic**
   - Does BSIM payment endpoint validate `wallet_payment_token` type?
   - Is the same signing secret used for validation?

### For NSIM Team:

1. **Check routing logic**
   - Is `walletCardToken` being parsed to extract BSIM ID?
   - Is the request being routed to the correct BSIM?

2. **Check token validation**
   - Is NSIM trying to validate the token before routing?
   - Should NSIM pass the token through to BSIM for validation?

3. **Add logging**
   - Log the incoming `walletCardToken` and `cardToken`
   - Log which BSIM is selected for routing
   - Log the response from BSIM

---

## Files Changed (WSIM/SSIM Side)

### WSIM Auth Server
- [auth-server/src/oidc-config.ts](auth-server/src/oidc-config.ts) - Resource indicators for JWT tokens
- [auth-server/src/routes/interaction.ts](auth-server/src/routes/interaction.ts) - Card selection and token request

### SSIM
- [ssim/src/routes/payment.ts](../ssim/src/routes/payment.ts) - Wallet callback and NSIM authorization call

---

## How to Test

1. Go to https://ssim-dev.banksim.ca/checkout
2. Add items to cart
3. Click "Pay with Wallet"
4. Enter email for WSIM user with enrolled cards
5. Select a card and click "Authorize Payment"
6. Observe error: "Payment declined: Invalid card token"

---

## Contact

WSIM team is standing by to assist with debugging. We can:
- Add additional logging to WSIM token generation
- Adjust token format/claims if needed
- Help trace the flow end-to-end

Let us know if you need any additional information or debugging assistance!
