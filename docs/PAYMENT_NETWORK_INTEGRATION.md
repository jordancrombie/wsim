# Payment Network Integration

This document describes how WSIM integrates with payment networks (NSIM) to route wallet payments to the correct bank provider.

---

## Overview

When a user pays with their wallet, the payment must be routed to the bank that issued the card. WSIM uses a `walletCardToken` to identify the source bank, and the payment network uses a registry to route the payment.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Payment Routing Flow                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │ Merchant│    │  WSIM   │    │ Payment │    │  Bank   │    │  Bank   │  │
│  │  (SSIM) │    │ Wallet  │    │ Network │    │ Provider│    │ Provider│  │
│  │         │    │         │    │  (NSIM) │    │   (A)   │    │   (B)   │  │
│  └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘  │
│       │              │              │              │              │        │
│       │ 1. Checkout  │              │              │              │        │
│       │─────────────►│              │              │              │        │
│       │              │              │              │              │        │
│       │◄─────────────│ 2. Tokens   │              │              │        │
│       │   walletCardToken          │              │              │        │
│       │   cardToken                │              │              │        │
│       │              │              │              │              │        │
│       │ 3. Authorize ──────────────────────────────────────────►│        │
│       │   { walletCardToken: "wsim_bankA_xxx", cardToken }      │        │
│       │              │              │              │              │        │
│       │              │              │ 4. Parse token             │        │
│       │              │              │    → bankA                 │        │
│       │              │              │              │              │        │
│       │              │              │ 5. Route ───►│              │        │
│       │              │              │              │              │        │
│       │              │              │◄─────────────│ 6. Auth OK  │        │
│       │              │              │              │              │        │
│       │◄──────────────────────────────────────────│ 7. Authorized│        │
│       │              │              │              │              │        │
│       ▼              ▼              ▼              ▼              ▼        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Token Architecture

WSIM uses two tokens for wallet payments:

### walletCardToken (Routing Token)

- **Issued by:** WSIM during card enrollment
- **Format:** `wsim_{bankId}_{uniqueId}`
- **Lifetime:** Permanent (until card removed)
- **Purpose:** Identifies the source bank for routing

**Example:**
```
wsim_td-bank_a1b2c3d4
wsim_rbc-bank_x9y8z7w6
```

### cardToken (Payment Token)

- **Issued by:** Bank provider on each payment
- **Format:** JWT or opaque token
- **Lifetime:** 5-15 minutes (single use)
- **Purpose:** Authorizes a specific payment

---

## Bank Registry

Payment networks maintain a registry of bank providers:

### Registry Entry Structure

```typescript
interface BankRegistryEntry {
  bankId: string;         // e.g., "td-bank"
  name: string;           // e.g., "TD Canada Trust"
  apiBaseUrl: string;     // e.g., "https://td.bank.example.com"
  apiKey: string;         // API key for this bank
  supportedNetworks: string[]; // ["VISA", "MASTERCARD"]
  binRanges?: string[];   // Optional BIN prefixes for additional routing
  status: "active" | "inactive" | "maintenance";
}
```

### Registry API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/registry/banks` | Register a new bank |
| `GET` | `/api/registry/banks` | List all registered banks |
| `GET` | `/api/registry/banks/:id` | Get bank details |
| `PUT` | `/api/registry/banks/:id` | Update bank registration |
| `DELETE` | `/api/registry/banks/:id` | Deregister bank |

### Register Bank

```http
POST /api/registry/banks
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "bankId": "td-bank",
  "name": "TD Canada Trust",
  "apiBaseUrl": "https://td.bank.example.com",
  "apiKey": "bsim_api_xxx",
  "supportedNetworks": ["VISA", "MASTERCARD", "AMEX"]
}
```

---

## Routing Logic

### Token-Based Routing

The payment network parses the `walletCardToken` to extract the bank ID:

```typescript
function routeToBank(walletCardToken: string): BankRegistryEntry {
  // Parse token: wsim_{bankId}_{cardId}
  const parts = walletCardToken.split('_');

  if (parts.length !== 3 || parts[0] !== 'wsim') {
    throw new Error('Invalid wallet card token format');
  }

  const bankId = parts[1];
  const bank = bankRegistry.get(bankId);

  if (!bank) {
    throw new Error(`Bank not found: ${bankId}`);
  }

  if (bank.status !== 'active') {
    throw new Error(`Bank unavailable: ${bankId}`);
  }

  return bank;
}
```

### Routing Fallback (Optional)

For additional redundancy, BIN-based routing can supplement token routing:

```typescript
function routeByBin(cardToken: string): BankRegistryEntry | null {
  // Decode card token to get BIN prefix
  const decoded = jwt.decode(cardToken);
  const bin = decoded?.bin as string;

  if (!bin) return null;

  // Find bank with matching BIN range
  for (const bank of bankRegistry.values()) {
    if (bank.binRanges?.some(prefix => bin.startsWith(prefix))) {
      return bank;
    }
  }

  return null;
}
```

---

## Payment Authorization Flow

### Request to Payment Network

```http
POST /api/payments/authorize
Content-Type: application/json
x-api-key: {merchant_api_key}

{
  "merchantId": "merchant-xyz",
  "merchantName": "Example Store",
  "amount": 99.99,
  "currency": "CAD",
  "walletCardToken": "wsim_td-bank_abc123",
  "cardToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "orderId": "order-456"
}
```

### Request Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `merchantId` | string | Yes | Merchant identifier |
| `merchantName` | string | No | Merchant display name |
| `amount` | number | Yes | Transaction amount |
| `currency` | string | Yes | ISO 4217 currency code |
| `walletCardToken` | string | Yes | WSIM routing token |
| `cardToken` | string | Yes | Bank's payment token |
| `orderId` | string | No | Merchant order reference |

### Response

```json
{
  "transactionId": "txn-789",
  "status": "authorized",
  "authorizationCode": "AUTH123456",
  "timestamp": "2024-12-07T10:30:00Z"
}
```

### Authorization Statuses

| Status | Description |
|--------|-------------|
| `authorized` | Payment approved, funds held |
| `declined` | Payment refused by bank |
| `error` | Processing error |

---

## Bank API Requirements

### Authorization Endpoint

The payment network calls the bank's authorization endpoint:

```http
POST /api/payment-network/authorize
Content-Type: application/json
x-api-key: {bank_api_key}

{
  "transactionId": "txn-789",
  "merchantId": "merchant-xyz",
  "amount": 99.99,
  "currency": "CAD",
  "cardToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "orderId": "order-456"
}
```

### Expected Response

```json
{
  "status": "authorized",
  "authorizationCode": "AUTH123456",
  "timestamp": "2024-12-07T10:30:01Z"
}
```

### Error Response

```json
{
  "status": "declined",
  "declineReason": "Insufficient funds",
  "declineCode": "51"
}
```

---

## Health Monitoring

### Bank Health Checks

Payment networks should monitor bank availability:

```typescript
interface HealthCheckResult {
  bankId: string;
  status: "healthy" | "degraded" | "unavailable";
  latency: number;
  lastCheck: Date;
  errorCount: number;
}
```

### Health Check Endpoint

Banks should expose a health endpoint:

```http
GET /health

Response:
{
  "status": "ok",
  "version": "1.0.0",
  "database": "connected",
  "timestamp": "2024-12-07T10:30:00Z"
}
```

### Circuit Breaker

Payment networks should implement circuit breaker patterns:

- **Closed:** Normal operation, requests go through
- **Open:** Bank unavailable, fail fast
- **Half-Open:** Testing if bank recovered

---

## Error Handling

### Common Error Codes

| Code | Description | Action |
|------|-------------|--------|
| `bank_not_found` | Bank ID not in registry | Return error to merchant |
| `bank_unavailable` | Bank is offline | Return error, trigger alert |
| `invalid_token` | Card token invalid/expired | Return error to merchant |
| `merchant_mismatch` | Token issued for different merchant | Return error |
| `amount_mismatch` | Token issued for different amount | Return error |

### Error Response Format

```json
{
  "transactionId": "txn-789",
  "status": "error",
  "error": "bank_unavailable",
  "errorDescription": "Bank TD is currently unavailable",
  "timestamp": "2024-12-07T10:30:00Z"
}
```

---

## Configuration

### Payment Network Configuration

```env
# Bank Registry
BANK_REGISTRY_TYPE=memory  # or "database", "redis"

# Health Checks
HEALTH_CHECK_INTERVAL=30000  # 30 seconds
HEALTH_CHECK_TIMEOUT=5000    # 5 seconds

# Circuit Breaker
CIRCUIT_BREAKER_THRESHOLD=5   # Failures before opening
CIRCUIT_BREAKER_TIMEOUT=60000 # Time before half-open

# API Keys
MERCHANT_API_KEYS={"merchant-xyz":"key123","merchant-abc":"key456"}
```

### WSIM Token Configuration

```env
# Token format prefix
WALLET_TOKEN_PREFIX=wsim

# Bank ID format (alphanumeric, hyphens)
BANK_ID_PATTERN=^[a-z0-9-]+$
```

---

## Multi-Bank Scenarios

### User with Multiple Banks

A user may have cards from multiple banks:

```
User's Wallet:
├── TD Visa ****4242       → walletCardToken: wsim_td-bank_card1
├── TD Mastercard ****5555 → walletCardToken: wsim_td-bank_card2
├── RBC Visa ****1111      → walletCardToken: wsim_rbc-bank_card3
└── BMO Amex ****3333      → walletCardToken: wsim_bmo-bank_card4
```

When user selects a card, WSIM:
1. Looks up which bank issued that card
2. Requests a fresh `cardToken` from that bank
3. Returns both tokens to the merchant

### Payment Flow

```
User selects: RBC Visa ****1111

1. WSIM → RBC: Request cardToken
2. RBC → WSIM: {cardToken: "jwt...", walletCardToken: "wsim_rbc-bank_card3"}
3. WSIM → Merchant: Both tokens
4. Merchant → NSIM: Authorize with both tokens
5. NSIM: Parse "wsim_rbc-bank_card3" → route to RBC
6. NSIM → RBC: Authorize with cardToken
7. RBC → NSIM: Authorized
8. NSIM → Merchant: Success
```

---

## Security Considerations

### Token Validation

Payment networks should validate:
- `walletCardToken` format matches expected pattern
- `cardToken` signature is valid (if JWT)
- `cardToken` has not expired
- Merchant ID in token matches requesting merchant

### API Security

- All endpoints require authentication (API key or OAuth)
- Use TLS 1.2+ for all communications
- Implement rate limiting per merchant
- Log all authorization attempts

### Fraud Prevention

- Track unusual patterns (velocity, amount, geography)
- Support merchant-defined rules
- Integrate with bank fraud detection systems

---

## Testing

### Test Scenarios

1. **Single Bank Payment**
   - User pays with card from one bank
   - Payment routed correctly

2. **Multi-Bank User**
   - User with cards from 2+ banks
   - Each card routes to correct bank

3. **Bank Unavailable**
   - Simulate bank downtime
   - Error returned gracefully

4. **Invalid Token**
   - Expired cardToken
   - Malformed walletCardToken
   - Both should fail safely

5. **Health Check Failure**
   - Bank health check fails
   - Circuit breaker activates

---

*Document created: 2025-12-07*
