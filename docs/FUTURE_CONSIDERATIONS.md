# Future Considerations

This document captures design decisions that were deferred for later implementation. These items should be revisited once the core WSIM functionality is stable.

---

## TODO: Native WSIM Accounts (Option B Authentication)

### Current State
Users must authenticate via a bsim on first use. The wsim profile is bootstrapped from the first bsim enrollment.

### Future Enhancement
Allow users to create a native wsim account first, then link bsims afterward.

### Why This Matters
- **Better UX**: Users can sign up for wsim directly
- **Account Recovery**: Not dependent on bsim for identity
- **Multiple Identities**: Users with different emails at different banks can link them

### Implementation Sketch

```typescript
// New data models
model WalletUser {
  // Existing fields...

  // Native authentication
  passwordHash    String?        // For native accounts
  passkeys        Passkey[]      // WebAuthn support

  // Account type
  authType        AuthType       // FEDERATED | NATIVE | HYBRID

  // Linked identities
  federatedIds    FederatedIdentity[]
}

model FederatedIdentity {
  id              String   @id @default(uuid())
  userId          String
  user            WalletUser @relation(...)

  provider        String   // bsim ID
  providerUserId  String   // sub claim from bsim
  email           String   // email from bsim (may differ from wsim email)

  @@unique([provider, providerUserId])
}
```

### Migration Path
1. Add optional `passwordHash` and `passkeys` to existing model
2. Existing users remain `FEDERATED` type
3. New signup flow offers both options
4. Federated users can "upgrade" to native by setting password

### Questions to Resolve
- Should native accounts require email verification?
- How to handle email conflicts (same email at wsim and bsim)?
- What's the password policy?
- Should we support social login (Google, Apple)?

---

## TODO: Token-Encoded Routing (Option C)

### Current State
`walletCardToken` format: `wsim_{bsimId}_{uniqueId}`

NSIM parses the prefix to extract `bsimId` for routing.

### Future Enhancement
Encode routing information in the token itself (signed/encrypted) rather than relying on parsing.

### Why This Matters
- **Security**: Harder to spoof or manipulate
- **Flexibility**: Can include additional metadata
- **Real-World Alignment**: Similar to how BIN routing works

### Implementation Sketch

```typescript
// Token structure (JWT or similar)
interface WalletCardTokenPayload {
  // Routing info
  bsimId: string;
  cardRef: string;

  // Security
  issuedAt: number;
  expiresAt: number;
  wsimId: string;  // Issuer identification

  // Optional metadata
  cardType?: string;
  network?: string;  // visa, mastercard
}

// Signed token
const walletCardToken = jwt.sign(payload, WSIM_SIGNING_KEY, {
  algorithm: 'ES256',  // Asymmetric for verification without secret
});

// NSIM decodes and verifies
function decodeWalletCardToken(token: string): WalletCardTokenPayload {
  return jwt.verify(token, WSIM_PUBLIC_KEY);
}
```

### Benefits
- NSIM can verify token authenticity
- Token can expire (short-lived for single transaction)
- Can include network hints for smarter routing
- Audit trail of who issued the token

### Migration Path
1. Add new token format alongside existing
2. NSIM supports both formats (detect by prefix)
3. Gradually migrate to new format
4. Deprecate prefix-based format

### Questions to Resolve
- Use JWT or custom format?
- Symmetric (HMAC) or asymmetric (ECDSA) signing?
- How to handle key rotation?
- Token TTL for payment tokens?

---

## TODO: Open Banking Expansion

### Current State
WSIM only handles payment credentials (cards).

### Future Enhancement
Aggregate full Open Banking capabilities:
- Account balances
- Transaction history
- Account-to-account transfers
- Standing orders
- Direct debits

### Why This Matters
- **Complete Financial View**: Users see all accounts in one place
- **Smart Payments**: Pay from account with best balance
- **Financial Insights**: Spending analytics across banks
- **Competitive Feature**: Match real-world aggregators

### Implementation Sketch

```typescript
// Additional OIDC scopes
const OPEN_BANKING_SCOPES = [
  'fdx:accountbasic:read',
  'fdx:accountdetailed:read',
  'fdx:transactions:read',
  'fdx:customercontact:read',
  'fdx:payments:write',  // For transfers
];

// Additional data models
model LinkedAccount {
  id              String   @id
  enrollmentId    String
  enrollment      BsimEnrollment @relation(...)

  accountNumber   String
  accountType     AccountType
  accountName     String
  currency        String

  // Cached data (refreshed periodically)
  cachedBalance   Decimal?
  balanceAsOf     DateTime?
}

model CachedTransaction {
  id              String   @id
  accountId       String
  account         LinkedAccount @relation(...)

  transactionId   String   // From bsim
  date            DateTime
  description     String
  amount          Decimal
  type            TransactionType

  @@index([accountId, date])
}
```

### API Extensions

```typescript
// GET /api/accounts - List all linked accounts across bsims
// GET /api/accounts/:id/balance - Get current balance (refresh if stale)
// GET /api/accounts/:id/transactions - Get transaction history
// POST /api/transfers - Initiate account-to-account transfer
```

### Data Refresh Strategy
- Balance: Refresh on demand, cache for 5 minutes
- Transactions: Incremental sync, cache for 1 hour
- Background job to refresh all accounts daily

### Questions to Resolve
- How fresh should balance data be?
- Store transactions locally or fetch on demand?
- How to handle rate limits from bsims?
- Consent management for different data types?

---

## TODO: Recurring Payments / Card-on-File

### Current State
Each payment requires user to select card and authorize.

### Future Enhancement
Allow merchants to store card reference for recurring/subscription payments.

### Why This Matters
- **Subscriptions**: Monthly payments without user interaction
- **One-Click Checkout**: Return customers can pay instantly
- **Merchant UX**: Standard e-commerce pattern

### Implementation Sketch

```typescript
// Extended consent model
model WalletPaymentConsent {
  // Existing fields...

  // Recurring consent
  consentType     ConsentType  // SINGLE | RECURRING | CARD_ON_FILE

  // For recurring
  frequency       String?      // monthly, weekly, etc.
  maxTransactions Int?         // Limit total uses
  usedCount       Int          @default(0)

  // For card-on-file
  merchantRef     String?      // Merchant's internal reference
}

// Merchant can request token refresh
// POST /api/consents/:id/refresh-token
// Returns new cardToken without user interaction (if consent valid)
```

### Security Considerations
- Strong customer authentication (SCA) for initial consent
- Merchant must be pre-registered and verified
- User can revoke recurring consent anytime
- Notifications for each charge

---

## TODO: Push Provisioning

### Current State
Users manually enroll cards via web flow.

### Future Enhancement
Banks can push cards directly to user's wallet.

### Why This Matters
- **Instant Activation**: New cards appear in wallet automatically
- **Better UX**: No enrollment steps for existing customers
- **Bank-Initiated**: Banks can promote wallet adoption

### Implementation Sketch
- Bank has API to push card to user's wallet
- User receives notification to accept/reject
- On accept, card is added without OIDC flow

### Questions to Resolve
- How to identify user across wsim and bsim?
- What's the consent model for push provisioning?
- How to handle unsolicited card pushes?

---

## TODO: Multi-Wallet Support

### Current State
One wallet per user.

### Future Enhancement
Users can have multiple wallets (personal, business, family).

### Why This Matters
- **Business Use**: Separate company cards
- **Family Sharing**: Shared wallet for family purchases
- **Organization**: Group cards by purpose

---

## TODO: Wallet-to-Wallet Transfers

### Current State
Payments only flow from wallet to merchant.

### Future Enhancement
P2P transfers between wallet users.

### Why This Matters
- **Venmo/PayPal Feature**: Send money to friends
- **Bill Splitting**: Instant settlement
- **Broader Use Case**: Beyond just commerce

---

## TODO: Merchant Authorization Grants (OAuth-style)

### Current State

When a user completes a payment via the Popup or Inline flow, they receive:
1. A **payment token** (single-use, for completing the current transaction)
2. A **session token** (30-day JWT, allows merchant to "peek" at user's cards for Quick Pay)

The session token enables returning users to skip the popup on subsequent visits. However, the current implementation has issues:

**Problem 1: Passkey Grace Period Bug** ✅ FIXED (2025-12-09)
- A "grace period" (5 minutes) was added to prevent double-prompting within the same checkout flow
- Bug: The grace period persisted across transactions within the same browser session
- **Fix Applied**: Grace period is now "consumed" (cleared) after each successful payment
- See: `auth-server/src/routes/popup.ts` and `embed.ts` - `delete session.lastPasskeyAuthAt`

**Problem 2: Session-Based State** (Still to address)
- Grace period is tracked via `lastPasskeyAuthAt` in the auth-server session
- No persistent server-side record of which merchants have been authorized
- Users cannot see or revoke merchant access from the wallet UI
- Works differently across Popup vs Inline vs Redirect flows

### Future Enhancement

Replace session-based grace period with server-side **Merchant Authorization Grants** - a more "OAuth-y" approach.

### Why This Matters

- **User Transparency**: Users can see which merchants have access to their cards
- **Revocation**: Users can revoke merchant access anytime from wallet UI
- **Consistent Behavior**: Works the same across all integration flows
- **Configurable Lifetime**: Admin can set authorization duration (1 day to 1 year)
- **Security Model**: Clear separation between "view cards" and "authorize payment"
- **Audit Trail**: Record of all merchant authorizations

### Conceptual Model

**Two distinct authorization levels:**

1. **Merchant Authorization Grant** ("Peek Key")
   - Allows merchant to fetch user's card list without popup
   - Stored server-side in WSIM backend database
   - Configurable lifetime (e.g., 30 days, 90 days, 1 year)
   - User can view and revoke via wallet settings
   - Created after first successful passkey authentication with that merchant

2. **Payment Authorization** (Passkey per Transaction)
   - Required for every payment, regardless of grant status
   - Ensures user consent for each financial transaction
   - Cannot be skipped even with valid merchant grant

### Key Architectural Insight: Browser-Portable JWT

The 30-day JWT session token is designed to be **browser-portable** - it follows the user around:

1. **Cross-Merchant Portability**: If a user completes a payment at Regal Moose and receives a JWT, that same JWT works at Coffee Shop (or any WSIM-enabled merchant) in that browser. The user can see their cards immediately without a popup.

2. **Fallback Behavior**: When a user:
   - Switches browsers
   - Clears localStorage/cookies
   - Has an expired token (30 days)

   They simply go through the popup/inline "open wallet" flow once, complete one passkey-authenticated payment, and get a fresh JWT. Then they're back to the streamlined experience.

3. **JWT + Server-Side Grant**: The JWT remains the bearer token for API calls. The `MerchantAuthorization` record in the database is the server-side validation that:
   - The user has authorized this merchant
   - The authorization hasn't been revoked
   - The grant hasn't expired

4. **Grant Creation Timing**: The `MerchantAuthorization` record should be created on **successful passkey verification for a payment** (not on login), because:
   - Passkey proves the real user is present with intent to transact
   - Cards and transaction status are consequences of that verified identity
   - This is the meaningful "consent moment"

### Initial Scope

Start with a single scope: `cards:read`
- Allows viewing card list for faster checkout
- Future extension: `recurring:write` for subscription payments

### Implementation Sketch

```typescript
// New data model in WSIM backend
model MerchantAuthorization {
  id              String   @id @default(uuid())

  // Who granted authorization
  userId          String
  user            WalletUser @relation(...)

  // Which merchant was authorized
  merchantId      String   // OAuth client ID
  merchantName    String   // Human-readable name

  // Authorization details
  scopes          String[] // e.g., ['cards:read']
  grantedAt       DateTime @default(now())
  expiresAt       DateTime

  // Revocation
  revokedAt       DateTime?
  revokedReason   String?  // 'user' | 'admin' | 'merchant'

  // Metadata
  originFlow      String   // 'popup' | 'inline' | 'redirect'
  firstPaymentId  String?  // Reference to initial transaction

  @@unique([userId, merchantId])
  @@index([userId])
  @@index([merchantId])
  @@index([expiresAt])
}
```

### API Changes

```typescript
// Merchant API (with session token)
// Check if authorization exists before fetching cards
GET /api/merchant/authorization
→ { authorized: true, expiresAt: '...', scopes: [...] }
→ { authorized: false, reason: 'no_grant' | 'expired' | 'revoked' }

GET /api/merchant/cards
→ 200: Returns cards if authorization valid
→ 401: No valid authorization, merchant should use popup flow

// User Wallet API
GET /api/user/authorizations
→ List all merchant authorizations for current user

DELETE /api/user/authorizations/:merchantId
→ Revoke authorization for specific merchant
```

### User Experience

**Wallet Settings → "Connected Merchants":**
```
┌─────────────────────────────────────────────────────────┐
│ Connected Merchants                                     │
├─────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐   │
│ │ 🛒 Regal Moose                                    │   │
│ │ Can view your cards for faster checkout           │   │
│ │ Connected: Dec 5, 2025 • Expires: Mar 5, 2026    │   │
│ │                                      [Revoke]     │   │
│ └───────────────────────────────────────────────────┘   │
│ ┌───────────────────────────────────────────────────┐   │
│ │ ☕ Coffee Shop                                    │   │
│ │ Can view your cards for faster checkout           │   │
│ │ Connected: Dec 1, 2025 • Expires: Mar 1, 2026    │   │
│ │                                      [Revoke]     │   │
│ └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Flow Changes

**Current Flow (Session-Based):**
1. User completes payment with passkey → `lastPasskeyAuthAt` set in session
2. Merchant stores session token in localStorage
3. Next visit: Merchant uses session token to fetch cards
4. Grace period checked → May skip passkey (BUG: skips across transactions)

**Proposed Flow (Grant-Based):**
1. User completes payment with passkey → `MerchantAuthorization` created in DB
2. Merchant stores session token in localStorage
3. Next visit: Merchant uses session token to fetch cards
4. Backend checks `MerchantAuthorization` exists and not expired
5. Cards returned for display (no popup needed)
6. User selects card → **Passkey always required** for payment authorization
7. Payment completes → Grant lifetime NOT extended (requires re-auth after expiry)

### Configuration

```typescript
// Admin-configurable settings
const MERCHANT_AUTHORIZATION_CONFIG = {
  // Default grant lifetime (can be overridden per-merchant)
  defaultLifetimeDays: 90,

  // Minimum/maximum bounds
  minLifetimeDays: 1,
  maxLifetimeDays: 365,

  // Grace period for same-checkout double-prompt prevention
  // Only applies within single checkout flow, NOT across transactions
  sameCheckoutGracePeriodMs: 5 * 60 * 1000, // 5 minutes
};
```

### Migration Path

1. **Phase 0**: ✅ DONE - Fix grace period bug (consume after each payment)
2. **Phase 1**: Create `MerchantAuthorization` model and Prisma migration
3. **Phase 2**: Update auth-server to create grants on successful passkey payment verification
4. **Phase 3**: Update merchant API to check grants (in addition to JWT validation)
5. **Phase 4**: Add wallet UI for viewing/revoking authorizations ("Connected Merchants")
6. **Phase 5**: Add admin configuration for grant lifetime settings
7. **Phase 6**: Consider removing session-based grace period entirely (grants handle it)

### Security Considerations

- Authorization grants do NOT allow payments - passkey required every time
- Grants can be revoked instantly by user
- Expired grants require full re-authentication
- Merchants cannot extend their own grant lifetime
- All grant operations logged for audit

### Design Decisions (from 2025-12-09 discussion)

| Question | Decision |
|----------|----------|
| Grant creation timing | On passkey verification for payment (not login) |
| Initial scope | `cards:read` only, extend later |
| Auto-renew grants? | TBD - lean toward fixed lifetime from first auth |

### Questions Still to Resolve

- Should there be different grant tiers (read-only vs. recurring payment)?
- How to handle merchant name changes (display vs. stored)?
- Should admin be able to revoke grants for all users of a merchant?
- What happens to in-flight transactions when a grant is revoked?
- Should JWT and grant expiration be aligned (both 30 days) or independent?

---

## TODO: Admin-Configurable Popup/Embed Origins

### Current State

The allowed origins for popup and embed flows are configured via environment variables (`ALLOWED_POPUP_ORIGINS`, `ALLOWED_EMBED_ORIGINS`). Changes require redeployment.

### Future Enhancement

Allow administrators to configure allowed origins dynamically through an admin UI, with per-merchant restrictions.

### Why This Matters

- **Self-Service**: Merchants can request new origins without deployment
- **Per-Merchant Security**: Each merchant only allowed from their registered domains
- **Audit Trail**: Track origin changes over time
- **Quick Response**: Block compromised origins immediately

### Implementation Sketch

Store allowed origins per OAuth client in the database, check at runtime.

---

## TODO: Standardized Health Check Endpoints (ECS/ALB Ready)

### Current State

Health endpoints are inconsistent across WSIM services:

| Service | `/health` | `/health/ready` | `/health/live` | Notes |
|---------|-----------|-----------------|----------------|-------|
| **Backend** | ✅ DB check | ✅ DB check | ✅ Always 200 | Full pattern at `/health/*` |
| **Auth Server** | ✅ DB check | ❌ Missing | ❌ Missing | Only basic health |
| **Frontend** | ❌ None | ❌ None | ❌ None | Next.js, no health routes |

**Problem**: For ECS/ALB deployments, the build team needs consistent health endpoints across all services:
- **ALB Target Group** needs `/health/ready` to determine if service can receive traffic
- **ECS Container Health** needs `/health/live` for container-level liveness checks

### Standard ECS/ALB Health Check Pattern

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Health Check Endpoints (per service)                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  /health/live    → Liveness   → Is the process running?                     │
│                    Response: 200 { alive: true }                            │
│                    Used by: ECS container health check                      │
│                                                                             │
│  /health/ready   → Readiness  → Can it handle traffic?                      │
│                    Response: 200 { ready: true } or 503 { ready: false }    │
│                    Checks: Database connection, external dependencies       │
│                    Used by: ALB target group health check                   │
│                                                                             │
│  /health         → Detailed   → Full status for monitoring/debugging        │
│                    Response: 200 { status, timestamp, service, version }    │
│                    Used by: Monitoring dashboards, manual checks            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation Required

#### 1. Auth Server - Add `/health/ready` and `/health/live`

File: `auth-server/src/index.ts`

```typescript
// Liveness check - is the process alive?
app.get('/health/live', (req, res) => {
  res.json({ alive: true });
});

// Readiness check - can we handle traffic?
app.get('/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ready: true });
  } catch {
    res.status(503).json({ ready: false });
  }
});

// Detailed health (existing, keep as-is)
app.get('/health', async (req, res) => { ... });
```

#### 2. Frontend - Add Next.js API Route

File: `frontend/src/app/api/health/route.ts` (new file)

```typescript
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'wsim-frontend',
  });
}
```

And `/api/health/live/route.ts`, `/api/health/ready/route.ts` similarly.

### Deployment Configuration

#### Local Nginx (Development)

Current nginx likely routes:
- `wsim-dev.banksim.ca/` → Frontend (port 3004)
- `wsim-dev.banksim.ca/api/*` → Backend (port 3003)
- `wsim-auth-dev.banksim.ca/*` → Auth Server (port 3005)

**Required changes** for health checks to work:

```nginx
# wsim-dev.banksim.ca
location /health {
    proxy_pass http://backend:3003/health;
}
location /api/ {
    proxy_pass http://backend:3003/api/;
}
location / {
    proxy_pass http://frontend:3004/;
}
```

Or alternatively, access backend health at `/api/health` (no nginx change needed).

#### AWS ECS/ALB (Production)

**ALB Target Group Configuration:**
```
Health check path:     /health/ready
Protocol:              HTTP
Healthy threshold:     2
Unhealthy threshold:   3
Timeout:               5 seconds
Interval:              30 seconds
Success codes:         200
```

**ECS Task Definition:**
```json
{
  "containerDefinitions": [{
    "name": "wsim-backend",
    "healthCheck": {
      "command": ["CMD-CURL", "-f", "http://localhost:3003/health/live"],
      "interval": 30,
      "timeout": 5,
      "retries": 3,
      "startPeriod": 60
    }
  }]
}
```

### Service-Specific URLs (After Implementation)

| Service | Health | Ready | Live |
|---------|--------|-------|------|
| Backend | `https://wsim-dev.banksim.ca/health` | `/health/ready` | `/health/live` |
| Auth Server | `https://wsim-auth-dev.banksim.ca/health` | `/health/ready` | `/health/live` |
| Frontend | `https://wsim-dev.banksim.ca/api/health` | `/api/health/ready` | `/api/health/live` |

### Migration Path

1. **Phase 1**: Add `/health/ready` and `/health/live` to Auth Server
2. **Phase 2**: Add `/api/health/*` routes to Frontend (Next.js API routes)
3. **Phase 3**: Update nginx config (if needed) or document `/api/health` path for backend
4. **Phase 4**: Update ECS task definitions with container health checks
5. **Phase 5**: Update ALB target group health check paths

---

## Priority Matrix

| Feature | Impact | Effort | Priority |
|---------|--------|--------|----------|
| **Standardized Health Checks** | **High** | **Low** | **P0** |
| Native Accounts (Option B) | High | Medium | P1 |
| Token-Encoded Routing (Option C) | Medium | Low | P2 |
| Open Banking | High | High | P2 |
| Recurring Payments | High | Medium | P1 |
| **Merchant Authorization Grants** | **High** | **Medium** | **P1** |
| Admin-Configurable Origins | Medium | Low | P2 |
| Push Provisioning | Medium | High | P3 |
| Multi-Wallet | Low | Medium | P4 |
| Wallet-to-Wallet | Medium | Medium | P3 |

**Immediate (P0):** Standardized Health Checks (required for ECS/ALB deployment)

**Recommended Next Phase:** Native Accounts + Recurring Payments + Merchant Authorization Grants

---

## TODO: Admin-Configurable Popup/Embed Origins

### Current State
The `ALLOWED_POPUP_ORIGINS` and `ALLOWED_EMBED_ORIGINS` environment variables control which merchant domains can use the popup and iframe integration methods. These are set at deployment time.

### Future Enhancement
Add admin UI to configure allowed origins per OAuth client, similar to how `webauthnRelatedOrigin` is now configured for Quick Pay cross-domain passkey authentication.

### Why This Matters
- **Self-Service**: Merchants could configure their own origins through the admin UI
- **Dynamic Updates**: No deployment required to add new merchant domains
- **Per-Client Control**: Different security policies per merchant

### Implementation Notes
- Could add `allowedPopupOrigins` and `allowedEmbedOrigins` fields to OAuthClient
- Would need to update CSP headers and postMessage validation dynamically
- Consider caching strategy for performance

---

## Notes

- All future work should maintain backward compatibility
- Security review required for each new feature
- Consider regulatory implications (PCI, Open Banking standards)
- User research recommended before major UX changes
