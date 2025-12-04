# Order of Operations - WSIM Integration

This document outlines the recommended sequence for implementing the wallet simulator ecosystem. Each phase has dependencies that must be completed before the next phase can begin effectively.

## Team Assignments

| Team | Component | Sub-Plan Document |
|------|-----------|-------------------|
| **BSIM Team** | Banking Simulator | [BSIM_SUBPLAN.md](./BSIM_SUBPLAN.md) |
| **NSIM Team** | Payment Network | [NSIM_SUBPLAN.md](./NSIM_SUBPLAN.md) |
| **WSIM Team** | Wallet Simulator | [WSIM_IMPLEMENTATION_PLAN.md](./WSIM_IMPLEMENTATION_PLAN.md) |
| **SSIM Team** | Store Simulator | [SSIM_SUBPLAN.md](./SSIM_SUBPLAN.md) |

---

## Phase 1: Foundation (Week 1-2)

### BSIM Team - START IMMEDIATELY

**Priority: CRITICAL** - All other work depends on this.

```
┌─────────────────────────────────────────────────────────────────┐
│  BSIM TASKS (Blocking)                                          │
├─────────────────────────────────────────────────────────────────┤
│  1. Add wallet:enroll OIDC scope                    [Day 1-2]   │
│  2. Create WalletCredential data model              [Day 2]     │
│  3. Implement /api/wallet/cards endpoint            [Day 3]     │
│  4. Implement /api/wallet/request-token endpoint    [Day 4-5]   │
│  5. Update consent UI for wallet enrollment         [Day 5]     │
│  6. Create /api/registry/info endpoint              [Day 6]     │
│  7. Testing & documentation                         [Day 7]     │
└─────────────────────────────────────────────────────────────────┘
```

**Deliverables:**
- [ ] BSIM can issue wallet credentials
- [ ] BSIM can return masked card list
- [ ] BSIM can issue ephemeral card tokens on request
- [ ] BSIM exposes registry info for NSIM

**Handoff to:** WSIM Team (for enrollment), NSIM Team (for registry)

---

### NSIM Team - START WEEK 1.5

**Priority: HIGH** - Can start mid-week once BSIM registry info is ready.

```
┌─────────────────────────────────────────────────────────────────┐
│  NSIM TASKS                                                      │
├─────────────────────────────────────────────────────────────────┤
│  1. Design BSIM registry data structure             [Day 1]     │
│  2. Implement registry service                      [Day 1-2]   │
│  3. Create registry API endpoints                   [Day 2]     │
│  4. Refactor BSIM client for multi-bsim             [Day 3]     │
│  5. Update payment routes to use routing            [Day 4]     │
│  6. Add health check system                         [Day 5]     │
│  7. Testing with multiple bsims                     [Day 6]     │
└─────────────────────────────────────────────────────────────────┘
```

**Deliverables:**
- [ ] NSIM can register multiple bsims
- [ ] NSIM routes payments based on walletCardToken
- [ ] NSIM health checks monitor bsim availability
- [ ] Backward compatible with single-bsim setup

**Handoff to:** WSIM Team (for payment routing), SSIM Team (for updated API)

---

## Phase 2: Core WSIM Development (Week 2-4)

### WSIM Team - START WEEK 2

**Priority: HIGH** - Core wallet implementation.

**Dependency:** BSIM wallet:enroll scope and /api/wallet/* endpoints must be ready.

```
┌─────────────────────────────────────────────────────────────────┐
│  WSIM TASKS                                                      │
├─────────────────────────────────────────────────────────────────┤
│  Week 2:                                                         │
│  1. Project setup (Express, Prisma, Next.js)        [Day 1-2]   │
│  2. Database schema & migrations                    [Day 2]     │
│  3. BSIM OIDC client configuration                  [Day 3]     │
│  4. Enrollment flow (start → callback)              [Day 4-5]   │
│                                                                  │
│  Week 3:                                                         │
│  5. Card fetching and storage                       [Day 1]     │
│  6. Wallet management APIs                          [Day 2]     │
│  7. OIDC Provider setup for SSIMs                   [Day 3-4]   │
│  8. Payment authorization flow                      [Day 4-5]   │
│                                                                  │
│  Week 4:                                                         │
│  9. Card selection UI (auth-server)                 [Day 1-2]   │
│  10. Frontend wallet dashboard                      [Day 2-3]   │
│  11. Frontend enrollment flow                       [Day 3-4]   │
│  12. Integration testing with bsim                  [Day 5]     │
└─────────────────────────────────────────────────────────────────┘
```

**Deliverables:**
- [ ] Users can enroll bank from wsim
- [ ] Cards are stored in wsim
- [ ] WSIM OIDC provider is running
- [ ] Payment flow with card selection works
- [ ] Frontend allows card management

**Handoff to:** SSIM Team (OIDC client config, callback handling)

---

## Phase 3: SSIM Integration (Week 4-5)

### SSIM Team - START WEEK 4

**Priority: MEDIUM** - Final integration point.

**Dependency:** WSIM OIDC provider must be running and payment flow tested.

```
┌─────────────────────────────────────────────────────────────────┐
│  SSIM TASKS                                                      │
├─────────────────────────────────────────────────────────────────┤
│  1. Add WSIM as OIDC provider                       [Day 1]     │
│  2. Update checkout UI (wallet button)              [Day 1-2]   │
│  3. Implement wallet payment callback               [Day 2-3]   │
│  4. Update NSIM client for walletCardToken          [Day 3]     │
│  5. Update order details display                    [Day 4]     │
│  6. End-to-end testing                              [Day 4-5]   │
└─────────────────────────────────────────────────────────────────┘
```

**Deliverables:**
- [ ] Checkout shows "Pay with Wallet" button
- [ ] Wallet payment flow completes successfully
- [ ] Orders show payment source (wallet vs bank)
- [ ] Existing bank payment still works

---

## Phase 4: Integration Testing (Week 5)

### All Teams - WEEK 5

**Priority: HIGH** - Ensure everything works together.

```
┌─────────────────────────────────────────────────────────────────┐
│  INTEGRATION TESTING                                             │
├─────────────────────────────────────────────────────────────────┤
│  Scenario 1: First-time wallet user                              │
│  ├── User visits wsim (no account)                              │
│  ├── Selects bsim for enrollment                                │
│  ├── Authenticates at bsim                                      │
│  ├── Cards imported to wsim                                     │
│  ├── User visits ssim checkout                                  │
│  ├── Clicks "Pay with Wallet"                                   │
│  ├── Selects card in wsim                                       │
│  └── Payment authorized via nsim → bsim                         │
│                                                                  │
│  Scenario 2: Returning wallet user                               │
│  ├── User has existing wsim profile                             │
│  ├── Visits ssim checkout                                       │
│  ├── Clicks "Pay with Wallet"                                   │
│  ├── Authenticates to wsim (or session exists)                  │
│  ├── Selects card                                               │
│  └── Payment completes                                          │
│                                                                  │
│  Scenario 3: Multi-bsim user                                     │
│  ├── User has cards from 2+ bsims                               │
│  ├── Card selection shows all cards                             │
│  ├── Selecting card from bsim A routes to bsim A                │
│  └── Selecting card from bsim B routes to bsim B                │
│                                                                  │
│  Scenario 4: Error handling                                      │
│  ├── Expired wallet credential → re-enrollment prompt           │
│  ├── Declined payment → proper error displayed                  │
│  ├── Unavailable bsim → graceful degradation                    │
│  └── Session timeout → redirect to login                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Gantt-Style Timeline

```
Week 1         Week 2         Week 3         Week 4         Week 5
│              │              │              │              │
├──BSIM────────┤              │              │              │
│  wallet:enroll, /api/wallet/*                             │
│              │              │              │              │
│    ├──NSIM───┤              │              │              │
│    │  registry, routing     │              │              │
│              │              │              │              │
│              ├──WSIM────────┼──────────────┤              │
│              │  setup       │ auth/payment │              │
│              │              │              │              │
│              │              │              ├──SSIM────────┤
│              │              │              │  integration │
│              │              │              │              │
│              │              │              │    ├──ALL────┤
│              │              │              │    │ testing │
```

---

## Communication Checkpoints

### Daily Standups (Recommended)
- Quick sync between teams on blockers
- Share progress on current tasks

### Checkpoint 1: End of Week 1
- **BSIM:** Demo wallet:enroll flow
- **NSIM:** Show registry working with 2 bsims

### Checkpoint 2: End of Week 2
- **WSIM:** Demo enrollment with live bsim
- **NSIM:** Confirm routing works with wallet tokens

### Checkpoint 3: End of Week 3
- **WSIM:** Demo OIDC provider with card selection
- **All:** Validate token format alignment

### Checkpoint 4: End of Week 4
- **SSIM:** Demo "Pay with Wallet" button working
- **All:** First E2E payment through wallet

### Final Demo: End of Week 5
- Complete flow demonstration
- Multi-bsim scenario
- Error handling scenarios

---

## Risk Mitigation

| Risk | Mitigation | Owner |
|------|------------|-------|
| BSIM delays block all work | Start BSIM work immediately, no parallel dependencies | BSIM Team |
| Token format mismatch | Document format early, validate at Checkpoint 3 | All Teams |
| OIDC configuration issues | Use existing bsim/ssim as reference | WSIM Team |
| Integration issues | Daily syncs, clear API contracts | All Teams |

---

## Definition of Done

### For Each Team's Sub-Plan:
1. All acceptance criteria met
2. Unit tests passing
3. Integration tests passing (where applicable)
4. Documentation updated
5. Code reviewed
6. Deployed to staging environment

### For Overall Project:
1. All E2E scenarios pass
2. No critical bugs
3. Performance acceptable (< 2s for authorization)
4. Security review completed
5. All teams sign off
