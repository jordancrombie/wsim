# Changelog

All notable changes to the WSIM (Wallet Simulator) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [0.6.6] - 2026-01-08

**APNs Payload Structure - Root Level** - Put custom data at root level to match Expo Push Service format.

### Changed
- **APNs Payload Structure** (`notification.ts`)
  - Reverted from wrapping data in `{ data: {...} }` to putting data at root level
  - Now matches how Expo Push Service formats APNs payloads
  - Before: `{ "aps": {...}, "data": { "type": "...", "transferId": "..." } }`
  - After: `{ "aps": {...}, "type": "...", "transferId": "...", ... }`
  - Expo/React Native maps all non-aps keys to `notification.request.content.data`

---

## [0.6.5] - 2026-01-08

**APNs Payload Debug Logging** - Added logging to see the exact compiled APNs payload.

### Added
- **Compiled Payload Logging** (`notification.ts`)
  - Logs `notification.payload` after setting it
  - Logs `notification.compile()` to see exact JSON sent to APNs
  - Helps diagnose why data payload isn't reaching iOS devices

---

## [0.6.4] - 2026-01-08

**APNs Payload Structure Fix** - Fixed push notification data payload not reaching iOS devices.

### Fixed
- **APNs Data Payload Structure** (`notification.ts`)
  - Custom data fields were placed at the root level of APNs payload
  - Expo/React Native expects custom data nested under a `data` key
  - Before: `{ "aps": {...}, "type": "...", "transferId": "..." }`
  - After: `{ "aps": {...}, "data": { "type": "...", "transferId": "..." } }`
  - This was causing `data: null` in the notification handler on iOS
  - Micro Merchant dashboard refresh now works correctly when payment notifications arrive

---

## [0.6.3] - 2026-01-07

**Debug Logging** - Comprehensive logging for webhook and push notification troubleshooting.

### Added
- **Webhook Debug Logging** (`webhooks.ts`)
  - Unique request ID for log correlation across services
  - Full incoming payload from TransferSim
  - Headers inspection (signature status, content-type)
  - Transfer details with all fields logged
  - Enrollment lookup results
  - Full notification payload sent to APNs
  - Request timing and response status

- **Notification Service Debug Logging** (`notification.ts`)
  - Unique notification ID for correlation
  - Device query results with token info (truncated for security)
  - Device breakdown by type (APNs/FCM/Expo)
  - Idempotency check results
  - Per-device APNs send details (token, alert, priority, response time)
  - APNs success/failure with error reasons
  - Token deactivation events logged
  - Batch completion summary with timing

---

## [0.6.2] - 2026-01-07

**Micro Merchant Notification Support** - Enhanced webhook to support Micro Merchant payments.

**Compatibility:**
- Requires TransferSim v0.5.2+ (sends `recipientType` and `merchantName` in webhook)
- Backwards compatible with existing P2P transfers

### Added
- **Micro Merchant Webhook Support** (`webhooks.ts`)
  - New fields in webhook payload: `recipientType` ('individual' | 'merchant'), `merchantName`
  - Different notification copy for merchant payments: "Payment Received!" vs "Money Received!"
  - Merchant notifications show business name: "Java Joe's Coffee received $25.00"
  - Push notification data includes `recipientType` and `merchantName` for mwsim dashboard refresh

### Tests
- Added 2 new webhook tests for merchant payment notifications

---

## [0.6.1] - 2026-01-04

**Webhook Signature Fix** - Fixed production webhook signature verification.

### Fixed
- **Webhook Signature Parsing** (`webhooks.ts`) - TransferSim sends signatures as `sha256=<hex>` but WSIM was comparing the full string including the prefix, causing buffer length mismatch and signature verification failure in production
  - Now properly strips `sha256=` prefix before hex comparison
  - Issue was masked in development by signature bypass (dev mode skips verification)

---

## [0.6.0] - 2026-01-04

**Direct APNs Integration** - Architecture revision (AD6) to use direct APNs instead of Expo Push Service.

**Compatibility:**
- Requires mwsim v1.5.0+ (uses native APNs tokens)
- Requires APNs credentials from Apple Developer Portal
- No external service dependencies (fully self-hosted)

### Changed
- **Push Notification Service** (`notification.ts`) - Replaced Expo Push with direct APNs
  - Uses `@parse/node-apn` for APNs HTTP/2 connection
  - Lazy-initialized APNs provider (only created when sending)
  - Graceful fallback when APNs not configured (development)
  - Handles `BadDeviceToken` and `Unregistered` errors to deactivate invalid tokens
  - Groups devices by token type (APNs, FCM, deprecated Expo)
  - FCM placeholder for future Android implementation
  - Added `shutdownNotificationService()` for graceful shutdown

### Configuration
New environment variables for APNs:
```bash
APNS_KEY_ID=ABC123DEFG           # 10-character key ID from Apple
APNS_TEAM_ID=ZJHD6JAC94          # Your Apple Team ID
APNS_KEY_PATH=/path/to/key.p8    # Path to APNs auth key file
APNS_BUNDLE_ID=com.banksim.mwsim # iOS bundle identifier
APNS_PRODUCTION=false            # true for App Store builds
```

### Dependencies
- Removed `expo-server-sdk`
- Added `@parse/node-apn` for direct APNs integration
- Added `@types/apn` for TypeScript definitions

### Migration Notes
- Existing devices with `pushTokenType: 'expo'` will receive deprecation errors
- Users need to re-open mwsim app to register native APNs tokens
- APNs credentials required before push notifications work

### References
- Architecture Decision AD6 in `PUSH_NOTIFICATION_QA.md`
- Apple APNs documentation: https://developer.apple.com/documentation/usernotifications

---

## [0.5.0] - 2026-01-04

**Push Notification Infrastructure** - Phase 1 implementation for mwsim mobile app notifications.

**Compatibility:**
- Requires mwsim with expo-notifications integration
- Works with TransferSim webhook integration (Phase 2)
- **Database migration required** (new NotificationLog model, MobileDevice schema changes)

### Added
- **Push Notification Service** (`notification.ts`)
  - Expo Push integration for iOS/Android notifications
  - `sendNotificationToUser()` - Notify all active devices for a user (per AD3)
  - `sendNotificationToDevice()` - Target specific device
  - Automatic token deactivation on `DeviceNotRegistered` error
  - Chunked sending for large device lists (Expo 100/request limit)
  - Idempotency support via sourceId for webhook retry deduplication

- **TransferSim Webhook Endpoint** (`POST /api/webhooks/transfersim`)
  - HMAC-SHA256 signature verification (production)
  - AD5-compliant enhanced payload format
  - User lookup: `fiUserRef` + `bsimId` → `BsimEnrollment` → `userId` → `MobileDevice`
  - Rich notification copy with sender name and bank info
  - Deep link data for mwsim navigation (`mwsim://transfer/{id}`)

- **Push Token Registration API**
  - `POST /api/mobile/device/push-token` - Register/update Expo push token
  - `DELETE /api/mobile/device/push-token` - Deactivate token on logout
  - Supports token types: `expo`, `apns`, `fcm`

- **Database Schema** (per AD4)
  - Extended `MobileDevice` model: `pushTokenType`, `pushTokenActive`, `pushTokenUpdatedAt`
  - New `NotificationLog` model for audit/debugging
  - Index on `pushToken` for efficient device lookup

### Tests
- 10 webhook tests covering signature verification, user lookup, notification flow
- 3 notification service type export tests

### Fixed
- **Health endpoint version sync** - Version now imported from `package.json` instead of hardcoded string (BSIM team contribution)

### Dependencies
- Added `expo-server-sdk` for Expo Push API integration

### Migration
```bash
npx prisma migrate dev --name add_push_notifications
# or: npx prisma db push
```

### References
- Architecture Decisions: AD1-AD5 from push notification proposal
- Project Tracker: `mwsim/LOCAL_DEPLOYMENT_PLANS/PUSH_NOTIFICATION_PROJECT_TRACKER.md`

---

## [0.4.2] - 2026-01-03

**Enhanced Diagnostic Logging** - More detailed logging to trace `offline_access` scope through the OAuth flow.

### Added
- **Comprehensive Scope Tracing** (`bsim-oidc.ts`)
  - JSON stringify scope string to detect hidden characters
  - Explicit boolean check for `offline_access` presence in input
  - URL searchParams analysis after `buildAuthorizationUrl` call
  - Check both raw and URL-encoded scope in final URL
  - Start/end markers for easier log parsing

### Investigation Update
- BSIM team confirmed auth server does NOT receive `offline_access` in the authorization request
- WSIM code clearly includes `offline_access` in the scope string
- Enhanced logging will reveal if the scope is lost during URL construction or encoding
- Possible causes: URL encoding issue, proxy modification, or browser redirect behavior

---

## [0.4.1] - 2026-01-03

**Diagnostic Logging** - Added detailed logging to troubleshoot refresh token issues.

### Added
- **OAuth Flow Logging** (`bsim-oidc.ts`)
  - Log requested scope when building authorization URL
  - Log full authorization URL and scope parameter for verification
  - Log token response keys after code exchange
  - Log presence/absence of refresh_token with warning if missing
  - Helps diagnose why `offline_access` scope may not be granted

### Investigation
- **Issue**: Refresh tokens not being stored for BSIM/NewBank enrollments
- **Symptom**: Access tokens expire after 1 hour with no way to renew
- **Root cause under investigation**: WSIM sends `offline_access` scope but auth server may not receive it
- See BSIM team analysis for auth server side investigation

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
