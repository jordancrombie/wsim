# BSIM Integration Guide: In-Bank WSIM Enrollment

This document provides implementation guidance for banks (BSIM or other OIDC providers) to enable in-bank WSIM enrollment. Users can enroll in WSIM Wallet without leaving the bank's website.

---

## Overview

The In-Bank Enrollment feature allows bank users to:
1. Click an "Enable Wallet Pay" button within the bank's UI
2. Select which cards to add to their wallet
3. Register a passkey for secure access
4. Complete enrollment without redirecting away from the bank

**Key Technical Feature:** Cross-origin passkey registration using WebAuthn Related Origin Requests (Level 3).

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

---

## Integration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         Bank Website                             │
│                                                                  │
│  1. User clicks "Enable Wallet Pay"                              │
│                              │                                   │
│  2. Bank opens WSIM enrollment popup/iframe                      │
│     URL: https://wsim-auth.example.com/enroll/embed?origin=...   │
│                              │                                   │
│  3. Bank sends user data via postMessage                         │
│     { type: 'wsim:enroll-init', claims: {...}, cards: [...] }    │
│                              │                                   │
│  4. User selects cards in WSIM UI                                │
│                              │                                   │
│  5. User registers passkey (cross-origin)                        │
│                              │                                   │
│  6. WSIM sends success via postMessage                           │
│     { type: 'wsim:enrolled', walletId: '...', sessionToken: '...'│
│                              │                                   │
│  7. Bank closes popup, shows success message                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Add Enrollment Button

Add an "Enable Wallet Pay" button in your user's dashboard or card management area.

```html
<button id="enableWalletPay" class="btn btn-primary">
  Enable Wallet Pay
</button>
```

### Step 2: Prepare Enrollment Data

When the user clicks the button, prepare the enrollment payload:

```typescript
interface EnrollmentPayload {
  // User identity (from your session/database)
  claims: {
    sub: string;           // Your internal user ID
    email: string;         // User's email
    given_name?: string;   // First name
    family_name?: string;  // Last name
  };

  // Cards available for enrollment
  cards: Array<{
    id: string;            // Your internal card reference ID
    cardType: string;      // VISA, MC, AMEX, VISA_DEBIT, MC_DEBIT
    lastFour: string;      // Last 4 digits
    cardHolder: string;    // Cardholder name
    expiryMonth: number;   // 1-12
    expiryYear: number;    // 4-digit year
  }>;

  // Bank identification
  bsimId: string;          // Your bank identifier (e.g., 'bsim')

  // Security
  signature: string;       // HMAC-SHA256 signature (see below)
  timestamp: number;       // Current timestamp in milliseconds
}
```

### Step 3: Generate Signature (Server-Side)

**IMPORTANT:** The signature MUST be generated server-side using your shared secret.

```typescript
// Backend (Node.js example)
import crypto from 'crypto';

function generateEnrollmentSignature(
  claims: { sub: string; email: string; given_name?: string; family_name?: string },
  cards: Array<{ id: string; cardType: string; lastFour: string; cardHolder: string; expiryMonth: number; expiryYear: number }>,
  bsimId: string,
  timestamp: number,
  sharedSecret: string
): string {
  const payload = JSON.stringify({
    claims,
    cards,
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
  const cards = await getCardsForUser(user.id);

  const timestamp = Date.now();
  const claims = {
    sub: user.id,
    email: user.email,
    given_name: user.firstName,
    family_name: user.lastName,
  };

  const signature = generateEnrollmentSignature(
    claims,
    cards,
    process.env.BSIM_ID,
    timestamp,
    process.env.WSIM_SHARED_SECRET
  );

  res.json({
    claims,
    cards,
    bsimId: process.env.BSIM_ID,
    signature,
    timestamp,
  });
});
```

### Step 4: Open Enrollment Popup

```typescript
// Frontend
const WSIM_AUTH_URL = 'https://wsim-auth.banksim.ca'; // or your WSIM auth server URL
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

### Step 5: Alternative - Iframe Integration

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
Sent after WSIM signals ready. Contains user identity and card data.

```typescript
{
  type: 'wsim:enroll-init',
  claims: {
    sub: string,
    email: string,
    given_name?: string,
    family_name?: string,
  },
  cards: Array<{
    id: string,
    cardType: string,
    lastFour: string,
    cardHolder: string,
    expiryMonth: number,
    expiryYear: number,
  }>,
  bsimId: string,
  signature: string,
  timestamp: number,
}
```

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
  code: string,     // Error code (EXPIRED, INVALID_SIGNATURE, etc.)
}
```

---

## Security Considerations

### Signature Verification
- The signature is validated server-side by WSIM
- Prevents client-side tampering with user identity
- Uses HMAC-SHA256 with a shared secret

### Timestamp Validation
- Timestamps must be within 5 minutes of current time
- Prevents replay attacks with old signed payloads

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
- WSIM Auth Server: `https://wsim-dev.banksim.ca/auth`
- Your origin must be added to the dev allowlist

### Test Flow
1. Log in to your bank test account
2. Click "Enable Wallet Pay"
3. Verify popup opens with card selection
4. Select at least one card
5. Complete passkey registration
6. Verify success message and session token received

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Popup blocked | Browser popup blocker | User must allow popups |
| Invalid signature | Mismatched secrets | Verify shared secret |
| Origin not allowed | Origin not in allowlist | Contact WSIM admin |
| Passkey fails | Browser not supported | Use Chrome 128+ or Safari 18+ |

---

## Environment Variables

Your backend will need these environment variables:

```bash
# Your bank identifier (provided by WSIM)
BSIM_ID=bsim

# Shared secret for signing (provided by WSIM)
WSIM_SHARED_SECRET=your-shared-secret-here

# WSIM Auth Server URL
WSIM_AUTH_URL=https://wsim-auth.banksim.ca
```

---

## Support

For integration support or to register your origin, contact the WSIM team.
