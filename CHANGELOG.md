# Changelog

All notable changes to the WSIM (Wallet Simulator) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Design Decisions
- Authentication: Passthrough via bsim (Option A) for initial release
- Credentials: Long-lived wallet credentials from bsim
- Routing: NSIM registry with prefix-based walletCardToken parsing
- Integration: Redirect-based OIDC flow from ssim to wsim
- Scope: Payment credentials only (Open Banking deferred)

## [0.0.0] - 2024-01-15

### Added
- Initial README placeholder
