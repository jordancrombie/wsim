# Changelog

All notable changes to the WSIM (Wallet Simulator) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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

- **URL Configuration**
  - Support for dev environment URLs (`*-dev.banksim.ca`)
  - `getBsimApiUrl()` helper for deriving API URL from OIDC issuer
  - Optional `apiUrl` field in provider config for explicit override

- **Documentation**
  - FAQ section in BSIM_SUBPLAN.md answering team integration questions
  - BSIM_DEPLOYMENT_INTEGRATION.md for docker-compose setup
  - Updated README with quick start guide and API documentation

### Changed
- Updated `.env.example` with proper dev environment URLs
- CORS configuration includes all dev subdomains

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
