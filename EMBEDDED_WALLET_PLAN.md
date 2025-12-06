# WSIM Embedded Wallet Payment - Implementation Plan

> **Purpose:** Local implementation plan for the Embedded Wallet Payment feature in WSIM. This enables merchants to embed WSIM card selection directly in their checkout flow, rather than full-page redirects.

> **Reference Documents:**
> - [NSIM Technical Design](../nsim/docs/EMBEDDED_WALLET_PAYMENT.md)
> - [NSIM Implementation Plan](../nsim/docs/IMPLEMENTATION_PLAN_EMBEDDED_WALLET.md)
> - [SSIM Integration Guide](../nsim/SSIM_INTEGRATION_GUIDE.md)

---

## Design Principles

1. **Additive, Not Replacement** - All new features are additive. The existing OIDC redirect flow MUST continue to work unchanged.
2. **Phase-by-Phase** - Implement in order: Popup → iframe → API. Each phase validates the next.
3. **Shared Infrastructure** - Passkey auth and postMessage protocol are shared across all integration methods.
4. **Reuse Existing Code** - Build on existing interaction routes, card selection UI, and payment context infrastructure.

---

## Current Architecture (For Reference)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Existing WSIM Payment Flow (OIDC Redirect)                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  auth-server/src/                                                       │
│  ├── index.ts              → OIDC provider setup, Express app           │
│  ├── oidc-config.ts        → Provider config, extraTokenClaims          │
│  ├── routes/interaction.ts → Login, consent, card-select handlers       │
│  ├── adapters/prisma.ts    → OIDC storage adapter                       │
│  └── views/                → EJS templates (login, consent, card-select)│
│                                                                         │
│  backend/src/                                                           │
│  ├── routes/payment.ts     → /api/payment/request-token, /context       │
│  └── services/             → BSIM client, token handling                │
│                                                                         │
│  frontend/src/app/                                                      │
│  ├── wallet/page.tsx       → Wallet dashboard                           │
│  ├── profile/page.tsx      → User profile                               │
│  └── enroll/page.tsx       → Bank enrollment                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key Files for Embedded Wallet:**
- [auth-server/src/routes/interaction.ts](auth-server/src/routes/interaction.ts) - Has `select-card` logic we can reuse
- [auth-server/src/oidc-config.ts](auth-server/src/oidc-config.ts) - Token generation with payment claims

---

## Phase 1: Passkey Infrastructure + Popup Integration

### 1.1 Passkey Infrastructure (WSIM Backend + Auth Server)

Passkeys provide secure, phishing-resistant authentication for payment confirmation. Users authenticate with biometrics instead of passwords.

#### Database Schema Changes

| Task | File | Description |
|------|------|-------------|
| Add PasskeyCredential model | `backend/prisma/schema.prisma` | Store WebAuthn credentials |

```prisma
model PasskeyCredential {
  id              String   @id @default(uuid())
  userId          String
  user            WalletUser @relation(fields: [userId], references: [id], onDelete: Cascade)

  // WebAuthn credential data
  credentialId    String   @unique  // Base64url encoded
  publicKey       String             // Base64url encoded COSE public key
  counter         Int      @default(0)
  transports      String[]           // e.g., ["internal", "hybrid"]

  // Metadata
  deviceName      String?            // "iPhone", "MacBook Pro", etc.
  createdAt       DateTime @default(now())
  lastUsedAt      DateTime?

  @@index([userId])
}
```

#### Backend API Endpoints

| Task | File | Route | Description |
|------|------|-------|-------------|
| Registration challenge | `backend/src/routes/passkey.ts` | `POST /api/passkey/register/challenge` | Generate registration options |
| Registration verify | `backend/src/routes/passkey.ts` | `POST /api/passkey/register/verify` | Verify and store credential |
| Authentication challenge | `backend/src/routes/passkey.ts` | `POST /api/passkey/authenticate/challenge` | Generate auth options |
| Authentication verify | `backend/src/routes/passkey.ts` | `POST /api/passkey/authenticate/verify` | Verify assertion |
| List user passkeys | `backend/src/routes/passkey.ts` | `GET /api/passkey/credentials` | List user's passkeys |
| Delete passkey | `backend/src/routes/passkey.ts` | `DELETE /api/passkey/credentials/:id` | Remove passkey |

**Dependencies to install:**
```bash
npm install @simplewebauthn/server @simplewebauthn/browser
```

#### Frontend Passkey UI

| Task | File | Description |
|------|------|-------------|
| Passkey settings page | `frontend/src/app/settings/passkeys/page.tsx` | Manage registered passkeys |
| Registration component | `frontend/src/components/PasskeyRegister.tsx` | WebAuthn registration flow |
| Passkey list component | `frontend/src/components/PasskeyList.tsx` | Display/delete passkeys |

### 1.2 Popup Card Picker (Auth Server)

A minimal, popup-optimized card selection page that communicates via postMessage.

#### New Routes

| Task | File | Route | Description |
|------|------|-------|-------------|
| Popup card picker page | `auth-server/src/routes/popup.ts` | `GET /popup/card-picker` | Render card picker UI |
| Popup auth check | `auth-server/src/routes/popup.ts` | `GET /popup/auth-status` | Check if user is authenticated |
| Popup card select | `auth-server/src/routes/popup.ts` | `POST /popup/select-card` | Handle card selection + passkey |

#### Query Parameters for `/popup/card-picker`

```
?merchantId=ssim-merchant
&merchantName=SSIM%20Store
&amount=104.99
&currency=CAD
&orderId=order-123
&origin=https://ssim.example.com  // For postMessage target validation
```

#### Popup Views (EJS Templates)

| Task | File | Description |
|------|------|-------------|
| Popup layout | `auth-server/src/views/popup/layout.ejs` | Minimal layout, no nav |
| Card picker | `auth-server/src/views/popup/card-picker.ejs` | Card list with passkey button |
| Passkey prompt | `auth-server/src/views/popup/passkey-confirm.ejs` | Payment confirmation |
| Auth required | `auth-server/src/views/popup/auth-required.ejs` | Login/passkey prompt |
| Error page | `auth-server/src/views/popup/error.ejs` | Error display |

#### postMessage Protocol Implementation

```typescript
// auth-server/src/public/js/popup-messenger.ts

interface WsimMessage {
  type: 'wsim:card-selected' | 'wsim:cancelled' | 'wsim:auth-required' | 'wsim:error';
}

interface CardSelectedMessage extends WsimMessage {
  type: 'wsim:card-selected';
  token: string;        // wallet_payment_token JWT
  cardLast4: string;    // "4242"
  cardBrand: string;    // "visa"
  expiresAt: string;    // ISO timestamp (5 min from now)
}

interface CancelledMessage extends WsimMessage {
  type: 'wsim:cancelled';
  reason: 'user' | 'timeout' | 'error';
}

interface AuthRequiredMessage extends WsimMessage {
  type: 'wsim:auth-required';
  message: string;
}

interface ErrorMessage extends WsimMessage {
  type: 'wsim:error';
  code: string;        // "passkey_failed", "token_error", etc.
  message: string;
}

// Send message to opener and close popup
function sendToOpener(message: WsimMessage, allowedOrigin: string): void {
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(message, allowedOrigin);
    window.close();
  }
}
```

### 1.3 Popup Flow Implementation

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Popup Flow                                                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. SSIM opens popup:                                                   │
│     window.open('https://wsim.../popup/card-picker?...', 'wsim', ...)   │
│                         │                                               │
│                         ▼                                               │
│  2. WSIM checks session cookie                                          │
│     ├── Has session → Show card list                                    │
│     └── No session → Show passkey/login options                         │
│                         │                                               │
│                         ▼                                               │
│  3. User selects card → Passkey prompt appears                          │
│     "Confirm $104.99 payment to SSIM Store"                             │
│                         │                                               │
│                         ▼                                               │
│  4. Passkey verified → Request wallet_payment_token from BSIM           │
│                         │                                               │
│                         ▼                                               │
│  5. postMessage to opener:                                              │
│     { type: 'wsim:card-selected', token: '...', ... }                   │
│                         │                                               │
│                         ▼                                               │
│  6. Popup closes automatically                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Phase 1 Task Checklist

#### 1.1 Passkey Infrastructure
- [x] Add `PasskeyCredential` model to Prisma schema
- [x] Run migration: `npx prisma migrate dev --name add_passkey_credentials`
- [x] Install `@simplewebauthn/server` in backend
- [x] Create `backend/src/routes/passkey.ts` with registration/auth endpoints
- [x] Add passkey routes to `backend/src/routes/index.ts`
- [x] Install `@simplewebauthn/browser` in frontend
- [x] Create `frontend/src/app/settings/passkeys/page.tsx`
- [x] Link passkeys page from profile page
- [x] Test passkey registration flow ✅ (verified 2024-12-05)
- [x] Test passkey authentication flow ✅ (verified 2024-12-05)

#### 1.2 Popup Card Picker
- [x] Create `auth-server/src/routes/popup.ts`
- [x] Add popup routes to auth-server Express app
- [x] Create `auth-server/src/views/popup/layout.ejs`
- [x] Create `auth-server/src/views/popup/card-picker.ejs`
- [x] Create `auth-server/src/views/popup/auth-required.ejs`
- [x] Create `auth-server/src/views/popup/error.ejs`
- [x] Add postMessage origin validation
- [x] Integrate passkey verification for payment confirmation
- [x] Generate wallet_payment_token after passkey success
- [ ] Test popup flow end-to-end with SSIM (pending SSIM integration)

#### 1.3 Configuration
- [x] Add `ALLOWED_POPUP_ORIGINS` to auth-server env
- [x] Configure session cookies to work in popup context
- [x] Add `WEBAUTHN_*` env vars for passkey RP configuration ✅ (configured in docker-compose)
- [ ] Add CSP headers allowing popup behavior

### Phase 1 Completion Criteria

- [x] User can register passkey in WSIM settings ✅
- [x] User can authenticate with passkey in WSIM ✅
- [x] SSIM can open WSIM popup for card selection ✅ (endpoint ready)
- [ ] User can select card and confirm with passkey (pending SSIM integration testing)
- [ ] Token flows back to SSIM via postMessage (pending SSIM integration testing)
- [x] Existing OIDC redirect flow still works unchanged ✅

---

## Phase 2: iframe Integration

### 2.1 iframe Embed Endpoint (Auth Server)

A card picker designed for inline embedding via iframe.

#### New Routes

| Task | File | Route | Description |
|------|------|-------|-------------|
| iframe card picker | `auth-server/src/routes/embed.ts` | `GET /embed/card-picker` | Embeddable card picker |
| iframe height reporter | `auth-server/src/routes/embed.ts` | Client-side | Send height changes to parent |

#### CSP and Security Headers

```typescript
// auth-server/src/middleware/embed-headers.ts

// Only allow embedding from approved merchant origins
const ALLOWED_EMBED_ORIGINS = process.env.ALLOWED_EMBED_ORIGINS?.split(',') || [];

export function embedSecurityHeaders(req: Request, res: Response, next: NextFunction) {
  const origin = req.query.origin as string;

  if (ALLOWED_EMBED_ORIGINS.includes(origin)) {
    // Allow this specific origin to embed
    res.setHeader('Content-Security-Policy', `frame-ancestors ${origin}`);
    res.setHeader('X-Frame-Options', `ALLOW-FROM ${origin}`);
  } else {
    // Block embedding from unknown origins
    res.setHeader('X-Frame-Options', 'DENY');
  }

  next();
}
```

#### iframe-specific postMessage Events

```typescript
// Additional events for iframe
interface ResizeMessage {
  type: 'wsim:resize';
  height: number;  // pixels
}

interface ReadyMessage {
  type: 'wsim:ready';
  // iframe has loaded and is ready
}
```

### 2.2 iframe Views

| Task | File | Description |
|------|------|-------------|
| iframe layout | `auth-server/src/views/embed/layout.ejs` | No padding, responsive |
| Card picker | `auth-server/src/views/embed/card-picker.ejs` | Minimal, embedded design |

### Phase 2 Task Checklist

- [ ] Create `auth-server/src/routes/embed.ts`
- [ ] Create `auth-server/src/middleware/embed-headers.ts`
- [ ] Add embed routes to auth-server
- [ ] Create `auth-server/src/views/embed/layout.ejs`
- [ ] Create `auth-server/src/views/embed/card-picker.ejs`
- [ ] Implement height resize postMessage
- [ ] Add `ALLOWED_EMBED_ORIGINS` to env
- [ ] Test passkey in iframe context (requires `allow` attribute)
- [ ] Test with SSIM iframe integration

### Phase 2 Completion Criteria

- [ ] SSIM can embed WSIM card picker in iframe
- [ ] Passkey authentication works within iframe
- [ ] Token flows via postMessage to parent
- [ ] iframe resizes appropriately
- [ ] Works alongside popup option (merchant choice)
- [ ] Existing OIDC redirect flow still works

---

## Phase 3: API Integration

### 3.1 Wallet API Endpoints

For merchants who want to build fully custom UIs.

#### New Routes

| Task | File | Route | Description |
|------|------|-------|-------------|
| List cards | `backend/src/routes/wallet-api.ts` | `GET /api/wallet/cards` | User's card list |
| Request token | `backend/src/routes/wallet-api.ts` | `POST /api/wallet/payment-token` | Get payment token |
| Passkey challenge | `backend/src/routes/wallet-api.ts` | `POST /api/wallet/passkey-challenge` | Get challenge for payment |
| Verify and token | `backend/src/routes/wallet-api.ts` | `POST /api/wallet/verify-payment` | Verify passkey, return token |

#### API Authentication

Merchants need a way to authenticate API calls on behalf of users.

**Option A: User Bearer Token**
- User authenticates with WSIM (passkey or OAuth)
- WSIM issues a short-lived API token
- Merchant passes token in API calls

**Option B: Merchant API Key + User Token**
- Merchant has API key
- User has WSIM session token
- Both required for API calls

### Phase 3 Task Checklist

- [ ] Design API authentication flow
- [ ] Create `backend/src/routes/wallet-api.ts`
- [ ] Implement card list endpoint
- [ ] Implement passkey challenge endpoint
- [ ] Implement verify + token endpoint
- [ ] Add rate limiting
- [ ] Add API documentation
- [ ] Test with SSIM API integration

### Phase 3 Completion Criteria

- [ ] Merchant can fetch user's card list via API
- [ ] Merchant can request payment token for selected card
- [ ] Passkey authentication integrated into API flow
- [ ] Works alongside popup and iframe options
- [ ] Existing OIDC redirect flow still works

---

## File Structure After Implementation

```
auth-server/src/
├── routes/
│   ├── interaction.ts    (existing - unchanged)
│   ├── popup.ts          (NEW - Phase 1)
│   └── embed.ts          (NEW - Phase 2)
├── middleware/
│   └── embed-headers.ts  (NEW - Phase 2)
├── views/
│   ├── login.ejs         (existing - unchanged)
│   ├── consent.ejs       (existing - unchanged)
│   ├── card-select.ejs   (existing - unchanged)
│   ├── popup/
│   │   ├── layout.ejs    (NEW)
│   │   ├── card-picker.ejs
│   │   ├── passkey-confirm.ejs
│   │   ├── auth-required.ejs
│   │   └── error.ejs
│   └── embed/
│       ├── layout.ejs    (NEW)
│       └── card-picker.ejs
└── public/
    └── js/
        └── popup-messenger.js (NEW)

backend/src/
├── routes/
│   ├── passkey.ts        (NEW - Phase 1)
│   └── wallet-api.ts     (NEW - Phase 3)
└── ...

frontend/src/
├── app/
│   └── settings/
│       └── passkeys/
│           └── page.tsx  (NEW - Phase 1)
└── components/
    ├── PasskeyRegister.tsx (NEW)
    └── PasskeyList.tsx     (NEW)
```

---

## Environment Variables

### Auth Server
```env
# Existing
BACKEND_URL=http://wsim-backend:3001
INTERNAL_API_SECRET=...

# New for Embedded Wallet
ALLOWED_POPUP_ORIGINS=https://ssim.example.com,https://localhost:3000
ALLOWED_EMBED_ORIGINS=https://ssim.example.com,https://localhost:3000

# WebAuthn
WEBAUTHN_RP_NAME="WSIM Wallet"
WEBAUTHN_RP_ID=wsim-auth-dev.banksim.ca
WEBAUTHN_ORIGIN=https://wsim-auth-dev.banksim.ca
```

### Backend
```env
# Existing
BSIM_URL=...

# New for Passkeys
WEBAUTHN_RP_NAME="WSIM Wallet"
WEBAUTHN_RP_ID=wsim-auth-dev.banksim.ca
WEBAUTHN_ORIGIN=https://wsim-auth-dev.banksim.ca
```

---

## Testing Plan

### Unit Tests
- [ ] Passkey registration challenge generation
- [ ] Passkey verification logic
- [ ] postMessage payload validation
- [ ] Origin validation for popup/embed

### Integration Tests
- [ ] Popup flow: open → select card → passkey → token → close
- [ ] iframe flow: load → select card → passkey → token → resize
- [ ] API flow: challenge → verify → token

### E2E Tests (with SSIM)
- [ ] SSIM popup integration
- [ ] SSIM iframe integration
- [ ] SSIM API integration
- [ ] Fallback from popup blocked → redirect
- [ ] Token expiry handling

### Browser Testing
- [ ] Chrome (desktop + mobile)
- [ ] Safari (desktop + iOS)
- [ ] Firefox
- [ ] Edge
- [ ] Passkey support in each browser

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| Clickjacking | `X-Frame-Options`, CSP `frame-ancestors` |
| Token interception | postMessage only to validated origins |
| Phishing | Passkey bound to WSIM origin only |
| Replay attacks | Single-use tokens, short TTL (5 min) |
| Session hijacking | Passkey required for each payment |
| XSS in popup | Strict CSP, sanitized inputs |

---

## Dependencies

| Package | Purpose | Install In |
|---------|---------|------------|
| `@simplewebauthn/server` | WebAuthn server-side verification | backend |
| `@simplewebauthn/browser` | WebAuthn client-side API | frontend, auth-server |

---

## Open Questions

1. **Passkey fallback:** If user's device doesn't support passkeys, do we fall back to password? Magic link?

2. **Session duration:** How long should WSIM session cookies last for popup/iframe flows?

3. **Multi-device passkeys:** Platform passkeys sync automatically. Do we need to handle this explicitly?

4. **Merchant registration:** Should merchants register allowed origins via an admin panel?

5. **Rate limiting:** What are appropriate rate limits for popup/embed/API endpoints?

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2024-12-05 | Initial WSIM implementation plan | Claude |
| 2024-12-05 | Phase 1 implementation: passkey infrastructure + popup card picker | Claude |
| 2024-12-05 | WebAuthn RP ID configuration fixed for `banksim.ca` domain | Claude |
| 2024-12-05 | Passkey registration/authentication tested and verified | Claude |
| 2024-12-05 | SSIM integration doc created, ready for SSIM team implementation | Claude |
| 2024-12-05 | Fixed popup API calls to use correct backend URL (FRONTEND_URL env var) | Claude |
| 2024-12-05 | Passkey transport filter: prefer internal over hybrid to avoid QR code prompts | Claude |

---

## Related Documents

- [TODO.md](./TODO.md) - Project status
- [ARCHITECTURE_PLAN.md](./ARCHITECTURE_PLAN.md) - System architecture
- [HANDOFF_BSIM_NSIM.md](./HANDOFF_BSIM_NSIM.md) - Current integration status
