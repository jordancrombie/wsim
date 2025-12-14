# WSIM Project TODO

> **Last Updated**: 2025-12-14

## Current Status: 🟢 Production Ready

**WSIM is deployed to production** with all major features working:
- Full OIDC payment flow (Popup, Inline, Redirect)
- Quick Pay with cross-domain passkey authentication
- In-Bank Enrollment for partner banks
- Admin dashboard with passkey-only authentication
- **Mobile API for mwsim integration** ✅ Tested and working

### What's Working ✅
- ✅ SSIM shows "Pay with Wallet" button
- ✅ WSIM OIDC flow (login → card selection → fresh consent per payment)
- ✅ WSIM requests card tokens from BSIM
- ✅ JWT access tokens with `wallet_card_token` and `card_token` claims
- ✅ **Admin Interface** - OAuth client management with passkey authentication
- ✅ **Quick Pay** - Cross-domain passkey auth on merchant domains
- ✅ **In-Bank Enrollment** - Users enroll from partner bank websites
- ✅ **WebAuthn ROR** - Related Origin Requests for cross-domain passkey support
- ✅ **API Direct Integration** - JWT bearer token auth for SSIM API calls
- ✅ **Schema Sync Validation** - Script to verify Prisma schemas before deployment
- ✅ **Mobile API** - JWT-based REST API for mwsim mobile wallet app (tested 2025-12-14)
- ✅ **Mobile Payment Flow** - Deep link payment approval with biometric auth

---

## Phase 1: Foundation (Week 1-2)

### WSIM Team ✅ COMPLETE
- [x] **Project Setup**
  - [x] Initialize backend (Express + TypeScript)
  - [x] Initialize auth-server (oidc-provider)
  - [x] Initialize frontend (Next.js 16)
  - [x] Set up PostgreSQL + Prisma
  - [x] Create database schema and run migrations
  - [x] Configure Docker Compose
  - [x] Set up environment configuration

- [x] **Production Docker Containers**
  - [x] Multi-stage Dockerfile for backend
  - [x] Multi-stage Dockerfile for auth-server
  - [x] Multi-stage Dockerfile for frontend (standalone mode)
  - [x] Non-root users for security
  - [x] Health checks on all services
  - [x] `.dockerignore` files for all services

**Completed Components:**
- Backend API server with routes for auth, wallet, enrollment, health
- Auth server with OIDC provider, Prisma adapter, interaction views
- Frontend with wallet dashboard, enrollment page, profile page
- Production-ready Docker containers for all services
- Full Prisma schema (WalletUser, BsimEnrollment, WalletCard, etc.)

### BSIM Team ✅ PHASE 1 COMPLETE
> See [docs/BANK_INTEGRATION_API.md](./docs/BANK_INTEGRATION_API.md) for integration spec
> See [docs/DEPLOYMENT_GUIDE.md](./docs/DEPLOYMENT_GUIDE.md) for deployment setup

- [x] Add `wallet:enroll` OIDC scope
- [x] Create `WalletCredential` data model
- [x] Implement `GET /api/wallet/cards` endpoint
- [x] Implement `POST /api/wallet/request-token` endpoint
- [x] Implement `POST /api/wallet/revoke` endpoint
- [x] Update consent UI for wallet enrollment
- [x] Create `GET /api/registry/info` endpoint
- [x] Register WSIM as OAuth client in BSIM auth-server
- [ ] **Integrate WSIM into docker-compose stack** (see docs/DEPLOYMENT_GUIDE.md)
- [ ] Testing and documentation

### NSIM Team 🟡 CAN START IN PARALLEL
> See [docs/PAYMENT_NETWORK_INTEGRATION.md](./docs/PAYMENT_NETWORK_INTEGRATION.md) for integration spec

- [ ] Design BSIM registry data structure
- [ ] Implement registry service
- [ ] Create registry API endpoints
- [ ] Refactor BSIM client for multi-bsim support
- [ ] Update payment routes with routing logic
- [ ] Add health check system
- [ ] Testing with multiple bsims

---

## Phase 2: Core WSIM Development (Week 2-4)

### WSIM Team ✅ Core Implementation Complete

#### Completed (UI/Structure Ready)
- [x] Configure oidc-provider (auth-server)
- [x] Create Prisma adapter for OIDC storage
- [x] Build card selection UI (EJS views)
- [x] Wallet dashboard page (frontend)
- [x] Card list component (frontend)
- [x] Bank enrollment page (frontend)
- [x] Profile management (frontend)

#### ✅ Enrollment Flow Implemented
- [x] **BSIM OIDC Client** (enrollment flow)
  - [x] Configure bsim providers
  - [x] Implement enrollment initiation route with PKCE
  - [x] Implement enrollment callback handler
  - [x] Create user profile from bsim data
  - [x] Session management for enrollment state

- [x] **Card Management**
  - [x] Implement card fetching from bsim
  - [x] Store cards with wallet tokens
  - [x] Create wallet management APIs
  - [x] Implement card removal
  - [x] List enrolled banks endpoint

#### ✅ Payment Flow Implementation
- [x] **OIDC Provider Payment Flow**
  - [x] Configure oidc-provider
  - [x] Create Prisma adapter
  - [x] Build card selection UI
  - [x] Implement payment interaction flow with card selection
  - [x] Add PaymentContext model for storing card token during OIDC flow
  - [x] Create backend `/api/payment/request-token` endpoint to get card tokens from BSIM
  - [x] Create backend `/api/payment/context` endpoints for storing/retrieving payment context
  - [x] Implement `extraTokenClaims` to add `wallet_card_token` and `card_token` to access tokens
  - [ ] E2E testing with SSIM (pending SSIM integration)

---

## Phase 3: SSIM Integration (Week 4-5)

### SSIM Team ✅ COMPLETE
> See [docs/MERCHANT_UI_INTEGRATION_GUIDE.md](./docs/MERCHANT_UI_INTEGRATION_GUIDE.md) for UI integration
> See [docs/API_PAYMENT_INTEGRATION_FLOWS.md](./docs/API_PAYMENT_INTEGRATION_FLOWS.md) for API integration

- [x] Add WSIM as OIDC provider
- [x] Update checkout UI with "Pay with Wallet" button
- [x] Implement wallet payment callback
- [x] Update NSIM client for walletCardToken
- [x] Update order details display
- [x] End-to-end testing (SSIM side)

---

## Phase 4: Integration Testing (Week 5)

### All Teams ✅ COMPLETE
- [x] **E2E Scenario: First-time wallet user**
- [x] **E2E Scenario: Returning wallet user** (Quick Pay)
- [x] **E2E Scenario: Multi-bsim user**
- [x] **E2E Scenario: Error handling**

---

## Local Development Setup

### For WSIM Standalone (without BSIM integration)
```bash
# Start PostgreSQL
docker-compose up postgres -d

# Run backend (terminal 1)
cd backend && cp .env.example .env && npm run dev

# Run auth-server (terminal 2)
cd auth-server && cp .env.example .env && npm run dev

# Run frontend (terminal 3)
cd frontend && npm run dev
```

Access at: http://localhost:3004

### For Full Stack (BSIM-orchestrated)
> See [docs/DEPLOYMENT_GUIDE.md](./docs/DEPLOYMENT_GUIDE.md) for deployment configuration

```bash
# From bsim directory
make dev-build
```

Access at: https://wsim-dev.banksim.ca

---

## Coordination Checkpoints

| Checkpoint | Target | Teams | Milestone | Status |
|------------|--------|-------|-----------|--------|
| Checkpoint 0 | Now | WSIM | Scaffolding complete | ✅ Done |
| Checkpoint 1 | Week 1 | BSIM | wallet:enroll scope ready | ✅ Done |
| Checkpoint 1.5 | Week 1 | WSIM | Docker containers ready | ✅ Done |
| Checkpoint 2 | Week 2 | WSIM, BSIM | Enrollment flow working | ✅ Done |
| Checkpoint 3 | Week 3 | All | Token format validation | ✅ Done |
| Checkpoint 4 | Week 4 | All | First E2E wallet payment | ✅ Done |
| Final Demo | Week 5 | All | Complete flow, all scenarios | ✅ Done |
| Production | Dec 2025 | All | Production deployment | ✅ Deployed |

---

## Key Documents

| Document | Purpose |
|----------|---------|
| [docs/ARCHITECTURE_PLAN.md](./docs/ARCHITECTURE_PLAN.md) | System design, data models, flows |
| [docs/DEPLOYMENT_GUIDE.md](./docs/DEPLOYMENT_GUIDE.md) | Docker, nginx, environment setup |
| [docs/MERCHANT_UI_INTEGRATION_GUIDE.md](./docs/MERCHANT_UI_INTEGRATION_GUIDE.md) | Popup, iframe, redirect integration |
| [docs/API_PAYMENT_INTEGRATION_FLOWS.md](./docs/API_PAYMENT_INTEGRATION_FLOWS.md) | API-based wallet integration |
| [docs/BANK_INTEGRATION_API.md](./docs/BANK_INTEGRATION_API.md) | Bank provider integration |
| [docs/PAYMENT_NETWORK_INTEGRATION.md](./docs/PAYMENT_NETWORK_INTEGRATION.md) | Payment network routing |
| [docs/EMBEDDED_WALLET_PLAN.md](./docs/EMBEDDED_WALLET_PLAN.md) | Embedded wallet implementation status |
| [docs/MOBILE_APP_PAYMENT_FLOW.md](./docs/MOBILE_APP_PAYMENT_FLOW.md) | Mobile app payment flow design |
| [docs/FUTURE_CONSIDERATIONS.md](./docs/FUTURE_CONSIDERATIONS.md) | Post-MVP features |

---

## Mobile API (mwsim Integration)

> **Status:** ✅ Tested and working in dev (2025-12-14)
> Branch: `feature/mobile-api`
> Proposal: `/Users/jcrombie/ai/mwsim/docs/WSIM_API_PROPOSAL.md`

### Phase 1 ✅ COMPLETE
- [x] Device registration endpoint
- [x] Account registration (new users)
- [x] Account login (existing users with email code)
- [x] Token refresh with rotation
- [x] Logout and token revocation
- [x] Wallet summary endpoint
- [x] Database schema (MobileDevice, MobileRefreshToken)

### Phase 2 ✅ COMPLETE
- [x] Bank enrollment via OAuth (JWT-based, not session)
- [x] Deep link callback for expo-web-browser (`mwsim://enrollment/callback`)
- [x] Enrollment list and delete
- [x] Card management (set default, remove)

### Phase 3 ✅ COMPLETE & TESTED (2025-12-14)
- [x] Mobile payment flow (merchant creates request, user approves in app)
  - [x] `POST /api/mobile/payment/request` - Merchant creates payment request
  - [x] `GET /api/mobile/payment/:requestId/status` - Merchant polls for approval
  - [x] `POST /api/mobile/payment/:requestId/cancel` - Cancel payment
  - [x] `POST /api/mobile/payment/:requestId/complete` - Exchange token for card tokens
  - [x] `GET /api/mobile/payment/:requestId` - Get payment details (for app)
  - [x] `POST /api/mobile/payment/:requestId/approve` - User approves with card
  - [x] `GET /api/mobile/payment/pending` - List pending payments
  - [x] `POST /api/mobile/payment/:requestId/test-approve` - E2E test helper
- [x] Database schema (MobilePaymentRequest)
- [x] Deep link support (`mwsim://payment/:requestId`)
- [x] Standardized error codes (PAYMENT_NOT_FOUND, PAYMENT_EXPIRED, etc.)
- [x] BSIM token request integration (sends `bsimCardRef` for ephemeral card token)
- [x] End-to-end flow tested: SSIM → mwsim deep link → approve → return to merchant

### Phase 4 (Future)
- [ ] Biometric authentication (Face ID / Touch ID) with cryptographic signature
- [ ] Push notification token storage
- [ ] Multi-device management
- [ ] QR code flow for desktop checkout

---

## Future Enhancements

### Admin-Configurable Allowed Origins ✅ PARTIALLY COMPLETE
- [x] **WebAuthn Related Origins** - Implemented via `OAuthClient.webauthnRelatedOrigin` field
  - Per-merchant Quick Pay cross-domain passkey support
  - Configurable in Admin UI under "Quick Pay (Cross-Domain Passkey)"
  - `/.well-known/webauthn` dynamically loads from database + env vars
- [ ] **Popup/Embed Origins** - Still environment variable based
  - `ALLOWED_POPUP_ORIGINS` and `ALLOWED_EMBED_ORIGINS` require container restarts
  - Lower priority now that Quick Pay origins are admin-configurable
  - Could add similar per-client `popupOrigin` and `embedOrigin` fields if needed

### Merchant-Scoped Session JWTs
- [ ] **Add audience (aud) claim to session JWTs to make them store-specific**
  - **Current behavior:** Session JWTs contain only `sub` (userId) - they work across all merchants
  - **Security concern:** A JWT obtained at SSIM could theoretically be used at regalmoose.ca
  - **Proposed Enhancement:**
    - Add `aud` (audience) claim with the merchant's `client_id` when generating session tokens
    - Validate `aud` claim when merchants use the JWT for API calls
    - Reject tokens where audience doesn't match the calling merchant
  - **Token payload (current):**
    ```json
    { "sub": "user-id", "iat": 1234567890, "exp": 1237159890 }
    ```
  - **Token payload (proposed):**
    ```json
    { "sub": "user-id", "aud": "ssim-merchant", "iat": 1234567890, "exp": 1237159890 }
    ```
  - **Files to modify:**
    - `auth-server/src/routes/popup.ts` - Add `aud` to `generateSessionToken()`
    - `auth-server/src/routes/embed.ts` - Same change
    - `backend/src/middleware/auth.ts` - Validate `aud` claim on API calls
  - **Tradeoff:** User must re-authenticate at each new merchant (better security, slightly worse UX)

### Server-to-Server Merchant Access Grants (Quick Pay Enhancement)
- [ ] **Add persistent server-side grants for returning user card access**
  - **Problem:** Current Quick Pay JWT is browser-based; lost if user clears browser data
  - **Goal:** Allow merchants to access returning users' card lists via server-to-server calls
  - **Important:** This is an ADDITION to existing Quick Pay, not a replacement
  - **User Control:** Users can view and revoke merchant access from WSIM dashboard

  - **Integration Options (merchant can choose):**
    | Option | Description | Best For |
    |--------|-------------|----------|
    | Quick Pay (current) | Browser JWT via postMessage | Simple integration, ephemeral |
    | Server Grant (new) | Server-to-server with persistent grant | Returning users, cross-device |

  - **Flow for Server Grant option:**
    ```
    INITIAL AUTH (Browser - same as today)
    ─────────────────────────────────────
    User → WSIM Popup → Passkey → Card Selection
                                      ↓
    postMessage returns: { sessionToken, authorizationCode (NEW) }
                                      ↓
    Merchant Frontend → sends authorizationCode to Merchant Backend
                                      ↓
    Merchant Backend → POST /api/merchant/exchange-grant
                       (with client_id, client_secret, authorizationCode)
                                      ↓
    WSIM returns: { merchantGrantToken, userId, expiresAt }
                   (Merchant stores this server-side, linked to their user)

    RETURNING USER (Server-to-Server)
    ─────────────────────────────────
    Merchant identifies returning user (by email, account ID, etc.)
                                      ↓
    Merchant Backend → GET /api/merchant/users/{externalUserId}/cards
                       Authorization: Bearer {merchantGrantToken}
                                      ↓
    WSIM validates grant is active → returns card list
                                      ↓
    Merchant displays cards for quick checkout (no popup needed)

    USER CONTROL (WSIM Dashboard)
    ─────────────────────────────
    User logs into WSIM → "Connected Merchants" page
    Shows: SSIM Store (connected Dec 9, 2025) [Revoke]
           RegalMoose (connected Dec 1, 2025) [Revoke]
    User clicks Revoke → Merchant can no longer access card list
    ```

  - **New data model:**
    ```prisma
    model MerchantUserGrant {
      id            String   @id @default(cuid())
      userId        String   // WSIM user
      merchantId    String   // OAuth client_id of merchant
      merchantName  String   // Display name for user dashboard
      grantToken    String   @unique // Token merchant uses for API calls
      scope         String   @default("cards:read") // What merchant can access
      grantedAt     DateTime @default(now())
      lastUsedAt    DateTime?
      revokedAt     DateTime? // Null = active, set = revoked
      expiresAt     DateTime? // Optional expiry

      user          WalletUser @relation(fields: [userId], references: [id])

      @@index([userId])
      @@index([merchantId])
      @@index([grantToken])
    }
    ```

  - **New API endpoints:**
    | Endpoint | Method | Auth | Description |
    |----------|--------|------|-------------|
    | `/api/merchant/exchange-grant` | POST | client credentials | Exchange auth code for grant token |
    | `/api/merchant/users/{id}/cards` | GET | grant token | Get user's cards (server-to-server) |
    | `/api/merchant/grants/{id}` | DELETE | grant token | Merchant revokes their own grant |
    | `/api/user/connected-merchants` | GET | user session | List merchants with access |
    | `/api/user/connected-merchants/{id}` | DELETE | user session | User revokes merchant access |

  - **Files to create/modify:**
    - `auth-server/prisma/schema.prisma` - Add MerchantUserGrant model
    - `backend/prisma/schema.prisma` - Same (keep in sync)
    - `auth-server/src/routes/merchantApi.ts` - New server-to-server endpoints
    - `auth-server/src/routes/popup.ts` - Return authorizationCode alongside sessionToken
    - `auth-server/src/routes/embed.ts` - Same change
    - `frontend/src/app/settings/connected-merchants/page.tsx` - User dashboard page
    - `docs/API_PAYMENT_INTEGRATION_FLOWS.md` - Update with new Server Grant option
    - `docs/MERCHANT_UI_INTEGRATION_GUIDE.md` - Update with new integration option

  - **Security considerations:**
    - Grant tokens are merchant-specific (includes `aud` claim)
    - Grants can be time-limited or indefinite (merchant choice)
    - Users can revoke at any time
    - Audit log of grant usage (lastUsedAt tracking)
    - Rate limiting on server-to-server endpoints

---

## Notes

- **BSIM docker integration is critical path** - WSIM containers are ready, waiting for BSIM team to add to their stack
- **See [docs/DEPLOYMENT_GUIDE.md](./docs/DEPLOYMENT_GUIDE.md)** for nginx/docker-compose changes
- NSIM routing can proceed in parallel once basic registry structure is agreed
- SSIM integration is last in sequence - needs working WSIM OIDC provider
- WSIM uses Prisma 5.x (not 7.x) for compatibility
- All Docker images use `node:20-alpine` base with multi-stage builds
