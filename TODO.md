# WSIM Project TODO

> **Last Updated**: 2025-12-04

## Current Status: 🚧 Scaffolding Complete - Awaiting BSIM Integration

WSIM project scaffolding is complete. The application runs but enrollment flow is blocked pending BSIM team implementation of `wallet:enroll` scope and wallet APIs.

---

## Phase 1: Foundation (Week 1-2)

### WSIM Team ✅ COMPLETE
- [x] **Project Setup**
  - [x] Initialize backend (Express + TypeScript)
  - [x] Initialize auth-server (oidc-provider)
  - [x] Initialize frontend (Next.js 14)
  - [x] Set up PostgreSQL + Prisma
  - [x] Create database schema and run migrations
  - [x] Configure Docker Compose
  - [x] Set up environment configuration

**Completed Components:**
- Backend API server with routes for auth, wallet, enrollment, health
- Auth server with OIDC provider, Prisma adapter, interaction views
- Frontend with wallet dashboard, enrollment page, profile page
- Docker Compose with all services
- Full Prisma schema (WalletUser, BsimEnrollment, WalletCard, etc.)

### BSIM Team (Blocking) 🔴 NOT STARTED
> See [BSIM_SUBPLAN.md](./BSIM_SUBPLAN.md) for details
> See [BSIM_DEPLOYMENT_INTEGRATION.md](./BSIM_DEPLOYMENT_INTEGRATION.md) for local dev setup

- [ ] Add `wallet:enroll` OIDC scope
- [ ] Create `WalletCredential` data model
- [ ] Implement `GET /api/wallet/cards` endpoint
- [ ] Implement `POST /api/wallet/request-token` endpoint
- [ ] Implement `POST /api/wallet/revoke` endpoint
- [ ] Update consent UI for wallet enrollment
- [ ] Create `GET /api/registry/info` endpoint
- [ ] Register WSIM as OAuth client in BSIM auth-server
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

### WSIM Team - Blocked by BSIM

#### Completed (UI/Structure Ready)
- [x] Configure oidc-provider (auth-server)
- [x] Create Prisma adapter for OIDC storage
- [x] Build card selection UI (EJS views)
- [x] Wallet dashboard page (frontend)
- [x] Card list component (frontend)
- [x] Bank enrollment page (frontend)
- [x] Profile management (frontend)

#### Blocked - Requires BSIM wallet:enroll
- [ ] **BSIM OIDC Client** (enrollment flow)
  - [x] Configure bsim providers (structure ready)
  - [ ] Implement enrollment initiation route (needs BSIM scope)
  - [ ] Implement enrollment callback handler (needs BSIM scope)
  - [ ] Create user profile from bsim data (needs BSIM response)

- [ ] **Card Management** (needs BSIM wallet APIs)
  - [ ] Implement card fetching from bsim
  - [ ] Store cards with wallet tokens
  - [x] Create wallet management APIs (routes ready, need data)
  - [x] Implement card removal (route ready)

- [ ] **OIDC Provider Payment Flow** (needs cards in system)
  - [x] Configure oidc-provider
  - [x] Create Prisma adapter
  - [x] Build card selection UI
  - [ ] Implement payment interaction flow (needs cards)
  - [ ] Add extraTokenClaims for card tokens (needs BSIM token API)

---

## Phase 3: SSIM Integration (Week 4-5)

### SSIM Team 🟡 CAN PREPARE
> See [SSIM_SUBPLAN.md](./SSIM_SUBPLAN.md) for details

- [ ] Add WSIM as OIDC provider
- [ ] Update checkout UI with "Pay with Wallet" button
- [ ] Implement wallet payment callback
- [ ] Update NSIM client for walletCardToken
- [ ] Update order details display
- [ ] End-to-end testing

---

## Phase 4: Integration Testing (Week 5)

### All Teams
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
| Checkpoint 1 | Week 1 | BSIM | wallet:enroll scope ready | 🔴 Waiting |
| Checkpoint 2 | Week 2 | WSIM, BSIM | Enrollment flow working | 🔴 Blocked |
| Checkpoint 3 | Week 3 | All | Token format validation | 🔴 Blocked |
| Checkpoint 4 | Week 4 | All | First E2E wallet payment | 🔴 Blocked |
| Final Demo | Week 5 | All | Complete flow, all scenarios | 🔴 Blocked |

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
| [FUTURE_CONSIDERATIONS.md](./FUTURE_CONSIDERATIONS.md) | Post-MVP features |

---

## Notes

- **BSIM work is critical path** - blocks WSIM enrollment development
- **BSIM team should review [BSIM_DEPLOYMENT_INTEGRATION.md](./BSIM_DEPLOYMENT_INTEGRATION.md)** for nginx/docker-compose changes
- NSIM routing can proceed in parallel once basic registry structure is agreed
- SSIM integration is last in sequence - needs working WSIM OIDC provider
- WSIM uses Prisma 5.x (not 7.x) for compatibility
