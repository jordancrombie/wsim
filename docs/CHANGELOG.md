# Changelog

All notable changes to this project will be documented in this file.

## 2025-12-11

### Added
- **In-Bank Enrollment (Cross-Origin Passkey Registration)**: New feature allowing users to enroll in WSIM from within their bank's website without redirecting away
  - `/.well-known/webauthn` endpoint for WebAuthn Related Origin Requests
  - `/enroll/embed` routes for popup/iframe enrollment flow
  - Card selection UI with passkey registration
  - HMAC signature verification for secure identity passing
  - Already-enrolled detection
  - Session token generation on successful enrollment

### Security
- **Server-to-server card fetch for enrollment**: Card data (even masked last4, expiry) is now fetched server-to-server during embedded enrollment, rather than being passed through browser postMessage. Only a short-lived `cardToken` JWT passes through the browser.

### Documentation
- **BSIM Integration Guide**: Created comprehensive integration documentation for banks to implement the enrollment flow ([BSIM_ENROLLMENT_INTEGRATION.md](BSIM_ENROLLMENT_INTEGRATION.md))
- **Feature BRD**: Added detailed requirements and implementation tracking ([IN_BANK_ENROLLMENT.md](features/IN_BANK_ENROLLMENT.md))

## 2025-12-09

### Fixed
- **Passkey grace period consumption**: Fixed bug where grace period persisted across multiple transactions, allowing users to skip passkey authentication on subsequent purchases. Grace period is now consumed (cleared) after each successful payment, ensuring at least one passkey authentication per transaction.

### Added
- **Health check endpoints (ECS/ALB compatible)**: Added standardized health check endpoints for deployment readiness:
  - Auth Server: Added `/health/ready` and `/health/live` endpoints
  - Frontend: Added `/health`, `/health/ready`, and `/health/live` API routes
  - Pattern follows AWS ECS/ALB best practices (liveness vs readiness checks)

### Documentation
- **Merchant Authorization Grants**: Added architecture documentation for future OAuth-style merchant authorization with browser-portable JWT tokens
- **Health Check Deployment Notes**: Added deployment configuration examples for nginx and AWS ECS/ALB in FUTURE_CONSIDERATIONS.md

## 2025-12-08

### Added
- **Quick Pay documentation**: Added Method 4 (Quick Pay / Quick Checkout) to merchant integration guide for returning user optimization
- **Global auth context**: Added session detection across tabs for improved UX

### Fixed
- **Card picker views**: Added sessionToken to postMessage responses
