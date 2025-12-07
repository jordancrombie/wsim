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

## Priority Matrix

| Feature | Impact | Effort | Priority |
|---------|--------|--------|----------|
| Native Accounts (Option B) | High | Medium | P1 |
| Token-Encoded Routing (Option C) | Medium | Low | P2 |
| Open Banking | High | High | P2 |
| Recurring Payments | High | Medium | P1 |
| Push Provisioning | Medium | High | P3 |
| Multi-Wallet | Low | Medium | P4 |
| Wallet-to-Wallet | Medium | Medium | P3 |

**Recommended Next Phase:** Native Accounts + Recurring Payments

---

## Notes

- All future work should maintain backward compatibility
- Security review required for each new feature
- Consider regulatory implications (PCI, Open Banking standards)
- User research recommended before major UX changes
