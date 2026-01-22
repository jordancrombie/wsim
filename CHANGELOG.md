# Changelog

All notable changes to the WSIM (Wallet Simulator) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [1.0.5] - 2026-01-22

### Added

#### Webhook Notifications for Token Revocations
- **MerchantWebhook model** - Store webhook registrations for merchants (SSIM)
- **WebhookDeliveryLog model** - Track webhook delivery attempts with status codes and errors

#### Webhook API (`/api/agent/v1/webhooks`)
- `POST /` - Register/update webhook subscription (requires introspection credentials)
- `GET /` - Get current webhook registration
- `DELETE /` - Unregister webhook
- `GET /logs` - Get recent delivery logs
- `POST /test` - Send test event

#### Webhook Events
- `token.revoked` - Fired when an agent access token is explicitly revoked
- `agent.deactivated` - Fired when an agent is suspended or revoked by owner
- `agent.secret_rotated` - Fired when an agent's client secret is rotated

#### Security
- HMAC-SHA256 webhook signatures with timestamp for replay protection
- Headers: `X-Webhook-Timestamp`, `X-Webhook-Signature: sha256={signature}`
- Signature payload: `{timestamp}.{json_body}`

### Database Migration Required
```bash
npx prisma migrate deploy
```

Creates 2 new tables: `merchant_webhooks`, `webhook_delivery_logs`

---

## [1.0.4] - 2026-01-22

### Fixed
- **Token expiry parsing**: Added `parseDuration()` to support "1h", "5m" format for `AGENT_ACCESS_TOKEN_EXPIRY` and `PAYMENT_TOKEN_EXPIRY` (was incorrectly parsing "1h" as 1 second)
- **Minimum expiry validation**: Enforces 60s minimum for access tokens, 30s for payment tokens
- **Snake_case API responses**: All SACP endpoints now return snake_case keys matching OpenAPI spec
- **Agent list filtering**: `GET /api/mobile/agents` now excludes revoked agents by default (use `?include_revoked=true` to include)

### Changed
- Updated `.env.example` with SACP configuration documentation

---

## [1.0.3] - 2026-01-22

### Fixed
- Fixed agent access request route path (`/api/agent/v1/` → `/api/agent/v1/access-request`)

---

## [1.0.2] - 2026-01-22

### Changed
- Made max active pairing codes configurable via `MAX_ACTIVE_PAIRING_CODES` env var
- Default: 30 in dev, 10 in production (was hardcoded to 3)

---

## [1.0.1] - 2026-01-22

### Fixed
- Fixed doubled route paths in access-request.ts (`/api/mobile/access-requests/access-requests` → `/api/mobile/access-requests`)

### Added

#### Agent-Initiated Credential Flow (Access Request)
- `PairingCode` model - User-generated codes for agent binding (WSIM-XXXXXX-XXXXXX format, 24h expiry)
- `AccessRequest` model - Agent access request tracking with approval workflow

#### Pairing Code Endpoints (`/api/mobile/pairing-codes`)
- `POST /` - Generate pairing code (max 3 active per user)

#### Access Request Endpoints - Mobile (`/api/mobile/access-requests/*`)
- `GET /` - List pending access requests
- `GET /:id` - Get access request details for approval screen
- `POST /:id/approve` - Approve with optional limit decreases (biometric required)
- `POST /:id/reject` - Reject with optional reason

#### Access Request Endpoints - Agent (`/api/agent/v1/*`)
- `POST /access-request` - Create access request using pairing code
- `GET /access-request/:id` - Poll for request status (returns credentials on approval)
- `GET /access-request/:id/qr` - Get QR code data for in-person binding

#### Notification Types
- `agent.access_request` - Push notification for new access request approval

#### Deep Link Support
- Added `accessRequestId` to DeepLinkParams for notification navigation

### Database Migration Required
```bash
npx prisma migrate deploy
```

Creates 2 additional tables: `pairing_codes`, `access_requests`

---

## [1.0.0] - 2026-01-21

**Agent Commerce Protocol (SACP)** - AI agents can now make purchases on behalf of users with spending controls and step-up authorization.

### Added

#### Database Schema (4 new models)
- `Agent` - AI agent registration with OAuth credentials and spending limits
- `AgentAccessToken` - OAuth access token tracking for revocation
- `AgentTransaction` - Transaction history for spending limit calculations
- `StepUpRequest` - Step-up authorization requests for high-value purchases

#### Agent OAuth Endpoints (`/api/agent/v1/oauth/*`)
- `POST /token` - OAuth 2.0 client credentials grant for agents
- `POST /introspect` - Token introspection for merchants (SSIM)
- `POST /revoke` - Token revocation

#### Payment Token API (`/api/agent/v1/payments/*`)
- `POST /token` - Request payment token (may trigger step-up)
- `GET /:paymentId/status` - Check payment or step-up status
- `GET /methods` - List available payment methods with spending info

#### Agent Management (`/api/mobile/agents/*`)
- `POST /` - Register new agent (returns client credentials)
- `GET /` - List user's agents with usage stats
- `GET /:id` - Get agent details and remaining limits
- `PATCH /:id` - Update agent settings
- `DELETE /:id` - Revoke agent
- `POST /:id/rotate-secret` - Rotate client secret (revokes all tokens)
- `GET /:id/transactions` - Get agent transaction history

#### Step-Up Authorization (`/api/mobile/step-up/*`)
- `GET /` - List pending step-up requests
- `GET /:stepUpId` - Get step-up details for approval screen
- `POST /:stepUpId/approve` - Approve step-up (select payment method)
- `POST /:stepUpId/reject` - Reject step-up

#### Services
- `agent-auth.ts` - Token generation, validation, introspection
- `spending-limits.ts` - EST timezone-aware spending limit calculations

#### Notification Types
- `agent.step_up` - Push notification for step-up approval
- `agent.transaction` - Agent transaction completed
- `agent.limit_warning` - Approaching spending limit
- `agent.suspended` - Agent auto-suspended

### Environment Variables (New)
```
AGENT_JWT_SECRET         - JWT signing key for agent tokens (REQUIRED in production)
AGENT_ACCESS_TOKEN_EXPIRY - Token expiry in seconds (default: 3600)
PAYMENT_TOKEN_SECRET     - JWT signing key for payment tokens (REQUIRED in production)
PAYMENT_TOKEN_EXPIRY     - Payment token expiry (default: 300)
STEP_UP_EXPIRY_MINUTES   - Step-up request expiry (default: 15)
DAILY_LIMIT_RESET_TIMEZONE - Timezone for daily limit reset (default: America/Toronto)
INTROSPECTION_CLIENT_ID  - Client ID for merchant introspection (default: ssim_introspect)
INTROSPECTION_CLIENT_SECRET - Client secret for merchant introspection (REQUIRED in production)
```

### Dependencies
- Added `nanoid@^5.0.0` for client ID generation
- Added `luxon@^3.4.0` for timezone handling

### Database Migration Required
```bash
npx prisma migrate deploy
```

Creates 4 new tables: `agents`, `agent_access_tokens`, `agent_transactions`, `step_up_requests`

### Documentation
- OpenAPI spec: `docs/sacp/openapi-agent.yaml`
- mwsim requirements: `docs/sacp/MWSIM_REQUIREMENTS.md`

---

## [0.9.9] - 2026-01-20

### Added
- Profile lookup endpoint now accepts `alias` parameter for recipient lookup
- Aliases resolved via TransferSim's internal alias API with local email fallback
- Supports `@username`, `username`, and `email@example.com` formats

---

## [0.9.8] - 2026-01-19

### Fixed
- Profile lookup now falls back to `fiUserRef` (BSIM user ID) if `walletId` not found
- Fixes 404 errors when mwsim passes fiUserRef as walletId for transfer resolution

---

## [0.9.7] - 2026-01-19

### Fixed
- Contract responses now include `displayName` resolved from WSIM database (was using stale ContractSim data)
- Added `counterpartyIsVerified` and `counterpartyVerificationLevel` to contract list items
- Added `isVerified` and `verificationLevel` to party objects in contract details
- WSIM is now the authoritative source for all profile data in contract responses

---

## [0.9.6] - 2026-01-19

### Changed
- Profile lookup endpoint now accepts `walletId` as alternative to `bsimUserId + bsimId`
- Enables mwsim to resolve contract counterparties by WSIM wallet ID

---

## [0.9.5] - 2026-01-19

### Added
- `GET /api/mobile/profile/lookup` - Mobile-accessible endpoint to look up other users' profiles by bsimUserId + bsimId
- Returns: displayName, profileImageUrl, initials, initialsColor, isVerified, verificationLevel
- Enables mwsim to resolve transfer sender/recipient UUIDs with proper JWT auth

---

## [0.9.4] - 2026-01-19

### Fixed
- Wallet summary endpoint now returns verification fields (`isVerified`, `verifiedAt`, `verificationLevel`, `profileImageUrl`)
- Fixes gold checkmark not persisting after re-login in mwsim

---

## [0.9.3] - 2026-01-19

### Added
- HMAC-SHA256 key type support for device key registration
- HMAC keys validated as hex strings (not base64)
- HMAC signature verification: `SHA256(payload + ':' + key)`

---

## [0.9.2] - 2026-01-19

**Trusted User Verification** - Identity verification endpoints and database schema.

### Added
- `POST /api/mobile/device/register-key` - Register device public key for signature verification
- `POST /api/mobile/verification/submit` - Submit signed verification result
- `DELETE /api/mobile/verification` - Remove verification status (for testing)
- `DELETE /api/mobile/account` - Delete user account (for testing)
- New database tables: `device_keys`, `user_verifications`
- WalletUser fields: `isVerified`, `verifiedAt`, `verificationLevel`
- Profile endpoint now returns verification status

### Security
- Asymmetric signature verification (ECDSA-P256 / RSA-2048)
- Device-bound keys with public key registration
- No PII stored - only verification metadata

---

## [0.9.1] - 2026-01-18

**Contract Profile Enrichment** - Contract responses now include user profile data (images, initials colors).

### Added
- `getUserProfiles()` batch lookup helper for efficient profile data retrieval
- Contract list items now include `counterpartyProfileImageUrl` and `counterpartyInitialsColor`
- Contract party objects now include `profileImageUrl` and `initialsColor`
- OpenAPI spec updated with new profile fields in Contract and ContractParty schemas

### Changed
- `transformContractListItem()` now enriches responses with counterparty profile data
- `transformParty()` now enriches party objects with profile data
- List, detail, and create endpoints perform batch profile lookups before transforming

---

## [0.9.0] - 2026-01-16

**Contract Webhook Notification Alignment** - Enhanced contract notifications per PROPOSAL_WEBHOOK_NOTIFICATIONS.md spec.

### Changed
- Updated ContractWebhookPayload interface with actor-specific fields
- `contract.accepted`: Now uses `accepted_by.display_name`
- `contract.funded`: Now uses `funded_by.display_name` and `contract_status`
- `contract.outcome`: Now uses `opponent.display_name` for personalized messages
- `contract.cancelled`: Now uses `cancelled_by.display_name`
- `contract.disputed`: Now uses `disputed_by.display_name`

### Added
- New interface fields: `accepted_by`, `funded_by`, `cancelled_by`, `disputed_by`, `opponent`
- New event fields: `contract_status`, `refund_amount`
- Expo `experienceId` in APNs payload (required for expo-notifications)

### Fixed
- Push notification custom data now properly included in APNs payload
- Fixes `data: null` issue on Expo/mwsim side when receiving notifications

---

## [0.8.2] - 2026-01-16

**APNs Payload Fix** - Custom data now correctly included in push notifications.

### Fixed
- Push notification custom data (screen, params, type, etc.) now properly included in APNs payload
- Changed from `rawPayload` approach to using `@parse/node-apn` built-in properties (`notification.payload`)
- Fixes `data: null` issue on Expo/mwsim side when receiving notifications

---

## [0.8.1] - 2026-01-16

**Push Notification Deep Linking** - Tap notifications to navigate directly to relevant screens.

### Added
- Deep linking support for push notifications (`screen` and `params` fields)
- `DeepLinkParams` interface for type-safe navigation parameters
- Transfer notifications now include `screen: 'TransferDetail'` with `transferId`
- Contract notifications now include `screen: 'ContractDetail'` with `contractId`

### Fixed
- Contract funding now sends `bsim_user_id` to ContractSim (instead of `party_id` and `bank_id`)
- ContractSim orchestrates escrow creation with BSIM using the correct user identifier
- Fund endpoint now auto-fetches user's BSIM account_id when not provided by mobile
- Fixes "Account not found" error when funding contracts without explicit account selection

---

## [0.8.0] - 2026-01-11

**ContractSim Integration** - Proxy layer for conditional payments (wagers, escrow) between users.

### Added

#### Contract Proxy API (`/api/mobile/contracts/*`)
- `GET /api/mobile/contracts` - List user's contracts (filtered by status)
- `GET /api/mobile/contracts/:id` - Get contract details
- `POST /api/mobile/contracts` - Create contract (with alias resolution)
- `POST /api/mobile/contracts/:id/accept` - Accept contract invitation
- `POST /api/mobile/contracts/:id/fund` - Initiate escrow funding
- `POST /api/mobile/contracts/:id/cancel` - Cancel unfunded contract

#### Internal Contracts API (`/api/internal/contracts/*`)
- `GET /api/internal/contracts/profile/:walletId` - Profile lookup by walletId
- For ContractSim to fetch party display info (displayName, profileImageUrl, initialsColor)
- Authenticated via `X-Internal-Api-Key` header

#### Alias Resolution (`contracts.ts`)
- `resolveAlias()` - Resolves @username or email to walletId
- Looks up BsimEnrollment by alias → WalletUser → walletId
- Supports email addresses (exact match) and @usernames

#### ContractSim Webhook Handler (`/api/webhooks/contractsim`)
- HMAC-SHA256 signature verification
- Idempotent processing via NotificationLog
- Handles 8 contract event types with push notifications

#### Contract Notification Templates (`notification.ts`)
New notification types for contract lifecycle events:
- `contract.proposed` - New contract invitation
- `contract.accepted` - Counterparty accepted
- `contract.funded` - Contract now active
- `contract.outcome` - Result determined (win/lose)
- `contract.settled` - Funds transferred
- `contract.disputed` - Dispute raised
- `contract.expired` - Funding timeout
- `contract.cancelled` - Contract cancelled

#### Configuration (`env.ts`)
- `CONTRACTSIM_API_URL` - ContractSim service URL (default: http://localhost:3007)
- `CONTRACTSIM_API_KEY` - API key for WSIM → ContractSim calls
- `CONTRACTSIM_WEBHOOK_SECRET` - HMAC secret for webhook verification

#### Pipeline Updates
- Added ContractSim env vars to `pipeline-dev.yaml` and `pipeline-dev-sandbox.yaml`

### Documentation
- Updated OpenAPI spec (`docs/openapi.yaml`) to v0.8.0 with contract endpoints
- Added Contract, ContractParty, CreateContractRequest schemas

### No Database Changes Required
Uses existing tables: WalletUser, BsimEnrollment, MobileDevice, NotificationLog

### References
- ContractSim Integration Guide: `/docs/INTEGRATION_WSIM.md` (in contractSim repo)
- Project Plan: `/LOCAL_DEPLOYMENT_PLANS/PROJECT_PLAN.md` (in contractSim repo)

---

## [0.7.0] - 2026-01-09

**Phase 1 User Profile** - User profile management with image upload and internal API for TransferSim.

### Added

#### Prisma Schema
- New profile fields on `WalletUser` model:
  - `displayName` - Editable display name (defaults to firstName + lastName)
  - `profileImageUrl` - CDN URL for profile image
  - `profileImageKey` - S3 key for deletion/replacement
  - `initialsColor` - Background color for initials avatar fallback

#### Mobile Profile API (`/api/mobile/profile/*`)
- `GET /api/mobile/profile` - Get authenticated user's profile
- `PUT /api/mobile/profile` - Update profile (displayName)
- `POST /api/mobile/profile/image` - Upload profile image (multipart/form-data)
- `DELETE /api/mobile/profile/image` - Delete profile image

#### Internal Profile API (`/api/internal/profile`)
- `GET /api/internal/profile?bsimUserId={id}&bsimId={bsimId}`
- For TransferSim to fetch sender profile image for webhook payloads
- Authenticated via `X-Internal-Api-Key` header (uses `INTERNAL_API_SECRET`)

#### Image Upload Service (`image-upload.ts`)
- Sharp-based image processing: resize to 512x512, 128x128, 64x64
- EXIF data stripping for privacy
- Magic byte validation for JPEG, PNG, HEIC
- File size validation (configurable, default 5MB)
- S3 upload with CDN cache busting
- Rate limiting (configurable, default 100 uploads/user/hour)

#### Configuration (`env.ts`)
- `AWS_REGION` - AWS region (default: ca-central-1)
- `AWS_S3_BUCKET_PROFILES` - S3 bucket name (default: banksim-profiles-wsim)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` - AWS credentials
- `CDN_BASE_URL` - CloudFront CDN URL (default: https://cdn.banksim.ca)
- `PROFILE_IMAGE_MAX_SIZE_MB` - Max image size (default: 5)
- `PROFILE_IMAGE_UPLOAD_RATE_LIMIT` - Max uploads per user per hour (default: 100)

#### Dependencies
- `@aws-sdk/client-s3` - AWS S3 SDK for image storage
- `sharp` - Image processing library
- `multer` - Multipart form data handling

#### Tests
- `profile.test.ts` - 23 tests covering all profile API endpoints
  - Mobile auth (JWT validation)
  - GET/PUT/POST/DELETE profile operations
  - Internal API key authentication
  - Error handling and validation
- `image-upload.test.ts` - 21 tests for image processing service
  - `generateInitials()` and `generateInitialsColor()` utilities
  - File validation (size, MIME type, magic bytes)
  - S3 upload/delete operations (mocked)
  - Sharp image processing (mocked)
- Coverage: `profile.ts` 83%, `image-upload.ts` 98%

### Migration Required
Run `prisma migrate deploy` to add profile fields to WalletUser table.

### Infrastructure Required
- S3 bucket: `banksim-profiles-wsim`
- CloudFront distribution with path routing `/users/*` → S3 bucket
- **CloudFront Cache Key**: Must include `v` query string parameter for cache busting
  - Without this, `?v=timestamp` cache-buster is ignored and old images are served

---

## [0.6.7] - 2026-01-08

**APNs rawPayload Fix** - Use `rawPayload` for complete control over APNs payload structure.

### Fixed
- **APNs Payload Using rawPayload** (`notification.ts`)
  - Previous approach using `notification.payload` wasn't reliably placing custom data at root level
  - Now uses `notification.rawPayload` to set the EXACT JSON structure sent to APNs
  - Custom data fields (type, transferId, amount, etc.) are now guaranteed siblings of `aps`
  - Payload structure: `{ "aps": { "alert": {...}, "sound": "default", "badge": 1 }, "type": "...", "transferId": "...", ... }`
  - iOS/Expo maps all non-aps root keys to `notification.request.content.data`

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
