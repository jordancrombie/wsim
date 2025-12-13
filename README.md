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

**Current Phase**: Production Ready

### Key Features

- **Multiple Integration Methods**: Popup, Inline (iframe), Redirect, and Quick Pay flows
- **In-Bank Enrollment**: Users can enroll directly from partner bank websites via embedded iframe
- **Cross-Origin Passkey Registration**: WebAuthn Level 3 Related Origin Requests support
- **Partner SSO**: Server-to-server JWT-based authentication for seamless cross-device access
- **Passkey Authentication**: WebAuthn/FIDO2 for secure, passwordless login
- **Admin Dashboard**: OAuth client management with passkey-only admin access
- **Modern Checkout UI**: Branded wallet checkout with step progress and payment summary

### Recent Updates (December 2025)

- JWT bearer token authentication for SSIM API Direct integration
- Schema sync validation script for shared database safety
- Admin-configurable WebAuthn Related Origins for Quick Pay
- Cross-domain passkey authentication on merchant domains
- In-Bank Enrollment with cross-origin passkey registration
- Redirect flow checkout UI redesign with branded wallet experience
- Partner SSO for cross-device wallet access
- Admin UI enhancements (grant types, API key management, Quick Pay origins)

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
- **Frontend**: Next.js 16 + React 19 + Tailwind CSS
- **Auth Server**: oidc-provider
- **OIDC Client**: openid-client v6 (for BSIM integration)
- **Containers**: Multi-stage Docker builds (node:20-alpine)

### Key Flows

1. **Enrollment Flow**: User enrolls cards from BSIM into WSIM
   - WSIM → BSIM OAuth with `wallet:enroll` scope
   - Cards fetched and stored with `walletCardToken` for NSIM routing

2. **Payment Flow**: User pays at SSIM using wallet
   - SSIM → WSIM OAuth with `payment:authorize` scope
   - WSIM fetches ephemeral `cardToken` from BSIM
   - SSIM → NSIM with both `walletCardToken` and `cardToken`

## Docker

All services have production-ready Dockerfiles with multi-stage builds:

| Service | Dockerfile | Internal Port |
|---------|------------|---------------|
| Backend | `backend/Dockerfile` | 3003 |
| Auth Server | `auth-server/Dockerfile` | 3005 |
| Frontend | `frontend/Dockerfile` | 3000 |

Features:
- Multi-stage builds (deps → builder → runner)
- Non-root users for security
- Health checks on all services
- Next.js standalone output mode

See [docs/DEPLOYMENT_GUIDE.md](./docs/DEPLOYMENT_GUIDE.md) for complete docker-compose configuration.

## Documentation

### Architecture & Planning

| Document | Description |
|----------|-------------|
| [docs/ARCHITECTURE_PLAN.md](./docs/ARCHITECTURE_PLAN.md) | System design, data models, flows |
| [docs/FUTURE_CONSIDERATIONS.md](./docs/FUTURE_CONSIDERATIONS.md) | Deferred features and enhancements |

### Integration Guides

| Document | Description |
|----------|-------------|
| [docs/DEPLOYMENT_GUIDE.md](./docs/DEPLOYMENT_GUIDE.md) | Docker, nginx, environment setup |
| [docs/MERCHANT_UI_INTEGRATION_GUIDE.md](./docs/MERCHANT_UI_INTEGRATION_GUIDE.md) | Popup, iframe, redirect, Quick Pay integration |
| [docs/API_PAYMENT_INTEGRATION_FLOWS.md](./docs/API_PAYMENT_INTEGRATION_FLOWS.md) | API-based wallet integration |
| [docs/BANK_INTEGRATION_API.md](./docs/BANK_INTEGRATION_API.md) | Bank provider integration spec |
| [docs/PAYMENT_NETWORK_INTEGRATION.md](./docs/PAYMENT_NETWORK_INTEGRATION.md) | Payment network routing integration |
| [docs/BSIM_ENROLLMENT_INTEGRATION.md](./docs/BSIM_ENROLLMENT_INTEGRATION.md) | In-bank enrollment integration for partners |
| [docs/features/IN_BANK_ENROLLMENT.md](./docs/features/IN_BANK_ENROLLMENT.md) | In-bank enrollment feature documentation |

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

### Admin Interface (`/administration`)

| Endpoint | Description |
|----------|-------------|
| `/administration` | Admin dashboard (protected) |
| `/administration/login` | Admin login with passkey |
| `/administration/setup` | Initial admin setup (first admin only) |
| `/administration/clients` | OAuth client management |

#### First-Time Admin Setup

1. Navigate to `https://wsim-auth-dev.banksim.ca/administration/setup`
2. Enter admin email, first name, and last name
3. Register a passkey for secure authentication
4. You'll be automatically logged in after registration

#### Admin Features

- **Passkey-only authentication** - No passwords, WebAuthn/FIDO2 security
- **OAuth Client Management** - Create, edit, and delete OAuth clients for SSIMs
- **Role-based access** - ADMIN and SUPER_ADMIN roles
- **Invite system** - SUPER_ADMINs can invite new administrators

## Related Projects

- [bsim](../bsim) - Banking Simulator
- [ssim](../ssim) - Store Simulator
- [nsim](../nsim) - Payment Network Simulator

## Contributing

This project is part of a coordinated multi-team effort. Please review:

1. [TODO.md](./TODO.md) for current status
2. [CHANGELOG.md](./CHANGELOG.md) for recent changes
3. The integration guides in [docs/](./docs/) for your specific integration needs

## License

Private - Internal Use Only
