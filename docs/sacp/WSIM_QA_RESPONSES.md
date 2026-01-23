# WSIM Team Q&A Responses
## For merging into agents/docs/PROJECT_QA.md

**Date**: 2026-01-21

---

## Summary Table Updates

Change WSIM rows in Open Questions Summary table to:

```markdown
| Q5 | WSIM | Agent secret rotation | WSIM Responded | Medium |
| Q6 | WSIM | Step-up expiration time | WSIM Responded | High |
| Q7 | WSIM | Multiple payment methods per agent | WSIM Responded | Medium |
| Q8 | WSIM | Daily limit timezone handling | WSIM Responded | Medium |
| Q9 | WSIM | mwsim agent management | WSIM Responded | **High** |
```

---

## Q5: Agent secret rotation

**Status**: WSIM Responded - Awaiting Consensus

**Discussion**:
- 2026-01-21 WSIM Team: **Recommend YES - support rotation.** Rationale:
  1. Security best practice - secrets should be rotatable without service disruption
  2. Reduces friction if secret is accidentally exposed
  3. Implementation: Add `POST /api/mobile/agents/:id/rotate-secret` endpoint
  4. Returns new secret once (like initial registration), old secret invalidated immediately
  5. Low implementation cost (~1 day)

**Resolution**: [Awaiting team consensus]

---

## Q6: Step-up expiration time

**Status**: WSIM Responded - Awaiting Consensus

**Discussion**:
- 2026-01-21 WSIM Team: **Recommend 15 minutes default.** Rationale:
  1. Balances user convenience (time to see notification) vs. cart freshness
  2. Aligns with industry norms (Stripe checkout sessions default to 24h, but agent context is more time-sensitive)
  3. Cart prices/availability can change - shorter window reduces stale checkout issues
  4. Push notification should reach user within seconds
  5. Can be configurable per-merchant in Phase 2 if needed

**Resolution**: [Awaiting team consensus]

---

## Q7: Multiple payment methods per agent

**Status**: WSIM Responded - Awaiting Consensus

**Discussion**:
- 2026-01-21 WSIM Team: **Recommend default card only for Phase 1.** Rationale:
  1. Simplifies MVP implementation
  2. Card selection UI in agent registration would add complexity
  3. Users can change their default card if they want agent to use different payment method
  4. Phase 2: Add optional `preferredPaymentMethod` to agent settings
  5. Security consideration: Limiting to default reduces attack surface

**Resolution**: [Awaiting team consensus]

---

## Q8: Daily limit timezone handling

**Status**: WSIM Responded - Awaiting Consensus

**Discussion**:
- 2026-01-21 WSIM Team: **Recommend user's configured timezone (with UTC fallback).** Rationale:
  1. User expectation: "daily limit" should reset at midnight in their local time
  2. WSIM already has user timezone in profile (or can add it)
  3. If no timezone configured, default to UTC
  4. Implementation: Store transaction timestamps in UTC, calculate daily totals with timezone offset
  5. Consistency with other wallet features (transaction history, notifications)

**Resolution**: [Awaiting team consensus]

---

## Q9: mwsim agent management

**Status**: WSIM Responded - Awaiting Consensus
**Priority**: Elevated to **High**

**Discussion**:
- 2026-01-21 WSIM Team: **Recommend YES - full mobile support.** Rationale:
  1. Mobile-first users expect to manage everything from the app
  2. Step-up approval is time-sensitive - in-app approval is faster than web redirect
  3. Push notifications already go to mobile - natural to complete approval there
  4. mwsim is our primary consumer-facing interface
  5. Adds ~3-4 weeks to mwsim scope (see MWSIM_REQUIREMENTS.md in wsim repo)

  **Proposed mwsim features**:
  - Agent registration wizard (5-step flow)
  - Agent list/detail screens
  - Step-up approval screen with biometric auth
  - Push notification handling for `agent.step_up` events
  - Transaction history per agent

**Resolution**: [Awaiting team consensus]

---

## Response to Q14 (BSIM - Agent ownership verification)

WSIM confirms compatibility for Q14:

**Discussion addition**:
- 2026-01-21 WSIM Team: **Confirm ID format compatibility.**
  - WSIM `ownerId` is the WSIM user ID (UUID format, e.g., `550e8400-e29b-41d4-a716-446655440000`)
  - BSIM can map this via the BsimEnrollment table which links WSIM user to BSIM cardholder
  - For verification: BSIM should call WSIM's introspection endpoint which returns `owner_id`
  - BSIM can then verify `owner_id` maps to the cardholder via enrollment lookup

---

## Response to Q17 (SSIM - WSIM Mock Service Contract)

**Discussion addition**:
- 2026-01-21 WSIM Team: **Commit to providing OpenAPI spec by end of Week 1.**
  - Will create `docs/openapi-agent.yaml` in wsim repo
  - Covers: OAuth token, introspection, payment token endpoints
  - SSIM can build mocks from this contract
  - Step-up webhook payload format will be included

---

## Response to Q18 (SSIM - Token Caching Policy)

**Discussion addition**:
- 2026-01-21 WSIM Team: **Recommend YES - caching is acceptable.**
  1. TTL: 60 seconds recommended (balance freshness vs. latency)
  2. Cache key: token hash (don't store full token in cache key logs)
  3. Invalidation: Yes, invalidate on `token.revoked` webhook
  4. Security note: Cache should be in-memory only, not shared/persistent
  5. Alternative: WSIM could include cache hints in introspection response (Phase 2)
