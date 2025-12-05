# Changelog

All notable changes to the WSIM (Wallet Simulator) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
