# Changelog

All notable changes to the WSIM (Wallet Simulator) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Mobile API for mwsim Integration (2025-12-13)**
  - Complete REST API for mobile wallet app with JWT-based authentication
  - Separate `MOBILE_JWT_SECRET` for mobile tokens (1hr access, 30-day refresh)
  - New Prisma models: `MobileDevice`, `MobileRefreshToken`, `MobilePaymentRequest`
  - **Phase 1 (Authentication & Wallet):**
    - `POST /api/mobile/device/register` - Register mobile device with credentials
    - `POST /api/mobile/auth/register` - Create new wallet account (with transaction safety)
    - `POST /api/mobile/auth/login` - Start login with email verification code
    - `POST /api/mobile/auth/login/verify` - Verify code and get tokens
    - `POST /api/mobile/auth/login/password` - Login with email/password (uses web wallet password)
    - `POST /api/mobile/auth/token/refresh` - Refresh access token (with rotation)
    - `POST /api/mobile/auth/logout` - Logout and revoke all device tokens
    - `GET /api/mobile/wallet/summary` - Get wallet overview with cards and enrollments
  - **Phase 2 (Bank Enrollment):**
    - `GET /api/mobile/enrollment/banks` - List available banks
    - `POST /api/mobile/enrollment/start/:bsimId` - Start OAuth enrollment flow
    - `GET /api/mobile/enrollment/callback/:bsimId` - Handle OAuth callback with deep link redirect
    - `GET /api/mobile/enrollment/list` - List user's enrolled banks
    - `DELETE /api/mobile/enrollment/:enrollmentId` - Remove bank enrollment
  - **Phase 3 (Mobile Payment Flow):**
    - Deep link-based payment approval: `mwsim://payment/{requestId}`
    - **Merchant endpoints** (require `x-api-key` header):
      - `POST /api/mobile/payment/request` - Create payment request, get deep link URL
      - `GET /api/mobile/payment/:id/status` - Poll for approval status
      - `POST /api/mobile/payment/:id/cancel` - Cancel payment request
      - `POST /api/mobile/payment/:id/complete` - Exchange one-time token for card tokens
    - **Mobile app endpoints** (require JWT auth):
      - `GET /api/mobile/payment/:id` - Get payment details for approval screen
      - `POST /api/mobile/payment/:id/approve` - Approve payment with selected card
      - `GET /api/mobile/payment/pending` - List user's pending payments
    - 5-minute request expiry with 60-second extension on approval
    - One-time payment token for secure merchant token exchange
    - Auto-cancel duplicate pending requests for same merchant+orderId
    - Standardized error codes: `PAYMENT_NOT_FOUND`, `PAYMENT_EXPIRED`, `INVALID_TOKEN`, etc.
    - Test endpoint for development: `POST /api/mobile/payment/:id/test-approve`
  - **Card Management:**
    - `POST /api/mobile/wallet/cards/:cardId/default` - Set card as default
    - `DELETE /api/mobile/wallet/cards/:cardId` - Soft delete card
  - Deep link support for expo-web-browser: `mwsim://enrollment/callback?success=...`
  - In-memory PKCE state storage with 10-minute TTL for mobile OAuth flows
  - Environment variables: `MOBILE_JWT_SECRET`, `MOBILE_ACCESS_TOKEN_EXPIRY`, `MOBILE_REFRESH_TOKEN_EXPIRY`
  - Feature branch: `feature/mobile-api`
  - Design documentation: `docs/MOBILE_APP_PAYMENT_FLOW.md`

- **Schema Sync Validation Script (2025-12-12)**
  - New `scripts/check-schema-sync.sh` to verify backend and auth-server Prisma schemas are identical
  - Prevents accidental table drops when services share a single PostgreSQL database
  - Should be added to CI/CD pipeline before deployments
  - Updated DEPLOYMENT_GUIDE.md with validation instructions

- **JWT Bearer Token Authentication for SSIM API Direct Integration (2025-12-12)**
  - Added `sessionToken` to popup auth responses (login/verify, passkey/verify, select-card-simple)
  - Backend `requireUserSession` middleware now accepts JWT bearer tokens as fallback to session cookies
  - Enables SSIM to store tokens for "Wallet SSO" experience across merchants (30-day expiry)
  - Modified files:
    - `auth-server/src/routes/popup.ts` - Generate and return sessionToken
    - `backend/src/routes/wallet-api.ts` - Accept JWT bearer tokens in middleware
    - `auth-server/src/config/env.ts` - Added JWT_SECRET config
  - Added 7 new tests for JWT authentication flow
  - Documentation: `LOCAL_DEPLOYMENT_PLANS/SSIM_JWT_API_INTEGRATION.md` (gitignored)

- **Admin-Configurable WebAuthn Related Origins for Quick Pay (2025-12-12)**
  - Added `webauthnRelatedOrigin` field to OAuth clients for per-merchant Quick Pay support
  - Merchants can now use passkeys registered with WSIM on their own domains
  - New admin UI section "Quick Pay (Cross-Domain Passkey)" in client edit form
  - `/.well-known/webauthn` endpoint now dynamically loads origins from:
    - Static `WEBAUTHN_RELATED_ORIGINS` env var (for partner origins like BSIM)
    - `OAuthClient.webauthnRelatedOrigin` database field (for merchant domains)
  - HTTPS validation ensures only secure origins can be configured
  - Uses WebAuthn Level 3 Related Origin Requests (ROR) specification
  - Modified files:
    - `backend/prisma/schema.prisma` - Added webauthnRelatedOrigin field to OAuthClient
    - `auth-server/prisma/schema.prisma` - Added webauthnRelatedOrigin field to OAuthClient
    - `auth-server/src/views/admin/client-form.ejs` - Added Quick Pay configuration section
    - `auth-server/src/routes/admin.ts` - Handle webauthnRelatedOrigin in client updates
    - `auth-server/src/index.ts` - Dynamic origins loading from database

### Fixed
- **TypeScript Strict Type Errors in Test Files (2025-12-12)**
  - Fixed implicit `any` type errors in `passkey.test.ts` (lines 150, 302, 309, 314)
  - Fixed `null` vs `undefined` type error in `mockPrisma.ts` (line 540)
  - These were pre-existing issues that blocked TypeScript compilation in strict mode

- **Quick Pay Cross-Domain Passkey Verification (2025-12-12)**
  - Server-side passkey verification now includes merchant's `webauthnRelatedOrigin` in expected origins
  - Previously, `verifyAuthenticationResponse` only accepted WSIM origins, causing 400 errors when
    passkey authentication occurred on merchant domains (e.g., `store.regalmoose.ca`)
  - `verifyMerchantApiKey` middleware now attaches `webauthnRelatedOrigin` to request
  - `/payment/confirm` endpoint builds `allowedOrigins` array including merchant origin
  - Modified files:
    - `backend/src/routes/wallet-api.ts` - Include merchant origin in passkey verification

- **In-Bank Enrollment with Cross-Origin Passkey Registration (2025-12-12)**
  - New enrollment flow allowing users to enroll in WSIM wallet directly from partner bank websites
  - Embedded enrollment UI (`/enroll/embed`) that can be loaded in an iframe on partner sites
  - Cross-origin WebAuthn passkey registration using Related Origin Requests (WebAuthn Level 3)
  - Server-to-server partner authentication via signed JWT tokens
  - New files:
    - `auth-server/src/routes/enroll-embed.ts` - Embedded enrollment routes and card fetching
    - `auth-server/src/views/enroll-embed/enroll.ejs` - Enrollment UI with passkey registration
    - `backend/src/routes/partner.ts` - Partner SSO token generation endpoint
    - `docs/features/IN_BANK_ENROLLMENT.md` - Feature documentation and BRD
    - `docs/BSIM_ENROLLMENT_INTEGRATION.md` - Integration guide for bank partners
  - Environment variables:
    - `PARTNER_JWT_SECRET` - Secret for signing partner SSO tokens
    - `ALLOWED_ENROLL_EMBED_ORIGINS` - Whitelist for iframe embedding
  - Unit tests for enroll-embed routes (20 tests)

- **Partner SSO for Cross-Device Wallet Access (2025-12-11)**
  - New `/api/partner/sso-token` endpoint for generating secure SSO tokens
  - Enables partner banks to provide seamless wallet access to their users
  - JWT-based token with configurable expiry (default 5 minutes)
  - Validates partner API key and user wallet enrollment
  - Unit tests for partner routes (8 tests)

- **Admin Interface: Grant Types & API Key Management (2025-12-11)**
  - Grant Types field added to OAuth client edit form
    - Checkbox UI for selecting `authorization_code`, `refresh_token`, and `implicit` grants
    - Defaults to `authorization_code` if no grants selected
  - Merchant API Key management section
    - Generate new API key for OAuth-only clients
    - Regenerate existing API key (invalidates old key)
    - Revoke API key to disable API access
    - API keys displayed in readonly field with copy-friendly format
  - Auto-reload of OAuth clients when settings change via admin UI
    - No container restart required after modifying client settings
    - Uses `provider.Client.cacheClear()` to invalidate cached client data
  - Modified files:
    - `auth-server/src/views/admin/client-form.ejs` - Added grant types checkboxes and API key section
    - `auth-server/src/routes/admin.ts` - Added grantTypes parsing, API key operations, cache clearing
    - `auth-server/src/routes/admin.test.ts` - Added tests for grantTypes and API key operations
    - `auth-server/src/index.ts` - Store provider on app for cache clearing from admin routes
    - `auth-server/src/adapters/prisma.ts` - Added Client model handling for dynamic client loading

### Changed
- **Redirect Flow Checkout UI Redesign (2025-12-12)**
  - Complete visual redesign of redirect-based wallet checkout pages
  - New WSIM Wallet branded header with logo and "Secure Checkout" subtitle
  - Step progress indicator showing checkout flow (login → consent → card select)
  - Payment summary panel displaying merchant name and amount
  - Card picker with brand-specific styling (Visa blue, Mastercard red/gold, Amex blue)
  - Checkmark indicator for selected card
  - "Secured by WSIM" footer badge
  - Modern button styling with gradient and hover effects
  - All views now self-contained with embedded CSS (no layout dependency)
  - Modified files:
    - `auth-server/src/views/login.ejs` - Redesigned login page
    - `auth-server/src/views/consent.ejs` - Redesigned consent page
    - `auth-server/src/views/card-select.ejs` - Redesigned card selection page
    - `auth-server/src/views/error.ejs` - Redesigned error page
    - `auth-server/src/views/layout.ejs` - Updated base styles

### Fixed
- **OIDC Discovery Document HTTP URLs (2025-12-12)**
  - Enabled `provider.proxy = true` in all environments (not just development)
  - Fixes 301 redirect errors when OAuth clients call token endpoint
  - Required for AWS ALB deployments where SSL is terminated at the load balancer
  - oidc-provider now trusts `X-Forwarded-Proto` headers to generate correct HTTPS URLs

- **OAuth Client Scope Validation Error (2025-12-11)**
  - Fixed "scope must only contain Authorization Server supported scope values" error
  - Root cause: PrismaAdapter didn't handle `Client` model lookups when cache was cleared
  - Added Client model handling to `PrismaAdapter.find()` to load from OAuthClient table
  - Clients now reload correctly from database after cache invalidation

- **Quick Pay Documentation (2025-12-09)**
  - Added Method 4: Quick Pay Integration to `MERCHANT_UI_INTEGRATION_GUIDE.md`
  - Quick Pay enables returning users to complete payments without popup/iframe
  - Uses stored JWT session tokens (30-day lifetime) from previous payments
  - Complete implementation guide with:
    - Sequence diagram showing Quick Pay flow
    - Frontend code examples (token storage, card picker, passkey handling)
    - Optional server-side token persistence
    - WSIM Merchant API endpoint reference
    - Troubleshooting guide for common issues
  - Updated overview tables with Quick Pay comparison
  - Updated PostMessage protocol reference with `sessionToken` fields
  - Updated security considerations for session token handling

- **Global Auth Context for Session Detection (2025-12-08)**
  - New `AuthContext` provider checks session on app load
  - Automatic session re-check on window focus and tab visibility change
  - Homepage redirects authenticated users directly to `/wallet`
  - Login page redirects if already authenticated
  - Fixes issue where opening new browser tab didn't detect existing session
  - New files:
    - `frontend/src/context/AuthContext.tsx` - Global auth state provider
    - `frontend/src/components/Providers.tsx` - Client wrapper component
  - Modified files:
    - `frontend/src/app/layout.tsx` - Wraps app with Providers
    - `frontend/src/app/page.tsx` - Checks auth, redirects if authenticated
    - `frontend/src/app/login/page.tsx` - Checks auth, calls `checkAuth()` after login

- **JWT Bearer Token Support for Merchant API (2025-12-08)**
  - New "API Direct" integration mode for SSIM
  - Merchants can authenticate using JWT bearer tokens instead of session cookies
  - `POST /api/merchant/payment/initiate` accepts `Authorization: Bearer <sessionToken>` header
  - `POST /api/merchant/payment/confirm` accepts JWT bearer token authentication
  - Session tokens returned in card-picker `postMessage` response
  - Enables server-to-server payment flows without browser cookies
  - Modified files:
    - `backend/src/routes/wallet-api.ts` - Added JWT authentication support
    - `backend/src/middleware/auth.ts` - Added `authenticateJwtOrSession` middleware

- **E2E Test Suite (2025-12-07)** - Comprehensive Playwright-based end-to-end testing
  - Full BSIM → WSIM enrollment flow testing
  - BSIM helpers: account creation, login, passkey registration, credit card creation
  - WSIM helpers: OAuth enrollment, card import, dashboard verification
  - WebAuthn virtual authenticator for passkey testing (Chrome DevTools Protocol)
  - Multi-environment support (dev/prod/local) via `TEST_ENV` variable
  - Global setup/teardown for automatic test user cleanup
  - Test fixtures for users, cards, and environment URLs
  - NPM scripts: `npm run test:e2e`, `npm run test:e2e:ui`, `npm run test:e2e:debug`
  - Test specs:
    - `tests/setup/bsim-user.spec.ts` - BSIM user setup (8 tests)
    - `tests/enrollment/enrollment.spec.ts` - WSIM enrollment flow

- **Public Integration Guides (2025-12-07)**
  - **DEPLOYMENT_GUIDE.md** - Comprehensive deployment guide for external developers
    - Docker Compose service configuration (frontend, backend, auth-server)
    - Nginx reverse proxy configuration with SSL
    - Environment variables reference
    - Database setup and migrations
    - First-time admin setup instructions
    - Health checks and troubleshooting
  - **BANK_INTEGRATION_API.md** - Bank provider integration specification
    - OIDC requirements (`wallet:enroll` scope)
    - REST API endpoints (cards, tokens, revoke)
    - Token architecture (walletCardToken vs cardToken)
    - Security requirements and error handling
  - **PAYMENT_NETWORK_INTEGRATION.md** - Payment network routing guide
    - Token-based routing with walletCardToken parsing
    - Bank registry structure and API endpoints
    - Authorization flow with request/response examples
    - Multi-bank scenarios and health monitoring

### Changed
- **Documentation Reorganization (2025-12-07)**
  - Moved planning documents to `docs/` directory
  - Moved internal deployment plans to `LOCAL_DEPLOYMENT_PLANS/` (gitignored)
  - Removed AWS deployment instructions from repo (kept locally)
  - Fixed broken links in README.md, TODO.md, and docs/ files
  - Updated ARCHITECTURE_PLAN.md to reference new public guides
  - Added `.claude/` to .gitignore (Claude Code session context stays local)

- **Merchant Integration Documentation (2025-12-07)**
  - **API_PAYMENT_INTEGRATION_FLOWS.md** - Comprehensive implementation guide for API-based wallet integration
    - Complete code examples for all three API modes:
      - Direct API Mode (Browser → WSIM): Frontend calls WSIM directly with credentials
      - Proxy Mode (Browser → Merchant → WSIM): Backend proxies requests, forwarding cookies
      - API Mode (hybrid approach): Backend initiates, frontend completes
    - Full frontend JavaScript and backend TypeScript examples
    - Handling unauthenticated users with popup login flow
    - CORS troubleshooting section with common issues and solutions
    - Complete checkout page HTML template with all three API modes
  - **MERCHANT_UI_INTEGRATION_GUIDE.md** - Comprehensive guide for UI-based wallet integration
    - Detailed sequence diagrams for Popup, Inline (iframe), and Redirect flows
    - CORS, Cookies, and Security Configuration section
    - Cross-origin request summary table (Browser → WSIM, Browser → Merchant, postMessage)
    - Cookie flow diagrams for popup and redirect modes
    - Origin validation code examples for postMessage security
    - iframe security configuration (CSP frame-ancestors, Permissions-Policy)
    - CSRF protection explanation (why wallet flows are safe)
    - WebAuthn origin configuration for passkey verification

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
- **sessionToken Missing from postMessage (2025-12-08)**
  - Added `sessionToken` and `sessionTokenExpiresIn` to card-picker postMessage responses
  - Affects both popup (`popup/card-picker.ejs`) and embed (`embed/card-picker.ejs`) views
  - Required for SSIM JWT Direct integration to receive session tokens for subsequent API calls

- **TypeScript Strict Type Errors in Tests (2025-12-08)**
  - Fixed strict type errors in test files for TypeScript compliance
  - Ensures clean `npm test` runs without type warnings

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
