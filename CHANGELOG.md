# Changelog

All notable changes to the WSIM (Wallet Simulator) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [0.4.0] - 2026-01-03

**P2P / Open Banking Support** - Enables mwsim to fetch real bank account balances for P2P transfers.

**Compatibility:**
- Requires BSIM with `bsim_user_id` claim support
- Works with TransferSim 0.2.0+ for P2P transfers
- **Database migration required** (new `accessToken` field)

### Added
- **P2P Accounts Proxy Endpoint**
  - New `GET /api/mobile/accounts` endpoint aggregates bank accounts from all enrolled BSIMs
  - Fetches real balances via BSIM Open Banking API (`/accounts` endpoint)
  - Response format matches mwsim API contract: `displayName`, `balance`, `bankName`, `bankLogoUrl`, `bsimId`
  - Enables mwsim "Send Money" P2P flow with real account selection

- **Expose fiUserRef in Enrollment List API**
  - Added `fiUserRef` field to `GET /api/mobile/enrollment/list` response
  - Required by mwsim for TransferSim P2P routing - identifies account owner at BSIM

- **Multi-Bank Enrollment UX**
  - Authenticated users can add banks without re-entering password
  - Header dynamically shows "Connect Another Bank" vs "Enroll in Wallet"
  - Already-enrolled banks filtered from selection

### Fixed
- **Refresh Token Flow** - Added `offline_access` scope; BSIM now issues 30-day refresh tokens
- **P2P Account Ownership** - Prefer `bsim_user_id` over `fi_user_ref` for correct ownership validation
- **Credential Storage** - Separate `accessToken` (JWT) from `walletCredential` (wcred_xxx)
- **Response Format** - Fixed field names to match mwsim contract

### Migration
```bash
npx prisma migrate dev --name add_access_token_field
# or: npx prisma db push
```

**Note:** Existing enrollments need re-enrollment to get refresh tokens and correct `fiUserRef`.

---

## [0.3.0] - 2025-12-17

**Mobile Platform Support** - Complete REST API for mwsim mobile wallet app with QR code payments.

**Compatibility:**
- Works with mwsim mobile app
- No database migration required from 0.2.0

### Added
- **QR Code Payment for Desktop Checkout**
  - Universal link landing page at `/pay/[requestId]` with device detection
  - Mobile: Deep link to mwsim app; Desktop: Display QR code
  - New endpoint: `GET /api/mobile/payment/:requestId/public`
  - iOS Universal Links and Android App Links configuration

- **Mobile API for mwsim Integration** (Tested on iOS Safari + Chrome)
  - Complete REST API with JWT authentication (1hr access, 30-day refresh)
  - Device registration, auth flows, wallet/card operations
  - Bank enrollment via OAuth with deep link callbacks
  - Mobile payment flow with deep links (`mwsim://payment/{requestId}`)
  - New Prisma models: `MobileDevice`, `MobileRefreshToken`, `MobilePaymentRequest`

### Fixed
- Route ordering bug in mobile.ts (`/payment/pending` before `/payment/:requestId`)
- Mobile payment BSIM token request (send `cardId` not `walletCardToken`)

### Tests
- Auth Server: +97 tests, coverage 21.8% → 59.11%
- Backend Mobile: +84 tests, coverage 39.5% → 60.78%

---

## [0.2.0] - 2025-12-12

**Production-Ready Wallet** - Complete payment integration with all checkout methods.

**Compatibility:**
- Requires BSIM with `wallet:enroll` scope
- Works with SSIM for popup, inline, redirect, and Quick Pay flows

### Added
- **Partner Integrations**
  - In-Bank Enrollment with cross-origin passkey registration (WebAuthn Level 3)
  - Partner SSO for cross-device wallet access
  - Quick Pay with admin-configurable WebAuthn Related Origins
  - JWT Bearer Token authentication for SSIM API Direct

- **Admin Interface**
  - OAuth client management with passkey-only authentication
  - Grant types and API key management
  - Admin invitation system with role-based access

- **Integration Methods**
  - Embedded wallet iframe integration
  - Popup and redirect flow checkout UI redesign
  - Cross-origin API support for "API Direct" mode

- **Testing Infrastructure**
  - 199 unit tests (163 backend + 36 auth-server)
  - E2E test suite with Playwright
  - Schema sync validation script

### Fixed
- OIDC discovery document HTTP URLs (proxy support)
- OAuth client scope validation
- Passkey credential ID encoding
- Cross-domain session handling

---

## [0.2.0-beta] - 2025-12-07

### Added
- **Public Integration Guides**
  - DEPLOYMENT_GUIDE.md - Docker, nginx, environment setup
  - BANK_INTEGRATION_API.md - Bank provider integration spec
  - PAYMENT_NETWORK_INTEGRATION.md - Payment network routing
  - MERCHANT_UI_INTEGRATION_GUIDE.md - Popup, iframe, redirect integration

- **Connected Banks Page** - Manage bank enrollments at `/banks`

### Changed
- Documentation reorganization to `docs/` directory

---

## [0.2.0-alpha] - 2025-12-05

### Added
- Authentication with password and passkey options
- E2E integration complete (SSIM → WSIM → BSIM → NSIM)
- Production Docker containers with multi-stage builds
- Full enrollment and payment authorization flows

### Fixed
- WSIM auth server issues (Grant creation, resource indicators)
- BSIM integration issues (Prisma targets, PKCE parameters, RFC 9207)
- Passkey encoding and session handling

---

## [0.1.0] - 2025-12-04

### Added
- **Project Scaffolding**
  - Backend API server (Express + TypeScript)
  - Auth server with oidc-provider
  - Frontend (Next.js 14 + Tailwind CSS)
  - Docker Compose configuration
  - PostgreSQL + Prisma setup

- **Database Schema**
  - `WalletUser` - User profiles
  - `BsimEnrollment` - Bank enrollment records
  - `WalletCard` - Enrolled cards with wallet tokens
  - `WalletPaymentConsent` - Payment authorization records
  - `OidcPayload` - OIDC provider storage
  - `OAuthClient` - Registered OAuth clients

- **Backend Routes**
  - Health check endpoints
  - Wallet card management (placeholder)
  - Enrollment routes (placeholder)
  - Auth routes

- **Auth Server**
  - OIDC provider configuration
  - Prisma adapter for OIDC storage
  - Interaction routes and EJS views
  - Card selection UI

- **Frontend Pages**
  - Wallet dashboard
  - Bank enrollment page
  - Profile management

### Design Decisions
- Authentication: Passthrough via bsim (Option A) for initial release
- Credentials: Long-lived wallet credentials from bsim
- Routing: NSIM registry with prefix-based walletCardToken parsing
- Integration: Redirect-based OIDC flow from ssim to wsim
- Scope: Payment credentials only (Open Banking deferred)

## [0.0.0] - 2024-01-15

### Added
- Initial project planning and architecture documentation
- High-level architecture plan (`ARCHITECTURE_PLAN.md`)
- BSIM team sub-plan for wallet credential support (`BSIM_SUBPLAN.md`)
- SSIM team sub-plan for "Pay with Wallet" integration (`SSIM_SUBPLAN.md`)
- NSIM team sub-plan for multi-bsim routing (`NSIM_SUBPLAN.md`)
- WSIM core implementation plan (`WSIM_IMPLEMENTATION_PLAN.md`)
- Order of operations timeline (`ORDER_OF_OPERATIONS.md`)
- Future considerations document (`FUTURE_CONSIDERATIONS.md`)
- Project TODO tracking (`TODO.md`)
