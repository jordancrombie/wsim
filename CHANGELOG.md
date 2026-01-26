# Changelog

All notable changes to WSIM (Wallet Simulator) will be documented in this file.

## [1.2.9] - 2026-01-26

### Fixed
- **Remove redundant push notification in web flow**: When user clicks the verification URL with token:
  - Previously sent a second "Authorize Agent" push (device_authorization already sent one)
  - Now authenticates user via token and redirects directly to approval page
  - Eliminates confusing duplicate notifications

## [1.2.8] - 2026-01-26

### Added
- **Fallback authentication on waiting page**: When push notification doesn't arrive, users can now authenticate directly:
  - **Passkey authentication**: If user has registered passkeys, they can sign in with Face ID/Touch ID
  - **Password authentication**: Users can sign in with email + password
  - Waiting page now shows "OR" section with fallback auth options for known users
  - On successful auth, redirects directly to approval page

## [1.2.7] - 2026-01-26

### Added
- **Optimized QR code web fallback**: When Gateway appends a signed token (`&t=...`) to `verification_uri_complete`:
  - Token format: `base64url(email).hmac_sha256(email:code, INTERNAL_API_SECRET)`
  - Automatically validates code, looks up user by email, and sends push notification
  - Skips manual code entry and email login steps for smoother UX
  - Falls back to standard flow if token is invalid or user not found

## [1.2.6] - 2026-01-26

### Fixed
- **Routing**: Move device auth web flow from `/m/device` to `/api/m/device` to fix ALB routing issue
  - The `/m/device` path was being routed to the frontend container instead of the backend
  - All internal form actions, redirects, and verification URIs updated to use `/api/m/device`

## [1.2.5] - 2026-01-26

### Added
- **Push notifications for device authorization**: When `buyer_email` is provided to the device_authorization endpoint, WSIM looks up the user and sends a push notification directly to their mobile device
- New response fields: `notification_sent` and `notification_user_id` in device_authorization response
- Pre-linking support: When push notification is sent, the pairing code is pre-linked to the user (status goes directly to `pending`)

## [1.2.4] - 2026-01-26

### Added
- **`response_type` parameter**: Device authorization endpoint now accepts `response_type` parameter
  - `credentials` (default): Returns `client_id` + `client_secret` for agent onboarding
  - `token`: Returns `access_token` directly for guest checkout (one-time use)
- New `responseType` field in AccessRequest database schema

## [1.2.3] - 2026-01-26

### Added
- **Web-based device code entry flow**: Complete web UI at `/m/device` for users to enter device codes
  - Device code entry page with auto-prefill from URL parameter
  - Email-based login with push notification authentication
  - Approval/rejection screens with permission and spending limit display
  - Session-based authentication for the web flow

## [1.2.2] - 2026-01-26

### Fixed
- **Route alias**: Added `/api/mobile/device-codes/claim` as alias for device code verification
- Fixed 404 error when mwsim submitted device codes

## [1.2.1] - 2026-01-26

### Fixed
- **Database schema**: Made `PairingCode.userId` nullable to support Device Authorization Grant
- Device authorization codes now created without a user ID (claimed later when user enters code)

## [1.2.0] - 2026-01-26

### Added
- **SACP Gateway support**: Initial guest checkout flow implementation
- Device Authorization Grant (RFC 8628) for guest checkout
- Token endpoint polling for authorization status

## [1.1.9] - 2026-01-26

### Fixed
- **OAuth security**: Added nonce-based CSP and form fallback for authorize page
- Improved security headers for OAuth flows

## [1.1.8] - 2026-01-26

### Fixed
- **OAuth validation**: Made `response_type` validation more lenient for better compatibility

## [1.1.7] - 2026-01-26

### Added
- **PKCE optional**: Made PKCE optional for confidential clients (server-side apps with client secrets)

## [1.1.6] - 2026-01-26

### Fixed
- **ChatGPT integration**: Fixed redirect URI validation for ChatGPT connector

## [1.1.5] - 2026-01-25

### Added
- **ChatGPT Connectors**: OAuth Authorization Code flow with PKCE support
- Full RFC 6749 and RFC 7636 compliance for public and confidential clients

## [1.1.4] - 2026-01-25

### Fixed
- **Token rotation**: Prevent refresh token loss during token rotation in BSIM integration

## [1.1.3] - 2026-01-25

### Added
- **OAuth Device Authorization**: RFC 8628 Device Authorization Grant for CLI/IoT devices
- **AI Discovery**: `.well-known/ai-plugin.json` and OpenAPI spec for AI assistants
- **Multi-client introspection**: Support multiple introspection clients via JSON config
