# WSIM - Wallet Simulator

A centralized digital wallet simulator that aggregates payment credentials from multiple banking simulators (bsims). Part of the payment simulation ecosystem alongside [bsim](../bsim), [ssim](../ssim), and [nsim](../nsim).

## Overview

WSIM acts as a credential vault, similar to Apple Pay or Google Pay, allowing users to:

1. **Enroll cards** from multiple bsims into a single wallet
2. **Authenticate once** to the wallet and access all enrolled credentials
3. **Pay at stores** (ssims) without re-authenticating to each bank

```
┌─────────┐     ┌─────────┐     ┌─────────┐
│  BSIM   │     │  BSIM   │     │  BSIM   │   (Banks)
│  (TD)   │     │ (RBC)   │     │ (BMO)   │
└────┬────┘     └────┬────┘     └────┬────┘
     │               │               │
     └───────────────┼───────────────┘
                     │
                     ▼
              ┌─────────────┐
              │    WSIM     │  (Wallet)
              │  ┌───────┐  │
              │  │ Cards │  │
              │  └───────┘  │
              └──────┬──────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
   ┌─────────┐  ┌─────────┐  ┌─────────┐
   │  SSIM   │  │  SSIM   │  │  SSIM   │  (Stores)
   └─────────┘  └─────────┘  └─────────┘
```

## Project Status

**Current Phase**: Planning Complete

See [TODO.md](./TODO.md) for current progress and [CHANGELOG.md](./CHANGELOG.md) for history.

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE_PLAN.md](./ARCHITECTURE_PLAN.md) | System design, data models, flows |
| [WSIM_IMPLEMENTATION_PLAN.md](./WSIM_IMPLEMENTATION_PLAN.md) | Core implementation details |
| [ORDER_OF_OPERATIONS.md](./ORDER_OF_OPERATIONS.md) | Timeline and team coordination |
| [FUTURE_CONSIDERATIONS.md](./FUTURE_CONSIDERATIONS.md) | Deferred features and enhancements |

### Team Sub-Plans

| Team | Document | Summary |
|------|----------|---------|
| BSIM | [BSIM_SUBPLAN.md](./BSIM_SUBPLAN.md) | Wallet credential support, new APIs |
| NSIM | [NSIM_SUBPLAN.md](./NSIM_SUBPLAN.md) | Multi-bsim routing registry |
| SSIM | [SSIM_SUBPLAN.md](./SSIM_SUBPLAN.md) | "Pay with Wallet" integration |

## Tech Stack (Planned)

- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL + Prisma
- **Frontend**: Next.js 14 + React + Tailwind CSS
- **Auth Server**: oidc-provider
- **OIDC Client**: openid-client (for bsim integration)

## Quick Start

> **Note**: Project scaffolding not yet complete. See [WSIM_IMPLEMENTATION_PLAN.md](./WSIM_IMPLEMENTATION_PLAN.md) for setup instructions.

```bash
# Coming soon
docker-compose up -d
```

## Related Projects

- [bsim](../bsim) - Banking Simulator
- [ssim](../ssim) - Store Simulator
- [nsim](../nsim) - Payment Network Simulator

## Contributing

This project is part of a coordinated multi-team effort. Please review:

1. [ORDER_OF_OPERATIONS.md](./ORDER_OF_OPERATIONS.md) for dependencies and timing
2. Your team's sub-plan document for specific tasks
3. [TODO.md](./TODO.md) for current status

## License

Private - Internal Use Only
