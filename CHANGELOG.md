# Changelog

All notable changes to the WSIM (Wallet Simulator) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Connected Banks Page (2025-12-06)**
  - New `/banks` page for managing connected bank enrollments
  - View list of connected banks with card counts and enrollment dates
  - Disconnect banks (removes enrollment and all associated cards)
  - "Connect Another Bank" button links to enrollment flow
  - Updated navigation: "Connected Banks" in profile now goes to `/banks` instead of `/enroll`
  - Footer navigation updated across all pages to use `/banks` for Banks tab
  - New files:
    - `frontend/src/app/banks/page.tsx` - Connected banks management page
  - Modified files:
    - `frontend/src/app/profile/page.tsx` - Updated "Connected Banks" link
    - `frontend/src/app/wallet/page.tsx` - Updated footer navigation
    - `frontend/src/app/enroll/page.tsx` - Updated footer navigation

- **Admin User Management (2025-12-06)**
  - SUPER_ADMIN can now edit other admin users (name, role)
  - SUPER_ADMIN can remove/delete other admin users
  - Cannot change your own role (prevents lockout)
  - Cannot delete your own account
  - Passkey management: view and delete individual passkeys
  - Cannot delete an admin's only passkey (must have at least one auth method)
  - New edit form with danger zone for account deletion
  - New files:
    - `auth-server/src/views/admin/admin-edit.ejs` - Admin edit form
  - Modified files:
    - `auth-server/src/routes/admin.ts` - Added edit/delete/passkey routes
    - `auth-server/src/views/admin/admins.ejs` - Added Edit/Remove buttons

- **Admin Invitation System (2025-12-06)**
  - SUPER_ADMIN users can now view all admin users on a dedicated "Admins" tab
  - Invite system for new administrators with secure 64-character hex invite codes
  - Optional email restriction (invite can be locked to a specific email)
  - Configurable expiry (1, 3, 7, 14, or 30 days)
  - Role selection (ADMIN or SUPER_ADMIN) when creating invites
  - Invites can be revoked before use
  - Two-step join flow: enter details, then register passkey
  - Automatic login after successful passkey registration
  - Navigation updates: "Admins" and "Invites" tabs visible to SUPER_ADMIN only
  - New environment variable `AUTH_SERVER_URL` for invite URL generation
  - New files:
    - `auth-server/src/views/admin/admins.ejs` - Admin users list view
    - `auth-server/src/views/admin/invites.ejs` - Invite management view
    - `auth-server/src/views/admin/invite-form.ejs` - Create invite form
    - `auth-server/src/views/admin/join.ejs` - Invite acceptance page
    - `auth-server/src/views/admin/join-error.ejs` - Invalid invite error page
  - Modified files:
    - `auth-server/src/routes/admin.ts` - Added admin/invite management routes
    - `auth-server/src/routes/adminAuth.ts` - Added join/register routes for invite flow
    - `auth-server/src/config/env.ts` - Added AUTH_SERVER_URL
    - `auth-server/src/views/admin/clients.ejs` - Added Admins/Invites nav tabs
    - `auth-server/src/views/admin/sessions.ejs` - Added Admins/Invites nav tabs
    - `auth-server/src/views/admin/users.ejs` - Added Admins/Invites nav tabs

- **Unit Test Infrastructure (2025-12-06)**
  - Vitest test framework with v8 coverage provider for backend and auth-server
  - Test scripts: `npm test`, `npm run test:watch`, `npm run test:coverage`
  - `vitest-mock-extended` for type-safe Prisma mocking
  - `supertest` for HTTP route testing
  - Test setup files with environment configuration
  - Comprehensive TESTING_PLAN.md with prioritized test strategy (P0-P3)
  - Mock Prisma factory (`mockPrisma.ts`) with in-memory storage for all WSIM models
  - **199 tests implemented (163 backend + 36 auth-server):**
    - P0 Critical (Security & State Management):
      - `backend/src/utils/crypto.test.ts` (23 tests) - encrypt/decrypt, token generation, tamper detection
      - `backend/src/middleware/auth.test.ts` (20 tests) - requireAuth, optionalAuth, JWT functions
      - `backend/src/routes/passkey.test.ts` (18 tests) - WebAuthn registration and authentication
      - `backend/src/routes/payment.test.ts` (17 tests) - payment token request, context storage
      - `backend/src/services/bsim-oidc.test.ts` (21 tests) - OIDC flows, PKCE, token exchange, card fetching
      - `auth-server/src/middleware/adminAuth.test.ts` (15 tests) - admin JWT tokens, middleware, cookies
    - P1 Business Logic:
      - `backend/src/routes/enrollment.test.ts` (21 tests) - bank enrollment OIDC flow, callbacks, card fetching
      - `backend/src/routes/wallet.test.ts` (23 tests) - card management, enrollments, user profile
      - `backend/src/routes/wallet-api.test.ts` (20 tests) - merchant API, authentication, payment initiation
      - `auth-server/src/routes/admin.test.ts` (21 tests) - OAuth client CRUD, session management

- **Admin Interface for Auth Server (2025-12-06)**
  - New `/administration` routes for OAuth client management
  - Passkey-only authentication (WebAuthn/FIDO2) for admin login
  - First-time setup wizard at `/administration/setup` for initial admin creation
  - `AdminUser` and `AdminPasskey` Prisma models with role-based access (ADMIN, SUPER_ADMIN)
  - `AdminInvite` model for inviting new administrators
  - JWT-based admin session management with secure cookies
  - Admin dashboard with OAuth client CRUD operations
  - EJS views: `setup.ejs`, `login.ejs`, `dashboard.ejs`, `clients.ejs`
  - Environment variable `AUTH_ADMIN_JWT_SECRET` for admin token signing

- **Merchant Wallet API (2025-12-06)**
  - New `/api/merchant` endpoints for custom wallet integration
  - `GET /api/merchant/user` - Check user authentication status
  - `GET /api/merchant/cards` - List user's enrolled wallet cards
  - `POST /api/merchant/payment/initiate` - Start payment, get passkey challenge
  - `POST /api/merchant/payment/confirm` - Verify passkey, get payment token
  - API key authentication via `x-api-key` header + user session
  - Added `apiKey` field to `OAuthClient` schema for merchant API access
  - API documentation added to EMBEDDED_WALLET_PLAN.md

- **Cross-Origin API Support for "API Direct" Integration (2025-12-06)**
  - CORS configured for browser-to-WSIM direct API calls from merchant sites
  - Session cookies updated to `SameSite=None; Secure` for cross-origin credential support
  - Explicit CORS headers: `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials: true`
  - Allowed headers include `X-API-Key` and `Content-Type`
  - Trust proxy enabled for all environments (needed behind nginx SSL termination)
  - Supports SSIM's "API Direct" integration option (browser calls WSIM directly)

- **Embedded Wallet iframe Integration (2025-12-06)**
  - New `/embed/card-picker` route for inline iframe checkout
  - `/embed/login/options` and `/embed/login/verify` endpoints for passkey auth in iframe
  - `/embed/passkey/options` and `/embed/passkey/verify` for payment confirmation
  - `/embed/select-card-simple` for users without passkeys (session-based)
  - Security middleware (`embed-headers.ts`) with CSP `frame-ancestors` and `Permissions-Policy`
  - Embed views: `card-picker.ejs`, `auth-required.ejs`, `error.ejs`
  - postMessage protocol: `wsim:ready`, `wsim:resize`, `wsim:card-selected`, `wsim:cancelled`, `wsim:error`, `wsim:auth-required`
  - `ALLOWED_EMBED_ORIGINS` environment variable for iframe origin whitelist
  - SSIM checkout page updated with "Inline" button for iframe wallet integration

- **Authentication Improvements (2025-12-05)**
  - New login page (`/login`) with password and passkey authentication options
  - Password authentication endpoint (`POST /api/auth/login`) with bcrypt verification
  - Password setup during enrollment flow (optional, can skip for passkey-only)
  - `passwordHash` field added to `WalletUser` schema
  - Homepage buttons renamed: "Add a Bank" → "Enroll in Wallet", "Open Wallet" → "Sign in to Wallet"
  - Wallet page redirects to login on 401 with `?redirect=/wallet` parameter
  - Suspense boundary added to login page for Next.js 16 compatibility

### Fixed
- **Admin Invite Flow Fixes (2025-12-06)**
  - Fixed `baseUrl is not defined` error in invites.ejs template - now uses pre-computed `invite.url`
  - Fixed invite registration flow - frontend now sends `email` instead of `adminId` to register-options/verify endpoints
  - Fixed response destructuring for registration options API (was missing `{ options }` wrapper)
  - Fixed invite validation to allow passkey registration after admin account creation (invite marked "used" at step 1)

- **Popup Passkey Authentication Cross-Domain Session (2025-12-05)**
  - Fixed session domain mismatch when authenticating via WSIM popup from SSIM
  - Added `/popup/login/options` and `/popup/login/verify` endpoints to auth-server
  - Auth-required popup now calls auth-server directly instead of backend API
  - Session is now set on auth-server domain (same as popup) for correct authentication
  - Added `WEBAUTHN_ORIGINS` support for multi-origin passkey verification
  - Updated `docker-compose.dev.yml` with both frontend and auth-server origins

- **iframe Passkey Origin Mismatch (2025-12-06)**
  - Fixed `WEBAUTHN_ORIGINS` not being set in container when using `docker-compose.yml` alone
  - Container was started with production config but nginx used dev config (`nginx.dev.conf`)
  - Passkey verification failed: `origin "https://wsim-auth-dev.banksim.ca" expected: https://wsim.banksim.ca`
  - Solution: Use `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` for dev environment
  - Added `ALLOWED_EMBED_ORIGINS` to both `docker-compose.yml` and `docker-compose.dev.yml`

- **Passkey Credential ID Encoding (2025-12-05)**
  - Fixed double-encoding bug in passkey registration
  - `credential.id` from `@simplewebauthn/server` v13+ is already base64url encoded
  - Was incorrectly re-encoding with `Buffer.from().toString('base64url')`
  - Passkey login now correctly matches stored credentials

- **Enrollment Session Issue (2025-12-05)**
  - Added `prompt: 'login'` to OIDC authorization URL to force BSIM login screen
  - Prevents auto-login with existing BSIM session during new enrollment

- **Input Field Visibility (2025-12-05)**
  - Added explicit `text-gray-900 bg-white` to input fields on login and enroll pages
  - Fixes light grey text on white background issue

- **E2E Integration Complete (2025-12-05)**
  - Full wallet payment flow working: SSIM → WSIM → BSIM → NSIM
  - WSIM OIDC provider issues JWT access tokens via Resource Indicators feature
  - JWT tokens include `wallet_card_token` and `card_token` claims
  - Fresh consent required for each payment via `loadExistingGrant` configuration
  - Payment context stored per-grant with 10-minute TTL
  - SSIM extracts tokens from WSIM JWT and passes to NSIM for payment authorization
  - Comprehensive handoff documentation for BSIM/NSIM teams

- **SSIM OAuth Client Configuration**
  - Registered `ssim-merchant` OAuth client in WSIM database
  - Configured SSIM environment with WSIM integration settings
  - Added `resource` parameter to authorization and token exchange for JWT format

- **Production Docker Containers**
  - Multi-stage Dockerfiles for all services (backend, auth-server, frontend)
  - Non-root users for security (`wsim`, `oidc`, `nextjs` with uid 1001)
  - Health checks on all services
  - `.dockerignore` files to optimize builds
  - Next.js standalone output mode for minimal container size

- **Enrollment Flow Implementation**
  - BSIM OIDC client service using `openid-client` v6
  - PKCE support for secure authorization code flow
  - Enrollment initiation route (`POST /api/enrollment/start/:bsimId`)
  - OIDC callback handler with code exchange
  - Automatic user profile creation from BSIM data
  - Card fetching from BSIM's `/api/wallet/cards` endpoint
  - Wallet card token generation (`wsim_{bsimId}_{uniqueId}` format)
  - Enrolled banks listing endpoint (`GET /api/enrollment/list`)
  - Enrollment removal with card cascade delete

- **Payment Authorization Flow**
  - `PaymentContext` Prisma model for storing card selection during OIDC flow
  - Backend `/api/payment/request-token` endpoint to request card tokens from BSIM
  - Backend `/api/payment/context` endpoints for storing/retrieving payment context
  - Auth-server card selection handler calls backend for BSIM card tokens
  - `extraTokenClaims` implementation adds `wallet_card_token` and `card_token` to access tokens
  - Internal API authentication between auth-server and backend (`INTERNAL_API_SECRET`)

- **URL Configuration**
  - Support for dev environment URLs (`*-dev.banksim.ca`)
  - `getBsimApiUrl()` helper for deriving API URL from OIDC issuer
  - Optional `apiUrl` field in provider config for explicit override

- **Documentation**
  - FAQ section in BSIM_SUBPLAN.md answering team integration questions
  - Comprehensive BSIM_DEPLOYMENT_INTEGRATION.md with nginx config, docker-compose services, and troubleshooting
  - Updated README with quick start guide, API documentation, and Docker section

### Changed
- Updated `.env.example` with proper dev environment URLs
- CORS configuration includes all dev subdomains
- `next.config.ts` now uses `output: "standalone"` for Docker deployment

### Fixed
- **WSIM Auth Server Issues (2025-12-05)**
  - Disabled `devInteractions` in oidc-provider to use custom interaction routes
  - Fixed Grant creation in card selection handler - properly creates and saves Grant with scopes
  - Added `resourceIndicators` feature with `defaultResource` and `getResourceServerInfo` for JWT access tokens
  - Fixed issuer mismatch by using dev environment config (`docker-compose.dev.yml`)
  - Added `grant.addResourceScope()` call to include resource in consent grant
  - Fixed variable name mismatch (`grantIdFromProvider` → `grantId`) in interaction result

- **BSIM Integration Issues (2025-12-05)**
  - Added Prisma binary targets for Alpine/ARM64 Docker containers (`linux-musl-arm64-openssl-3.0.x`, `linux-musl-openssl-3.0.x`)
  - Changed backend Dockerfile to use `prisma db push` instead of `migrate deploy` (no migrations yet)
  - Fixed `useSearchParams()` React 19 error by wrapping enrollment page content in Suspense boundary
  - Removed non-existent `tailwind.config.ts` from frontend Dockerfile (Tailwind v4 doesn't require it)
  - Fixed PKCE parameter order in `buildAuthorizationUrl()` call (nonce and codeChallenge were swapped)
  - Added RFC 9207 compliance: include `iss` and `state` parameters in callback URL for `oauth4webapi` validation
  - Separated WSIM database from BSIM database to avoid Prisma schema conflicts
  - Extract `wallet_credential` custom claim from BSIM access token JWT for card fetching
  - Transform BSIM card response format (`id`→`cardRef`, `cardHolder`→`cardholderName`) to WSIM normalized format

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
