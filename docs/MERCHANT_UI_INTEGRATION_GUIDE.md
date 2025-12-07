# WSIM Merchant UI Integration Guide

> **Purpose:** Guide for merchants integrating WSIM wallet payments into their checkout flow using Popup, Inline (iframe), or Redirect methods.
>
> **Audience:** Frontend and backend developers implementing wallet payments on merchant sites.
>
> **Reference Implementation:** SSIM (Store Simulator) at `/Users/jcrombie/ai/ssim`

---

## Overview

WSIM provides three UI integration methods for wallet payments. Each method offers different trade-offs in user experience, implementation complexity, and control.

| Method | Description | UX Impact | Implementation |
|--------|-------------|-----------|----------------|
| **Popup** | Opens WSIM in a new window | User stays on checkout, popup handles auth | Medium |
| **Inline (iframe)** | Embeds WSIM card picker in page | Seamless, no navigation | Medium |
| **Redirect** | Full-page OAuth redirect | Standard flow, leaves checkout | Simple |

### Quick Comparison

| Feature | Popup | Inline | Redirect |
|---------|-------|--------|----------|
| User leaves checkout page | No | No | Yes |
| Requires popup blocker handling | Yes | No | No |
| Dynamic height adjustment | No | Yes | N/A |
| Works with strict CSP | Yes | Requires config | Yes |
| Mobile experience | Good | Excellent | Good |
| Implementation complexity | Medium | Medium | Low |

---

## Prerequisites

Before implementing any method, ensure:

1. **WSIM OAuth Client Registration** - Your merchant is registered with WSIM
2. **Environment Variables** - Configure the required URLs and credentials
3. **HTTPS** - All methods require HTTPS for secure cookies and WebAuthn

### Required Configuration

```env
# Enable WSIM integration
WSIM_ENABLED=true

# OAuth (for Redirect method)
WSIM_AUTH_URL=https://wsim-auth.banksim.ca
WSIM_CLIENT_ID=your-merchant-id
WSIM_CLIENT_SECRET=your-client-secret

# Popup/Inline integration
WSIM_POPUP_URL=https://wsim-auth.banksim.ca

# API key (optional, for API-based card picker)
WSIM_API_KEY=wsim_api_xxx
WSIM_API_URL=https://wsim.banksim.ca/api/merchant
```

---

# Sequence Diagrams

## Popup Flow - Complete Sequence

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ POPUP FLOW: User Selects Card via Popup Window                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────┐
│ Merchant │    │  Popup   │    │  WSIM Auth   │    │WSIM Backend │    │   BSIM   │
│  Page    │    │ Window   │    │   Server     │    │             │    │          │
└────┬─────┘    └────┬─────┘    └──────┬───────┘    └──────┬──────┘    └────┬─────┘
     │               │                 │                    │                │
     │ 1. window.open(/popup/card-picker?origin=...)       │                │
     │──────────────►│                 │                    │                │
     │               │                 │                    │                │
     │               │ 2. GET /popup/card-picker            │                │
     │               │────────────────►│                    │                │
     │               │                 │                    │                │
     │               │                 │ 3. Validate origin │                │
     │               │                 │   (ALLOWED_POPUP_ORIGINS)           │
     │               │                 │                    │                │
     │               │◄────────────────│                    │                │
     │               │ 4. HTML page    │                    │                │
     │               │    (card picker UI)                  │                │
     │               │                 │                    │                │
     │               │═══════════════════════════════════════════════════════│
     │               │ 5. Check WSIM session (cross-site cookie)             │
     │               │═══════════════════════════════════════════════════════│
     │               │                 │                    │                │
     │               │─────────────────┼───────────────────►│                │
     │               │ 6. GET /api/cards (with wsim.sid cookie)              │
     │               │                 │                    │                │
     │               │◄────────────────┼────────────────────│                │
     │               │ 7. Cards list   │                    │                │
     │               │                 │                    │                │
     │               │═══════════════════════════════════════════════════════│
     │               │ 8. User selects card & confirms (passkey)             │
     │               │═══════════════════════════════════════════════════════│
     │               │                 │                    │                │
     │               │─────────────────┼───────────────────►│                │
     │               │ 9. POST /api/passkey/authenticate    │                │
     │               │    (WebAuthn assertion)              │                │
     │               │                 │                    │                │
     │               │                 │                    │───────────────►│
     │               │                 │                    │ 10. GET /api/  │
     │               │                 │                    │     card-token │
     │               │                 │                    │                │
     │               │                 │                    │◄───────────────│
     │               │                 │                    │ 11. cardToken  │
     │               │                 │                    │     (5 min)    │
     │               │◄────────────────┼────────────────────│                │
     │               │ 12. { cardToken, cardLast4, ... }    │                │
     │               │                 │                    │                │
     │◄──────────────│                 │                    │                │
     │ 13. postMessage('wsim:card-selected', { cardToken... })               │
     │               │                 │                    │                │
     │               │ 14. window.close()                   │                │
     │               │                 │                    │                │
     │═══════════════════════════════════════════════════════════════════════│
     │ 15. Merchant processes token via backend             │                │
     │═══════════════════════════════════════════════════════════════════════│
     │               │                 │                    │                │
     ▼               ▼                 ▼                    ▼                ▼
```

### Key Points - Popup Flow

| Step | Description | Security Requirement |
|------|-------------|---------------------|
| 1 | Merchant opens popup with `origin` parameter | Origin must match `window.location.origin` |
| 3 | WSIM Auth validates origin | Origin checked against `ALLOWED_POPUP_ORIGINS` |
| 6 | Cards fetched with cross-site cookie | `wsim.sid` cookie needs `SameSite=None; Secure` |
| 9 | Passkey challenge/response | WebAuthn RP ID must match domain |
| 13 | Token sent via postMessage | Target origin restricted to validated origin |

---

## Inline (iframe) Flow - Complete Sequence

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ INLINE FLOW: User Selects Card via Embedded iframe                                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────┐
│ Merchant │    │  iframe  │    │  WSIM Auth   │    │WSIM Backend │    │   BSIM   │
│  Page    │    │          │    │   Server     │    │             │    │          │
└────┬─────┘    └────┬─────┘    └──────┬───────┘    └──────┬──────┘    └────┬─────┘
     │               │                 │                    │                │
     │ 1. Create <iframe src="/embed/card-picker?origin=...">               │
     │    with allow="publickey-credentials-get *; publickey-credentials-create *"
     │──────────────►│                 │                    │                │
     │               │                 │                    │                │
     │               │ 2. GET /embed/card-picker            │                │
     │               │────────────────►│                    │                │
     │               │                 │                    │                │
     │               │                 │ 3. Validate origin │                │
     │               │                 │   (ALLOWED_EMBED_ORIGINS)           │
     │               │                 │                    │                │
     │               │                 │ 4. Set CSP header: │                │
     │               │                 │    frame-ancestors 'self' {origin}  │
     │               │                 │                    │                │
     │               │                 │ 5. Set Permissions-Policy:          │
     │               │                 │    publickey-credentials-get=(self) │
     │               │                 │                    │                │
     │               │◄────────────────│                    │                │
     │               │ 6. HTML page    │                    │                │
     │               │    (card picker UI)                  │                │
     │               │                 │                    │                │
     │◄──────────────│                 │                    │                │
     │ 7. postMessage('wsim:ready')    │                    │                │
     │               │                 │                    │                │
     │               │═══════════════════════════════════════════════════════│
     │               │ 8. Check WSIM session (cross-site cookie in iframe)   │
     │               │═══════════════════════════════════════════════════════│
     │               │                 │                    │                │
     │               │─────────────────┼───────────────────►│                │
     │               │ 9. GET /api/cards (with wsim.sid cookie)              │
     │               │                 │                    │                │
     │◄──────────────│                 │                    │                │
     │ 10. postMessage('wsim:resize', { height: 450 })      │                │
     │               │                 │                    │                │
     │               │◄────────────────┼────────────────────│                │
     │               │ 11. Cards list  │                    │                │
     │               │                 │                    │                │
     │               │═══════════════════════════════════════════════════════│
     │               │ 12. User selects card & confirms (passkey in iframe)  │
     │               │     ⚠️  Requires iframe allow="publickey-credentials-*"
     │               │═══════════════════════════════════════════════════════│
     │               │                 │                    │                │
     │               │─────────────────┼───────────────────►│                │
     │               │ 13. POST /api/passkey/authenticate   │                │
     │               │     (WebAuthn assertion)             │                │
     │               │                 │                    │                │
     │               │                 │                    │───────────────►│
     │               │                 │                    │ 14. GET /api/  │
     │               │                 │                    │     card-token │
     │               │                 │                    │                │
     │               │                 │                    │◄───────────────│
     │               │                 │                    │ 15. cardToken  │
     │               │◄────────────────┼────────────────────│                │
     │               │ 16. { cardToken, cardLast4, ... }    │                │
     │               │                 │                    │                │
     │◄──────────────│                 │                    │                │
     │ 17. postMessage('wsim:card-selected', { cardToken... })               │
     │               │                 │                    │                │
     │═══════════════════════════════════════════════════════════════════════│
     │ 18. Merchant processes token via backend             │                │
     │═══════════════════════════════════════════════════════════════════════│
     │               │                 │                    │                │
     ▼               ▼                 ▼                    ▼                ▼
```

### Key Points - Inline Flow

| Step | Description | Security Requirement |
|------|-------------|---------------------|
| 1 | iframe created with `allow` attribute | **Critical:** `publickey-credentials-*` needed for WebAuthn |
| 3-5 | Origin validated, CSP headers set | `frame-ancestors` restricts who can embed |
| 9 | Cross-site cookie in iframe | Third-party cookies must be enabled |
| 12 | Passkey in iframe | Both `allow` attribute AND `Permissions-Policy` header required |

---

## Redirect Flow - Complete Sequence

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ REDIRECT FLOW: Full OAuth 2.0 Authorization Code Flow with PKCE                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────┐
│ User     │    │ Merchant │    │  WSIM Auth   │    │WSIM Backend │    │   BSIM   │
│ Browser  │    │ Backend  │    │   Server     │    │             │    │          │
└────┬─────┘    └────┬─────┘    └──────┬───────┘    └──────┬──────┘    └────┬─────┘
     │               │                 │                    │                │
     │ 1. Click "Pay with Wallet"      │                    │                │
     │──────────────►│                 │                    │                │
     │               │                 │                    │                │
     │               │ 2. Generate PKCE parameters          │                │
     │               │    state, nonce, code_verifier       │                │
     │               │    Store in session                  │                │
     │               │                 │                    │                │
     │◄──────────────│                 │                    │                │
     │ 3. HTTP 302 Redirect to:        │                    │                │
     │    /authorize?client_id=xxx     │                    │                │
     │    &code_challenge=yyy          │                    │                │
     │    &state=zzz                   │                    │                │
     │    &scope=openid payment:authorize                   │                │
     │               │                 │                    │                │
     │──────────────────────────────────────────────────────────────────────►│
     │ 4. GET /authorize               │                    │                │
     │               │                 │                    │                │
     │◄──────────────────────────────────────────────────────────────────────│
     │ 5. Login page (if not authenticated)                 │                │
     │               │                 │                    │                │
     │═══════════════════════════════════════════════════════════════════════│
     │ 6. User authenticates (passkey) │                    │                │
     │═══════════════════════════════════════════════════════════════════════│
     │               │                 │                    │                │
     │◄──────────────────────────────────────────────────────────────────────│
     │ 7. Card picker page             │                    │                │
     │               │                 │                    │                │
     │═══════════════════════════════════════════════════════════════════════│
     │ 8. User selects card, confirms with passkey          │                │
     │═══════════════════════════════════════════════════════════════════════│
     │               │                 │                    │                │
     │               │                 │───────────────────►│                │
     │               │                 │ 9. Request card    │                │
     │               │                 │    token           │                │
     │               │                 │                    │───────────────►│
     │               │                 │                    │ 10. GET /api/  │
     │               │                 │                    │     card-token │
     │               │                 │                    │                │
     │               │                 │                    │◄───────────────│
     │               │                 │ 11. cardToken      │                │
     │               │                 │◄───────────────────│                │
     │               │                 │                    │                │
     │               │                 │ 12. Generate       │                │
     │               │                 │     authorization  │                │
     │               │                 │     code           │                │
     │               │                 │                    │                │
     │◄──────────────────────────────────────────────────────────────────────│
     │ 13. HTTP 302 Redirect to:       │                    │                │
     │     /callback?code=xxx&state=zzz│                    │                │
     │               │                 │                    │                │
     │──────────────►│                 │                    │                │
     │ 14. GET /callback?code=xxx      │                    │                │
     │               │                 │                    │                │
     │               │────────────────►│                    │                │
     │               │ 15. POST /token │                    │                │
     │               │     code=xxx    │                    │                │
     │               │     code_verifier=yyy                │                │
     │               │                 │                    │                │
     │               │◄────────────────│                    │                │
     │               │ 16. {           │                    │                │
     │               │   access_token: JWT containing:      │                │
     │               │     - wallet_card_token              │                │
     │               │     - card_token                     │                │
     │               │   id_token: user identity            │                │
     │               │ }               │                    │                │
     │               │                 │                    │                │
     │               │═══════════════════════════════════════════════════════│
     │               │ 17. Merchant extracts tokens from JWT, authorizes     │
     │               │     payment with NSIM                │                │
     │               │═══════════════════════════════════════════════════════│
     │               │                 │                    │                │
     │◄──────────────│                 │                    │                │
     │ 18. HTTP 302 Redirect to order confirmation          │                │
     │               │                 │                    │                │
     ▼               ▼                 ▼                    ▼                ▼
```

### Key Points - Redirect Flow

| Step | Description | Security Requirement |
|------|-------------|---------------------|
| 2 | PKCE parameters generated | `code_verifier` stored server-side |
| 3 | State parameter in redirect | CSRF protection - verified on callback |
| 15 | Token exchange | `code_verifier` proves original requester |
| 16 | JWT contains payment tokens | Short-lived (5 min), single-use |

---

# CORS, Cookies, and Security Configuration

Cross-origin requests are fundamental to the Popup and Inline methods. This section explains the security configurations required for each flow.

## Cross-Origin Request Summary

| Method | Cross-Origin? | Cookie Required? | CORS Required? | Special Headers |
|--------|---------------|------------------|----------------|-----------------|
| Popup | Yes (popup → opener) | Yes (cross-site) | No (postMessage) | `SameSite=None` |
| Inline (iframe) | Yes (parent → iframe) | Yes (cross-site) | No (postMessage) | `SameSite=None`, CSP frame-ancestors |
| Redirect | No (same origin after redirect) | Yes (merchant session) | No | - |

---

## Cookie Configuration

### Why SameSite=None is Required (Popup & Inline)

For Popup and Inline flows, the WSIM session cookie must be sent when the popup/iframe makes requests to WSIM Backend. This requires:

1. **`SameSite=None`** - Allows cookies in cross-site contexts
2. **`Secure=true`** - Required when using `SameSite=None` (HTTPS only)
3. **`credentials: 'include'`** - Client must explicitly request cookies

### Cookie Flow - Popup/iframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Cross-Site Cookie Flow (Popup/iframe)                                       │
├─────────────────────────────────────────────────────────────────────────────┤

1. User previously logged into WSIM at wsim.banksim.ca
   ┌───────────────────┐
   │ wsim.banksim.ca   │
   │                   │ Set-Cookie: wsim.sid=abc123;
   │ Login successful  │            SameSite=None;
   │                   │            Secure;
   └───────────────────┘            HttpOnly

2. User visits merchant at ssim.banksim.ca, opens popup/iframe
   ┌───────────────────┐     ┌───────────────────┐
   │ ssim.banksim.ca   │     │ wsim-auth...      │
   │                   │────►│ (popup/iframe)    │
   │ Checkout page     │     │                   │
   └───────────────────┘     └───────────────────┘

3. Popup/iframe fetches cards from WSIM Backend (cross-origin)
   ┌───────────────────┐           ┌───────────────────┐
   │ wsim-auth...      │           │ wsim.banksim.ca   │
   │ (popup/iframe)    │           │                   │
   │                   │  ──────►  │ GET /api/cards    │
   │ fetch(            │           │                   │
   │   wsim.../cards,  │  Cookie:  │                   │
   │   {credentials:   │  wsim.sid │ ✓ Cookie received │
   │    'include'}     │  =abc123  │ ✓ User identified │
   │ )                 │           │                   │
   └───────────────────┘           └───────────────────┘

   Requirements:
   ✓ wsim.sid has SameSite=None; Secure
   ✓ WSIM server allows cross-origin requests
   ✓ Popup/iframe uses credentials: 'include'

└─────────────────────────────────────────────────────────────────────────────┘
```

### WSIM Backend Session Cookie Configuration

**File:** [backend/src/app.ts](../backend/src/app.ts)

```typescript
app.use(session({
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'wsim.sid',
  cookie: {
    secure: true,           // Required for SameSite=None
    httpOnly: true,         // Prevent XSS access to cookie
    maxAge: 24 * 60 * 60 * 1000,  // 24 hours
    sameSite: 'none',       // Allow cross-origin requests
  },
}));

// Required for secure cookies behind reverse proxy
app.set('trust proxy', 1);
```

---

## Origin Validation

### Popup Origin Validation

**File:** [auth-server/src/routes/popup.ts](../auth-server/src/routes/popup.ts)

```typescript
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return env.ALLOWED_POPUP_ORIGINS.includes(origin);
}

router.get('/card-picker', async (req, res) => {
  const { origin } = req.query;

  if (!isAllowedOrigin(origin as string)) {
    return res.status(403).render('popup/error', {
      message: 'This origin is not authorized to use the wallet popup.',
    });
  }
  // Render card picker...
});
```

**Environment Variable:**
```env
ALLOWED_POPUP_ORIGINS=https://ssim.banksim.ca,https://ssim-dev.banksim.ca
```

### postMessage Security

**Sending (from popup/iframe to merchant):**
```javascript
// WSIM popup validates origin before sending
window.opener.postMessage(
  { type: 'wsim:card-selected', token: '...' },
  validatedMerchantOrigin  // Only sends to pre-validated origin
);
```

**Receiving (merchant page):**
```javascript
window.addEventListener('message', (event) => {
  // CRITICAL: Always verify origin
  if (event.origin !== 'https://wsim-auth.banksim.ca') {
    return; // Ignore messages from unknown origins
  }
  // Process message...
});
```

---

## iframe Security (Inline Method Only)

### CSP frame-ancestors

The iframe method uses Content Security Policy `frame-ancestors` to control which sites can embed the WSIM card picker.

**File:** [auth-server/src/middleware/embed-headers.ts](../auth-server/src/middleware/embed-headers.ts)

```typescript
export function embedSecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  const origin = req.query.origin as string;

  if (origin && env.ALLOWED_EMBED_ORIGINS.includes(origin)) {
    // Allow this specific origin to embed
    res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${origin}`);

    // Permissions Policy for WebAuthn in iframe
    res.setHeader('Permissions-Policy',
      'publickey-credentials-get=(self), publickey-credentials-create=(self)');
  } else {
    // Block embedding from unknown origins
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  }

  next();
}
```

**Environment Variable:**
```env
ALLOWED_EMBED_ORIGINS=https://ssim.banksim.ca,https://ssim-dev.banksim.ca
```

### iframe WebAuthn Requirements

For passkeys to work inside an iframe, **two things are required**:

1. **iframe `allow` attribute** (merchant side):
```html
<iframe
  src="https://wsim-auth.banksim.ca/embed/card-picker?..."
  allow="publickey-credentials-get *; publickey-credentials-create *"
></iframe>
```

2. **Permissions-Policy header** (WSIM server side):
```http
Permissions-Policy: publickey-credentials-get=(self), publickey-credentials-create=(self)
```

Without both, the passkey prompt will not appear in the iframe.

---

## CSRF Protection

### Why Traditional CSRF Tokens Are Not Used

WSIM uses **passkey-based authentication** which provides inherent CSRF protection:

1. **Passkey verification is per-request** - Every payment confirmation requires biometric authentication
2. **Origin binding** - Passkeys are cryptographically bound to the RP ID (domain)
3. **Challenge-response** - Each action uses a unique, single-use challenge

### CSRF Protection by Method

| Method | CSRF Protection Mechanism |
|--------|--------------------------|
| Popup | postMessage target origin validation |
| Inline | postMessage target origin + CSP frame-ancestors |
| Redirect | PKCE `code_verifier` + `state` parameter |

### Redirect Flow CSRF Protection (State Parameter)

```typescript
// Merchant generates state before redirect
const state = generators.state();
req.session.paymentState = { state, ... };

// Merchant verifies state on callback
if (req.query.state !== paymentState.state) {
  return res.redirect('/checkout?error=state_mismatch');
}
```

---

## WebAuthn Origin Configuration

Passkeys are bound to the **Relying Party ID** (RP ID). For WSIM, the RP ID is typically the parent domain to allow passkey usage across subdomains.

**File:** [backend/src/config/env.ts](../backend/src/config/env.ts)

```typescript
WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID || 'banksim.ca',
WEBAUTHN_ORIGINS: process.env.WEBAUTHN_ORIGINS?.split(',') || [
  'https://wsim.banksim.ca',
  'https://wsim-auth.banksim.ca',
],
```

**Environment Variables:**
```env
WEBAUTHN_RP_ID=banksim.ca
WEBAUTHN_ORIGINS=https://wsim.banksim.ca,https://wsim-auth.banksim.ca
```

The RP ID `banksim.ca` allows passkeys registered on `wsim.banksim.ca` to work in popups/iframes served from `wsim-auth.banksim.ca`.

---

# Method 1: Popup Integration

The popup method opens WSIM in a new browser window. The user selects their card and authenticates with a passkey, then the popup sends the payment token back to your page via `postMessage`.

## User Flow

```
1. User clicks "Pay with Wallet" on checkout
2. Popup window opens showing WSIM card picker
3. User selects card and confirms with passkey (biometric)
4. Popup sends token to parent page via postMessage
5. Popup closes automatically
6. Your page sends token to backend for payment authorization
7. User sees order confirmation
```

## Frontend Implementation

### Step 1: Add Payment Button

```html
<button id="walletPopupBtn" onclick="openWalletPopup()">
  Pay with Wallet (Popup)
</button>
```

### Step 2: Open Popup Window

```javascript
// Configuration
const WSIM_POPUP_URL = 'https://wsim-auth.banksim.ca';

let walletPopup = null;
let popupCheckInterval = null;

function openWalletPopup() {
  // Get payment details from your cart/order
  const orderTotal = 10499; // cents
  const orderId = 'order-' + Date.now();

  // Build popup URL with payment parameters
  const params = new URLSearchParams({
    origin: window.location.origin,        // Required: Your site's origin
    merchantId: 'your-merchant-id',        // Your registered merchant ID
    merchantName: 'Your Store Name',       // Display name in popup
    amount: (orderTotal / 100).toFixed(2), // Amount in dollars
    currency: 'CAD',                       // Currency code
    orderId: orderId,                      // Your order reference
  });

  const popupUrl = `${WSIM_POPUP_URL}/popup/card-picker?${params}`;

  // Calculate centered position
  const width = 420;
  const height = 620;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  // Open popup
  walletPopup = window.open(
    popupUrl,
    'wsim-wallet',
    `width=${width},height=${height},left=${left},top=${top},popup=true,noopener=false`
  );

  if (!walletPopup) {
    alert('Popup was blocked. Please allow popups for this site.');
    return;
  }

  // Set up message listener
  window.addEventListener('message', handleWalletMessage);

  // Monitor for popup closure (user closed without completing)
  popupCheckInterval = setInterval(() => {
    if (walletPopup && walletPopup.closed) {
      clearInterval(popupCheckInterval);
      window.removeEventListener('message', handleWalletMessage);
      console.log('Popup closed by user');
      // Reset button state
    }
  }, 500);
}
```

### Step 3: Handle PostMessage Events

```javascript
function handleWalletMessage(event) {
  // SECURITY: Verify the message origin
  if (!event.origin.startsWith(WSIM_POPUP_URL)) {
    return; // Ignore messages from other origins
  }

  const { type, ...data } = event.data;

  switch (type) {
    case 'wsim:card-selected':
      // Payment confirmed! Process the token
      handlePaymentSuccess(data);
      break;

    case 'wsim:cancelled':
      // User cancelled the payment
      handlePaymentCancelled(data.reason);
      break;

    case 'wsim:error':
      // An error occurred
      handlePaymentError(data.code, data.message);
      break;

    case 'wsim:auth-required':
      // User needs to authenticate first (informational)
      console.log('User authentication required:', data.message);
      break;
  }
}
```

### Step 4: Process Payment Token

```javascript
async function handlePaymentSuccess(data) {
  // Clean up popup resources
  clearInterval(popupCheckInterval);
  window.removeEventListener('message', handleWalletMessage);

  if (walletPopup && !walletPopup.closed) {
    walletPopup.close();
  }

  // Data received from popup:
  // {
  //   cardToken: 'jwt...',      // Token for payment authorization
  //   cardLast4: '4242',        // Last 4 digits for display
  //   cardBrand: 'visa',        // Card brand for display
  //   expiresAt: '2024-12-07T12:05:00Z'  // Token expiry
  // }

  try {
    // Send token to your backend for payment processing
    const response = await fetch('/api/payment/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardToken: data.cardToken,
        cardLast4: data.cardLast4,
        cardBrand: data.cardBrand,
      }),
    });

    const result = await response.json();

    if (result.success) {
      // Redirect to order confirmation
      window.location.href = result.redirectUrl;
    } else {
      showError(result.error);
    }
  } catch (error) {
    console.error('Payment processing error:', error);
    showError('Payment failed. Please try again.');
  }
}

function handlePaymentCancelled(reason) {
  clearInterval(popupCheckInterval);
  window.removeEventListener('message', handleWalletMessage);

  if (walletPopup && !walletPopup.closed) {
    walletPopup.close();
  }

  console.log('Payment cancelled:', reason);
  // Reset button state, show message if needed
}

function handlePaymentError(code, message) {
  clearInterval(popupCheckInterval);
  window.removeEventListener('message', handleWalletMessage);

  if (walletPopup && !walletPopup.closed) {
    walletPopup.close();
  }

  console.error('Payment error:', code, message);
  showError(message || 'An error occurred. Please try again.');
}
```

## Backend Implementation

### Payment Completion Endpoint

```typescript
// POST /api/payment/complete
router.post('/api/payment/complete', async (req, res) => {
  const { cardToken, cardLast4, cardBrand } = req.body;

  if (!cardToken) {
    return res.status(400).json({ error: 'Card token is required' });
  }

  // Get order from session or create one
  const order = await createOrderFromCart(req.session.cart);

  try {
    // Authorize payment with your payment processor (e.g., NSIM)
    const authResult = await authorizePayment({
      merchantId: process.env.MERCHANT_ID,
      amount: order.total,
      currency: order.currency,
      cardToken: cardToken,
      orderId: order.id,
    });

    if (authResult.status === 'authorized') {
      // Update order status
      await updateOrderStatus(order.id, 'authorized', {
        transactionId: authResult.transactionId,
        cardLast4,
        cardBrand,
        paymentMethod: 'wallet',
      });

      // Clear cart
      req.session.cart = [];

      return res.json({
        success: true,
        orderId: order.id,
        redirectUrl: `/order-confirmation/${order.id}`,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: authResult.declineReason || 'Payment declined',
      });
    }
  } catch (error) {
    console.error('Payment authorization error:', error);
    return res.status(500).json({
      success: false,
      error: 'Payment processing failed',
    });
  }
});
```

---

# Method 2: Inline (iframe) Integration

The inline method embeds the WSIM card picker directly in your checkout page using an iframe. This provides the most seamless user experience.

## User Flow

```
1. User clicks "Pay with Wallet" on checkout
2. Card picker appears inline below the button
3. User selects card and confirms with passkey (biometric)
4. iframe sends token to parent page via postMessage
5. Card picker collapses
6. Your page sends token to backend for payment authorization
7. User sees order confirmation
```

## Frontend Implementation

### Step 1: Add Container HTML

```html
<button id="walletInlineBtn" onclick="toggleWalletEmbed()">
  Pay with Wallet (Inline)
</button>

<!-- Hidden container for embedded card picker -->
<div id="walletEmbedContainer" class="hidden">
  <div class="wallet-embed-wrapper">
    <iframe
      id="walletEmbedFrame"
      src=""
      class="wallet-embed-iframe"
      allow="publickey-credentials-get *; publickey-credentials-create *"
    ></iframe>
  </div>
  <button onclick="closeWalletEmbed()">Cancel</button>
</div>

<style>
.hidden { display: none; }
.wallet-embed-wrapper {
  border: 2px solid #8b5cf6;
  border-radius: 12px;
  overflow: hidden;
  margin-top: 16px;
}
.wallet-embed-iframe {
  width: 100%;
  min-height: 300px;
  border: none;
}
</style>
```

### Step 2: Toggle Embed Visibility

```javascript
// Configuration
const WSIM_POPUP_URL = 'https://wsim-auth.banksim.ca';

let embedMessageListenerActive = false;

function toggleWalletEmbed() {
  const container = document.getElementById('walletEmbedContainer');
  const iframe = document.getElementById('walletEmbedFrame');

  // If already visible, close it
  if (!container.classList.contains('hidden')) {
    closeWalletEmbed();
    return;
  }

  // Get payment details
  const orderTotal = 10499; // cents
  const orderId = 'order-' + Date.now();

  // Build embed URL
  const params = new URLSearchParams({
    origin: window.location.origin,        // Required: Your origin
    merchantId: 'your-merchant-id',
    merchantName: 'Your Store Name',
    amount: (orderTotal / 100).toFixed(2),
    currency: 'CAD',
    orderId: orderId,
  });

  const embedUrl = `${WSIM_POPUP_URL}/embed/card-picker?${params}`;

  // Set up message listener (only once)
  if (!embedMessageListenerActive) {
    window.addEventListener('message', handleEmbedMessage);
    embedMessageListenerActive = true;
  }

  // Load the iframe
  iframe.src = embedUrl;
  container.classList.remove('hidden');

  // Scroll into view
  setTimeout(() => {
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

function closeWalletEmbed() {
  const container = document.getElementById('walletEmbedContainer');
  const iframe = document.getElementById('walletEmbedFrame');

  container.classList.add('hidden');
  iframe.src = ''; // Clear iframe

  // Remove listener if no longer needed
  if (embedMessageListenerActive) {
    window.removeEventListener('message', handleEmbedMessage);
    embedMessageListenerActive = false;
  }
}
```

### Step 3: Handle PostMessage Events

```javascript
function handleEmbedMessage(event) {
  // SECURITY: Verify the message origin
  if (!event.origin.startsWith(WSIM_POPUP_URL)) {
    return;
  }

  const { type, ...data } = event.data;

  switch (type) {
    case 'wsim:ready':
      // iframe has loaded and is ready
      console.log('Wallet embed ready');
      break;

    case 'wsim:resize':
      // Dynamically resize iframe to fit content
      const iframe = document.getElementById('walletEmbedFrame');
      if (iframe && data.height) {
        iframe.style.height = data.height + 'px';
      }
      break;

    case 'wsim:card-selected':
      // Payment confirmed
      handleEmbedSuccess(data);
      break;

    case 'wsim:cancelled':
      // User cancelled
      closeWalletEmbed();
      break;

    case 'wsim:error':
      // Error occurred
      handleEmbedError(data.code, data.message);
      break;
  }
}
```

### Step 4: Process Payment Token

```javascript
async function handleEmbedSuccess(data) {
  const container = document.getElementById('walletEmbedContainer');

  // Show loading state
  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Processing payment...</p>
    </div>
  `;

  try {
    // Send token to backend (same endpoint as popup method)
    const response = await fetch('/api/payment/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardToken: data.cardToken,
        cardLast4: data.cardLast4,
        cardBrand: data.cardBrand,
      }),
    });

    const result = await response.json();

    if (result.success) {
      window.location.href = result.redirectUrl;
    } else {
      showError(result.error);
      closeWalletEmbed();
    }
  } catch (error) {
    console.error('Payment processing error:', error);
    showError('Payment failed. Please try again.');
    closeWalletEmbed();
  }
}

function handleEmbedError(code, message) {
  console.error('Embed error:', code, message);
  showError(message || 'An error occurred');
  closeWalletEmbed();
}
```

## Important: iframe Permissions

The iframe **must** have the `allow` attribute for WebAuthn to work:

```html
<iframe
  allow="publickey-credentials-get *; publickey-credentials-create *"
  ...
></iframe>
```

Without this, passkey authentication will fail inside the iframe.

## Backend Implementation

The backend implementation is **identical to the Popup method** - both use the same `/api/payment/complete` endpoint.

---

# Method 3: Redirect Integration

The redirect method uses standard OAuth 2.0 Authorization Code flow with PKCE. The user is redirected to WSIM for authentication and card selection, then redirected back to your site with an authorization code.

## User Flow

```
1. User clicks "Pay with Wallet" on checkout
2. Browser redirects to WSIM authorization page
3. User authenticates and selects card
4. WSIM redirects back to your callback URL with auth code
5. Your backend exchanges code for tokens (includes payment token)
6. Backend authorizes payment with NSIM
7. User sees order confirmation
```

## Frontend Implementation

### Step 1: Add Payment Button

```html
<button id="walletRedirectBtn" onclick="initiateWalletPayment()">
  Pay with Wallet (Redirect)
</button>
```

### Step 2: Initiate Payment

```javascript
async function initiateWalletPayment() {
  const button = document.getElementById('walletRedirectBtn');
  button.disabled = true;
  button.textContent = 'Redirecting...';

  try {
    // Call backend to create order and get auth URL
    const response = await fetch('/api/payment/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'wallet',  // Specify wallet payment
      }),
    });

    const data = await response.json();

    if (response.ok && data.redirectUrl) {
      // Redirect to WSIM
      window.location.href = data.redirectUrl;
    } else {
      throw new Error(data.error || 'Failed to initiate payment');
    }
  } catch (error) {
    console.error('Payment initiation error:', error);
    showError(error.message);
    button.disabled = false;
    button.textContent = 'Pay with Wallet';
  }
}
```

## Backend Implementation

### Step 1: Install Dependencies

```bash
npm install openid-client
```

### Step 2: Initialize OIDC Client

```typescript
import { Issuer, Client, generators } from 'openid-client';

let wsimClient: Client | null = null;

async function getWsimClient(): Promise<Client> {
  if (!wsimClient) {
    // Discover WSIM OIDC configuration
    const issuer = await Issuer.discover(process.env.WSIM_AUTH_URL);

    wsimClient = new issuer.Client({
      client_id: process.env.WSIM_CLIENT_ID,
      client_secret: process.env.WSIM_CLIENT_SECRET,
      redirect_uris: [`${process.env.APP_URL}/api/payment/wallet-callback`],
      response_types: ['code'],
    });
  }
  return wsimClient;
}
```

### Step 3: Payment Initiation Endpoint

```typescript
// POST /api/payment/initiate
router.post('/api/payment/initiate', async (req, res) => {
  const { provider } = req.body;

  if (provider !== 'wallet') {
    return res.status(400).json({ error: 'Invalid provider' });
  }

  // Create order from cart
  const order = await createOrderFromCart(req.session.cart);

  try {
    // Generate PKCE parameters
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    // Store in session for callback verification
    req.session.paymentState = {
      orderId: order.id,
      state,
      nonce,
      codeVerifier,
      provider: 'wallet',
    };

    // Get WSIM client
    const client = await getWsimClient();

    // Build authorization URL
    const authUrl = client.authorizationUrl({
      scope: 'openid payment:authorize',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      resource: 'urn:wsim:payment-api',
      claims: JSON.stringify({
        payment: {
          amount: (order.total / 100).toFixed(2),
          currency: order.currency,
          merchantId: process.env.MERCHANT_ID,
          orderId: order.id,
        },
      }),
    });

    // Save session and return URL
    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ error: 'Session error' });
      }
      res.json({ redirectUrl: authUrl, orderId: order.id });
    });

  } catch (error) {
    console.error('Payment initiation error:', error);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});
```

### Step 4: OAuth Callback Endpoint

```typescript
// GET /api/payment/wallet-callback
router.get('/api/payment/wallet-callback', async (req, res) => {
  const paymentState = req.session.paymentState;

  // Verify session state exists
  if (!paymentState || paymentState.provider !== 'wallet') {
    return res.redirect('/checkout?error=invalid_state');
  }

  const { orderId, state, nonce, codeVerifier } = paymentState;

  // Verify state parameter (CSRF protection)
  if (req.query.state !== state) {
    return res.redirect('/checkout?error=state_mismatch');
  }

  // Check for authorization errors
  if (req.query.error) {
    console.error('WSIM auth error:', req.query.error);
    return res.redirect(`/checkout?error=${req.query.error}`);
  }

  try {
    const client = await getWsimClient();

    // Exchange authorization code for tokens
    const params = client.callbackParams(req);
    const redirectUri = `${process.env.APP_URL}/api/payment/wallet-callback`;

    const tokenSet = await client.callback(redirectUri, params, {
      state,
      nonce,
      code_verifier: codeVerifier,
    }, {
      exchangeBody: {
        resource: 'urn:wsim:payment-api',
      },
    });

    // Extract tokens from JWT access token
    const accessToken = tokenSet.access_token;
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64').toString()
    );

    // IMPORTANT: Token names use underscores
    const walletCardToken = payload.wallet_card_token;  // For NSIM routing
    const cardToken = payload.card_token;                // For authorization

    if (!walletCardToken || !cardToken) {
      throw new Error('Missing payment tokens in response');
    }

    // Get order
    const order = await getOrder(orderId);

    // Optional: Extract user identity from ID token
    if (!req.session.user && tokenSet.id_token) {
      const claims = tokenSet.claims();
      req.session.user = {
        id: claims.sub,
        email: claims.email,
        name: claims.name,
      };
    }

    // Authorize payment with NSIM
    const authResult = await authorizePayment({
      merchantId: process.env.MERCHANT_ID,
      amount: order.total,
      currency: order.currency,
      cardToken,
      walletCardToken,  // Include for routing
      orderId: order.id,
    });

    // Clear payment state
    delete req.session.paymentState;

    if (authResult.status === 'authorized') {
      await updateOrderStatus(order.id, 'authorized', {
        transactionId: authResult.transactionId,
        paymentMethod: 'wallet',
      });

      req.session.cart = [];
      req.session.save();

      return res.redirect(`/order-confirmation/${order.id}`);
    } else {
      return res.redirect(
        `/checkout?error=payment_declined&reason=${encodeURIComponent(authResult.declineReason)}`
      );
    }

  } catch (error) {
    console.error('Callback error:', error);
    return res.redirect(
      `/checkout?error=payment_error&reason=${encodeURIComponent(error.message)}`
    );
  }
});
```

---

# PostMessage Protocol Reference

All Popup and Inline methods use the same postMessage protocol.

## Messages from WSIM to Merchant

### Card Selected (Payment Approved)

```javascript
{
  type: 'wsim:card-selected',
  cardToken: 'eyJhbG...',           // JWT token for payment
  cardLast4: '4242',                // Last 4 digits
  cardBrand: 'visa',                // Brand (visa, mastercard, etc.)
  expiresAt: '2024-12-07T12:05:00Z' // Token expiry (5 minutes)
}
```

### Cancelled

```javascript
{
  type: 'wsim:cancelled',
  reason: 'user_cancelled' | 'timeout' | 'error'
}
```

### Error

```javascript
{
  type: 'wsim:error',
  code: 'passkey_failed' | 'token_error' | 'origin_invalid' | ...,
  message: 'Human-readable error description'
}
```

### Auth Required (Informational)

```javascript
{
  type: 'wsim:auth-required',
  message: 'Please sign in to continue'
}
```

### Ready (iframe only)

```javascript
{
  type: 'wsim:ready'
}
```

### Resize (iframe only)

```javascript
{
  type: 'wsim:resize',
  height: 450  // pixels
}
```

---

# Security Considerations

## Origin Validation

**Always validate the message origin** before processing postMessage events:

```javascript
function handleMessage(event) {
  // Verify origin matches WSIM
  if (!event.origin.startsWith('https://wsim-auth.banksim.ca')) {
    return; // Ignore
  }
  // Process message...
}
```

## Token Handling

- **Never store tokens** - Use immediately for payment authorization
- **Tokens expire in 5 minutes** - Process promptly
- **Token is single-use** - Cannot be reused for multiple payments

## HTTPS Required

All methods require HTTPS because:
- `SameSite=None` cookies require `Secure` flag
- WebAuthn (passkeys) requires secure context
- postMessage validation depends on secure origins

## iframe Security

For inline method, the WSIM embed URL includes your origin for validation:

```
/embed/card-picker?origin=https://your-site.com&...
```

WSIM validates this against `ALLOWED_EMBED_ORIGINS` and sets appropriate CSP headers.

---

# Troubleshooting

## Popup Blocked

**Symptom:** Popup doesn't open, `window.open()` returns null

**Solution:**
- Ensure popup is triggered by user interaction (click event)
- Prompt user to allow popups for your site
- Provide fallback to Redirect method

```javascript
const popup = window.open(...);
if (!popup) {
  alert('Please allow popups or use another payment method');
  // Fall back to redirect
  initiateWalletPayment();
}
```

## iframe Passkey Not Working

**Symptom:** Passkey prompt doesn't appear in iframe

**Solution:** Add the `allow` attribute:

```html
<iframe allow="publickey-credentials-get *; publickey-credentials-create *" ...>
```

## postMessage Not Received

**Symptom:** No messages received from popup/iframe

**Checklist:**
1. Message listener added before opening popup/iframe
2. Origin validation isn't too strict
3. WSIM `ALLOWED_POPUP_ORIGINS` or `ALLOWED_EMBED_ORIGINS` includes your origin

## Session/Cookie Issues

**Symptom:** User appears unauthenticated in popup/iframe

**Cause:** Cross-site cookies blocked

**Solution:** WSIM cookies use `SameSite=None; Secure`. If third-party cookies are blocked in the browser, users may need to authenticate each time.

## Redirect Callback Errors

**Symptom:** `state_mismatch` or `invalid_state` error

**Cause:** Session lost between redirect and callback

**Checklist:**
1. Session middleware configured correctly
2. Session saved before redirect (`req.session.save()`)
3. Cookie settings allow persistence
4. Not using incognito/private mode

---

# Environment Variables Summary

| Variable | Required For | Description |
|----------|--------------|-------------|
| `WSIM_ENABLED` | All | Enable WSIM integration (`true`) |
| `WSIM_AUTH_URL` | Redirect | WSIM OIDC issuer URL |
| `WSIM_CLIENT_ID` | Redirect | Your OAuth client ID |
| `WSIM_CLIENT_SECRET` | Redirect | Your OAuth client secret |
| `WSIM_POPUP_URL` | Popup, Inline | WSIM auth server URL |
| `MERCHANT_ID` | All | Your registered merchant ID |
| `APP_URL` | Redirect | Your application's base URL |

---

# Complete Example: Checkout Page

See the SSIM implementation for a complete working example:
- **Frontend:** `/Users/jcrombie/ai/ssim/src/views/checkout.ejs`
- **Backend:** `/Users/jcrombie/ai/ssim/src/routes/payment.ts`

---

*Document created: 2024-12-07*
