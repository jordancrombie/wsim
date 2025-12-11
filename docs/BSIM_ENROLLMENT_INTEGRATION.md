# BSIM Integration Guide: In-Bank WSIM Enrollment

This document provides implementation guidance for banks (BSIM or other OIDC providers) to enable in-bank WSIM enrollment. Users can enroll in WSIM Wallet without leaving the bank's website.

---

## Overview

The In-Bank Enrollment feature allows bank users to:
1. Click an "Enable Wallet Pay" button within the bank's UI
2. Select which cards to add to their wallet
3. Register a passkey for secure access
4. Complete enrollment without redirecting away from the bank

**Key Technical Features:**
- Cross-origin passkey registration using WebAuthn Related Origin Requests (Level 3)
- **Server-to-server card data transfer** (card data never passes through browser postMessage)

---

## Prerequisites

### Browser Support
- Chrome 128+ (August 2024)
- Safari 18+ (September 2024)
- Firefox: Not yet supported (users will need to use supported browsers)

### WSIM Configuration
The bank's origin must be registered in WSIM's `/.well-known/webauthn` file. Contact WSIM administrators to add your origin.

### Shared Secret
A shared HMAC secret is required to sign enrollment payloads. This prevents client-side tampering with user identity claims.

### Card API Endpoint
Your bank must expose a `/api/wallet/cards` endpoint that WSIM can call server-to-server to fetch user's cards. This is the same endpoint used in the existing OIDC enrollment flow.

---

## Integration Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Bank Website                                    │
│                                                                             │
│  1. User clicks "Enable Wallet Pay"                                         │
│                              │                                              │
│  2. Bank backend generates cardToken (JWT) for card API access              │
│                              │                                              │
│  3. Bank opens WSIM enrollment popup/iframe                                 │
│     URL: https://wsim-auth.example.com/enroll/embed?origin=...              │
│                              │                                              │
│  4. Bank sends cardToken + claims via postMessage                           │
│     { type: 'wsim:enroll-init', claims: {...}, cardToken: '...' }           │
│                              │                                              │
│  5. WSIM backend fetches cards from Bank (server-to-server)                 │
│     GET /api/wallet/cards with Authorization: Bearer <cardToken>            │
│                              │                                              │
│  6. User selects cards in WSIM UI                                           │
│                              │                                              │
│  7. User registers passkey (cross-origin)                                   │
│                              │                                              │
│  8. WSIM sends success via postMessage                                      │
│     { type: 'wsim:enrolled', walletId: '...', sessionToken: '...' }         │
│                              │                                              │
│  9. Bank closes popup, shows success message                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Security Note:** Card data (even masked data like last4, expiry) is fetched server-to-server and never passes through browser postMessage. Only a short-lived `cardToken` is passed through the browser.

---

## Implementation Steps

### Step 1: Add Enrollment Button

Add an "Enable Wallet Pay" button in your user's dashboard or card management area.

```html
<button id="enableWalletPay" class="btn btn-primary">
  Enable Wallet Pay
</button>
```

### Step 2: Implement Card Token Endpoint

Create an endpoint that generates a short-lived JWT token for card API access:

```typescript
// Backend (Node.js example)
import jwt from 'jsonwebtoken';

// This endpoint generates a card access token
app.post('/api/wsim/card-token', requireAuth, async (req, res) => {
  const user = req.user;

  // Generate a short-lived token (5 minutes) for card API access
  const cardToken = jwt.sign(
    {
      sub: user.id,
      type: 'wallet_card_access',
      scope: 'cards:read',
    },
    process.env.CARD_TOKEN_SECRET,
    { expiresIn: '5m' }
  );

  res.json({ cardToken });
});
```

### Step 3: Ensure Card API Endpoint Exists

WSIM will call your `/api/wallet/cards/enroll` endpoint server-to-server. Ensure it:
1. Accepts the `cardToken` as a Bearer token
2. Returns cards in the expected format:

```typescript
// GET /api/wallet/cards/enroll
// Authorization: Bearer <cardToken>

// Response:
{
  "cards": [
    {
      "id": "card_123",           // Your internal card reference ID
      "cardType": "VISA",         // VISA, MC, AMEX, VISA_DEBIT, MC_DEBIT
      "lastFour": "4242",         // Last 4 digits
      "cardHolder": "John Doe",   // Cardholder name
      "expiryMonth": 12,          // 1-12
      "expiryYear": 2025          // 4-digit year
    }
  ]
}
```

### Step 4: Generate Enrollment Signature (Server-Side)

**IMPORTANT:** The signature MUST be generated server-side using your shared secret.

```typescript
// Backend (Node.js example)
import crypto from 'crypto';

function generateEnrollmentSignature(
  claims: { sub: string; email: string; given_name?: string; family_name?: string },
  cardToken: string,  // Note: cardToken, not card data
  bsimId: string,
  timestamp: number,
  sharedSecret: string
): string {
  const payload = JSON.stringify({
    claims,
    cardToken,    // Sign the token, not the card data
    bsimId,
    timestamp,
  });

  return crypto
    .createHmac('sha256', sharedSecret)
    .update(payload)
    .digest('hex');
}

// API endpoint example
app.post('/api/wsim/enrollment-data', requireAuth, async (req, res) => {
  const user = req.user;

  // Generate card access token
  const cardToken = jwt.sign(
    { sub: user.id, type: 'wallet_card_access', scope: 'cards:read' },
    process.env.CARD_TOKEN_SECRET,
    { expiresIn: '5m' }
  );

  const timestamp = Date.now();
  const claims = {
    sub: user.id,
    email: user.email,
    given_name: user.firstName,
    family_name: user.lastName,
  };

  const signature = generateEnrollmentSignature(
    claims,
    cardToken,
    process.env.BSIM_ID,
    timestamp,
    process.env.WSIM_SHARED_SECRET
  );

  res.json({
    claims,
    cardToken,      // Token to fetch cards, NOT card data
    bsimId: process.env.BSIM_ID,
    signature,
    timestamp,
  });
});
```

### Step 5: Open Enrollment Popup

```typescript
// Frontend
// Dev: https://wsim-auth-dev.banksim.ca
// Prod: https://wsim-auth.banksim.ca
const WSIM_AUTH_URL = 'https://wsim-auth-dev.banksim.ca';
const BANK_ORIGIN = window.location.origin;

let enrollmentPopup: Window | null = null;

async function openWsimEnrollment() {
  // 1. Get signed enrollment data from your backend
  const response = await fetch('/api/wsim/enrollment-data', {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to get enrollment data');
  }

  const enrollmentData = await response.json();

  // 2. Open WSIM enrollment popup
  const popupUrl = `${WSIM_AUTH_URL}/enroll/embed?origin=${encodeURIComponent(BANK_ORIGIN)}`;

  enrollmentPopup = window.open(
    popupUrl,
    'wsim-enrollment',
    'width=450,height=600,scrollbars=yes,resizable=yes'
  );

  if (!enrollmentPopup) {
    throw new Error('Popup blocked. Please allow popups for this site.');
  }

  // 3. Wait for popup to be ready, then send enrollment data
  // (handled in message listener below)
  window._pendingEnrollmentData = enrollmentData;
}

// Handle messages from WSIM popup
window.addEventListener('message', (event) => {
  // Validate origin
  if (event.origin !== WSIM_AUTH_URL) {
    return;
  }

  const { type, ...data } = event.data;

  switch (type) {
    case 'wsim:enroll-ready':
      // Popup is ready, send enrollment data
      if (window._pendingEnrollmentData && enrollmentPopup) {
        enrollmentPopup.postMessage({
          type: 'wsim:enroll-init',
          ...window._pendingEnrollmentData,
        }, WSIM_AUTH_URL);
        delete window._pendingEnrollmentData;
      }
      break;

    case 'wsim:enrolled':
      // Success! User is now enrolled
      console.log('User enrolled:', data.walletId);
      console.log('Session token:', data.sessionToken);
      console.log('Cards enrolled:', data.cardsEnrolled);

      // Optionally store the session token for Quick Pay
      localStorage.setItem('wsim_session_token', data.sessionToken);
      localStorage.setItem('wsim_session_expires',
        String(Date.now() + data.sessionTokenExpiresIn * 1000));

      enrollmentPopup?.close();
      showSuccessMessage('Wallet Pay is now enabled!');
      break;

    case 'wsim:already-enrolled':
      // User was already enrolled
      console.log('User already enrolled:', data.walletId);
      enrollmentPopup?.close();
      showInfoMessage('Wallet Pay is already enabled for your account.');
      break;

    case 'wsim:enroll-cancelled':
      // User cancelled enrollment
      enrollmentPopup?.close();
      break;

    case 'wsim:enroll-error':
      // Enrollment failed
      console.error('Enrollment error:', data.error, data.code);
      enrollmentPopup?.close();
      showErrorMessage('Failed to enable Wallet Pay. Please try again.');
      break;
  }
});

// Add click handler
document.getElementById('enableWalletPay')?.addEventListener('click', () => {
  openWsimEnrollment().catch(error => {
    console.error('Enrollment error:', error);
    showErrorMessage(error.message);
  });
});
```

### Step 6: Alternative - Iframe Integration

If you prefer an inline experience instead of a popup:

```html
<div id="wsim-enrollment-container" style="display: none;">
  <iframe
    id="wsim-enrollment-iframe"
    style="width: 100%; height: 500px; border: none; border-radius: 12px;"
  ></iframe>
</div>
```

```typescript
function openWsimEnrollmentInline() {
  const iframe = document.getElementById('wsim-enrollment-iframe') as HTMLIFrameElement;
  const container = document.getElementById('wsim-enrollment-container');

  const iframeUrl = `${WSIM_AUTH_URL}/enroll/embed?origin=${encodeURIComponent(BANK_ORIGIN)}`;
  iframe.src = iframeUrl;
  container.style.display = 'block';

  // Message handling is the same as popup
}
```

---

## PostMessage Protocol Reference

### Messages FROM Bank TO WSIM

#### wsim:enroll-init
Sent after WSIM signals ready. Contains user identity and card access token.

```typescript
{
  type: 'wsim:enroll-init',
  claims: {
    sub: string,          // Bank's user ID
    email: string,
    given_name?: string,
    family_name?: string,
  },
  cardToken: string,      // JWT for server-to-server card fetch
  bsimId: string,         // Bank identifier
  signature: string,      // HMAC signature
  timestamp: number,      // Milliseconds since epoch
}
```

**Note:** Card data is NOT included in postMessage. WSIM fetches cards server-to-server using `cardToken`.

### Messages FROM WSIM TO Bank

#### wsim:enroll-ready
WSIM is ready to receive enrollment data.

```typescript
{ type: 'wsim:enroll-ready' }
```

#### wsim:enrolled
Enrollment completed successfully.

```typescript
{
  type: 'wsim:enrolled',
  walletId: string,           // User's WSIM wallet ID
  sessionToken: string,       // JWT for Quick Pay (30-day validity)
  sessionTokenExpiresIn: number, // Seconds until token expires
  cardsEnrolled: number,      // Number of cards added
}
```

#### wsim:already-enrolled
User was already enrolled in WSIM.

```typescript
{
  type: 'wsim:already-enrolled',
  walletId: string,
}
```

#### wsim:enroll-cancelled
User cancelled the enrollment flow.

```typescript
{ type: 'wsim:enroll-cancelled' }
```

#### wsim:enroll-error
An error occurred during enrollment.

```typescript
{
  type: 'wsim:enroll-error',
  error: string,    // Human-readable error message
  code: string,     // Error code (EXPIRED, INVALID_SIGNATURE, CARD_FETCH_FAILED, etc.)
}
```

---

## Security Considerations

### Server-to-Server Card Fetch
- Card data (even masked last4, expiry) is **never** passed through browser postMessage
- Only a short-lived `cardToken` JWT passes through the browser
- WSIM fetches cards directly from your `/api/wallet/cards` endpoint
- This matches the security pattern used in the standard OIDC enrollment flow

### Signature Verification
- The signature is validated server-side by WSIM
- Prevents client-side tampering with user identity and cardToken
- Uses HMAC-SHA256 with a shared secret

### Timestamp Validation
- Timestamps must be within 5 minutes of current time
- Prevents replay attacks with old signed payloads

### Card Token Expiration
- The `cardToken` should be short-lived (5 minutes recommended)
- Limits the window for potential token theft

### Origin Validation
- WSIM validates the parent origin against an allowlist
- Only registered bank origins can embed the enrollment flow

### Cross-Origin Passkeys
- Passkeys are registered with WSIM's RP ID
- Browser validates against WSIM's `/.well-known/webauthn`
- Ensures passkeys work across all WSIM-enabled merchants

---

## Testing

### Test Environment
- WSIM Auth Server: `https://wsim-auth-dev.banksim.ca`
- BSIM Dev Origin: `https://dev.banksim.ca` (already in allowlist)
- BSIM Prod Origin: `https://banksim.ca` (already in allowlist)

### Test Flow
1. Log in to your bank test account
2. Click "Enable Wallet Pay"
3. Verify popup opens and loads cards (fetched server-to-server)
4. Select at least one card
5. Complete passkey registration
6. Verify success message and session token received

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Popup blocked | Browser popup blocker | User must allow popups |
| Invalid signature | Mismatched secrets | Verify shared secret matches |
| Origin not allowed | Origin not in allowlist | Contact WSIM admin |
| Passkey fails | Browser not supported | Use Chrome 128+ or Safari 18+ |
| Card fetch fails | Card API issue | Verify `/api/wallet/cards` endpoint works with cardToken |
| CARD_FETCH_FAILED | WSIM can't reach card API | Check CORS, network, cardToken validity |

---

## Environment Variables

Your backend will need these environment variables:

```bash
# Your bank identifier
BSIM_ID=bsim

# Shared secret for signing (must match WSIM's INTERNAL_API_SECRET)
# Dev: use 'dev-internal-secret-change-in-production'
# Prod: coordinate secure exchange with WSIM team
WSIM_SHARED_SECRET=dev-internal-secret-change-in-production

# Secret for signing card access tokens (BSIM-internal, generate your own)
CARD_TOKEN_SECRET=your-card-token-secret-here

# WSIM Auth Server URL
# Dev: https://wsim-auth-dev.banksim.ca
# Prod: https://wsim-auth.banksim.ca
WSIM_AUTH_URL=https://wsim-auth-dev.banksim.ca
```

### Environment-Specific Configuration

| Environment | BSIM Origin | WSIM Auth URL |
|-------------|-------------|---------------|
| Local dev | `http://localhost:3000` | `http://localhost:3005` |
| Dev/staging | `https://dev.banksim.ca` | `https://wsim-auth-dev.banksim.ca` |
| Production | `https://banksim.ca` | `https://wsim-auth.banksim.ca` |

---

## Migration from Previous Version

If you previously integrated with an earlier version that passed cards via postMessage:

1. **Backend changes:**
   - Generate `cardToken` instead of fetching cards
   - Update signature to sign `cardToken` instead of `cards` array
   - Remove `cards` from the enrollment data response

2. **Frontend changes:**
   - No changes needed - the postMessage format is similar
   - Just send `cardToken` instead of `cards`

3. **API changes:**
   - Ensure `/api/wallet/cards` accepts the new `cardToken` format
   - WSIM will call this endpoint server-to-server

---

## Single Sign-On (SSO) for Wallet Management

After enrollment, users may want to manage their WSIM Wallet (view cards, set default payment method, etc.). WSIM provides two SSO options:

| Option | Description | Best For |
|--------|-------------|----------|
| **Server-to-Server SSO** (Recommended) | BSIM server requests fresh token from WSIM | Cross-device, any browser |
| **Client-Side SSO** | Uses localStorage token from enrollment | Same browser only |

---

### Option 1: Server-to-Server SSO (Recommended)

**True SSO** that works on any device/browser - user just needs to be logged into BSIM.

#### How It Works

1. User clicks "Open WSIM Wallet" in BSIM
2. BSIM backend calls WSIM's `/api/partner/sso-token` endpoint
3. WSIM returns a short-lived (5 min) SSO token
4. BSIM frontend redirects user to WSIM with the token
5. User is automatically logged in - no passkey needed

#### BSIM Backend Implementation

```typescript
// POST /api/wsim/sso-url - Returns SSO URL for the current user
import crypto from 'crypto';

function generateSignature(payload: object, secret: string): string {
  // Remove undefined values for consistent signing
  const cleanPayload = Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined)
  );
  const signedData = JSON.stringify(cleanPayload);
  return crypto.createHmac('sha256', secret).update(signedData).digest('hex');
}

router.get('/api/wsim/sso-url', requireAuth, async (req, res) => {
  const timestamp = Date.now();
  const payload = {
    bsimId: process.env.BSIM_ID,           // e.g., 'bsim'
    bsimUserId: req.user.sub,               // BSIM user ID (fiUserRef)
    timestamp,
  };

  const signature = generateSignature(payload, process.env.WSIM_SHARED_SECRET);

  try {
    const response = await fetch(`${process.env.WSIM_BACKEND_URL}/api/partner/sso-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, signature }),
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json(error);
    }

    const data = await response.json();
    res.json({ ssoUrl: data.ssoUrl });
  } catch (error) {
    console.error('Failed to get WSIM SSO URL:', error);
    res.status(500).json({ error: 'Failed to get SSO URL' });
  }
});
```

#### BSIM Frontend Implementation

```typescript
async function openWsimWallet() {
  try {
    const response = await fetch('/api/wsim/sso-url', {
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 404) {
        // User not enrolled - show enrollment prompt
        showEnrollmentPrompt();
        return;
      }
      throw new Error('Failed to get SSO URL');
    }

    const { ssoUrl } = await response.json();
    window.open(ssoUrl, '_blank');
  } catch (error) {
    console.error('Failed to open WSIM wallet:', error);
    showError('Unable to open wallet. Please try again.');
  }
}
```

```html
<button onclick="openWsimWallet()">
  Open WSIM Wallet
</button>
```

#### WSIM Partner SSO API Reference

**Endpoint:** `POST /api/partner/sso-token`

**Request:**
```json
{
  "bsimId": "bsim",
  "bsimUserId": "user-sub-from-bsim",
  "email": "user@example.com",        // Optional if bsimUserId provided
  "timestamp": 1733929200000,
  "signature": "hmac-sha256-hex-signature"
}
```

**Response (200):**
```json
{
  "ssoToken": "eyJhbG...",
  "ssoUrl": "https://wsim-dev.banksim.ca/api/auth/sso?token=eyJhbG...",
  "expiresIn": 300,
  "walletId": "wallet-abc"
}
```

**Error Responses:**
- `400` - Missing fields, expired timestamp (>5 min old)
- `403` - Invalid signature
- `404` - User not enrolled in WSIM

---

### Option 2: Client-Side SSO (Browser-Specific)

Uses the `sessionToken` returned during enrollment. **Only works in the same browser** where enrollment occurred.

#### How It Works

1. **During Enrollment**: WSIM returns a `sessionToken` JWT (30-day validity) in the `wsim:enrolled` postMessage.

2. **SSO Access**: To open wallet management with SSO:
   ```
   https://wsim-dev.banksim.ca/api/auth/sso?token=<sessionToken>
   ```

3. **What Happens**: The WSIM backend validates the token, creates a session cookie, and redirects the user to the wallet dashboard at `/wallet`.

#### Built-in "Manage Wallet" Button

The WSIM enrollment popup already includes a "Manage Wallet" button after successful enrollment. Users can click this to open their wallet in a new tab with SSO.

No additional BSIM implementation required.

#### Bank-Side Implementation (Optional)

If you want to add a "Manage Wallet" link within your bank's UI:

```typescript
// WSIM Backend URL (NOT the auth server)
// Dev: https://wsim-dev.banksim.ca
// Prod: https://wsim.banksim.ca
const WSIM_BACKEND_URL = 'https://wsim-dev.banksim.ca';

// Store the session token after enrollment
window.addEventListener('message', (event) => {
  if (event.origin !== WSIM_AUTH_URL) return;

  if (event.data.type === 'wsim:enrolled' || event.data.type === 'wsim:already-enrolled') {
    // Store the token (localStorage)
    if (event.data.sessionToken) {
      localStorage.setItem('wsim_session_token', event.data.sessionToken);
      localStorage.setItem('wsim_session_expires',
        String(Date.now() + event.data.sessionTokenExpiresIn * 1000));
    }
  }
});

// Function to open wallet management (same-browser only)
function openWalletManagementClientSide() {
  const token = localStorage.getItem('wsim_session_token');
  const expires = parseInt(localStorage.getItem('wsim_session_expires') || '0');

  if (!token || Date.now() > expires) {
    // Token expired or not available - use server-to-server SSO instead
    openWsimWallet(); // Call the server-to-server version
    return;
  }

  // SSO via backend API - creates session and redirects to frontend /wallet
  const ssoUrl = `${WSIM_BACKEND_URL}/api/auth/sso?token=${encodeURIComponent(token)}`;
  window.open(ssoUrl, '_blank');
}
```

---

### SSO Endpoints Summary

| Environment | SSO Endpoint |
|-------------|--------------|
| Local dev | `http://localhost:3003/api/auth/sso?token=<token>` |
| Dev/staging | `https://wsim-dev.banksim.ca/api/auth/sso?token=<token>` |
| Production | `https://wsim.banksim.ca/api/auth/sso?token=<token>` |

| Environment | Partner SSO Token Endpoint |
|-------------|---------------------------|
| Local dev | `http://localhost:3003/api/partner/sso-token` |
| Dev/staging | `https://wsim-dev.banksim.ca/api/partner/sso-token` |
| Production | `https://wsim.banksim.ca/api/partner/sso-token` |

### SSO Security Considerations

1. **Server-to-Server Tokens**:
   - Short-lived (5 minutes) - minimizes exposure window
   - Generated fresh per request - no storage required
   - HMAC-signed requests prevent forgery

2. **Client-Side Tokens**:
   - Longer-lived (30 days) - for localStorage convenience
   - Browser-specific - lost if user clears data or uses different device
   - Best used as fallback when server-to-server isn't implemented

3. **SSO URL Validation**:
   - WSIM validates that the redirect stays within relative paths
   - Open redirect attacks are prevented

### Wallet Management Features

Once logged in via SSO, users can:
- View all enrolled payment cards
- Set a default payment card
- Remove cards from their wallet
- View registered passkeys
- Log out of wallet management

---

## Support

For integration support or to register your origin, contact the WSIM team.
