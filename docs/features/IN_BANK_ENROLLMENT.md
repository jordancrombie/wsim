# Feature: In-Bank Enrollment (Cross-Origin Passkey Registration)

**Status:** WSIM Implementation Complete - Awaiting BSIM Integration
**Branch:** `feature/in-bank-enrollment`
**Created:** 2025-12-10
**Last Updated:** 2025-12-11

---

## Executive Summary

Enable WSIM enrollment from within a bank's website (BSIM or any OIDC provider) without requiring the user to redirect away. The key technical innovation is **cross-origin passkey registration** using WebAuthn Related Origin Requests, allowing users to register a WSIM passkey while remaining on the bank's domain.

---

## Business Requirements

### Problem Statement

Currently, to enroll in WSIM, users must:
1. Navigate to WSIM's enrollment page
2. Redirect to BSIM for OIDC authentication
3. Return to WSIM to complete enrollment
4. Register a passkey on WSIM's domain

This multi-redirect flow creates friction and drop-off. Banks want to offer WSIM enrollment as an in-app feature (e.g., "Enable Wallet Pay" button) without sending users away.

### Goals

1. **Seamless in-bank enrollment**: Users can enroll in WSIM without leaving their bank's website
2. **Cross-origin passkey registration**: Validate that WebAuthn Related Origin Requests work for our use case
3. **Bank-driven UX**: Banks control the enrollment trigger (button, promotion, etc.)
4. **Immediate usability**: After enrollment, user can immediately use WSIM for payments

### Non-Goals (This Phase)

- SSO from bank to WSIM wallet page (future enhancement)
- Admin UI for configuring related origins (start hardcoded)
- Multiple bank support in `/.well-known/webauthn` (start with BSIM only)

---

## User Stories

### US-1: Bank User Enrolls in WSIM
**As a** BSIM user
**I want to** enroll in WSIM from within my bank's website
**So that** I can enable wallet payments without leaving my bank

**Acceptance Criteria:**
- [ ] User clicks "Enable Wallet Pay" button in BSIM
- [ ] WSIM enrollment UI appears (popup/iframe)
- [ ] User sees their available cards and selects which to add
- [ ] User registers a passkey (cross-origin)
- [ ] Enrollment completes without page redirects
- [ ] User receives confirmation and can immediately use WSIM

### US-2: Already Enrolled User Detection
**As a** BSIM user who is already enrolled in WSIM
**I want to** be informed that I'm already enrolled
**So that** I don't create duplicate accounts

**Acceptance Criteria:**
- [ ] System detects existing WSIM user by email/BSIM sub
- [ ] User sees "You're already enrolled" message
- [ ] User can dismiss and return to bank
- [ ] (Future) User can SSO to WSIM wallet

---

## Technical Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         BSIM Website                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  "Enable Wallet Pay" Button                              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              WSIM Enrollment Popup/Iframe                │    │
│  │  ┌─────────────────────────────────────────────────┐    │    │
│  │  │  1. Receive user identity via postMessage       │    │    │
│  │  │  2. Display card selection UI                   │    │    │
│  │  │  3. Register passkey (cross-origin WebAuthn)    │    │    │
│  │  │  4. Create WSIM user + cards                    │    │    │
│  │  │  5. Return success via postMessage              │    │    │
│  │  └─────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Flow Sequence

```
BSIM                           WSIM Auth Server                    Browser/Authenticator
  │                                   │                                    │
  │  1. User clicks "Enable Wallet Pay"                                    │
  │────────────────────────────────────────────────────────────────────────│
  │                                   │                                    │
  │  2. Open popup: wsim.example/enroll/embed?origin=bsim.example          │
  │──────────────────────────────────>│                                    │
  │                                   │                                    │
  │  3. postMessage: { type: 'wsim:enroll-init', claims: {...}, cards: [...] }
  │──────────────────────────────────>│                                    │
  │                                   │                                    │
  │                    4. Validate origin against allowed list             │
  │                    5. Check if user already enrolled                   │
  │                                   │                                    │
  │                    [If already enrolled]                               │
  │  6a. postMessage: { type: 'wsim:already-enrolled' }                    │
  │<──────────────────────────────────│                                    │
  │                                   │                                    │
  │                    [If new user]                                       │
  │                    6b. Display card selection UI                       │
  │                                   │                                    │
  │                    7. User selects cards                               │
  │                                   │                                    │
  │                    8. Generate passkey registration options            │
  │                       (with cross-origin RP ID)                        │
  │                                   │                                    │
  │                                   │  9. navigator.credentials.create() │
  │                                   │────────────────────────────────────>│
  │                                   │                                    │
  │                                   │  10. User authenticates (biometric)│
  │                                   │<────────────────────────────────────│
  │                                   │                                    │
  │                    11. Verify registration response                    │
  │                    12. Create WalletUser + PasskeyCredential           │
  │                    13. Create WalletCards for selected cards           │
  │                                   │                                    │
  │  14. postMessage: { type: 'wsim:enrolled', sessionToken: '...' }       │
  │<──────────────────────────────────│                                    │
  │                                   │                                    │
  │  15. Close popup, show success                                         │
  │                                   │                                    │
```

### WebAuthn Related Origin Requests

For cross-origin passkey registration to work, WSIM must publish a `/.well-known/webauthn` file that declares which origins are allowed to register passkeys with WSIM's RP ID.

**File:** `/.well-known/webauthn`
```json
{
  "origins": [
    "https://bsim-dev.banksim.ca",
    "https://bsim.banksim.ca"
  ]
}
```

**How it works:**
1. BSIM page calls `navigator.credentials.create()` with `rpId: "wsim.banksim.ca"`
2. Browser fetches `https://wsim.banksim.ca/.well-known/webauthn`
3. Browser checks if current origin (`bsim-dev.banksim.ca`) is in the `origins` array
4. If allowed, passkey registration proceeds with WSIM as the Relying Party
5. Passkey is bound to WSIM's RP ID, usable from any WSIM-related origin

**Browser Support:**
- Chrome 128+ (August 2024)
- Safari 18+ (September 2024)
- Firefox: Not yet supported (fallback to popup approach needed)

### Data Flow: Identity and Card Token from BSIM

BSIM passes user identity and a card access token via postMessage. **Card data is NOT passed through the browser** - it's fetched server-to-server for security.

```typescript
interface EnrollmentInitMessage {
  type: 'wsim:enroll-init';
  // User identity (from BSIM's session)
  claims: {
    sub: string;           // BSIM user ID
    email: string;
    given_name: string;
    family_name: string;
  };
  // Card access token (NOT card data!)
  cardToken: string;       // Short-lived JWT for server-to-server card fetch
  // Authentication
  bsimId: string;          // Bank identifier
  signature: string;       // HMAC signature for verification
  timestamp: number;       // For replay protection
}
```

**Security:**
- The `signature` is computed server-side by BSIM using a shared secret
- Card data (even masked last4, expiry) never passes through browser postMessage
- WSIM fetches cards server-to-server using the `cardToken`
- This matches the security pattern of the existing OIDC enrollment flow

### Response Messages

```typescript
// Success
interface EnrollmentSuccessMessage {
  type: 'wsim:enrolled';
  walletId: string;
  sessionToken: string;      // JWT for immediate API access
  sessionTokenExpiresIn: number;
}

// Already enrolled
interface AlreadyEnrolledMessage {
  type: 'wsim:already-enrolled';
  walletId: string;
  message: string;
}

// Error
interface EnrollmentErrorMessage {
  type: 'wsim:enroll-error';
  error: string;
  code: string;
}

// Cancelled
interface EnrollmentCancelledMessage {
  type: 'wsim:enroll-cancelled';
}
```

---

## Implementation Plan

### Phase 1: Core Infrastructure
- [ ] Create `/.well-known/webauthn` endpoint (hardcoded BSIM origins)
- [ ] Create `/enroll/embed` route in auth-server
- [ ] Create enrollment embed EJS view
- [ ] Implement postMessage protocol for enrollment

### Phase 2: Enrollment Flow
- [ ] Implement identity verification (validate BSIM signature)
- [ ] Implement "already enrolled" detection
- [ ] Create card selection UI in embed
- [ ] Implement cross-origin passkey registration

### Phase 3: User/Card Creation
- [ ] Create WalletUser from BSIM claims (no OIDC redirect)
- [ ] Create BsimEnrollment record (without wallet_credential initially)
- [ ] Create WalletCard records for selected cards
- [ ] Generate and return session token

### Phase 4: BSIM Integration
- [ ] Add enrollment button to BSIM UI
- [ ] Implement postMessage communication in BSIM
- [ ] Add API signature generation in BSIM backend
- [ ] End-to-end testing

### Phase 5: Documentation & Polish
- [ ] Update MERCHANT_UI_INTEGRATION_GUIDE.md with enrollment flow
- [ ] Add error handling and edge cases
- [ ] Browser compatibility fallbacks (Firefox)
- [ ] Update CHANGELOG

---

## API Specification

### New Endpoints (Auth Server)

#### GET /.well-known/webauthn
Returns the WebAuthn related origins configuration.

**Response:**
```json
{
  "origins": ["https://bsim-dev.banksim.ca", "https://bsim.banksim.ca"]
}
```

#### GET /enroll/embed
Serves the enrollment embed page (opened in popup/iframe by BSIM).

**Query Parameters:**
- `origin` (required): The parent origin for postMessage validation

#### POST /enroll/embed/check
Check if user is already enrolled.

**Request:**
```json
{
  "email": "user@example.com",
  "bsimSub": "bsim-user-id"
}
```

**Response:**
```json
{
  "enrolled": true,
  "walletId": "..."
}
```

#### POST /enroll/embed/cards
Fetch cards from BSIM server-to-server using card token.

**Request:**
```json
{
  "cardToken": "eyJhbGciOiJIUzI1NiIs...",
  "bsimId": "bsim",
  "claims": { "sub": "...", "email": "..." },
  "signature": "...",
  "timestamp": 1234567890
}
```

**Response:**
```json
{
  "cards": [
    { "id": "card_123", "cardType": "VISA", "lastFour": "4242", ... }
  ]
}
```

#### POST /enroll/embed/passkey/register/options
Generate passkey registration options for cross-origin registration.

**Request:**
```json
{
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response:** WebAuthn PublicKeyCredentialCreationOptions

#### POST /enroll/embed/passkey/register/verify
Verify passkey registration and create user. Cards are fetched server-to-server.

**Request:**
```json
{
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "bsimId": "bsim",
  "bsimSub": "bsim-user-id",
  "cardToken": "eyJhbGciOiJIUzI1NiIs...",
  "selectedCardIds": ["card_123", "card_456"],
  "credential": { /* WebAuthn response */ },
  "signature": "...",
  "timestamp": 1234567890
}
```

**Response:**
```json
{
  "success": true,
  "walletId": "...",
  "sessionToken": "...",
  "sessionTokenExpiresIn": 2592000
}
```

---

## Security Considerations

### Server-to-Server Card Fetch
- Card data (even masked last4, expiry) never passes through browser postMessage
- Only a short-lived `cardToken` JWT passes through the browser
- WSIM fetches cards directly from BSIM's `/api/wallet/cards` endpoint
- This matches the security pattern used in the standard OIDC enrollment flow

### Origin Validation
- Strict origin checking on postMessage
- Only allow origins listed in `/.well-known/webauthn`
- Validate `signature` from BSIM to prevent claim tampering

### Replay Protection
- Include `timestamp` in signed payload
- Reject requests older than 5 minutes
- Single-use nonces for passkey registration

### Cross-Origin Passkey Security
- Passkey is bound to WSIM's RP ID (not BSIM's)
- Works because browser verifies Related Origin Requests
- If browser doesn't support ROR, registration will fail (fallback needed)

### Data Minimization
- BSIM passes only necessary claims
- No wallet_credential needed (cards are pre-authorized by BSIM)
- Card data is masked (last 4 only)

---

## Testing Plan

### Unit Tests
- [ ] Origin validation logic
- [ ] Signature verification
- [ ] User creation from claims
- [ ] Card creation from BSIM data

### Integration Tests
- [ ] Full enrollment flow (happy path)
- [ ] Already enrolled detection
- [ ] Invalid signature rejection
- [ ] Expired timestamp rejection

### E2E Tests
- [ ] BSIM → WSIM enrollment popup flow
- [ ] Cross-origin passkey registration
- [ ] Immediate payment after enrollment

### Browser Compatibility
- [ ] Chrome 128+
- [ ] Safari 18+
- [ ] Firefox (expect failure, document fallback)
- [ ] Edge (Chromium-based, should work)

---

## Future Enhancements

### Phase 2 Enhancements
- [ ] **Admin-configurable origins**: Allow adding/removing related origins via admin UI
- [ ] **SSO to wallet**: After "already enrolled" detection, option to SSO user to /wallet
- [ ] **Popup fallback for Firefox**: If ROR not supported, fall back to WSIM popup for passkey

### Phase 3 Enhancements
- [ ] **Multiple bank support**: Support enrollment from multiple OIDC providers
- [ ] **Wallet credential exchange**: Option for BSIM to pass wallet_credential for card refresh
- [ ] **Enrollment analytics**: Track conversion rates from bank → enrollment → first payment

---

## Open Questions

1. **Card refresh strategy**: Without wallet_credential, how do we refresh card data if user adds new cards at BSIM?
   - *Proposed*: Provide a "refresh cards" flow that does a mini OIDC to get fresh wallet_credential

2. **Firefox fallback timing**: Should we implement popup fallback now or wait for Firefox ROR support?
   - *Proposed*: Document limitation, implement fallback in Phase 2

3. **Enrollment without cards**: Should users be able to enroll without selecting any cards?
   - *Proposed*: Require at least one card for initial enrollment

---

## References

- [WebAuthn Related Origin Requests Spec](https://w3c.github.io/webauthn/#sctn-related-origins)
- [Chrome 128 Release Notes (ROR support)](https://developer.chrome.com/blog/passkeys-related-origin-requests)
- [WSIM Merchant Integration Guide](./MERCHANT_UI_INTEGRATION_GUIDE.md)
- [Current Enrollment Flow](../backend/src/routes/enrollment.ts)

---

## Implementation Status

### WSIM Components (Complete)

| Component | Status | Notes |
|-----------|--------|-------|
| `/.well-known/webauthn` endpoint | Done | Returns related origins for cross-origin passkey |
| `/enroll/embed` route | Done | Main enrollment embed routes |
| `/enroll/embed/cards` endpoint | Done | Server-to-server card fetch from BSIM |
| Enrollment embed view | Done | Card selection + passkey registration UI |
| postMessage protocol | Done | Full bi-directional communication |
| Identity verification | Done | HMAC signature validation |
| Already enrolled detection | Done | Check by email or BSIM sub |
| Cross-origin passkey registration | Done | Using WebAuthn Level 3 |
| Server-to-server card fetch | Done | Card data never passes through browser |
| User/enrollment/card creation | Done | Transaction-safe creation |
| Session token generation | Done | 30-day JWT returned on success |

### BSIM Integration (Pending - External Team)

| Component | Status | Notes |
|-----------|--------|-------|
| "Enable Wallet Pay" button | Pending | BSIM team to implement |
| Backend card token generation | Pending | BSIM team to implement |
| Backend signature generation | Pending | BSIM team to implement |
| `/api/wallet/cards` endpoint | Pending | May already exist from OIDC flow |
| postMessage communication | Pending | BSIM team to implement |

**Integration Guide:** See [BSIM_ENROLLMENT_INTEGRATION.md](../BSIM_ENROLLMENT_INTEGRATION.md)

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2025-12-11 | Claude | Security enhancement: Server-to-server card fetch (card data no longer passes through browser postMessage) |
| 2025-12-11 | Claude | WSIM implementation complete; BSIM integration guide created |
| 2025-12-10 | Claude | Initial BRD created |
