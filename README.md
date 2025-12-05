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

**Current Phase**: Enrollment Flow Ready for Testing

- BSIM team has completed Phase 1 (`wallet:enroll` scope and wallet APIs)
- WSIM enrollment flow is implemented and ready for E2E testing
- Payment flow implementation in progress

See [TODO.md](./TODO.md) for detailed progress and [CHANGELOG.md](./CHANGELOG.md) for history.

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Local DNS entries (for BSIM-orchestrated environment):
  ```
  127.0.0.1 wsim-dev.banksim.ca
  127.0.0.1 wsim-auth-dev.banksim.ca
  ```

### Development Setup

#### Option 1: BSIM-Orchestrated Environment (Recommended)

```bash
# From the bsim directory (requires BSIM integration complete)
make dev-build
```

Access at: https://wsim-dev.banksim.ca

#### Option 2: Standalone Development

```bash
# Start PostgreSQL
docker-compose up postgres -d

# Run backend (terminal 1)
cd backend && cp .env.example .env && npm install && npm run dev

# Run auth-server (terminal 2)
cd auth-server && cp .env.example .env && npm install && npm run dev

# Run frontend (terminal 3)
cd frontend && npm install && npm run dev
```

Access at: http://localhost:3004

### Environment Configuration

The backend requires BSIM provider configuration. Edit `backend/.env`:

```bash
# For BSIM-orchestrated dev environment:
BSIM_PROVIDERS='[{"bsimId":"bsim","name":"Bank Simulator","issuer":"https://auth-dev.banksim.ca","apiUrl":"https://dev.banksim.ca","clientId":"wsim-wallet","clientSecret":"wsim-dev-secret"}]'
```

## Architecture

### Services

| Service | Port | Dev URL | Description |
|---------|------|---------|-------------|
| Backend | 3003 | https://wsim-dev.banksim.ca/api | REST API server |
| Auth Server | 3005 | https://wsim-auth-dev.banksim.ca | OIDC provider for SSIMs |
| Frontend | 3000 | https://wsim-dev.banksim.ca | Next.js web app |

### Tech Stack

- **Backend**: Express.js + TypeScript + Prisma
- **Database**: PostgreSQL
- **Frontend**: Next.js 14 + React + Tailwind CSS
- **Auth Server**: oidc-provider
- **OIDC Client**: openid-client v6 (for BSIM integration)

### Key Flows

1. **Enrollment Flow**: User enrolls cards from BSIM into WSIM
   - WSIM → BSIM OAuth with `wallet:enroll` scope
   - Cards fetched and stored with `walletCardToken` for NSIM routing

2. **Payment Flow**: User pays at SSIM using wallet
   - SSIM → WSIM OAuth with `payment:authorize` scope
   - WSIM fetches ephemeral `cardToken` from BSIM
   - SSIM → NSIM with both `walletCardToken` and `cardToken`

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE_PLAN.md](./ARCHITECTURE_PLAN.md) | System design, data models, flows |
| [WSIM_IMPLEMENTATION_PLAN.md](./WSIM_IMPLEMENTATION_PLAN.md) | Core implementation details |
| [BSIM_DEPLOYMENT_INTEGRATION.md](./BSIM_DEPLOYMENT_INTEGRATION.md) | BSIM docker-compose integration |
| [FUTURE_CONSIDERATIONS.md](./FUTURE_CONSIDERATIONS.md) | Deferred features and enhancements |

### Team Sub-Plans

| Team | Document | Summary |
|------|----------|---------|
| BSIM | [BSIM_SUBPLAN.md](./BSIM_SUBPLAN.md) | Wallet credential support, new APIs |
| NSIM | [NSIM_SUBPLAN.md](./NSIM_SUBPLAN.md) | Multi-bsim routing registry |
| SSIM | [SSIM_SUBPLAN.md](./SSIM_SUBPLAN.md) | "Pay with Wallet" integration |

## API Endpoints

### Backend API (`/api`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/enrollment/banks` | List available banks for enrollment |
| POST | `/enrollment/start/:bsimId` | Start bank enrollment flow |
| GET | `/enrollment/callback/:bsimId` | OIDC callback handler |
| GET | `/enrollment/list` | List user's enrolled banks |
| DELETE | `/enrollment/:enrollmentId` | Remove bank enrollment |
| GET | `/wallet/cards` | List user's cards |
| DELETE | `/wallet/cards/:cardId` | Remove a card |

### Auth Server (OIDC)

| Endpoint | Description |
|----------|-------------|
| `/.well-known/openid-configuration` | OIDC discovery |
| `/authorize` | Authorization endpoint |
| `/token` | Token endpoint |
| `/interaction/:uid` | User interaction (card selection) |

## Related Projects

- [bsim](../bsim) - Banking Simulator
- [ssim](../ssim) - Store Simulator
- [nsim](../nsim) - Payment Network Simulator

## Contributing

This project is part of a coordinated multi-team effort. Please review:

1. [TODO.md](./TODO.md) for current status
2. Your team's sub-plan document for specific tasks
3. [BSIM_SUBPLAN.md](./BSIM_SUBPLAN.md) FAQ section for integration questions

## License

Private - Internal Use Only
