# WSIM Project TODO

> **Last Updated**: 2024-01-15

## Current Status: 📋 Planning Complete

We have completed the architectural planning phase. Implementation is ready to begin.

---

## Phase 1: Foundation (Week 1-2)

### WSIM Team
- [ ] **Project Setup**
  - [ ] Initialize backend (Express + TypeScript)
  - [ ] Initialize auth-server (oidc-provider)
  - [ ] Initialize frontend (Next.js 14)
  - [ ] Set up PostgreSQL + Prisma
  - [ ] Create database schema and run migrations
  - [ ] Configure Docker Compose
  - [ ] Set up environment configuration

### BSIM Team (Blocking)
> See [BSIM_SUBPLAN.md](./BSIM_SUBPLAN.md) for details

- [ ] Add `wallet:enroll` OIDC scope
- [ ] Create `WalletCredential` data model
- [ ] Implement `GET /api/wallet/cards` endpoint
- [ ] Implement `POST /api/wallet/request-token` endpoint
- [ ] Implement `POST /api/wallet/revoke` endpoint
- [ ] Update consent UI for wallet enrollment
- [ ] Create `GET /api/registry/info` endpoint
- [ ] Testing and documentation

### NSIM Team
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

### WSIM Team
- [ ] **BSIM OIDC Client**
  - [ ] Configure bsim providers
  - [ ] Implement enrollment initiation route
  - [ ] Implement enrollment callback handler
  - [ ] Create user profile from bsim data

- [ ] **Card Management**
  - [ ] Implement card fetching from bsim
  - [ ] Store cards with wallet tokens
  - [ ] Create wallet management APIs
  - [ ] Implement card removal

- [ ] **OIDC Provider (for SSIMs)**
  - [ ] Configure oidc-provider
  - [ ] Create Prisma adapter
  - [ ] Implement payment interaction flow
  - [ ] Build card selection UI
  - [ ] Add extraTokenClaims for card tokens

- [ ] **Frontend**
  - [ ] Wallet dashboard page
  - [ ] Card list component
  - [ ] Bank enrollment page
  - [ ] Profile management

---

## Phase 3: SSIM Integration (Week 4-5)

### SSIM Team
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
  - [ ] User visits wsim → enrollment
  - [ ] Selects bsim → authenticates
  - [ ] Cards imported to wsim
  - [ ] Visits ssim → "Pay with Wallet"
  - [ ] Selects card → payment authorized

- [ ] **E2E Scenario: Returning wallet user**
  - [ ] Existing wsim session
  - [ ] ssim checkout → wallet payment
  - [ ] Card selection → payment completes

- [ ] **E2E Scenario: Multi-bsim user**
  - [ ] Cards from 2+ bsims
  - [ ] Correct routing to each bsim

- [ ] **E2E Scenario: Error handling**
  - [ ] Expired credentials
  - [ ] Declined payments
  - [ ] Unavailable bsim

---

## Future Enhancements (Post-MVP)

> See [FUTURE_CONSIDERATIONS.md](./FUTURE_CONSIDERATIONS.md) for details

- [ ] Native WSIM accounts (Option B authentication)
- [ ] Token-encoded routing (Option C)
- [ ] Open Banking expansion (accounts, balances, transactions)
- [ ] Recurring payments / Card-on-file
- [ ] Push provisioning
- [ ] Multi-wallet support
- [ ] Wallet-to-wallet transfers

---

## Coordination Checkpoints

| Checkpoint | Date | Teams | Milestone |
|------------|------|-------|-----------|
| Checkpoint 1 | End of Week 1 | BSIM, NSIM | wallet:enroll demo, registry working |
| Checkpoint 2 | End of Week 2 | WSIM, NSIM | Enrollment with live bsim |
| Checkpoint 3 | End of Week 3 | All | Token format validation |
| Checkpoint 4 | End of Week 4 | All | First E2E wallet payment |
| Final Demo | End of Week 5 | All | Complete flow, all scenarios |

---

## Notes

- BSIM work is **critical path** - blocks WSIM enrollment development
- NSIM routing can proceed in parallel once basic registry structure is agreed
- SSIM integration is last in sequence - needs working WSIM OIDC provider
