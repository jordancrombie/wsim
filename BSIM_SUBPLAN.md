# BSIM Sub-Plan: Wallet Credential Support

> **AI Context**: This document describes changes needed to the Banking Simulator (bsim) to support wallet enrollment. The bsim codebase is located at `/Users/jcrombie/ai/bsim`. It uses Express.js + TypeScript backend, PostgreSQL with Prisma ORM, and has an OIDC authorization server using `oidc-provider`. Review the existing OIDC implementation in `auth-server/` and payment APIs in `backend/src/routes/`.

## Overview

BSIM needs to support a new "wallet enrollment" flow where a wallet simulator (wsim) can:
1. Authenticate users and obtain long-lived wallet credentials
2. Retrieve a user's card information (masked)
3. Request ephemeral card tokens for payments on behalf of the user

## Prerequisites

- Existing OIDC provider is functional
- Payment network APIs (`/api/payment-network/*`) are working
- Credit card model exists with card tokens

---

## Task 1: New OIDC Scope - `wallet:enroll`

### Context for AI
> The OIDC provider is configured in `auth-server/src/oidc-config.ts`. Scopes and claims are defined there. The pattern for adding new scopes follows the existing `payment:authorize` scope implementation.

### Requirements

1. **Add new scope**: `wallet:enroll`
   - This scope allows wsim to enroll a user's cards into the wallet
   - Should be requested during the initial enrollment flow

2. **Add new claims**:
   ```typescript
   'wallet:enroll': ['wallet_credential', 'fi_user_ref']
   ```

3. **Implement `extraTokenClaims`** to include:
   - `wallet_credential`: A long-lived JWT that wsim stores
   - `fi_user_ref`: The user's financial institution reference (existing field on User model)

### Implementation Hints

```typescript
// In oidc-config.ts, add to claims:
const claims = {
  // ... existing claims
  'wallet:enroll': ['wallet_credential', 'fi_user_ref'],
};

// In extraTokenClaims callback:
async extraTokenClaims(ctx, token) {
  const claims: Record<string, unknown> = {};

  if (token.scope?.includes('wallet:enroll')) {
    // Generate wallet credential (long-lived JWT)
    const walletCredential = await generateWalletCredential(token.accountId);
    claims.wallet_credential = walletCredential;
    claims.fi_user_ref = user.fiUserRef;
  }

  return claims;
}
```

### Acceptance Criteria
- [ ] `wallet:enroll` scope is recognized by OIDC provider
- [ ] Token response includes `wallet_credential` claim when scope is granted
- [ ] Wallet credential is a valid JWT with appropriate expiry (90 days suggested)

---

## Task 2: Wallet Credential Model

### Context for AI
> Prisma schema is at `backend/prisma/schema.prisma`. Follow existing patterns for models like `PaymentConsent`. The wallet credential is similar to a consent but specifically for wallet access.

### Requirements

Add new Prisma model:

```prisma
model WalletCredential {
  id              String    @id @default(uuid())

  // Owner
  userId          String
  user            User      @relation(fields: [userId], references: [id])

  // Wallet identification
  walletId        String              // wsim's wallet identifier
  walletName      String?             // e.g., "WalletSim"

  // Credential
  credentialToken String    @unique   // The JWT or opaque token

  // Permissions
  scope           String              // Granted scopes (space-separated)
  cardIds         String[]            // Cards this credential can access

  // Lifecycle
  expiresAt       DateTime
  revokedAt       DateTime?
  lastUsedAt      DateTime?

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([userId])
  @@index([credentialToken])
}
```

### Implementation Hints
- Run `npx prisma migrate dev --name add_wallet_credential` after adding model
- Add relation to User model: `walletCredentials WalletCredential[]`

### Acceptance Criteria
- [ ] Migration runs successfully
- [ ] Can create/read/update WalletCredential records
- [ ] Relation to User works correctly

---

## Task 3: Wallet API Endpoints

### Context for AI
> API routes are in `backend/src/routes/`. Follow the pattern used in `credit-cards.ts` and `payment-network.ts`. Use the existing auth middleware for JWT validation.

### Requirements

Create new route file: `backend/src/routes/wallet.ts`

#### 3.1 GET /api/wallet/cards

Returns masked card information for the authenticated user.

```typescript
// Request
GET /api/wallet/cards
Authorization: Bearer {wallet_credential}

// Response 200 OK
{
  "cards": [
    {
      "cardRef": "card_abc123",        // Internal reference (NOT card number)
      "cardType": "VISA",
      "lastFour": "4532",
      "cardholderName": "John Doe",
      "expiryMonth": 12,
      "expiryYear": 2026,
      "isActive": true
    }
  ]
}
```

#### 3.2 POST /api/wallet/request-token

Generates an ephemeral card token for a specific payment.

```typescript
// Request
POST /api/wallet/request-token
Authorization: Bearer {wallet_credential}
Content-Type: application/json

{
  "cardRef": "card_abc123",
  "merchantId": "bestbuy-ssim",
  "merchantName": "BestBuy Electronics",
  "amount": 125.00,
  "currency": "CAD"
}

// Response 200 OK
{
  "cardToken": "tok_xyz789...",
  "expiresAt": "2024-01-15T10:45:00Z",
  "tokenType": "single_use"
}

// Response 403 Forbidden (card not in credential scope)
{
  "error": "card_not_authorized",
  "message": "This card is not authorized for wallet access"
}
```

#### 3.3 POST /api/wallet/revoke

Revokes a wallet credential (user-initiated).

```typescript
// Request
POST /api/wallet/revoke
Authorization: Bearer {wallet_credential}

// Response 200 OK
{
  "revoked": true,
  "revokedAt": "2024-01-15T10:00:00Z"
}
```

#### 3.4 GET /api/wallet/status

Check credential status.

```typescript
// Request
GET /api/wallet/status
Authorization: Bearer {wallet_credential}

// Response 200 OK
{
  "valid": true,
  "expiresAt": "2024-04-15T00:00:00Z",
  "scope": "wallet:enroll wallet:cards wallet:pay",
  "cardCount": 3
}
```

### Implementation Hints

```typescript
// backend/src/routes/wallet.ts
import { Router } from 'express';
import { verifyWalletCredential } from '../middleware/wallet-auth';

const router = Router();

// Middleware to verify wallet credential JWT
router.use(verifyWalletCredential);

router.get('/cards', async (req, res) => {
  const { userId, cardIds } = req.walletCredential;

  const cards = await prisma.creditCard.findMany({
    where: {
      userId,
      id: { in: cardIds },
      // Don't return deleted/inactive cards
    },
    select: {
      id: true,
      cardType: true,
      cardNumber: true,  // Will mask this
      cardHolder: true,
      expiryMonth: true,
      expiryYear: true,
    }
  });

  // Mask card numbers
  const maskedCards = cards.map(card => ({
    cardRef: card.id,
    cardType: card.cardType,
    lastFour: card.cardNumber.slice(-4),
    cardholderName: card.cardHolder,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    isActive: true,
  }));

  res.json({ cards: maskedCards });
});

router.post('/request-token', async (req, res) => {
  const { cardRef, merchantId, merchantName, amount, currency } = req.body;
  const { userId, cardIds } = req.walletCredential;

  // Verify card is in scope
  if (!cardIds.includes(cardRef)) {
    return res.status(403).json({
      error: 'card_not_authorized',
      message: 'This card is not authorized for wallet access'
    });
  }

  // Generate ephemeral token (reuse existing PaymentConsent logic)
  const consent = await prisma.paymentConsent.create({
    data: {
      userId,
      creditCardId: cardRef,
      merchantId,
      merchantName,
      maxAmount: amount,
      cardToken: generateCardToken(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min
    }
  });

  res.json({
    cardToken: consent.cardToken,
    expiresAt: consent.expiresAt,
    tokenType: 'single_use',
  });
});

export default router;
```

### Acceptance Criteria
- [ ] All endpoints return correct responses
- [ ] Wallet credential validation works
- [ ] Card tokens are generated correctly
- [ ] Tokens work with existing payment-network authorize endpoint
- [ ] Proper error handling for invalid/expired credentials

---

## Task 4: BSIM Registry Registration

### Context for AI
> NSIM maintains a registry of bsims for routing. BSIM needs to register itself on startup or provide a registration endpoint.

### Requirements

1. **Define BSIM metadata** that will be registered with NSIM:

```typescript
interface BsimRegistration {
  bsimId: string;              // Unique identifier, e.g., "td-bank"
  name: string;                // Display name, e.g., "TD Canada Trust"
  apiBaseUrl: string;          // e.g., "https://td.banksim.ca"
  authServerUrl: string;       // OIDC issuer URL
  supportedCardTypes: string[]; // ["VISA", "MC", "VISA_DEBIT"]
  walletEnrollmentSupported: boolean;
}
```

2. **Option A**: Register on startup (call NSIM API)
3. **Option B**: Expose registration info at `GET /api/registry/info`

### Implementation Hints

```typescript
// backend/src/config/bsim-identity.ts
export const bsimIdentity: BsimRegistration = {
  bsimId: process.env.BSIM_ID || 'default-bsim',
  name: process.env.BSIM_NAME || 'Bank Simulator',
  apiBaseUrl: process.env.BSIM_API_URL || 'http://localhost:3001',
  authServerUrl: process.env.BSIM_AUTH_URL || 'http://localhost:3002',
  supportedCardTypes: ['VISA', 'MC', 'AMEX', 'VISA_DEBIT', 'MC_DEBIT'],
  walletEnrollmentSupported: true,
};

// GET /api/registry/info
router.get('/info', (req, res) => {
  res.json(bsimIdentity);
});
```

### Acceptance Criteria
- [ ] BSIM identity is configurable via environment
- [ ] Registration info endpoint returns correct data
- [ ] NSIM can successfully register this bsim

---

## Task 5: Consent UI Updates

### Context for AI
> The auth-server has consent pages rendered during OIDC flows. When `wallet:enroll` scope is requested, the consent UI should explain what wallet enrollment means.

### Requirements

Update consent screen to show wallet-specific messaging when `wallet:enroll` is in requested scopes:

```
WalletSim wants to:

✓ Access your profile (name, email)
✓ Add your cards to your digital wallet
✓ Request payment authorization on your behalf

Cards that will be shared:
• Visa ending in 4532
• Mastercard ending in 8821

[ ] Remember this decision

[Deny]                    [Allow]
```

### Implementation Hints
- Consent page is likely in `auth-server/src/views/` or `auth-server/src/pages/`
- Fetch user's cards when wallet:enroll scope is present
- Display card selection (or all cards by default)

---

## Testing Checklist

### Unit Tests
- [ ] Wallet credential generation
- [ ] Wallet credential validation/verification
- [ ] Card token generation from wallet credential
- [ ] Scope validation

### Integration Tests
- [ ] Full OIDC flow with wallet:enroll scope
- [ ] /api/wallet/cards returns correct cards
- [ ] /api/wallet/request-token generates valid tokens
- [ ] Generated tokens work with /api/payment-network/authorize
- [ ] Credential revocation

### Manual Testing
- [ ] Consent screen shows wallet enrollment info
- [ ] Can complete enrollment flow from wsim
- [ ] Card tokens work for payments

---

## Environment Variables

Add to `.env`:

```bash
# BSIM Identity (for registry)
BSIM_ID=td-bank
BSIM_NAME="TD Canada Trust"
BSIM_API_URL=https://td.banksim.ca
BSIM_AUTH_URL=https://auth.td.banksim.ca

# Wallet Credential Settings
WALLET_CREDENTIAL_EXPIRY_DAYS=90
WALLET_CREDENTIAL_SECRET=your-secret-for-signing

# NSIM Registry (for auto-registration)
NSIM_REGISTRY_URL=https://payment.banksim.ca/api/v1/registry
```

---

## Dependencies

This work should be completed **BEFORE** wsim development begins, as wsim depends on:
- `wallet:enroll` OIDC scope
- `/api/wallet/*` endpoints
- BSIM registry registration

Estimated effort: 3-5 days

---

## Frequently Asked Questions

### Q1: What scope does SSIM request from WSIM when initiating a wallet payment?

**Answer: `openid payment:authorize`**

When a user clicks "Pay with Wallet" at an SSIM checkout, the SSIM redirects to WSIM's OIDC provider requesting:
```
scope=openid payment:authorize
```

Payment details are passed via the `claims` parameter:
```json
{
  "payment": {
    "amount": "125.00",
    "currency": "CAD",
    "merchantId": "bestbuy-ssim",
    "merchantName": "BestBuy Electronics",
    "orderId": "order-456"
  }
}
```

Note: This is SSIM → WSIM flow. The WSIM → BSIM enrollment flow uses `openid profile email wallet:enroll`.

---

### Q2: Does NSIM need changes to accept wallet tokens?

**Answer: Yes - NSIM must accept TWO tokens for wallet payments**

WSIM introduces a new token (`walletCardToken`) **in addition to** the existing `cardToken`:

| Token | Purpose | Format | Issuer |
|-------|---------|--------|--------|
| `walletCardToken` | **Routing** - tells NSIM which BSIM to route to | `wsim_{bsimId}_{uniqueId}` | WSIM |
| `cardToken` | **Authorization** - used by BSIM to authorize payment | Opaque (existing format) | BSIM |

NSIM parses the `walletCardToken` to extract the `bsimId`:
```typescript
// NSIM routing logic
const parts = walletCardToken.split('_');
// parts[0] = "wsim"
// parts[1] = "td-bank"  ← route to this BSIM
// parts[2] = "abc123"
```

**Backward Compatibility**: The `walletCardToken` is optional. If not provided (direct bank payment), NSIM falls back to the default BSIM.

---

### Q3: Does WSIM have its own auth server?

**Answer: Yes - WSIM runs a separate OIDC provider**

The ecosystem has **multiple** OIDC providers:

| Service | OIDC Provider | Purpose |
|---------|---------------|---------|
| BSIM | `auth.{bsimId}.banksim.ca` | User authentication, `wallet:enroll` for WSIM |
| WSIM | `wsim-auth.banksim.ca` | Card selection, `payment:authorize` for SSIMs |

**OAuth Client Registrations:**

1. **WSIM registered with BSIM** (for enrollment):
   ```
   client_id: wsim-wallet
   redirect_uri: https://wsim.banksim.ca/auth/callback/{bsimId}
   scope: openid profile email wallet:enroll
   ```

2. **SSIM registered with WSIM** (for payment):
   ```
   client_id: ssim-merchant
   redirect_uri: https://{ssim}.banksim.ca/payment/wallet-callback
   scope: openid payment:authorize
   ```

WSIM uses `oidc-provider` (same library as BSIM) for its auth server.

---

### Q4: Is the "Pay with Wallet" flow redirect-based or an embedded widget?

**Answer: Redirect-based (OIDC standard flow)**

When a user clicks "Pay with Wallet" at SSIM:

1. SSIM **redirects** browser to `https://wsim-auth.banksim.ca/authorize?...`
2. WSIM shows card selection UI (user picks which card)
3. User clicks "Authorize"
4. WSIM **redirects** back to `https://{ssim}.banksim.ca/payment/wallet-callback?code=...`
5. SSIM exchanges code for tokens containing `walletCardToken` + `cardToken`

This mirrors the existing "Pay with Bank" flow - just redirecting to WSIM instead of BSIM.

**No embedded SDK/widget is planned for MVP** - keeping integration simple and consistent with existing OIDC patterns.

---

### Q5: What's the relationship between tokens in the system?

**Token Lifecycle:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ ENROLLMENT (WSIM → BSIM)                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. WSIM requests wallet:enroll scope from BSIM                     │
│  2. BSIM issues: access_token containing wallet_credential claim    │
│  3. WSIM stores wallet_credential (long-lived, 90 days)             │
│  4. WSIM generates walletCardToken for each card (permanent)        │
│     Format: wsim_{bsimId}_{uniqueId}                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ PAYMENT (SSIM → WSIM → BSIM → NSIM)                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. SSIM requests payment:authorize from WSIM                       │
│  2. User selects card in WSIM                                       │
│  3. WSIM calls BSIM POST /api/wallet/request-token                  │
│     (using stored wallet_credential)                                │
│  4. BSIM issues: cardToken (ephemeral, single-use)                  │
│  5. WSIM returns to SSIM:                                           │
│     - walletCardToken (for NSIM routing)                            │
│     - cardToken (for BSIM authorization)                            │
│  6. SSIM calls NSIM with both tokens                                │
│  7. NSIM parses walletCardToken → routes to correct BSIM            │
│  8. BSIM validates cardToken → authorizes payment                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Questions for WSIM Team

1. What should the wallet credential JWT contain? (suggested: userId, walletId, cardIds, scope, exp)
2. Should users be able to select which cards to share, or all by default?
3. What's the desired expiry for wallet credentials? (suggested: 90 days)
4. Should we support credential refresh without full re-authentication?
