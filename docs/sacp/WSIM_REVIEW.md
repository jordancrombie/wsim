# WSIM Team Review
## SACP (Agent Commerce Protocol) Implementation

**Date**: 2026-01-21
**Branch**: `agentic-support`
**Reference**: [WSIM_REQUIREMENTS.md](https://github.com/jordancrombie/agents/blob/main/docs/teams/WSIM_REQUIREMENTS.md)

---

## Summary

WSIM is the **Credentials Provider (CP)** - the central authority for AI agent authentication, authorization, and payment credential management. This is the critical path for the SACP initiative.

**Estimated Effort**: 6-8 weeks

---

## Review Notes

### Architecture Alignment

The requirements align well with existing WSIM infrastructure:

| Existing Component | Agent Commerce Use |
|-------------------|-------------------|
| OAuth/JWT auth | Extend for agent client credentials |
| APNs push notifications | Step-up approval notifications |
| Passkey authentication | Step-up approval verification |
| Profile/identity management | Agent registration and ownership |
| Transaction tracking | Agent spending limit enforcement |

### Key Implementation Phases

#### Phase 1 (P0 - Critical Path)
1. **Agent Registration System** - Database schema + API endpoints
2. **OAuth Token Endpoint** - Client credentials flow for agents
3. **Token Introspection** - Merchants validate agent tokens
4. **Payment Token Issuance** - Issue payment credentials to agents
5. **Spending Limit Enforcement** - Per-transaction, daily, monthly limits
6. **Step-Up Authentication** - Push notification + approval flow

#### Phase 2 (P1 - Important)
7. **Mandate Signing** - Cryptographic signatures for cart/intent mandates
8. **Agent Dashboard** - UI for managing agents
9. **Intent Mandates** - Pre-authorization for categories of purchases

#### Phase 3 (P2 - Nice to Have)
10. **Activity Webhooks** - External system notifications
11. **Merchant Allow/Block Lists**
12. **Velocity Controls**

---

## Questions & Concerns

### Questions to Raise in PROJECT_QA.md

1. **mwsim Integration**: Question #5 asks if mwsim users should be able to register/manage agents from mobile. We believe **YES** - see [MWSIM_REQUIREMENTS.md](./MWSIM_REQUIREMENTS.md).

2. **Step-Up Channel**: Should step-up approval be:
   - Web-only (current design)
   - In-app (native mwsim UI)
   - Both with deep links?

   **Recommendation**: In-app with web fallback. Better UX, faster approval.

3. **Agent Secret Rotation**: Should be YES - support rotation without re-registration. Add `POST /api/agent/v1/agents/:id/rotate-secret` endpoint.

4. **Daily Limit Timezone**: Should be based on user's configured timezone (stored in profile), defaulting to UTC.

5. **Multi-Card Support**: Should agents be able to select which card to use? Or always use default?

   **Recommendation**: Start with default card only. Add card selection in Phase 2.

6. **Payment Token Format**: Should payment tokens be JWTs or opaque tokens?

   **Recommendation**: JWTs for easier debugging, but opaque for NSIM reference.

### Implementation Concerns

1. **Spending Tracking Performance**: Need efficient queries for daily/monthly spending totals. Consider:
   - Materialized views for spending summaries
   - Redis cache for frequent limit checks
   - Precomputed daily totals updated on transaction

2. **Step-Up Race Condition**: If user approves while agent retries, need idempotency:
   - Step-up requests should be idempotent by `(agentId, merchantId, sessionId)`
   - Multiple approval attempts should be no-ops

3. **Token Introspection Load**: If SSIM calls introspect on every request:
   - Cache introspection results
   - Consider embedding more in JWT claims
   - Add rate limiting per client

---

## Existing Code to Leverage

### Authentication
- `backend/src/routes/mobile.ts` - JWT token patterns
- `backend/src/routes/verification.ts` - Passkey/device key patterns
- `backend/src/config/env.ts` - Environment configuration

### Push Notifications
- `backend/src/services/notification.ts` - APNs integration (rawPayload)
- Already supports custom data fields at root level

### Database
- `backend/prisma/schema.prisma` - Extend for agent tables
- WalletUser model for ownership relationships

---

## Proposed API Routes

```
# New route file: backend/src/routes/agent.ts

## Agent Management (requires mobile JWT auth)
POST   /api/mobile/agents              # Register new agent
GET    /api/mobile/agents              # List my agents
GET    /api/mobile/agents/:id          # Get agent details
PATCH  /api/mobile/agents/:id          # Update agent
DELETE /api/mobile/agents/:id          # Revoke agent
POST   /api/mobile/agents/:id/rotate-secret  # Rotate secret

## OAuth (client credentials - no JWT required)
POST   /api/agent/v1/oauth/token       # Get access token
POST   /api/agent/v1/oauth/introspect  # Validate token (for SSIM)
POST   /api/agent/v1/oauth/revoke      # Revoke token

## Payments (requires agent Bearer token)
POST   /api/agent/v1/payments/token    # Request payment token
GET    /api/agent/v1/payments/:id/status  # Check payment status

## Step-Up (web routes)
GET    /step-up/:id                    # Approval page
POST   /api/step-up/:id/approve        # Approve with passkey
POST   /api/step-up/:id/reject         # Reject
```

---

## Database Schema Additions

```prisma
// backend/prisma/schema.prisma additions

model Agent {
  id              String   @id @default(uuid())
  ownerId         String
  owner           WalletUser @relation(fields: [ownerId], references: [id])

  name            String
  description     String?
  clientId        String   @unique
  clientSecretHash String

  permissions     Json     // AgentPermission[]
  spendingLimits  Json     // SpendingLimits

  status          String   @default("active") // active, suspended, revoked

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  lastUsedAt      DateTime?

  transactions    AgentTransaction[]
  stepUpRequests  StepUpRequest[]
  mandates        Mandate[]

  @@index([ownerId])
  @@index([clientId])
  @@map("wsim_agents")
}

model AgentTransaction {
  id          String   @id @default(uuid())
  agentId     String
  agent       Agent    @relation(fields: [agentId], references: [id])
  ownerId     String
  merchantId  String
  sessionId   String?
  amount      Decimal  @db.Decimal(10, 2)
  currency    String   @db.VarChar(3)
  status      String   // pending, completed, failed, refunded
  mandateId   String?
  createdAt   DateTime @default(now())

  @@index([agentId])
  @@index([agentId, createdAt])
  @@map("wsim_agent_transactions")
}

model StepUpRequest {
  id          String   @id @default(uuid())
  agentId     String
  agent       Agent    @relation(fields: [agentId], references: [id])
  ownerId     String
  merchantId  String
  sessionId   String?
  amount      Decimal  @db.Decimal(10, 2)
  currency    String   @db.VarChar(3)
  items       Json
  reason      String
  status      String   @default("pending") // pending, approved, rejected, expired
  callbackUrl String?
  createdAt   DateTime @default(now())
  expiresAt   DateTime
  resolvedAt  DateTime?

  @@index([status, expiresAt])
  @@map("wsim_step_up_requests")
}

model Mandate {
  id          String   @id @default(uuid())
  type        String   // intent, cart, payment
  agentId     String
  agent       Agent    @relation(fields: [agentId], references: [id])
  ownerId     String
  payload     Json
  signature   String
  createdAt   DateTime @default(now())
  expiresAt   DateTime?

  @@map("wsim_mandates")
}
```

---

## Dependencies on Other Teams

| Team | Dependency | Blocking? |
|------|-----------|-----------|
| SSIM | Token introspection consumer | No - can mock |
| NSIM | Payment mandate acceptance | No - can mock |
| mwsim | Mobile UI for agent management | Parallel work |

---

## Timeline (Proposed)

| Week | Tasks |
|------|-------|
| 1-2 | Database schema, Agent registration API |
| 3-4 | OAuth token/introspect endpoints |
| 5-6 | Payment token issuance, spending limits |
| 7-8 | Step-up flow (backend + web UI) |
| 9+ | Testing, mwsim integration, Phase 2 items |

---

## Sign-Off Status

- [ ] Requirements reviewed
- [ ] Questions submitted to PROJECT_QA.md
- [ ] Estimate confirmed (6-8 weeks)
- [ ] Technical approach approved
- [ ] Ready for implementation

---

## Next Steps

1. Submit questions to `agents` repo PROJECT_QA.md
2. Review mwsim requirements with mwsim team
3. Create initial database migration (schema only)
4. Set up agent routes skeleton
5. Implement OAuth token endpoint (enables SSIM work)
