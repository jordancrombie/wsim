# WSIM (Wallet Simulator) - Architecture Plan

## Overview

WSIM is a centralized wallet simulator that aggregates payment credentials from multiple banking simulators (bsims). It acts as a credential vault, similar to Apple Pay or Google Pay, allowing users to:

1. Enroll cards from multiple bsims into a single wallet
2. Authenticate once to the wallet and access all enrolled credentials
3. Use the wallet to pay at stores (ssims) without re-authenticating to each bank

## System Context

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PAYMENT ECOSYSTEM                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────┐         ┌─────────┐         ┌─────────┐                       │
│  │  BSIM   │         │  BSIM   │         │  BSIM   │   (Bank Simulators)   │
│  │  (TD)   │         │ (RBC)   │         │ (BMO)   │                       │
│  └────┬────┘         └────┬────┘         └────┬────┘                       │
│       │                   │                   │                             │
│       │    Wallet Credentials (long-lived)    │                             │
│       └───────────────────┼───────────────────┘                             │
│                           │                                                 │
│                           ▼                                                 │
│                    ┌─────────────┐                                          │
│                    │    WSIM     │  (Wallet Simulator)                      │
│                    │             │                                          │
│                    │ - Profile   │                                          │
│                    │ - Cards     │                                          │
│                    │ - Auth      │                                          │
│                    └──────┬──────┘                                          │
│                           │                                                 │
│         ┌─────────────────┼─────────────────┐                               │
│         │                 │                 │                               │
│         ▼                 ▼                 ▼                               │
│    ┌─────────┐       ┌─────────┐       ┌─────────┐                         │
│    │  SSIM   │       │  SSIM   │       │  SSIM   │   (Store Simulators)    │
│    │(Amazon) │       │(BestBuy)│       │ (Costco)│                         │
│    └────┬────┘       └────┬────┘       └────┬────┘                         │
│         │                 │                 │                               │
│         └─────────────────┼─────────────────┘                               │
│                           │                                                 │
│                           ▼                                                 │
│                    ┌─────────────┐                                          │
│                    │    NSIM     │  (Network Simulator)                     │
│                    │             │                                          │
│                    │ - Routing   │  ◄── Routes to correct BSIM              │
│                    │ - Auth/Cap  │      based on card metadata              │
│                    └─────────────┘                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Design Decisions

| Decision | Choice | Future Consideration |
|----------|--------|---------------------|
| User Identity | Passthrough (auth via bsim) | Option B: Native wsim accounts |
| Credential Type | Wallet credentials (long-lived) | - |
| Multi-bsim Routing | NSIM registry + BIN-style routing | Option C: Token-encoded routing |
| SSIM Integration | Redirect-based (OIDC-style) | - |
| Scope | Payment credentials only | Full Open Banking aggregation |

---

## Phase 1: Core Infrastructure

### 1.1 WSIM Service Setup

**Tech Stack** (aligned with existing ecosystem):
- Backend: Express.js + TypeScript
- Database: PostgreSQL + Prisma
- Frontend: Next.js 14 + React + Tailwind CSS
- Auth: OIDC Provider (for ssim integration) + OIDC Client (for bsim enrollment)
- Session: Express sessions with secure cookies

**Core Components**:
```
wsim/
├── backend/                 # Express API server
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.ts           # OIDC callbacks from bsims
│   │   │   ├── enrollment.ts     # Card enrollment flow
│   │   │   ├── wallet.ts         # Wallet management APIs
│   │   │   └── payment.ts        # Payment authorization flow
│   │   ├── services/
│   │   │   ├── profile.ts        # User profile management
│   │   │   ├── credential.ts     # Wallet credential storage
│   │   │   └── bsim-client.ts    # BSIM API client
│   │   ├── oidc/
│   │   │   ├── provider.ts       # OIDC provider for ssims
│   │   │   └── client.ts         # OIDC client for bsims
│   │   └── middleware/
│   │       └── auth.ts           # Session/JWT validation
│   └── prisma/
│       └── schema.prisma
├── frontend/                # Next.js UI
│   └── src/
│       └── app/
│           ├── enroll/           # Bank enrollment flow
│           ├── wallet/           # Card management
│           ├── authorize/        # Payment consent screen
│           └── profile/          # User profile
└── docker-compose.yml
```

### 1.2 Data Models

```prisma
// WSIM User Profile (bootstrapped from first bsim)
model WalletUser {
  id              String   @id @default(uuid())

  // Identity (from first enrolled bsim)
  email           String   @unique
  firstName       String?
  lastName        String?

  // Wallet-specific
  walletId        String   @unique @default(uuid())  // Public wallet identifier
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Relationships
  enrollments     BsimEnrollment[]
  walletCards     WalletCard[]
  paymentConsents WalletPaymentConsent[]
}

// Enrolled Bank (bsim) Connection
model BsimEnrollment {
  id              String   @id @default(uuid())
  userId          String
  user            WalletUser @relation(fields: [userId], references: [id])

  // BSIM identification
  bsimId          String              // e.g., "td-bank", "rbc-bank"
  bsimIssuer      String              // OIDC issuer URL
  fiUserRef       String              // User's ID at this bsim

  // Wallet credential (long-lived token from bsim)
  walletCredential String             // Encrypted credential
  credentialExpiry DateTime?

  // Refresh token for re-enrollment
  refreshToken    String?             // Encrypted

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Cards from this enrollment
  cards           WalletCard[]

  @@unique([userId, bsimId])
}

// Card stored in wallet
model WalletCard {
  id              String   @id @default(uuid())
  userId          String
  user            WalletUser @relation(fields: [userId], references: [id])
  enrollmentId    String
  enrollment      BsimEnrollment @relation(fields: [enrollmentId], references: [id])

  // Card display info (masked)
  cardType        String              // VISA, MC, AMEX, etc.
  lastFour        String              // Last 4 digits
  cardholderName  String
  expiryMonth     Int
  expiryYear      Int

  // Card reference at bsim (NOT the actual card number)
  bsimCardRef     String              // Reference ID at bsim

  // Wallet card token (wsim-issued, for nsim routing)
  walletCardToken String   @unique    // Format: wsim_{bsimId}_{uniqueId}

  // Status
  isDefault       Boolean  @default(false)
  isActive        Boolean  @default(true)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([enrollmentId, bsimCardRef])
}

// Payment consent (when ssim requests payment)
model WalletPaymentConsent {
  id              String   @id @default(uuid())
  userId          String
  user            WalletUser @relation(fields: [userId], references: [id])

  // Merchant info
  merchantId      String
  merchantName    String

  // Selected card
  walletCardId    String

  // Consent details
  scope           String              // e.g., "payment:single" or "payment:recurring"
  maxAmount       Decimal? @db.Decimal(15, 2)

  // Token issued to merchant
  consentToken    String   @unique

  expiresAt       DateTime
  revokedAt       DateTime?

  createdAt       DateTime @default(now())
}
```

---

## Phase 2: Enrollment Flow

### 2.1 First-Time User Flow (Profile Bootstrap)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     FIRST-TIME ENROLLMENT FLOW                            │
└──────────────────────────────────────────────────────────────────────────┘

1. User arrives at WSIM (no session)
   └─► WSIM shows "Add Your First Bank" screen
       └─► Displays list of available bsims

2. User selects a bsim (e.g., "TD Bank")
   └─► WSIM initiates OIDC flow to bsim
       ├─► Scope: "openid profile email wallet:enroll"
       └─► Redirect: wsim.banksim.ca/auth/callback/td-bank

3. User authenticates at bsim
   └─► bsim shows consent screen:
       "WalletSim wants to:
        ✓ Access your profile information
        ✓ Enroll your cards in your wallet
        ✓ Request payment authorization on your behalf"

4. User consents
   └─► bsim returns authorization code

5. WSIM exchanges code for tokens
   └─► Receives:
       ├─► id_token (user profile)
       ├─► access_token (with wallet_credential claim)
       └─► refresh_token (for future re-enrollment)

6. WSIM creates user profile
   └─► Bootstraps from bsim profile:
       ├─► email, firstName, lastName
       └─► Generates walletId

7. WSIM fetches user's cards from bsim
   └─► GET /api/wallet/cards (using access_token)
       └─► Returns: [{cardType, lastFour, cardRef, ...}]

8. WSIM stores enrollment + cards
   └─► Creates: BsimEnrollment, WalletCard records
       └─► Generates walletCardToken for each card

9. User redirected to wallet dashboard
   └─► Shows enrolled cards, option to add more banks
```

### 2.2 Subsequent Bank Enrollment

```
1. Authenticated user clicks "Add Another Bank"
2. Same OIDC flow as above
3. WSIM matches user by email (or creates link if different email)
4. Adds new BsimEnrollment + WalletCards
```

---

## Phase 3: Payment Flow

### 3.1 SSIM → WSIM → NSIM Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         PAYMENT FLOW                                      │
└──────────────────────────────────────────────────────────────────────────┘

1. USER AT SSIM CHECKOUT
   └─► User clicks "Pay with Wallet" button
       └─► SSIM initiates OIDC flow to WSIM
           ├─► Scope: "openid payment:authorize"
           ├─► Claims: {amount, currency, merchantId, orderId}
           └─► Redirect: ssim.banksim.ca/payment/wallet-callback

2. USER AT WSIM CARD SELECTION
   └─► WSIM shows card selection UI:
       ┌─────────────────────────────────────────┐
       │  Select a card for this purchase        │
       │                                         │
       │  Amount: $125.00 CAD                    │
       │  Merchant: BestBuy Electronics          │
       │                                         │
       │  ┌─────────────────────────────────┐   │
       │  │ 💳 TD Visa ****4532             │   │
       │  │    Expires 12/26                │   │
       │  └─────────────────────────────────┘   │
       │  ┌─────────────────────────────────┐   │
       │  │ 💳 RBC Mastercard ****8821      │   │
       │  │    Expires 08/25                │   │
       │  └─────────────────────────────────┘   │
       │                                         │
       │  [Cancel]              [Authorize]      │
       └─────────────────────────────────────────┘

3. USER AUTHORIZES
   └─► WSIM:
       a) Creates WalletPaymentConsent record
       b) Requests fresh card_token from bsim:
          └─► POST /api/wallet/request-token
              ├─► walletCredential (from enrollment)
              ├─► cardRef (bsim card reference)
              ├─► merchantId, amount
              └─► Returns: {cardToken, expiresAt}
       c) Returns authorization code to SSIM

4. SSIM RECEIVES CALLBACK
   └─► Exchanges code for tokens
       └─► access_token contains:
           ├─► walletCardToken (wsim-issued, includes bsim routing info)
           ├─► cardToken (bsim-issued, for actual payment)
           └─► scope: "payment:authorize"

5. SSIM → NSIM AUTHORIZATION
   └─► POST /api/v1/payments/authorize
       {
         merchantId: "bestbuy-ssim",
         amount: 125.00,
         currency: "CAD",
         walletCardToken: "wsim_td-bank_abc123",  // For routing
         cardToken: "bsim_token_xyz789",          // For auth
         orderId: "order-456"
       }

6. NSIM ROUTES TO CORRECT BSIM
   └─► Parses walletCardToken → extracts "td-bank"
   └─► Looks up bsim in registry
   └─► POST to td-bank's /api/payment-network/authorize

7. BSIM AUTHORIZES
   └─► Validates cardToken
   └─► Creates authorization hold
   └─► Returns authorizationCode

8. NSIM → SSIM
   └─► Returns transactionId, status: "authorized"

9. WEBHOOKS (async)
   └─► NSIM sends payment.authorized to SSIM
```

### 3.2 Token Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         TOKEN TYPES                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  WALLET CREDENTIAL (bsim → wsim, long-lived)                           │
│  ├─► Issued by: bsim during enrollment                                 │
│  ├─► Stored by: wsim (encrypted)                                       │
│  ├─► Purpose: Request fresh card tokens                                │
│  ├─► Lifetime: 90 days (renewable with refresh_token)                  │
│  └─► Format: JWT with claims {sub, scope: "wallet:*", cards: [...]}    │
│                                                                         │
│  WALLET CARD TOKEN (wsim-issued, for routing)                          │
│  ├─► Issued by: wsim during enrollment                                 │
│  ├─► Format: wsim_{bsimId}_{uniqueId}                                  │
│  ├─► Purpose: NSIM routing to correct bsim                             │
│  ├─► Lifetime: Permanent (until card removed)                          │
│  └─► Example: wsim_td-bank_a1b2c3d4                                    │
│                                                                         │
│  CARD TOKEN (bsim → nsim, ephemeral)                                   │
│  ├─► Issued by: bsim on payment request                                │
│  ├─► Requested by: wsim using wallet credential                        │
│  ├─► Purpose: Actual payment authorization at bsim                     │
│  ├─► Lifetime: Single-use or short TTL (15 min)                        │
│  └─► Format: Opaque token                                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 4: Component Changes

### 4.1 BSIM Changes (Sub-Plan for BSIM Team)

See: [BSIM_SUBPLAN.md](./BSIM_SUBPLAN.md)

**Summary of Required Changes**:

1. **New OIDC Scope**: `wallet:enroll`
   - Returns wallet_credential in token claims
   - Long-lived credential for wsim to request card tokens

2. **New API Endpoints**:
   ```
   GET  /api/wallet/cards          # List user's cards (masked info)
   POST /api/wallet/request-token  # Request ephemeral card token
   POST /api/wallet/revoke         # Revoke wallet credential
   ```

3. **New Data Models**:
   ```prisma
   model WalletCredential {
     id              String   @id
     userId          String
     walletId        String   // wsim's wallet ID
     credential      String   // JWT or opaque token
     scope           String   // Granted permissions
     expiresAt       DateTime
     revokedAt       DateTime?
   }
   ```

4. **BSIM Registry Entry**:
   - bsim must register with nsim (or central registry)
   - Provides: bsimId, API base URL, supported card types

### 4.2 SSIM Changes (Sub-Plan for SSIM Team)

See: [SSIM_SUBPLAN.md](./SSIM_SUBPLAN.md)

**Summary of Required Changes**:

1. **New "Pay with Wallet" Button**:
   - Alternative to existing "Pay with Bank" flow
   - Initiates OIDC flow to wsim instead of bsim

2. **WSIM OIDC Client Configuration**:
   ```typescript
   {
     providerId: 'wsim',
     issuer: 'https://wsim.banksim.ca',
     clientId: 'ssim-client',
     scope: 'openid payment:authorize',
     redirectUri: '/payment/wallet-callback'
   }
   ```

3. **Modified Payment Flow**:
   - Receive both walletCardToken and cardToken from wsim
   - Pass both to nsim for routing + authorization

4. **UI Updates**:
   - Checkout page: Add wallet payment option
   - Payment callback: Handle wsim responses

### 4.3 NSIM Changes (Sub-Plan for NSIM Team)

See: [NSIM_SUBPLAN.md](./NSIM_SUBPLAN.md)

**Summary of Required Changes**:

1. **BSIM Registry**:
   ```typescript
   interface BsimRegistryEntry {
     bsimId: string;           // e.g., "td-bank"
     name: string;             // e.g., "TD Canada Trust"
     apiBaseUrl: string;       // e.g., "https://td.banksim.ca"
     apiKey: string;           // API key for this bsim
     supportedNetworks: string[]; // ["visa", "mastercard"]
     binRanges?: string[];     // Optional BIN prefixes
   }
   ```

2. **Routing Logic**:
   ```typescript
   // Parse walletCardToken to extract bsimId
   function routeToBsim(walletCardToken: string): BsimRegistryEntry {
     const [prefix, bsimId, cardId] = walletCardToken.split('_');
     return bsimRegistry.get(bsimId);
   }
   ```

3. **Modified Authorization Flow**:
   - Accept walletCardToken in addition to cardToken
   - Route to correct bsim based on token
   - Use bsim-specific API key

4. **New API Endpoints**:
   ```
   POST /api/v1/registry/bsims      # Register a bsim
   GET  /api/v1/registry/bsims      # List registered bsims
   DELETE /api/v1/registry/bsims/:id # Deregister bsim
   ```

---

## Phase 5: Security Considerations

### 5.1 Credential Security

| Credential | Storage | Encryption | Rotation |
|------------|---------|------------|----------|
| Wallet Credential | wsim DB | AES-256-GCM | 90 days |
| Refresh Token | wsim DB | AES-256-GCM | On use |
| Card Token | In-flight only | TLS | Single-use |
| Wallet Card Token | wsim DB | None (reference only) | Never |

### 5.2 Authentication Flow Security

- All OIDC flows use PKCE (S256)
- State parameter validation
- Nonce for replay protection
- Short-lived authorization codes (10 min)
- Secure, httpOnly, sameSite cookies

### 5.3 API Security

- TLS everywhere
- API keys for service-to-service
- JWT validation with issuer verification
- Rate limiting on sensitive endpoints

---

## Phase 6: Implementation Order

### Recommended Sequence

```
Week 1-2: BSIM Changes
├─► Implement wallet:enroll scope
├─► Create WalletCredential model
├─► Build /api/wallet/* endpoints
└─► Register bsim in nsim registry

Week 3-4: NSIM Changes
├─► Implement bsim registry
├─► Add routing logic
└─► Update authorization flow

Week 5-8: WSIM Core
├─► Project setup (Express + Prisma + Next.js)
├─► Data models
├─► Enrollment flow (OIDC client to bsim)
├─► Card management UI
├─► OIDC provider (for ssim)
└─► Payment authorization flow

Week 9-10: SSIM Changes
├─► Add wsim OIDC client config
├─► "Pay with Wallet" button
├─► Wallet payment callback
└─► Pass routing token to nsim

Week 11-12: Integration & Testing
├─► End-to-end flow testing
├─► Multi-bsim scenarios
├─► Error handling
└─► Documentation
```

---

## Future Considerations

### TODO: Native WSIM Accounts (Option B)

Currently, users must authenticate via a bsim. Future enhancement:
- WSIM maintains its own user database with passkey/password auth
- Users can create wsim account first, then link bsims
- Enables wallet-first experience

### TODO: Token-Encoded Routing (Option C)

Current: walletCardToken format `wsim_{bsimId}_{id}` parsed by nsim
Future: Encode routing info in card token itself (like real BIN routing)
- Embed bsim identifier in token payload
- NSIM decodes rather than parses prefix
- More flexible, harder to spoof

### TODO: Open Banking Expansion

Current: Payment credentials only
Future: Full account aggregation
- Balance inquiries
- Transaction history
- Account-to-account transfers
- Requires fdx:* scopes from bsim

---

## Appendix: API Contracts

### WSIM → BSIM (Enrollment)

```typescript
// OIDC Token Response (with wallet:enroll scope)
{
  access_token: "eyJ...",  // Contains wallet_credential claim
  id_token: "eyJ...",
  refresh_token: "...",
  token_type: "Bearer",
  expires_in: 3600,
  scope: "openid profile email wallet:enroll"
}

// GET /api/wallet/cards
// Headers: Authorization: Bearer {access_token}
Response: {
  cards: [{
    cardRef: "card_123",
    cardType: "VISA",
    lastFour: "4532",
    cardholderName: "John Doe",
    expiryMonth: 12,
    expiryYear: 2026
  }]
}

// POST /api/wallet/request-token
// Headers: Authorization: Bearer {wallet_credential}
Request: {
  cardRef: "card_123",
  merchantId: "bestbuy-ssim",
  amount: 125.00,
  currency: "CAD"
}
Response: {
  cardToken: "bsim_token_xyz789",
  expiresAt: "2024-01-15T10:30:00Z"
}
```

### SSIM → WSIM (Payment)

```typescript
// OIDC Authorization Request
GET /authorize?
  client_id=ssim-client&
  redirect_uri=https://ssim.banksim.ca/payment/wallet-callback&
  response_type=code&
  scope=openid payment:authorize&
  state=...&
  code_challenge=...&
  code_challenge_method=S256&
  claims={"payment":{"amount":"125.00","currency":"CAD","merchantId":"bestbuy"}}

// Token Response
{
  access_token: "eyJ...",  // Contains walletCardToken, cardToken
  id_token: "eyJ...",
  token_type: "Bearer",
  expires_in: 300,
  scope: "openid payment:authorize"
}

// Access Token Claims
{
  sub: "wallet_user_123",
  aud: "ssim-client",
  walletCardToken: "wsim_td-bank_abc123",
  cardToken: "bsim_token_xyz789",
  paymentAmount: "125.00",
  paymentCurrency: "CAD"
}
```

### SSIM → NSIM (Authorization)

```typescript
// POST /api/v1/payments/authorize
Request: {
  merchantId: "bestbuy-ssim",
  merchantName: "BestBuy Electronics",
  amount: 125.00,
  currency: "CAD",
  walletCardToken: "wsim_td-bank_abc123",  // NEW: for routing
  cardToken: "bsim_token_xyz789",
  orderId: "order-456"
}

Response: {
  transactionId: "txn_789",
  status: "authorized",
  authorizationCode: "AUTH123",
  timestamp: "2024-01-15T10:25:00Z"
}
```
