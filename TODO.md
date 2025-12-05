# WSIM Project TODO

> **Last Updated**: 2025-12-05

## Current Status: 🟢 WSIM Flow Complete - Pending NSIM Merchant Fix

**WSIM integration is fully working!** JWT tokens with payment claims are being issued correctly. The current blocker is a **"Merchant mismatch"** error from NSIM - this is a configuration issue on the SSIM/NSIM side.

### What's Working (WSIM Side) ✅
- ✅ SSIM shows "Pay with Wallet" button
- ✅ WSIM OIDC flow (login → card selection → fresh consent per payment)
- ✅ WSIM requests card tokens from BSIM
- ✅ JWT access tokens with `wallet_card_token` and `card_token` claims
- ✅ SSIM extracts tokens from WSIM JWT
- ✅ SSIM calls NSIM with tokens

### Current Blocker: Merchant ID Mismatch (NSIM Side)

**Error:** `"Merchant mismatch"` from NSIM

**Root Cause:**
- BSIM card token contains: `merchantId: "ssim-merchant"` (WSIM's OAuth client_id for SSIM)
- SSIM sends in claims: `merchantId: "ssim-client"` (SSIM's BSIM client_id)

**See:** [HANDOFF_BSIM_NSIM.md](./HANDOFF_BSIM_NSIM.md) for detailed analysis and fix options

---

## Phase 1: Foundation (Week 1-2)

### WSIM Team ✅ COMPLETE
- [x] **Project Setup**
  - [x] Initialize backend (Express + TypeScript)
  - [x] Initialize auth-server (oidc-provider)
  - [x] Initialize frontend (Next.js 16)
  - [x] Set up PostgreSQL + Prisma
  - [x] Create database schema and run migrations
  - [x] Configure Docker Compose
  - [x] Set up environment configuration

- [x] **Production Docker Containers**
  - [x] Multi-stage Dockerfile for backend
  - [x] Multi-stage Dockerfile for auth-server
  - [x] Multi-stage Dockerfile for frontend (standalone mode)
  - [x] Non-root users for security
  - [x] Health checks on all services
  - [x] `.dockerignore` files for all services

**Completed Components:**
- Backend API server with routes for auth, wallet, enrollment, health
- Auth server with OIDC provider, Prisma adapter, interaction views
- Frontend with wallet dashboard, enrollment page, profile page
- Production-ready Docker containers for all services
- Full Prisma schema (WalletUser, BsimEnrollment, WalletCard, etc.)

### BSIM Team ✅ PHASE 1 COMPLETE
> See [BSIM_SUBPLAN.md](./BSIM_SUBPLAN.md) for details
> See [BSIM_DEPLOYMENT_INTEGRATION.md](./BSIM_DEPLOYMENT_INTEGRATION.md) for local dev setup

- [x] Add `wallet:enroll` OIDC scope
- [x] Create `WalletCredential` data model
- [x] Implement `GET /api/wallet/cards` endpoint
- [x] Implement `POST /api/wallet/request-token` endpoint
- [x] Implement `POST /api/wallet/revoke` endpoint
- [x] Update consent UI for wallet enrollment
- [x] Create `GET /api/registry/info` endpoint
- [x] Register WSIM as OAuth client in BSIM auth-server
- [ ] **Integrate WSIM into docker-compose stack** (see BSIM_DEPLOYMENT_INTEGRATION.md)
- [ ] Testing and documentation

### NSIM Team 🟡 CAN START IN PARALLEL
> See [NSIM_SUBPLAN.md](./NSIM_SUBPLAN.md) for details

- [ ] Design BSIM registry data structure
- [ ] Implement registry service
- [ ] Create registry API endpoints
- [ ] Refactor BSIM client for multi-bsim support
- [ ] Update payment routes with routing logic
- [ ] Add health check system
- [ ] Testing with multiple bsims

---

## Phase 2: Core WSIM Development (Week 2-4)

### WSIM Team ✅ Core Implementation Complete

#### Completed (UI/Structure Ready)
- [x] Configure oidc-provider (auth-server)
- [x] Create Prisma adapter for OIDC storage
- [x] Build card selection UI (EJS views)
- [x] Wallet dashboard page (frontend)
- [x] Card list component (frontend)
- [x] Bank enrollment page (frontend)
- [x] Profile management (frontend)

#### ✅ Enrollment Flow Implemented
- [x] **BSIM OIDC Client** (enrollment flow)
  - [x] Configure bsim providers
  - [x] Implement enrollment initiation route with PKCE
  - [x] Implement enrollment callback handler
  - [x] Create user profile from bsim data
  - [x] Session management for enrollment state

- [x] **Card Management**
  - [x] Implement card fetching from bsim
  - [x] Store cards with wallet tokens
  - [x] Create wallet management APIs
  - [x] Implement card removal
  - [x] List enrolled banks endpoint

#### ✅ Payment Flow Implementation
- [x] **OIDC Provider Payment Flow**
  - [x] Configure oidc-provider
  - [x] Create Prisma adapter
  - [x] Build card selection UI
  - [x] Implement payment interaction flow with card selection
  - [x] Add PaymentContext model for storing card token during OIDC flow
  - [x] Create backend `/api/payment/request-token` endpoint to get card tokens from BSIM
  - [x] Create backend `/api/payment/context` endpoints for storing/retrieving payment context
  - [x] Implement `extraTokenClaims` to add `wallet_card_token` and `card_token` to access tokens
  - [ ] E2E testing with SSIM (pending SSIM integration)

---

## Phase 3: SSIM Integration (Week 4-5)

### SSIM Team ✅ COMPLETE
> See [SSIM_SUBPLAN.md](./SSIM_SUBPLAN.md) for details

- [x] Add WSIM as OIDC provider
- [x] Update checkout UI with "Pay with Wallet" button
- [x] Implement wallet payment callback
- [x] Update NSIM client for walletCardToken
- [x] Update order details display
- [x] End-to-end testing (SSIM side)

---

## Phase 4: Integration Testing (Week 5)

### All Teams 🟡 IN PROGRESS
- [ ] **E2E Scenario: First-time wallet user**
- [ ] **E2E Scenario: Returning wallet user**
- [ ] **E2E Scenario: Multi-bsim user**
- [ ] **E2E Scenario: Error handling**

---

## Local Development Setup

### For WSIM Standalone (without BSIM integration)
```bash
# Start PostgreSQL
docker-compose up postgres -d

# Run backend (terminal 1)
cd backend && cp .env.example .env && npm run dev

# Run auth-server (terminal 2)
cd auth-server && cp .env.example .env && npm run dev

# Run frontend (terminal 3)
cd frontend && npm run dev
```

Access at: http://localhost:3004

### For Full Stack (BSIM-orchestrated)
> Requires BSIM team to implement changes in [BSIM_DEPLOYMENT_INTEGRATION.md](./BSIM_DEPLOYMENT_INTEGRATION.md)

```bash
# From bsim directory
make dev-build
```

Access at: https://wsim-dev.banksim.ca

---

## Coordination Checkpoints

| Checkpoint | Target | Teams | Milestone | Status |
|------------|--------|-------|-----------|--------|
| Checkpoint 0 | Now | WSIM | Scaffolding complete | ✅ Done |
| Checkpoint 1 | Week 1 | BSIM | wallet:enroll scope ready | ✅ Done |
| Checkpoint 1.5 | Week 1 | WSIM | Docker containers ready | ✅ Done |
| Checkpoint 2 | Week 2 | WSIM, BSIM | Enrollment flow working | ✅ Done |
| Checkpoint 3 | Week 3 | All | Token format validation | ✅ Done |
| Checkpoint 4 | Week 4 | All | First E2E wallet payment | 🟡 Testing |
| Final Demo | Week 5 | All | Complete flow, all scenarios | 🟡 In Progress |

---

## Key Documents

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE_PLAN.md](./ARCHITECTURE_PLAN.md) | System design, data models, flows |
| [BSIM_SUBPLAN.md](./BSIM_SUBPLAN.md) | BSIM team task list |
| [BSIM_DEPLOYMENT_INTEGRATION.md](./BSIM_DEPLOYMENT_INTEGRATION.md) | **NEW** - How to add WSIM to BSIM docker stack |
| [NSIM_SUBPLAN.md](./NSIM_SUBPLAN.md) | NSIM team task list |
| [SSIM_SUBPLAN.md](./SSIM_SUBPLAN.md) | SSIM team task list |
| [WSIM_IMPLEMENTATION_PLAN.md](./WSIM_IMPLEMENTATION_PLAN.md) | WSIM implementation details |
| [EMBEDDED_WALLET_PLAN.md](./EMBEDDED_WALLET_PLAN.md) | **NEW** - Embedded wallet (popup/iframe/API) checkout |
| [FUTURE_CONSIDERATIONS.md](./FUTURE_CONSIDERATIONS.md) | Post-MVP features |

---

## Notes

- **BSIM docker integration is critical path** - WSIM containers are ready, waiting for BSIM team to add to their stack
- **BSIM team should review [BSIM_DEPLOYMENT_INTEGRATION.md](./BSIM_DEPLOYMENT_INTEGRATION.md)** for nginx/docker-compose changes
- NSIM routing can proceed in parallel once basic registry structure is agreed
- SSIM integration is last in sequence - needs working WSIM OIDC provider
- WSIM uses Prisma 5.x (not 7.x) for compatibility
- All Docker images use `node:20-alpine` base with multi-stage builds
