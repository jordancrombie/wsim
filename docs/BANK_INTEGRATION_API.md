# Bank Provider Integration API

This document describes the API requirements for integrating a bank provider (BSIM) with WSIM wallet. Bank providers enable users to enroll their payment cards into the wallet.

---

## Overview

WSIM integrates with bank providers via:
1. **OIDC Authentication** - Users authenticate at their bank to authorize wallet enrollment
2. **REST API** - WSIM fetches card information and requests payment tokens

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Bank Integration Flow                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────┐         ┌─────────┐         ┌─────────┐                       │
│  │   User  │         │  WSIM   │         │  Bank   │                       │
│  │ Browser │         │ Wallet  │         │ (BSIM)  │                       │
│  └────┬────┘         └────┬────┘         └────┬────┘                       │
│       │                   │                   │                             │
│       │ 1. Click "Enroll Bank"               │                             │
│       │──────────────────►│                   │                             │
│       │                   │                   │                             │
│       │                   │ 2. OIDC /authorize                              │
│       │                   │──────────────────►│                             │
│       │                   │                   │                             │
│       │◄──────────────────┼───────────────────│ 3. Redirect to bank login  │
│       │                   │                   │                             │
│       │ 4. User authenticates & consents     │                             │
│       │──────────────────────────────────────►│                             │
│       │                   │                   │                             │
│       │◄──────────────────┼───────────────────│ 5. Redirect with code      │
│       │                   │                   │                             │
│       │                   │ 6. Exchange code for tokens                     │
│       │                   │──────────────────►│                             │
│       │                   │                   │                             │
│       │                   │◄──────────────────│ 7. ID token + access token │
│       │                   │                   │                             │
│       │                   │ 8. GET /api/wallet/cards                        │
│       │                   │──────────────────►│                             │
│       │                   │                   │                             │
│       │                   │◄──────────────────│ 9. Card list                │
│       │                   │                   │                             │
│       │◄──────────────────│ 10. Enrollment complete                        │
│       │                   │                   │                             │
│       ▼                   ▼                   ▼                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## OIDC Requirements

### Required Scopes

Bank providers must support the following OIDC scopes:

| Scope | Purpose |
|-------|---------|
| `openid` | Standard OIDC identity |
| `profile` | User profile information |
| `email` | User email address |
| `wallet:enroll` | **Required** - Wallet enrollment permission |

### Consent Screen

When a user authenticates with scope `wallet:enroll`, the bank should display a consent screen explaining:

```
WalletSim wants to:
✓ Access your profile information
✓ Enroll your cards in your digital wallet
✓ Request payment authorization on your behalf
```

### Token Claims

The ID token should include standard claims:

```json
{
  "sub": "user-123",
  "email": "user@example.com",
  "email_verified": true,
  "name": "John Doe",
  "given_name": "John",
  "family_name": "Doe"
}
```

### WSIM as OIDC Client

WSIM registers as an OIDC client with the bank:

```
Client ID: wsim-wallet
Redirect URIs:
  - https://wsim.example.com/api/enrollment/callback/{bsimId}
Scopes: openid profile email wallet:enroll
Grant Types: authorization_code
Token Endpoint Auth: client_secret_basic
```

---

## REST API Requirements

### Base URL

```
https://api.bank.example.com/api/wallet
```

### Authentication

All API endpoints require a valid access token from the OIDC flow:

```http
Authorization: Bearer {access_token}
```

---

## Endpoint: List Cards

Returns the user's cards eligible for wallet enrollment.

### Request

```http
GET /api/wallet/cards
Authorization: Bearer {access_token}
```

### Response

```json
{
  "cards": [
    {
      "cardRef": "card-abc123",
      "cardType": "VISA",
      "lastFour": "4242",
      "cardholderName": "JOHN DOE",
      "expiryMonth": 12,
      "expiryYear": 2027,
      "status": "active"
    },
    {
      "cardRef": "card-def456",
      "cardType": "MASTERCARD",
      "lastFour": "5555",
      "cardholderName": "JOHN DOE",
      "expiryMonth": 8,
      "expiryYear": 2026,
      "status": "active"
    }
  ]
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `cardRef` | string | Bank's internal card reference (NOT the card number) |
| `cardType` | string | Card network: VISA, MASTERCARD, AMEX, etc. |
| `lastFour` | string | Last 4 digits of card number |
| `cardholderName` | string | Name on card |
| `expiryMonth` | integer | Expiration month (1-12) |
| `expiryYear` | integer | Expiration year (4-digit) |
| `status` | string | Card status: active, suspended, expired |

---

## Endpoint: Request Payment Token

When a user makes a payment, WSIM requests an ephemeral card token from the bank.

### Request

```http
POST /api/wallet/tokens
Authorization: Bearer {wallet_credential}
Content-Type: application/json

{
  "cardRef": "card-abc123",
  "merchantId": "merchant-xyz",
  "merchantName": "Example Store",
  "amount": "99.99",
  "currency": "CAD"
}
```

### Request Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cardRef` | string | Yes | Bank's card reference from enrollment |
| `merchantId` | string | Yes | Merchant identifier |
| `merchantName` | string | No | Merchant display name |
| `amount` | string | No | Transaction amount |
| `currency` | string | No | ISO 4217 currency code |

### Response

```json
{
  "cardToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "walletCardToken": "bsim_bank123_card456",
  "expiresAt": "2024-12-07T10:30:00Z"
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `cardToken` | string | Ephemeral token for payment authorization (5-15 min TTL) |
| `walletCardToken` | string | Persistent token for payment network routing |
| `expiresAt` | string | ISO 8601 timestamp when cardToken expires |

### Token Lifetimes

| Token | Lifetime | Purpose |
|-------|----------|---------|
| `cardToken` | 5-15 minutes | Single payment authorization |
| `walletCardToken` | Permanent | Identifies card for routing |

---

## Endpoint: Revoke Wallet Credential

Allows users to disconnect their bank from the wallet.

### Request

```http
POST /api/wallet/revoke
Authorization: Bearer {wallet_credential}
Content-Type: application/json

{
  "walletId": "wsim-wallet-123"
}
```

### Response

```json
{
  "success": true,
  "message": "Wallet credential revoked"
}
```

---

## Endpoint: Registry Info

Provides information for payment network registration.

### Request

```http
GET /api/registry/info
```

### Response

```json
{
  "bsimId": "bank-simulator",
  "name": "Bank Simulator",
  "apiBaseUrl": "https://api.bank.example.com",
  "supportedNetworks": ["VISA", "MASTERCARD"],
  "binRanges": ["411111", "555555"]
}
```

---

## Data Models

### WalletCredential

Bank stores wallet credentials to track enrolled wallets:

```prisma
model WalletCredential {
  id              String   @id @default(uuid())
  userId          String
  walletId        String      // WSIM wallet ID
  walletCardToken String      // Routing token for each card
  scope           String      // Granted permissions
  createdAt       DateTime @default(now())
  expiresAt       DateTime?
  revokedAt       DateTime?

  user            User     @relation(fields: [userId], references: [id])

  @@index([walletId])
}
```

---

## Security Requirements

### Token Security

- Card tokens must be single-use or very short-lived (5-15 min)
- Card tokens must be bound to a specific merchant transaction
- Wallet credentials should be encrypted at rest
- All API calls must use TLS 1.2+

### Audit Logging

Bank should log:
- Wallet enrollment attempts
- Token requests
- Credential revocations

---

## Error Responses

### Standard Error Format

```json
{
  "error": "error_code",
  "error_description": "Human-readable description"
}
```

### Error Codes

| HTTP | Error Code | Description |
|------|------------|-------------|
| 400 | `invalid_request` | Malformed request |
| 401 | `invalid_token` | Access token invalid or expired |
| 403 | `insufficient_scope` | Missing required scope |
| 404 | `card_not_found` | Card reference not found |
| 409 | `already_enrolled` | Card already enrolled in this wallet |

---

## WSIM Configuration

To register a bank provider with WSIM, configure the `BSIM_PROVIDERS` environment variable:

```bash
BSIM_PROVIDERS='[
  {
    "bsimId": "bank-simulator",
    "name": "Bank Simulator",
    "issuer": "https://auth.bank.example.com",
    "apiUrl": "https://api.bank.example.com",
    "clientId": "wsim-wallet",
    "clientSecret": "your-client-secret"
  }
]'
```

### Configuration Fields

| Field | Description |
|-------|-------------|
| `bsimId` | Unique identifier for this bank |
| `name` | Display name shown to users |
| `issuer` | OIDC issuer URL (for discovery) |
| `apiUrl` | Base URL for REST API calls |
| `clientId` | WSIM's client ID at this bank |
| `clientSecret` | WSIM's client secret |

---

## Testing

### Test User Flow

1. User visits WSIM and clicks "Enroll Bank"
2. User selects bank from list
3. WSIM redirects to bank's OIDC authorization endpoint
4. User authenticates at bank
5. User grants consent for wallet enrollment
6. Bank redirects back to WSIM with authorization code
7. WSIM exchanges code for tokens
8. WSIM calls `GET /api/wallet/cards` to fetch cards
9. Cards are displayed in user's wallet

### Test Payment Flow

1. User selects card at checkout
2. WSIM calls `POST /api/wallet/tokens`
3. Bank returns ephemeral `cardToken`
4. WSIM passes token to merchant
5. Merchant authorizes payment via payment network

---

*Document created: 2025-12-07*
