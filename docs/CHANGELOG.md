# Changelog

All notable changes to this project will be documented in this file.

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
