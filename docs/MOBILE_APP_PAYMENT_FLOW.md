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
*Status: Design Draft - Awaiting Team Review*
