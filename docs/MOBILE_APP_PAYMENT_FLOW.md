# Mobile App Payment Approval Flow

> **Purpose:** Design document for mobile wallet app (mwsim) payment approval integration with merchant stores (ssim).
>
> **Audience:** Developers on wsim, mwsim, and ssim teams implementing mobile payment flows.
>
> **Status:** Design Draft - Awaiting Team Review

---

## Overview

This document describes three integration options for allowing users to approve payments using the mwsim mobile wallet app when shopping on merchant websites. All three options should eventually be supported, with Option 3 (Web-to-App Bridge with Fallback) implemented first.

### Goals

1. **Seamless mobile payment** - User can approve payments in the native mwsim app
2. **Graceful fallback** - If app not installed, fall back to existing web flows (popup/inline)
3. **Cross-platform support** - Works on iOS, Android, and desktop browsers
4. **No disruption** - Existing web payment flows (popup, inline, redirect, Quick Pay) remain unchanged

### Integration Options Summary

| Option | Description | Implementation Priority | Best For |
|--------|-------------|------------------------|----------|
| **Option 1** | Universal Links / App Links | Later | Deep OS integration |
| **Option 2** | QR Code + Push Notification | Later | Desktop-to-mobile |
| **Option 3** | Web-to-App Bridge with Fallback | **First** | Mobile web browsers |

---

## Sequence Diagram: Complete Mobile Payment Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ MOBILE APP PAYMENT FLOW: User Approves Payment in mwsim App                              │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────┐    ┌──────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐
│ Merchant │    │  mwsim   │    │   WSIM      │    │WSIM Backend │    │   BSIM   │
│  Page    │    │   App    │    │   Auth      │    │             │    │          │
└────┬─────┘    └────┬─────┘    └──────┬──────┘    └──────┬──────┘    └────┬─────┘
     │               │                 │                   │                │
     │ 1. User clicks "Pay with Mobile Wallet"            │                │
     │──────────────────────────────────────────────────────────────────────│
     │               │                 │                   │                │
     │ 2. POST /api/mobile/payment/request                │                │
     │    { amount, currency, merchantId, returnUrl }     │                │
     │─────────────────────────────────────────────────────►                │
     │               │                 │                   │                │
     │ 3. { requestId, deepLinkUrl, expiresAt }           │                │
     │◄─────────────────────────────────────────────────────                │
     │               │                 │                   │                │
     │═══════════════════════════════════════════════════════════════════════│
     │ 4. Attempt to open mwsim://payment/{requestId}     │                │
     │═══════════════════════════════════════════════════════════════════════│
     │               │                 │                   │                │
     │───────────────►                 │                   │                │
     │ 5. Deep link opens app (if installed)              │                │
     │               │                 │                   │                │
     │               │ 6. GET /api/mobile/payment/{requestId}              │
     │               │    Authorization: Bearer {accessToken}              │
     │               │─────────────────────────────────────►                │
     │               │                 │                   │                │
     │               │ 7. { amount, currency, merchant, cards }            │
     │               │◄─────────────────────────────────────                │
     │               │                 │                   │                │
     │               │═══════════════════════════════════════════════════════│
     │               │ 8. User selects card, confirms with biometric       │
     │               │═══════════════════════════════════════════════════════│
     │               │                 │                   │                │
     │               │ 9. POST /api/mobile/payment/{requestId}/approve     │
     │               │    { cardId, biometricSignature }   │                │
     │               │─────────────────────────────────────►                │
     │               │                 │                   │                │
     │               │                 │                   │───────────────►│
     │               │                 │                   │ 10. Request    │
     │               │                 │                   │     card token │
     │               │                 │                   │                │
     │               │                 │                   │◄───────────────│
     │               │                 │                   │ 11. cardToken  │
     │               │                 │                   │                │
     │               │ 12. { approved, cardToken, walletCardToken }        │
     │               │◄─────────────────────────────────────                │
     │               │                 │                   │                │
     │               │ 13. Open returnUrl?paymentToken=xxx │                │
     │               │─────────────────────────────────────────────────────►│
     │               │                 │                   │                │
     │◄──────────────────────────────────────────────────────────────────────│
     │ 14. Browser returns with paymentToken              │                │
     │               │                 │                   │                │
     │ 15. Complete payment via backend                   │                │
     │───────────────────────────────────────────────────────────────────────►
     │               │                 │                   │                │
     ▼               ▼                 ▼                   ▼                ▼
```

---

# Option 1: Universal Links / App Links

**Implementation Priority:** Later

Universal Links (iOS) and App Links (Android) allow the operating system to intercept specific URLs and open them directly in the native app instead of a browser.

## How It Works

1. Merchant website includes a "Pay with Wallet" button that links to a WSIM URL
2. If mwsim is installed, the OS opens the app directly
3. If not installed, the URL opens in the browser (fallback to web flow)

## Configuration Required

### iOS (Universal Links)

**File:** `wsim.banksim.ca/.well-known/apple-app-site-association`

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAMID.com.banksim.mwsim",
        "paths": [
          "/app/payment/*",
          "/app/approve/*"
        ]
      }
    ]
  }
}
```

### Android (App Links)

**File:** `wsim.banksim.ca/.well-known/assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.banksim.mwsim",
      "sha256_cert_fingerprints": ["SHA256_FINGERPRINT"]
    }
  }
]
```

## Flow Sequence

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Option 1: Universal Links / App Links Flow                                   │
├─────────────────────────────────────────────────────────────────────────────┤

User on Mobile Browser
         │
         │ 1. Clicks "Pay with Wallet"
         │    href="https://wsim.banksim.ca/app/payment/{requestId}"
         ▼
    ┌─────────────────────────────────────────┐
    │ Is mwsim app installed?                  │
    └─────────────────────────────────────────┘
         │                          │
         │ YES                      │ NO
         ▼                          ▼
    ┌─────────┐              ┌──────────────┐
    │ OS opens│              │ Browser opens│
    │ mwsim   │              │ WSIM web page│
    │ app     │              │ (fallback)   │
    └────┬────┘              └──────┬───────┘
         │                          │
         ▼                          ▼
    Payment approval           Web payment flow
    in native app              (popup/inline)

└─────────────────────────────────────────────────────────────────────────────┘
```

## WSIM Endpoint for Universal Link Fallback

```typescript
// GET /app/payment/:requestId
// This page renders if app is NOT installed (browser fallback)
router.get('/app/payment/:requestId', async (req, res) => {
  const { requestId } = req.params;

  // Verify payment request exists
  const paymentRequest = await getPaymentRequest(requestId);
  if (!paymentRequest) {
    return res.redirect('/error?code=invalid_request');
  }

  // Render web fallback - redirect to popup/inline flow
  res.render('app-payment-fallback', {
    requestId,
    amount: paymentRequest.amount,
    merchantName: paymentRequest.merchantName,
    // Show "Continue in browser" option
  });
});
```

## Pros and Cons

| Pros | Cons |
|------|------|
| Native OS support | Requires app store approval for domain association |
| Seamless when app is installed | Configuration must be on production domain |
| Automatic fallback to browser | Testing is complex (requires signed builds) |
| Works with regular `<a>` links | iOS Safari has specific behavior quirks |

---

# Option 2: QR Code + Push Notification

**Implementation Priority:** Later (after Option 3)

This option is ideal for **desktop checkout** where the user wants to approve on their phone.

## How It Works

1. Desktop merchant page shows a QR code
2. User scans QR code with mwsim app (or phone camera)
3. mwsim opens to payment approval screen
4. User approves with biometric
5. Desktop page polls for completion OR receives push notification

## Flow Sequence

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Option 2: QR Code + Push Notification Flow                                   │
├─────────────────────────────────────────────────────────────────────────────┤

Desktop Browser                                    Mobile Phone (mwsim)
      │                                                    │
      │ 1. User clicks "Pay with Mobile Wallet"           │
      │    on desktop                                      │
      │                                                    │
      │ 2. POST /api/payment/request                      │
      │────────────────────────►                          │
      │                                                    │
      │ 3. { requestId, qrCodeData }                      │
      │◄────────────────────────                          │
      │                                                    │
      │ 4. Display QR code                                │
      │    ┌─────────────┐                                │
      │    │ ▄▄▄ ▄▄▄ ▄▄▄│                                │
      │    │ █▀█ █▀█ █▀█│  "Scan with                    │
      │    │ ▄▀▄ ▄▀▄ ▄▀▄│   mwsim app"                   │
      │    └─────────────┘                                │
      │                                                    │
      │ 5. Start polling:                                 │
      │    GET /api/payment/{requestId}/status            │
      │    every 2 seconds                                │
      │                                                    │
      │                                    6. User scans QR
      │                                    ───────────────►
      │                                                    │
      │                                    7. mwsim opens with
      │                                       payment details
      │                                                    │
      │                                    8. User confirms
      │                                       with biometric
      │                                                    │
      │                                    9. POST /approve
      │                                    ───────────────►
      │                                                    │
      │ 10. Poll returns:                                 │
      │     { status: "approved", paymentToken }          │
      │◄────────────────────────                          │
      │                                                    │
      │ 11. Complete payment                              │
      │────────────────────────►                          │

└─────────────────────────────────────────────────────────────────────────────┘
```

## QR Code Data Format

```javascript
// QR code contains a deep link URL:
const qrData = `mwsim://payment/${requestId}`;

// Or for Universal Link fallback:
const qrData = `https://wsim.banksim.ca/app/payment/${requestId}`;
```

## Polling Endpoint

```typescript
// GET /api/merchant/payment/:requestId/status
router.get('/payment/:requestId/status', requireMerchantApiKey, async (req, res) => {
  const { requestId } = req.params;

  const paymentRequest = await prisma.paymentRequest.findUnique({
    where: { id: requestId },
  });

  if (!paymentRequest) {
    return res.status(404).json({ error: 'not_found' });
  }

  if (paymentRequest.status === 'approved') {
    return res.json({
      status: 'approved',
      paymentToken: paymentRequest.paymentToken,
      cardToken: paymentRequest.cardToken,
      walletCardToken: paymentRequest.walletCardToken,
      cardLast4: paymentRequest.cardLast4,
      cardBrand: paymentRequest.cardBrand,
    });
  }

  if (paymentRequest.status === 'cancelled' || paymentRequest.status === 'expired') {
    return res.json({
      status: paymentRequest.status,
      reason: paymentRequest.cancelReason,
    });
  }

  // Still pending
  return res.json({
    status: 'pending',
    expiresAt: paymentRequest.expiresAt,
  });
});
```

## Optional: Push Notification

Instead of polling, the desktop page can register for WebSocket updates:

```typescript
// WebSocket connection for real-time status updates
// Alternative to polling

// Client-side
const ws = new WebSocket(`wss://wsim.banksim.ca/ws/payment/${requestId}`);
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.status === 'approved') {
    completePayment(data.paymentToken);
  }
};
```

## Pros and Cons

| Pros | Cons |
|------|------|
| Works on any desktop browser | Requires camera for QR scanning |
| No app installation detection needed | Extra step (scanning) |
| Clear user intent | Desktop must poll or maintain WebSocket |
| Secure - payment confirmed on user's device | User must have phone nearby |

---

# Option 3: Web-to-App Bridge with Fallback

**Implementation Priority:** FIRST

This is the recommended starting point. It works well for mobile web browsers and gracefully falls back to existing flows.

## How It Works

1. Merchant page attempts to open mwsim via deep link (`mwsim://`)
2. Set a short timeout (e.g., 2 seconds)
3. If app doesn't respond (not installed), timeout fires → fall back to popup/inline flow
4. If app opens, user approves payment in app
5. App redirects back to merchant page with payment token

## Detection Strategy

```javascript
function attemptMobileAppPayment(requestId, fallbackFn) {
  const deepLinkUrl = `mwsim://payment/${requestId}`;
  const startTime = Date.now();

  // Set fallback timeout
  const fallbackTimeout = setTimeout(() => {
    // App didn't open (not installed or blocked)
    console.log('App not detected, falling back to web flow');
    fallbackFn();
  }, 2000);  // 2 second timeout

  // Listen for page visibility change (app opening causes this)
  const handleVisibilityChange = () => {
    if (document.hidden) {
      // Page became hidden - app likely opened
      clearTimeout(fallbackTimeout);
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Attempt to open the app
  window.location.href = deepLinkUrl;

  // Clean up listener after timeout
  setTimeout(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, 3000);
}
```

## Complete Flow Sequence

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Option 3: Web-to-App Bridge with Fallback                                    │
├─────────────────────────────────────────────────────────────────────────────┤

Mobile Browser                   mwsim App                  WSIM Backend
      │                              │                           │
      │ 1. User clicks "Pay with Mobile Wallet"                 │
      │                              │                           │
      │ 2. POST /api/mobile/payment/request                     │
      │─────────────────────────────────────────────────────────►
      │                              │                           │
      │ 3. { requestId, deepLinkUrl, expiresAt }                │
      │◄─────────────────────────────────────────────────────────
      │                              │                           │
      │ 4. Set 2-second fallback timeout                        │
      │                              │                           │
      │ 5. window.location = "mwsim://payment/{requestId}"      │
      │                              │                           │
      │                   ┌──────────┴──────────┐                │
      │                   │                     │                │
      │           APP INSTALLED           NOT INSTALLED          │
      │                   │                     │                │
      │                   ▼                     ▼                │
      │              ┌─────────┐         ┌───────────┐           │
      │              │ App     │         │ Timeout   │           │
      │              │ opens   │         │ fires     │           │
      │              └────┬────┘         └─────┬─────┘           │
      │                   │                    │                 │
      │                   │               Fall back to           │
      │                   │               popup/inline           │
      │                   │               flow                   │
      │                   │                    │                 │
      │                   ▼                    ▼                 │
      │              Payment approval    Existing web            │
      │              in native app       payment flow            │
      │                   │                                      │
      │                   │ 6. GET /api/mobile/payment/{requestId}
      │                   │─────────────────────────────────────►
      │                   │                                      │
      │                   │ 7. { amount, merchant, cards, ... }  │
      │                   │◄─────────────────────────────────────
      │                   │                                      │
      │                   │ 8. User selects card, biometric      │
      │                   │                                      │
      │                   │ 9. POST /api/mobile/payment/{requestId}/approve
      │                   │─────────────────────────────────────►
      │                   │                                      │
      │                   │ 10. { approved, paymentToken, ... }  │
      │                   │◄─────────────────────────────────────
      │                   │                                      │
      │ 11. App opens returnUrl with paymentToken               │
      │◄──────────────────┘                                      │
      │                                                          │
      │ 12. Browser receives token, completes payment           │
      │─────────────────────────────────────────────────────────►
      │                                                          │
      ▼                                                          ▼

└─────────────────────────────────────────────────────────────────────────────┘
```

## Pros and Cons

| Pros | Cons |
|------|------|
| Simple implementation | Timeout detection is imperfect |
| No OS configuration needed | Some browsers block deep links |
| Graceful fallback | iOS Safari can show "Open in app?" dialog |
| Works today | User must return to browser after app approval |

---

# WSIM API Endpoints (New)

These endpoints are added to WSIM Backend to support mobile app payment approval.

## Data Model

```prisma
// Add to prisma/schema.prisma

model PaymentRequest {
  id              String   @id @default(cuid())
  merchantId      String   // OAuth client_id
  merchantName    String
  amount          Decimal  @db.Decimal(10, 2)
  currency        String   @default("CAD")
  orderId         String?  // Merchant's order reference
  returnUrl       String   // URL to return to after approval

  status          String   @default("pending") // pending, approved, cancelled, expired
  cancelReason    String?

  // Populated on approval
  userId          String?
  cardId          String?
  paymentToken    String?  @unique // One-time token for merchant to complete payment
  cardToken       String?  // BSIM card token
  walletCardToken String?  // Wallet card token for routing
  cardLast4       String?
  cardBrand       String?

  createdAt       DateTime @default(now())
  expiresAt       DateTime
  approvedAt      DateTime?

  @@index([merchantId])
  @@index([status])
  @@index([paymentToken])
}
```

## Merchant API Endpoints

### Create Payment Request

Used by merchant to create a payment request that can be approved in the mobile app.

```typescript
// POST /api/merchant/payment/request
// Auth: X-API-Key header

interface CreatePaymentRequestBody {
  amount: string;        // e.g., "104.99"
  currency?: string;     // default: "CAD"
  orderId?: string;      // merchant's order reference
  returnUrl: string;     // URL to redirect after approval
  merchantName?: string; // display name (optional, uses OAuth client name)
}

interface CreatePaymentRequestResponse {
  requestId: string;
  deepLinkUrl: string;   // mwsim://payment/{requestId}
  universalLinkUrl: string; // https://wsim.banksim.ca/app/payment/{requestId}
  qrCodeData: string;    // URL to encode in QR code
  expiresAt: string;     // ISO timestamp (5 minutes from now)
  pollUrl: string;       // URL to poll for status
}

router.post('/payment/request', requireMerchantApiKey, async (req, res) => {
  const { amount, currency = 'CAD', orderId, returnUrl, merchantName } = req.body;

  if (!amount || !returnUrl) {
    return res.status(400).json({ error: 'amount and returnUrl are required' });
  }

  // Validate returnUrl is allowed for this merchant
  const merchant = req.merchant; // Set by requireMerchantApiKey middleware
  if (!isValidReturnUrl(returnUrl, merchant.allowedRedirectUris)) {
    return res.status(400).json({ error: 'Invalid returnUrl' });
  }

  const paymentRequest = await prisma.paymentRequest.create({
    data: {
      merchantId: merchant.clientId,
      merchantName: merchantName || merchant.name,
      amount: new Prisma.Decimal(amount),
      currency,
      orderId,
      returnUrl,
      status: 'pending',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    },
  });

  res.json({
    requestId: paymentRequest.id,
    deepLinkUrl: `mwsim://payment/${paymentRequest.id}`,
    universalLinkUrl: `${env.WSIM_URL}/app/payment/${paymentRequest.id}`,
    qrCodeData: `mwsim://payment/${paymentRequest.id}`,
    expiresAt: paymentRequest.expiresAt.toISOString(),
    pollUrl: `${env.WSIM_API_URL}/merchant/payment/${paymentRequest.id}/status`,
  });
});
```

### Poll Payment Status

Used by merchant to check if payment has been approved.

```typescript
// GET /api/merchant/payment/:requestId/status
// Auth: X-API-Key header

interface PaymentStatusResponse {
  status: 'pending' | 'approved' | 'cancelled' | 'expired';
  expiresAt?: string;       // Only for pending
  paymentToken?: string;    // Only for approved
  cardToken?: string;       // Only for approved
  walletCardToken?: string; // Only for approved
  cardLast4?: string;       // Only for approved
  cardBrand?: string;       // Only for approved
  reason?: string;          // Only for cancelled
}

router.get('/payment/:requestId/status', requireMerchantApiKey, async (req, res) => {
  const { requestId } = req.params;

  const paymentRequest = await prisma.paymentRequest.findFirst({
    where: {
      id: requestId,
      merchantId: req.merchant.clientId,
    },
  });

  if (!paymentRequest) {
    return res.status(404).json({ error: 'not_found' });
  }

  // Check expiration
  if (paymentRequest.status === 'pending' && paymentRequest.expiresAt < new Date()) {
    await prisma.paymentRequest.update({
      where: { id: requestId },
      data: { status: 'expired' },
    });
    return res.json({ status: 'expired' });
  }

  if (paymentRequest.status === 'approved') {
    return res.json({
      status: 'approved',
      paymentToken: paymentRequest.paymentToken,
      cardToken: paymentRequest.cardToken,
      walletCardToken: paymentRequest.walletCardToken,
      cardLast4: paymentRequest.cardLast4,
      cardBrand: paymentRequest.cardBrand,
    });
  }

  if (paymentRequest.status === 'cancelled') {
    return res.json({
      status: 'cancelled',
      reason: paymentRequest.cancelReason,
    });
  }

  return res.json({
    status: 'pending',
    expiresAt: paymentRequest.expiresAt.toISOString(),
  });
});
```

## Mobile API Endpoints

### Get Payment Request Details

Used by mwsim app when opened via deep link.

```typescript
// GET /api/mobile/payment/:requestId
// Auth: Bearer {mobileAccessToken}

interface PaymentRequestDetailsResponse {
  requestId: string;
  merchantName: string;
  amount: string;
  currency: string;
  orderId?: string;
  expiresAt: string;
  cards: Array<{
    id: string;
    lastFour: string;
    cardType: string;
    bankName: string;
    isDefault: boolean;
  }>;
}

router.get('/payment/:requestId', requireMobileAuth, async (req, res) => {
  const { requestId } = req.params;
  const userId = req.user.id;

  const paymentRequest = await prisma.paymentRequest.findUnique({
    where: { id: requestId },
  });

  if (!paymentRequest) {
    return res.status(404).json({ error: 'not_found' });
  }

  if (paymentRequest.status !== 'pending') {
    return res.status(400).json({
      error: 'invalid_status',
      message: `Payment request is ${paymentRequest.status}`,
    });
  }

  if (paymentRequest.expiresAt < new Date()) {
    return res.status(400).json({ error: 'expired' });
  }

  // Get user's cards
  const cards = await prisma.walletCard.findMany({
    where: {
      userId,
      isActive: true,
    },
    select: {
      id: true,
      lastFour: true,
      cardType: true,
      cardholderName: true,
      isDefault: true,
      enrollment: {
        select: {
          bsimName: true,
        },
      },
    },
    orderBy: [
      { isDefault: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  res.json({
    requestId: paymentRequest.id,
    merchantName: paymentRequest.merchantName,
    amount: paymentRequest.amount.toString(),
    currency: paymentRequest.currency,
    orderId: paymentRequest.orderId,
    expiresAt: paymentRequest.expiresAt.toISOString(),
    cards: cards.map(card => ({
      id: card.id,
      lastFour: card.lastFour,
      cardType: card.cardType,
      bankName: card.enrollment?.bsimName || 'Unknown Bank',
      isDefault: card.isDefault,
    })),
  });
});
```

### Approve Payment

Used by mwsim app when user confirms payment with biometric.

```typescript
// POST /api/mobile/payment/:requestId/approve
// Auth: Bearer {mobileAccessToken}

interface ApprovePaymentBody {
  cardId: string;
  // Future: biometricSignature for additional security
}

interface ApprovePaymentResponse {
  approved: boolean;
  paymentToken: string;
  returnUrl: string;  // URL to open in browser
}

router.post('/payment/:requestId/approve', requireMobileAuth, async (req, res) => {
  const { requestId } = req.params;
  const { cardId } = req.body;
  const userId = req.user.id;

  if (!cardId) {
    return res.status(400).json({ error: 'cardId is required' });
  }

  // Verify payment request
  const paymentRequest = await prisma.paymentRequest.findUnique({
    where: { id: requestId },
  });

  if (!paymentRequest) {
    return res.status(404).json({ error: 'not_found' });
  }

  if (paymentRequest.status !== 'pending') {
    return res.status(400).json({ error: 'invalid_status' });
  }

  if (paymentRequest.expiresAt < new Date()) {
    return res.status(400).json({ error: 'expired' });
  }

  // Verify card belongs to user
  const card = await prisma.walletCard.findFirst({
    where: {
      id: cardId,
      userId,
      isActive: true,
    },
    include: {
      enrollment: true,
    },
  });

  if (!card) {
    return res.status(404).json({ error: 'card_not_found' });
  }

  // Request card token from BSIM
  const tokenResult = await requestCardToken({
    walletCardId: card.id,
    merchantId: paymentRequest.merchantId,
    merchantName: paymentRequest.merchantName,
    amount: paymentRequest.amount,
    currency: paymentRequest.currency,
  });

  // Generate one-time payment token for merchant
  const paymentToken = generateSecureToken();

  // Update payment request
  await prisma.paymentRequest.update({
    where: { id: requestId },
    data: {
      status: 'approved',
      userId,
      cardId,
      paymentToken,
      cardToken: tokenResult.cardToken,
      walletCardToken: card.walletCardToken,
      cardLast4: card.lastFour,
      cardBrand: card.cardType,
      approvedAt: new Date(),
    },
  });

  // Build return URL with payment token
  const returnUrl = new URL(paymentRequest.returnUrl);
  returnUrl.searchParams.set('paymentToken', paymentToken);
  returnUrl.searchParams.set('requestId', requestId);

  res.json({
    approved: true,
    paymentToken,
    returnUrl: returnUrl.toString(),
  });
});
```

### Cancel Payment

Used by mwsim app if user cancels.

```typescript
// POST /api/mobile/payment/:requestId/cancel
// Auth: Bearer {mobileAccessToken}

router.post('/payment/:requestId/cancel', requireMobileAuth, async (req, res) => {
  const { requestId } = req.params;
  const { reason } = req.body;

  const paymentRequest = await prisma.paymentRequest.findUnique({
    where: { id: requestId },
  });

  if (!paymentRequest || paymentRequest.status !== 'pending') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  await prisma.paymentRequest.update({
    where: { id: requestId },
    data: {
      status: 'cancelled',
      cancelReason: reason || 'user_cancelled',
    },
  });

  res.json({ cancelled: true });
});
```

### Complete Payment (Merchant Backend)

Used by merchant backend to complete payment using the one-time payment token.

```typescript
// POST /api/merchant/payment/complete
// Auth: X-API-Key header

interface CompletePaymentBody {
  paymentToken: string;
}

interface CompletePaymentResponse {
  success: boolean;
  cardToken: string;
  walletCardToken: string;
  cardLast4: string;
  cardBrand: string;
}

router.post('/payment/complete', requireMerchantApiKey, async (req, res) => {
  const { paymentToken } = req.body;

  if (!paymentToken) {
    return res.status(400).json({ error: 'paymentToken is required' });
  }

  // Find and verify payment request
  const paymentRequest = await prisma.paymentRequest.findFirst({
    where: {
      paymentToken,
      merchantId: req.merchant.clientId,
      status: 'approved',
    },
  });

  if (!paymentRequest) {
    return res.status(404).json({ error: 'invalid_token' });
  }

  // Invalidate the payment token (one-time use)
  await prisma.paymentRequest.update({
    where: { id: paymentRequest.id },
    data: { paymentToken: null },
  });

  res.json({
    success: true,
    cardToken: paymentRequest.cardToken,
    walletCardToken: paymentRequest.walletCardToken,
    cardLast4: paymentRequest.cardLast4,
    cardBrand: paymentRequest.cardBrand,
  });
});
```

---

# mwsim App Changes Required

## Deep Link Handling

Configure Expo to handle the `mwsim://` URL scheme.

### app.json Configuration

```json
{
  "expo": {
    "scheme": "mwsim",
    "ios": {
      "bundleIdentifier": "com.banksim.mwsim",
      "associatedDomains": [
        "applinks:wsim.banksim.ca",
        "applinks:wsim-dev.banksim.ca"
      ]
    },
    "android": {
      "package": "com.banksim.mwsim",
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            {
              "scheme": "mwsim"
            },
            {
              "scheme": "https",
              "host": "wsim.banksim.ca",
              "pathPrefix": "/app"
            }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

### Deep Link Router

```typescript
// src/navigation/linking.ts
import { LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';

export const linking: LinkingOptions<RootParamList> = {
  prefixes: [
    Linking.createURL('/'),
    'mwsim://',
    'https://wsim.banksim.ca/app',
  ],
  config: {
    screens: {
      PaymentApproval: 'payment/:requestId',
      EnrollmentCallback: 'enrollment/callback',
      // ... other screens
    },
  },
};
```

## Payment Approval Screen

New screen for approving payments from merchants.

```typescript
// src/screens/PaymentApprovalScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, Linking } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

interface PaymentDetails {
  requestId: string;
  merchantName: string;
  amount: string;
  currency: string;
  cards: Array<{
    id: string;
    lastFour: string;
    cardType: string;
    bankName: string;
    isDefault: boolean;
  }>;
}

export function PaymentApprovalScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { accessToken } = useAuth();

  const { requestId } = route.params as { requestId: string };

  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<PaymentDetails | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPaymentDetails();
  }, [requestId]);

  async function loadPaymentDetails() {
    try {
      const response = await api.get(`/mobile/payment/${requestId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      setDetails(response.data);

      // Auto-select default card
      const defaultCard = response.data.cards.find(c => c.isDefault);
      if (defaultCard) {
        setSelectedCardId(defaultCard.id);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load payment details');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    if (!selectedCardId) {
      Alert.alert('Error', 'Please select a card');
      return;
    }

    setApproving(true);

    try {
      // Authenticate with biometric
      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: `Approve payment of ${details.currency} ${details.amount} to ${details.merchantName}`,
        fallbackLabel: 'Use passcode',
      });

      if (!authResult.success) {
        setApproving(false);
        return;
      }

      // Approve payment
      const response = await api.post(
        `/mobile/payment/${requestId}/approve`,
        { cardId: selectedCardId },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      // Open return URL in browser to complete payment
      const { returnUrl } = response.data;
      await Linking.openURL(returnUrl);

      // Navigate back to wallet home
      navigation.navigate('Home');

    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to approve payment');
    } finally {
      setApproving(false);
    }
  }

  async function handleCancel() {
    try {
      await api.post(
        `/mobile/payment/${requestId}/cancel`,
        { reason: 'user_cancelled' },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
    } catch (err) {
      // Ignore cancel errors
    }
    navigation.goBack();
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (error) {
    return <ErrorScreen message={error} onDismiss={() => navigation.goBack()} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Payment Request</Text>
        <Text style={styles.merchantName}>{details.merchantName}</Text>
      </View>

      <View style={styles.amountContainer}>
        <Text style={styles.currency}>{details.currency}</Text>
        <Text style={styles.amount}>{details.amount}</Text>
      </View>

      <View style={styles.cardsSection}>
        <Text style={styles.sectionTitle}>Select Card</Text>
        {details.cards.map(card => (
          <TouchableOpacity
            key={card.id}
            style={[
              styles.cardOption,
              selectedCardId === card.id && styles.cardSelected,
            ]}
            onPress={() => setSelectedCardId(card.id)}
          >
            <Text style={styles.cardType}>{card.cardType}</Text>
            <Text style={styles.cardNumber}>•••• {card.lastFour}</Text>
            <Text style={styles.cardBank}>{card.bankName}</Text>
            {card.isDefault && <Text style={styles.defaultBadge}>Default</Text>}
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.approveButton]}
          onPress={handleApprove}
          disabled={approving || !selectedCardId}
        >
          <Text style={styles.buttonText}>
            {approving ? 'Approving...' : 'Approve with Face ID'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.cancelButton]}
          onPress={handleCancel}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
```

---

# SSIM Merchant Integration

## Frontend Changes

Add new payment button and handler for mobile app payment.

```javascript
// Check if user is on mobile device
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

// Mobile payment flow
async function initiateMobilePayment() {
  const statusEl = document.getElementById('paymentStatus');
  statusEl.textContent = 'Creating payment request...';

  try {
    // Create payment request
    const response = await fetch('/api/payment/mobile/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: orderTotal.toFixed(2),
        currency: 'CAD',
      }),
    });

    const data = await response.json();

    // Attempt to open app
    statusEl.textContent = 'Opening wallet app...';

    attemptMobileAppPayment(
      data.requestId,
      data.deepLinkUrl,
      () => {
        // Fallback: app not installed
        console.log('App not detected, falling back to popup');
        statusEl.textContent = '';
        openWalletPopup();  // Existing popup flow
      },
      (pollUrl) => {
        // Success: start polling
        startPolling(pollUrl, data.requestId);
      }
    );

  } catch (error) {
    console.error('Mobile payment error:', error);
    statusEl.textContent = 'Error: ' + error.message;
  }
}

function attemptMobileAppPayment(requestId, deepLinkUrl, fallbackFn, successFn) {
  const pollUrl = `/api/payment/mobile/${requestId}/status`;
  let appOpened = false;

  // Set fallback timeout
  const fallbackTimeout = setTimeout(() => {
    if (!appOpened) {
      fallbackFn();
    }
  }, 2500);

  // Listen for visibility change
  const handleVisibility = () => {
    if (document.hidden) {
      appOpened = true;
      clearTimeout(fallbackTimeout);
      // Start polling when page becomes visible again
      document.addEventListener('visibilitychange', function onVisible() {
        if (!document.hidden) {
          document.removeEventListener('visibilitychange', onVisible);
          successFn(pollUrl);
        }
      });
    }
  };

  document.addEventListener('visibilitychange', handleVisibility, { once: true });

  // Attempt to open the app
  window.location.href = deepLinkUrl;

  // Cleanup
  setTimeout(() => {
    document.removeEventListener('visibilitychange', handleVisibility);
  }, 3000);
}

function startPolling(pollUrl, requestId) {
  const statusEl = document.getElementById('paymentStatus');
  statusEl.textContent = 'Waiting for approval in wallet app...';

  const pollInterval = setInterval(async () => {
    try {
      const response = await fetch(pollUrl);
      const data = await response.json();

      if (data.status === 'approved') {
        clearInterval(pollInterval);
        statusEl.textContent = 'Payment approved! Completing...';
        await completePayment(data.paymentToken);
      } else if (data.status === 'cancelled') {
        clearInterval(pollInterval);
        statusEl.textContent = 'Payment cancelled';
      } else if (data.status === 'expired') {
        clearInterval(pollInterval);
        statusEl.textContent = 'Payment request expired';
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, 2000);

  // Stop polling after 5 minutes
  setTimeout(() => {
    clearInterval(pollInterval);
  }, 5 * 60 * 1000);
}

async function completePayment(paymentToken) {
  const response = await fetch('/api/payment/mobile/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentToken }),
  });

  const result = await response.json();

  if (result.success) {
    window.location.href = result.redirectUrl;
  } else {
    throw new Error(result.error);
  }
}
```

## HTML Button

```html
<!-- Show mobile payment button only on mobile devices -->
<script>
  if (isMobileDevice()) {
    document.getElementById('mobilePaymentSection').style.display = 'block';
  }
</script>

<div id="mobilePaymentSection" style="display: none;">
  <button onclick="initiateMobilePayment()">
    Pay with Mobile Wallet
  </button>
</div>

<!-- Existing buttons remain unchanged -->
<button onclick="openWalletPopup()">Pay with Wallet (Popup)</button>
<button onclick="toggleWalletEmbed()">Pay with Wallet (Inline)</button>
```

## Backend Routes

```typescript
// routes/payment.ts - Add mobile payment routes

// POST /api/payment/mobile/request
router.post('/payment/mobile/request', async (req, res) => {
  const { amount, currency = 'CAD' } = req.body;

  // Create order from cart
  const order = await createOrderFromCart(req.session.cart);

  // Store order ID in session for completion
  req.session.pendingMobilePayment = { orderId: order.id };

  // Call WSIM to create payment request
  const wsimResponse = await fetch(`${env.WSIM_API_URL}/merchant/payment/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': env.WSIM_API_KEY,
    },
    body: JSON.stringify({
      amount,
      currency,
      orderId: order.id,
      returnUrl: `${env.APP_URL}/checkout?payment=mobile`,
      merchantName: 'SSIM Store',
    }),
  });

  const data = await wsimResponse.json();

  res.json({
    requestId: data.requestId,
    deepLinkUrl: data.deepLinkUrl,
  });
});

// GET /api/payment/mobile/:requestId/status
router.get('/payment/mobile/:requestId/status', async (req, res) => {
  const { requestId } = req.params;

  const wsimResponse = await fetch(
    `${env.WSIM_API_URL}/merchant/payment/${requestId}/status`,
    {
      headers: { 'X-API-Key': env.WSIM_API_KEY },
    }
  );

  const data = await wsimResponse.json();
  res.json(data);
});

// POST /api/payment/mobile/complete
router.post('/payment/mobile/complete', async (req, res) => {
  const { paymentToken } = req.body;

  // Get pending order from session
  const { orderId } = req.session.pendingMobilePayment || {};
  if (!orderId) {
    return res.status(400).json({ error: 'No pending payment' });
  }

  // Get tokens from WSIM
  const wsimResponse = await fetch(`${env.WSIM_API_URL}/merchant/payment/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': env.WSIM_API_KEY,
    },
    body: JSON.stringify({ paymentToken }),
  });

  const tokenData = await wsimResponse.json();

  if (!tokenData.success) {
    return res.status(400).json({ error: 'Invalid payment token' });
  }

  // Authorize payment with NSIM
  const order = await getOrder(orderId);
  const authResult = await authorizePayment({
    merchantId: env.MERCHANT_ID,
    amount: order.total,
    currency: order.currency,
    cardToken: tokenData.cardToken,
    walletCardToken: tokenData.walletCardToken,
    orderId,
  });

  if (authResult.status === 'authorized') {
    await updateOrderStatus(orderId, 'authorized', {
      transactionId: authResult.transactionId,
      cardLast4: tokenData.cardLast4,
      cardBrand: tokenData.cardBrand,
      paymentMethod: 'mobile_wallet',
    });

    req.session.cart = [];
    delete req.session.pendingMobilePayment;

    res.json({
      success: true,
      orderId,
      redirectUrl: `/order-confirmation/${orderId}`,
    });
  } else {
    res.status(400).json({
      success: false,
      error: authResult.declineReason || 'Payment declined',
    });
  }
});
```

---

# Implementation Plan

## Phase 1: Option 3 (Web-to-App Bridge) - Priority

### WSIM Team Tasks

1. **Database Migration**
   - Add `PaymentRequest` model to Prisma schema
   - Generate migration and apply

2. **New Merchant API Endpoints**
   - `POST /api/merchant/payment/request` - Create payment request
   - `GET /api/merchant/payment/:requestId/status` - Poll status
   - `POST /api/merchant/payment/complete` - Exchange token for card tokens

3. **New Mobile API Endpoints**
   - `GET /api/mobile/payment/:requestId` - Get payment details
   - `POST /api/mobile/payment/:requestId/approve` - Approve payment
   - `POST /api/mobile/payment/:requestId/cancel` - Cancel payment

4. **Documentation**
   - Update MERCHANT_UI_INTEGRATION_GUIDE.md with mobile payment option

### mwsim Team Tasks

1. **Deep Link Configuration**
   - Configure `mwsim://` URL scheme in app.json
   - Set up navigation linking

2. **Payment Approval Screen**
   - New screen to display payment details
   - Card selection UI
   - Biometric confirmation
   - Return to browser after approval

3. **API Integration**
   - Add payment endpoints to API service

### SSIM Team Tasks

1. **Frontend**
   - Add "Pay with Mobile Wallet" button
   - Implement deep link attempt with fallback
   - Add polling for payment status

2. **Backend**
   - Proxy routes for WSIM mobile payment API
   - Payment completion route

## Phase 2: Option 2 (QR Code) - Later

1. **WSIM**: Add QR code generation to payment request response
2. **SSIM**: Add QR code display for desktop users
3. **mwsim**: QR code scanner integration

## Phase 3: Option 1 (Universal Links) - Later

1. **WSIM**: Add `.well-known` configuration files
2. **mwsim**: Configure associated domains
3. **SSIM**: Add Universal Link fallback page

---

# Security Considerations

## Payment Request Security

1. **Request Expiration**: Payment requests expire after 5 minutes
2. **One-Time Tokens**: `paymentToken` is single-use and invalidated after exchange
3. **Merchant Validation**: Payment requests tied to specific merchant client_id
4. **Return URL Validation**: Return URLs must match merchant's registered redirect URIs

## Token Security

1. **Card tokens** are short-lived (5 minutes) and single-use
2. **Payment tokens** are one-time use and merchant-specific
3. **Mobile access tokens** are device-bound and support rotation

## User Verification

1. **Biometric Required**: Payment approval requires biometric authentication in the app
2. **Card Ownership**: Cards verified to belong to authenticated user
3. **Amount Display**: Full payment details shown to user before approval

---

# Testing Plan

## Unit Tests

- Payment request creation
- Status transitions (pending → approved/cancelled/expired)
- Token validation and exchange

## Integration Tests

- End-to-end payment flow with mock app
- Fallback to popup when app not detected
- Polling and completion

## Manual Testing

- iOS: Test deep link and Universal Link behavior
- Android: Test deep link and App Link behavior
- Desktop: Test QR code flow (Phase 2)

---

*Document created: 2025-12-13*
*Status: ✅ APPROVED - Ready for Implementation*
*All teams approved: 2025-12-13*

---

# Team Review Comments

## WSIM Team Responses (2025-12-13)

This section contains WSIM team responses to mwsim and SSIM team questions, plus our own questions for clarification.

### Key Decisions Made

| Topic | Decision | Rationale |
|-------|----------|-----------|
| **Bundle ID** | `com.banksim.wsim` | Agreed with mwsim proposal - app is the mobile interface for WSIM |
| **Return URL UX** | Polling is PRIMARY, return URL is OPTIMIZATION | See detailed explanation below |
| **Biometric Phase 1** | Success/failure is sufficient | True biometric-bound keys deferred to Phase 2 |
| **Error Codes** | Standardize across all endpoints | Adopting mwsim's proposed format |
| **Fallback Timeout** | Increase to 2.5 seconds | Address slower device concerns |
| **Expiration Handling** | Extend by 60s on approval | Prevents race condition |

### Responses to mwsim Team Questions

#### 1. Authentication State on Cold Start
**Agreed with mwsim's proposal.** The flow should be:
1. Deep link opens app with `requestId` stored
2. If no valid token, show login screen (preserve `requestId` in app state)
3. After successful auth, auto-navigate to payment approval with the stored `requestId`
4. If login fails/cancelled, show error and option to go to home screen

**Implementation note:** The `requestId` should be stored in React state (or SecureStore) immediately on deep link, before any auth check.

#### 2. Multiple Payment Requests
**Decision:** Show only the most recent request when opening via deep link. If user has multiple pending requests:
- Deep link always opens the specific `requestId` from the link
- Add a "Pending Payments" section to wallet home screen (Phase 2 enhancement)
- For Phase 1: One request at a time is sufficient

**API Addition:** We'll add `GET /api/mobile/payment/pending` to list all pending requests for the user.

#### 3. Return URL Handling (CRITICAL CLARIFICATION)
**This is the most important clarification.** The flow works as follows:

```
ORIGINAL BROWSER TAB                    MOBILE APP
─────────────────────                   ──────────
1. User clicks "Pay with Wallet"
2. Initiates deep link attempt
3. Browser detects app opened ─────────► 4. App opens at payment screen
   (via visibilitychange event)
5. Starts POLLING /status every 2s      6. User reviews payment
   (shows "Waiting for approval...")     7. User approves with biometric
                                         8. App calls POST /approve
                                         9. WSIM updates status to 'approved'
10. Polling receives {status: 'approved'}
11. Browser completes payment flow ◄──── (optional: returnUrl opens)
12. Shows success, updates order
```

**Key Points:**
- **Polling is PRIMARY**: The original browser tab polls and detects approval
- **Return URL is OPTIMIZATION**: Opening `returnUrl` brings user back to browser, but the browser already detected approval via polling
- User does NOT need to tap return URL for payment to complete
- Return URL is primarily for UX (bringing user back to where they started)

**Updated implementation:** We'll make return URL handling optional:
- `returnUrl` in response tells app where to redirect IF user taps a "Return to Store" button
- App should show: "Payment approved! ✓" with a "Return to Store" button
- Even if user stays in app, the browser completes the payment via polling

#### 4. Biometric Signature
**Confirmed: Phase 1 = success/failure only.**

For Phase 1:
- `expo-local-authentication.authenticateAsync()` returns `success: true/false`
- We simply require biometric success before allowing approve API call
- No cryptographic signature

For Phase 2 (future):
- True biometric-bound keys using `expo-crypto` or native Keychain/Keystore
- Will require native module integration
- Adds actual cryptographic proof of biometric

#### 5. Deep Link Scheme Conflict
**Confirmed: Path-based routing handles both.** The URL structure is:
- `mwsim://payment/:requestId` → Payment approval
- `mwsim://enrollment/callback?...` → Enrollment callback

Implementation in app's linking config:
```javascript
const linking = {
  prefixes: ['mwsim://'],
  config: {
    screens: {
      PaymentApproval: 'payment/:requestId',
      EnrollmentCallback: 'enrollment/callback',
    }
  }
};
```

**No conflict** - Expo's linking handles path-based routing correctly.

#### 6. Card Token Request to BSIM
**Clarification on token types:**

| Token | Issuer | Lifetime | Purpose |
|-------|--------|----------|---------|
| `walletCardToken` | BSIM | Long-lived | Stored in WSIM, identifies card for routing |
| `cardToken` | BSIM | Short-lived (~5 min) | Transaction-specific, sent to NSIM for auth |

**Flow:**
1. During enrollment, BSIM issues `walletCardToken` → WSIM stores it
2. During payment, WSIM calls `POST /api/wallet/request-token` on BSIM
3. BSIM returns ephemeral `cardToken` for this transaction
4. WSIM returns both tokens to merchant → merchant sends to NSIM

**BSIM already has this endpoint** - see [BANK_INTEGRATION_API.md](./BANK_INTEGRATION_API.md).

#### 7. Payment Request Expiry UX
**Agreed.** When payment request has expired:
1. Show error: "This payment request has expired"
2. Show buttons:
   - "Return to Store" (opens `returnUrl` if available)
   - "Go to Wallet" (navigate to home screen)
3. Auto-cleanup: Remove from pending payments list

**Error screen wireframe:**
```
┌─────────────────────────────────┐
│                                 │
│      ⚠️ Payment Expired         │
│                                 │
│  This payment request has       │
│  expired. Please return to      │
│  the store to try again.        │
│                                 │
│  ┌─────────────────────────┐    │
│  │   Return to Store       │    │
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │   Go to Wallet          │    │
│  └─────────────────────────┘    │
│                                 │
└─────────────────────────────────┘
```

#### 8. Offline/Network Error Handling
**Decision:** Do NOT queue approvals. Payment requests are time-sensitive.

If network error during approval:
1. Show error: "Network error. Please check your connection."
2. Show "Retry" button (retries the approve call)
3. If still failing after 3 retries, show "Return to Store" option
4. Do NOT approve offline and sync later (security risk)

**Rationale:** Card tokens have short validity. Queuing would create stale tokens that fail at NSIM.

### Responses to mwsim Implementation Notes

#### Navigation Architecture
Acknowledged. We'll update the sample code in this doc to use state-based navigation pattern matching mwsim's current architecture. The React Navigation samples are illustrative only.

#### app.json Config
**Confirmed:** Use `com.banksim.wsim` as the bundle identifier. Updating doc to reflect this.

#### Estimated Work
Looks accurate. We'll coordinate via Slack on implementation timing.

### Responses to mwsim Suggested API Additions

#### 1. GET /api/mobile/payment/:requestId Response
**Accepted.** Updated response schema:
```typescript
{
  requestId: string;
  status: 'pending' | 'approved' | 'cancelled' | 'expired' | 'completed';
  merchantName: string;
  merchantLogo?: string;
  amount: number;
  currency: string;
  orderId: string;
  orderDescription?: string;
  cards: Array<{...}>;
  createdAt: string;     // ISO 8601 timestamp
  expiresAt: string;     // ISO 8601 timestamp
}
```

#### 2. Error Codes
**Accepted.** Standardized error format across all payment endpoints:

```typescript
{
  error: 'ERROR_CODE',
  message: 'Human-readable message'
}
```

Error codes:
| Code | HTTP Status | Description |
|------|-------------|-------------|
| `PAYMENT_NOT_FOUND` | 404 | Request ID doesn't exist |
| `PAYMENT_EXPIRED` | 410 | Request past expiration |
| `PAYMENT_ALREADY_PROCESSED` | 409 | Already approved/cancelled/completed |
| `CARD_NOT_FOUND` | 404 | Selected card not in user's wallet |
| `CARD_TOKEN_ERROR` | 502 | Failed to get token from BSIM |
| `UNAUTHORIZED` | 401 | Invalid/expired JWT |
| `FORBIDDEN` | 403 | User doesn't own this payment request |
| `INVALID_REQUEST` | 400 | Malformed request body |

---

### Responses to SSIM Team Questions

#### 1. Return URL Token Handling
**See mwsim response #3 above.** To summarize:
- **Polling is PRIMARY** - original browser tab detects approval
- **Return URL is OPTIMIZATION** - brings user back to browser for better UX
- The `paymentToken` on return URL is a backup; browser already has `requestId` and polls for status

**Important:** When status becomes `approved`, the polling response includes `oneTimePaymentToken`. SSIM doesn't need to parse the return URL.

#### 2. Session State After App Handoff
**Good suggestion.** Recommend SSIM store in both session AND localStorage:

```javascript
// When initiating mobile payment
sessionStorage.setItem('wsim_pending_payment', JSON.stringify({
  requestId,
  orderId,
  amount,
  initiatedAt: Date.now()
}));

// On page load, check for interrupted payments
const pending = sessionStorage.getItem('wsim_pending_payment');
if (pending) {
  const { requestId, initiatedAt } = JSON.parse(pending);
  const elapsed = Date.now() - initiatedAt;
  if (elapsed < 5 * 60 * 1000) { // Within 5 min
    resumePolling(requestId);
  } else {
    sessionStorage.removeItem('wsim_pending_payment');
  }
}
```

Note: Use `sessionStorage` (not `localStorage`) to avoid cross-tab conflicts.

#### 3. Polling Endpoint Authentication
**Confirmed:** SSIM proxies through its backend which adds `X-API-Key`.

**Caching:** Yes, SSIM MAY cache polling responses for 1-2 seconds. Recommended implementation:
- Cache `pending` status for 1 second
- Do NOT cache `approved`/`completed` status (user needs immediate feedback)
- Invalidate cache on any non-pending status

#### 4. Expiration Race Condition
**Accepted.** We'll implement:
- On successful approval, extend `expiresAt` by 60 seconds
- Token exchange checks `approvedAt` timestamp, not just `expiresAt`
- This gives merchant adequate time to complete the flow

**Schema update:**
```prisma
model PaymentRequest {
  // ... existing fields
  approvedAt    DateTime?  // Set when user approves
  expiresAt     DateTime   // Extended by 60s on approval
}
```

#### 5. Fallback Timeout Tuning
**Accepted.** Increasing to 2.5 seconds with visual feedback:
- Show spinner immediately: "Opening wallet app..."
- After 1 second: "Connecting to wallet..."
- After 2.5 seconds: Show fallback UI

#### 6. Card Token Validity Window
**Clarification:** BSIM card tokens are valid for **5 minutes** (configurable per BSIM).

Timeline buffer:
- Payment request: 5 min expiry
- Card token: 5 min validity
- On approval: Request extended 60s, card token just generated = 5 min remaining
- Merchant has ~4-5 minutes to complete after approval

This should be adequate. If timing becomes an issue, we can request longer-lived tokens from BSIM.

#### 7. Multiple Concurrent Requests
**Decision:** Auto-cancel previous pending requests for same `merchantId + orderId`.

When creating new request:
```sql
UPDATE "PaymentRequest"
SET status = 'cancelled', cancelledAt = NOW()
WHERE "merchantId" = $1
  AND "orderId" = $2
  AND status = 'pending';
```

This prevents orphaned requests and simplifies the flow.

---

### Responses to SSIM Suggestions

#### 1. Request Cancellation from SSIM
**Accepted.** Adding `POST /api/merchant/payment/:requestId/cancel` endpoint.

```typescript
// Request
POST /api/merchant/payment/:requestId/cancel
Headers: X-API-Key: <merchantApiKey>

// Response
{ success: true, status: 'cancelled' }
```

SSIM can call this on `beforeunload` as suggested.

#### 2. UI Feedback During Polling
**Agreed.** SSIM should implement:
- Countdown timer (seconds remaining)
- Pulsing/spinner animation
- Cancel button
- Status messages

**Suggested UX:**
```
┌─────────────────────────────────────┐
│                                     │
│  🔄 Waiting for wallet approval...  │
│                                     │
│        4:32 remaining               │
│                                     │
│    [Cancel and use another card]    │
│                                     │
└─────────────────────────────────────┘
```

#### 3. WebSocket for Scale
**Deferred to Phase 2.** For Phase 1:
- Polling every 2 seconds is acceptable for our current scale
- Will monitor WSIM load
- Can implement adaptive polling (2s → 5s after 30 seconds) as quick optimization

Phase 2 consideration:
- WebSocket with polling fallback
- Or: Server-Sent Events (simpler than WebSocket)

#### 4. E2E Test Strategy
**Accepted.** Adding test-only endpoint (dev environment only):

```typescript
// Only available when NODE_ENV !== 'production'
POST /api/mobile/payment/:requestId/test-approve
Body: { cardId: string }

// Simulates full approval flow without biometric
```

**Important:** This endpoint will be behind environment check AND require special test header.

#### 5. Consistent Error Response Format
**Already addressed** in mwsim response #2 above. All endpoints will use:
```typescript
{ error: 'ERROR_CODE', message: 'Human readable message' }
```

---

### WSIM Team Questions for Other Teams

#### For mwsim Team

1. **State Persistence Across App Restarts**
   - If user force-closes the app mid-payment-approval, how do we handle?
   - Suggestion: Store `pendingPaymentRequestId` in SecureStore, check on app launch

2. **Biometric Prompt Timing**
   - Should biometric prompt appear immediately when payment screen opens, or after user taps "Approve"?
   - Recommendation: After tapping "Approve" (more intuitive UX)

3. **Card Display Order**
   - How should cards be ordered on the payment approval screen?
   - Options: (a) Default card first, (b) Most recently used, (c) By card type
   - Currently thinking: Default card pre-selected, others in enrollment order

#### For SSIM Team

1. **Desktop vs Mobile Detection**
   - How will SSIM detect if user is on mobile vs desktop?
   - Need to decide: Show "Pay with Mobile Wallet" button on mobile only, or both?
   - Desktop use case: Show QR code (Phase 2) or always show button?

2. **Order State Management**
   - When mobile payment is initiated, should order status change to "payment_pending"?
   - What happens if user tries to pay again via card while mobile payment is pending?

3. **Merchant Logo URL**
   - Can SSIM provide a logo URL when calling `/api/merchant/payment/request`?
   - This would display in the mwsim approval screen
   - Format: HTTPS URL, recommended 256x256 PNG

---

*WSIM Team Review Complete: 2025-12-13*

---

### WSIM Final Approval (2025-12-13)

**Status: ✅ APPROVED FOR IMPLEMENTATION**

All questions from mwsim and SSIM teams have been satisfactorily answered. We're aligned on:

#### Confirmed Decisions

| Decision | mwsim | SSIM | WSIM |
|----------|-------|------|------|
| Bundle ID: `com.banksim.wsim` | ✅ | - | ✅ |
| Polling is PRIMARY mechanism | ✅ | ✅ | ✅ |
| Fallback timeout: 2.5 seconds | ✅ | ✅ | ✅ |
| Phase 1 biometric: success/failure only | ✅ | - | ✅ |
| Extend expiry by 60s on approval | - | ✅ | ✅ |
| Auto-cancel previous pending requests | - | ✅ | ✅ |
| Mobile-only button for Phase 1 | - | ✅ | ✅ |
| Merchant logo URL support | - | ✅ | ✅ |

#### WSIM Implementation Plan

**Phase 1: Payment API Endpoints (2-3 days)**

New endpoints to add to `backend/src/routes/mobile.ts`:
- `POST /api/merchant/payment/request` - Create payment request (merchant API)
- `GET /api/merchant/payment/:requestId/status` - Poll status (merchant API)
- `POST /api/merchant/payment/:requestId/cancel` - Cancel request (merchant API)
- `POST /api/merchant/payment/:requestId/complete` - Exchange token (merchant API)
- `GET /api/mobile/payment/:requestId` - Get payment details (mobile app)
- `POST /api/mobile/payment/:requestId/approve` - Approve with card (mobile app)
- `POST /api/mobile/payment/:requestId/cancel` - Cancel from app (mobile app)
- `POST /api/mobile/payment/:requestId/test-approve` - E2E test helper (dev only)

**Database Schema:**
```prisma
model PaymentRequest {
  id              String    @id @default(cuid())
  merchantId      String    // OAuth client_id
  userId          String?   // Set when user opens in app
  orderId         String
  amount          Decimal
  currency        String    @default("CAD")
  orderDescription String?
  returnUrl       String
  merchantName    String
  merchantLogoUrl String?

  status          String    @default("pending") // pending, approved, cancelled, expired, completed
  selectedCardId  String?
  cardToken       String?   // From BSIM, set on approval
  walletCardToken String?   // For NSIM routing
  oneTimeToken    String?   @unique // For merchant token exchange

  createdAt       DateTime  @default(now())
  expiresAt       DateTime
  approvedAt      DateTime?
  completedAt     DateTime?
  cancelledAt     DateTime?

  user            WalletUser? @relation(fields: [userId], references: [id])

  @@index([merchantId, orderId])
  @@index([status])
  @@index([oneTimeToken])
}
```

**Implementation Order:**
1. Add PaymentRequest model to Prisma schema
2. Implement merchant-facing endpoints (SSIM integration)
3. Implement mobile-facing endpoints (mwsim integration)
4. Add test endpoint for E2E testing
5. Deploy to `wsim-dev.banksim.ca`
6. Notify SSIM and mwsim teams

**Estimated Total Effort:** 2-3 days

#### Ready to Begin

WSIM will begin implementation immediately. Will notify teams when endpoints are available on dev.

---

## mwsim Team Comments (2025-12-13)

### Status: APPROVED FOR IMPLEMENTATION

All original questions have been addressed by the WSIM team. We're ready to proceed.

---

### Responses to WSIM Team Questions

#### 1. State Persistence Across App Restarts
**Agreed.** We will:
- Store `pendingPaymentRequestId` in SecureStore immediately when deep link is received
- On app launch, check SecureStore for pending payment
- If found and not expired (check via API), navigate to payment approval screen
- Clear from SecureStore after approval/cancel/expiry

Implementation:
```typescript
// On deep link received
await SecureStore.setItemAsync('pendingPaymentRequestId', requestId);

// On app launch
const pendingId = await SecureStore.getItemAsync('pendingPaymentRequestId');
if (pendingId) {
  const status = await api.getPaymentStatus(pendingId);
  if (status === 'pending') {
    navigateToPaymentApproval(pendingId);
  } else {
    await SecureStore.deleteItemAsync('pendingPaymentRequestId');
  }
}
```

#### 2. Biometric Prompt Timing
**Agreed: After tapping "Approve".**

Flow:
1. User sees payment details with card selector
2. User selects card (default is pre-selected)
3. User taps "Approve Payment" button
4. Biometric prompt appears
5. On success, API call is made
6. Show success screen with "Return to Store" button

This matches user expectations (confirm → authenticate pattern).

#### 3. Card Display Order
**Agreed: Default card pre-selected, others in enrollment order.**

UI implementation:
- Default card shown at top with visual indicator (checkmark or highlight)
- Other cards listed below in `createdAt` order
- Tapping a non-default card selects it for THIS transaction only (doesn't change default)
- Clear visual feedback on selected card

---

### Implementation Plan Summary

Based on the finalized design, our implementation tasks are:

**Phase 1 (Payment Flow):**
1. Deep link handler for `mwsim://payment/:requestId`
2. `PaymentApproval` screen with:
   - Payment details display (merchant, amount, description)
   - Card selector (default pre-selected)
   - Approve button with biometric gate
   - Cancel button
   - Success/Error states
3. API methods:
   - `GET /api/mobile/payment/:requestId` → `getPaymentDetails()`
   - `POST /api/mobile/payment/:requestId/approve` → `approvePayment()`
   - `POST /api/mobile/payment/:requestId/cancel` → `cancelPayment()`
4. Cold-start auth flow (preserve requestId across login)
5. SecureStore persistence for interrupted payments

**Estimated effort:** 3-4 days

**Bundle ID change:** Will update `app.json` to use `com.banksim.wsim` before starting payment flow work.

---

### Original Questions (Resolved)

*These questions have been answered by WSIM team above. Kept for reference.*

1. **Authentication State on Cold Start** - ✅ Agreed with our proposal
2. **Multiple Payment Requests** - ✅ Handle specific requestId from deep link
3. **Return URL Handling** - ✅ Polling is primary, return URL is optional UX enhancement
4. **Biometric Signature** - ✅ Phase 1 = success/failure only
5. **Deep Link Scheme Conflict** - ✅ Path-based routing handles both
6. **Card Token Request to BSIM** - ✅ Clarified token types and flow
7. **Payment Request Expiry UX** - ✅ Error screen with Return/Home options
8. **Offline/Network Error Handling** - ✅ Retry with limit, no offline queuing

---

*mwsim Team Review Complete: 2025-12-13*
*Status: APPROVED - Ready for Implementation*

---

## SSIM Team Comments (2025-12-13)

### Status: APPROVED FOR IMPLEMENTATION

All original questions have been addressed by the WSIM team. We're ready to proceed.

---

### Responses to WSIM Team Questions

#### 1. Desktop vs Mobile Detection
**Decision:** Show "Pay with Mobile Wallet" button on **mobile only** for Phase 1.

Detection strategy:
```javascript
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}
```

**Phase 2 (Desktop):** Will add QR code flow. Desktop users will see "Scan to Pay with Wallet" which displays a QR code for mwsim to scan.

#### 2. Order State Management
**Decision:**
- When mobile payment is initiated, order remains in `pending` state (not `payment_pending`)
- If user tries to pay via another method while mobile payment is in progress:
  - Cancel the mobile payment request via `POST /api/merchant/payment/:requestId/cancel`
  - Proceed with the new payment method
- Rationale: Keeping order state simple; the PaymentRequest tracks payment attempt state

**Implementation:**
```javascript
// When switching payment methods
if (pendingMobileRequestId) {
  await cancelMobilePayment(pendingMobileRequestId);
  pendingMobileRequestId = null;
}
// Proceed with new payment method
```

#### 3. Merchant Logo URL
**Yes, SSIM will provide a logo URL.**

We'll include `merchantLogoUrl` in the payment request:
```typescript
POST /api/merchant/payment/request
{
  amount: "59.99",
  currency: "CAD",
  orderId: "order-123",
  returnUrl: "https://ssim.banksim.ca/checkout",
  merchantName: "SSIM Store",
  merchantLogoUrl: "https://ssim.banksim.ca/images/logo-256.png"  // NEW
}
```

**Logo specs:**
- Format: PNG with transparent background
- Size: 256x256 (will create this asset)
- Served via HTTPS from SSIM domain

---

### Original Questions (Resolved)

*These questions have been answered by WSIM team above. Kept for reference.*

1. **Return URL Token Handling** - ✅ Polling is PRIMARY, return URL is UX optimization
2. **Session State After App Handoff** - ✅ Use sessionStorage with recovery on page load
3. **Polling Endpoint Authentication** - ✅ Proxy through backend, caching OK (1-2s for pending)
4. **Expiration Race Condition** - ✅ Extend by 60s on approval
5. **Fallback Timeout Tuning** - ✅ Increasing to 2.5s with visual feedback
6. **Card Token Validity Window** - ✅ 5 min validity, adequate buffer
7. **Multiple Concurrent Requests** - ✅ Auto-cancel previous pending for same orderId

---

### Implementation Plan (Updated)

**Phase 1a: Backend Proxy Routes (1-2 days)**
- `POST /api/payment/mobile/request` → proxy to WSIM (include merchantLogoUrl)
- `GET /api/payment/mobile/:id/status` → proxy to WSIM (with 1s cache for pending)
- `POST /api/payment/mobile/:id/cancel` → proxy to WSIM
- `POST /api/payment/mobile/complete` → exchange token via WSIM, authorize via NSIM

**Phase 1b: Frontend Integration (1-2 days)**
- "Pay with Mobile Wallet" button (mobile user-agent only)
- Deep link attempt with 2.5s fallback
- Polling UI with countdown, spinner, cancel button
- sessionStorage recovery for interrupted payments
- beforeunload handler to cancel abandoned requests

**Phase 1c: E2E Tests (1 day)**
- Mock-based tests for fallback behavior (app not installed)
- Integration tests using `/test-approve` endpoint on dev

**Phase 1d: Assets (0.5 days)**
- Create 256x256 merchant logo PNG
- Add to SSIM static assets

**Total estimated effort:** 4-5 days

**Dependency**: Notify us when WSIM endpoints are available on `wsim-dev.banksim.ca`.

---

*SSIM Team Review Complete: 2025-12-13*
*Status: APPROVED - Ready for Implementation*

---
