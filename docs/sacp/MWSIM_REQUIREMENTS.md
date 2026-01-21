# MWSIM Team Requirements
## Agent Commerce Integration (Mobile Wallet)

**Project**: SimToolBox Agent Commerce Protocol (SACP)
**Component**: mwsim (Mobile Wallet App)
**Priority**: P1 (Parallel with WSIM - User-facing authorization flows)

---

## Overview

mwsim provides the **human authorization interface** for the agent commerce ecosystem. Users interact with their agents through the mobile app for:

1. **Agent Management** - Register, configure, and revoke AI agents
2. **Step-Up Approval** - Approve/reject purchases that exceed agent limits
3. **Activity Monitoring** - View agent transactions and spending
4. **Push Notifications** - Real-time alerts for agent activity

---

## Why Mobile is Critical

The SACP design enables AI agents to make purchases autonomously - but humans need a convenient way to:
- **Set up agents** - Mobile-first users expect to manage everything from the app
- **Approve purchases** - Step-up auth needs to be fast and frictionless
- **Monitor spending** - See what agents are doing in real-time
- **Revoke access** - Immediately disable a compromised or misbehaving agent

Web-only management creates friction. Mobile-first approval reduces step-up latency.

---

## Requirements

### P0 - Critical (Phase 1)

#### 1. Push Notification Handling

**New Notification Types**:
```typescript
type AgentNotificationType =
  | 'agent.step_up'              // Purchase approval needed
  | 'agent.transaction'          // Transaction completed
  | 'agent.limit_warning'        // Approaching spending limit
  | 'agent.suspended';           // Agent auto-suspended

interface StepUpNotification {
  type: 'agent.step_up';
  stepUpId: string;
  agentId: string;
  agentName: string;
  merchantName: string;
  amount: number;
  currency: string;
  reason: string;              // "Exceeds per-transaction limit"
  expiresAt: string;
}
```

**Actions**:
- Tapping notification opens Step-Up Approval screen
- Quick actions: "Approve" / "View Details" (iOS action buttons)

#### 2. Step-Up Approval Screen

**Route**: `/step-up/:stepUpId`

**UI Components**:
```
┌────────────────────────────────────┐
│  Purchase Approval Needed          │
│                                    │
│  ┌────────────────────────────┐   │
│  │  🤖 My Shopping Assistant  │   │
│  │     wants to spend         │   │
│  │                            │   │
│  │     $156.48 CAD            │   │
│  │                            │   │
│  │  at Regal Moose            │   │
│  └────────────────────────────┘   │
│                                    │
│  Items:                            │
│  • Canadian Maple Syrup (2) $49.98│
│  • Organic Coffee Beans    $24.99│
│  • Local Honey            $18.99│
│  • Subtotal               $93.96│
│  • Tax                    $12.21│
│  • Total                 $106.17│
│                                    │
│  ⚠️ Amount exceeds your $100       │
│     per-transaction limit          │
│                                    │
│  ⏱️ Expires in 14:32               │
│                                    │
│  ┌─────────┐  ┌──────────────┐    │
│  │ Reject  │  │   Approve    │    │
│  └─────────┘  └──────────────┘    │
│               (requires Face ID)   │
└────────────────────────────────────┘
```

**Behavior**:
- **Approve**: Trigger biometric auth (Face ID / Touch ID), then call WSIM API
- **Reject**: Confirm dialog, then call WSIM API
- **Expiry countdown**: Show remaining time, auto-dismiss when expired
- **Deep link support**: `mwsim://step-up/:stepUpId`

**API Calls**:
```typescript
// Approve
POST /api/mobile/step-up/:stepUpId/approve
Authorization: Bearer {mobile_jwt}
Body: { consent: true }
// Passkey/biometric happens client-side before this call

// Reject
POST /api/mobile/step-up/:stepUpId/reject
Authorization: Bearer {mobile_jwt}
Body: { reason?: string }
```

#### 3. Agent Management (Basic)

**New Settings Section**: Settings > AI Agents

**List View**:
```
┌────────────────────────────────────┐
│  AI Agents                     + ──│──> Register New
│                                    │
│  ┌────────────────────────────┐   │
│  │ 🤖 My Shopping Assistant   │   │
│  │    Active • $245.50 today  │   │
│  │    Last used 2 hours ago   │   │
│  └────────────────────────────┘   │
│                                    │
│  ┌────────────────────────────┐   │
│  │ 🤖 Coffee Subscription Bot │   │
│  │    Active • $0.00 today    │   │
│  │    Last used 3 days ago    │   │
│  └────────────────────────────┘   │
│                                    │
│  Learn more about AI Agents →      │
└────────────────────────────────────┘
```

**Registration Flow**:
```
Step 1: Agent Name
┌────────────────────────────────────┐
│  Register AI Agent                 │
│                                    │
│  Name your agent:                  │
│  ┌────────────────────────────┐   │
│  │ My Shopping Assistant      │   │
│  └────────────────────────────┘   │
│                                    │
│  Description (optional):           │
│  ┌────────────────────────────┐   │
│  │ Helps me buy groceries     │   │
│  └────────────────────────────┘   │
│                                    │
│            [Continue]              │
└────────────────────────────────────┘

Step 2: Permissions
┌────────────────────────────────────┐
│  What can this agent do?           │
│                                    │
│  ☑️ Browse products                │
│  ☑️ Create shopping carts          │
│  ☑️ Complete purchases             │
│  ☐ View order history              │
│                                    │
│            [Continue]              │
└────────────────────────────────────┘

Step 3: Spending Limits
┌────────────────────────────────────┐
│  Set spending limits               │
│                                    │
│  Auto-approve up to:               │
│  ┌────────────────────────────┐   │
│  │ $50.00 CAD                 │   │
│  └────────────────────────────┘   │
│  Purchases above this require      │
│  your approval                     │
│                                    │
│  Daily limit:                      │
│  ┌────────────────────────────┐   │
│  │ $200.00 CAD                │   │
│  └────────────────────────────┘   │
│                                    │
│  Monthly limit:                    │
│  ┌────────────────────────────┐   │
│  │ $500.00 CAD                │   │
│  └────────────────────────────┘   │
│                                    │
│            [Continue]              │
└────────────────────────────────────┘

Step 4: Confirm & Create
┌────────────────────────────────────┐
│  Confirm with Face ID              │
│                                    │
│  Creating agent:                   │
│  My Shopping Assistant             │
│                                    │
│  Permissions:                      │
│  • Browse, Cart, Purchase          │
│                                    │
│  Limits:                           │
│  • Auto-approve: $50/transaction   │
│  • Daily: $200                     │
│  • Monthly: $500                   │
│                                    │
│       [Create Agent]               │
│       (requires Face ID)           │
└────────────────────────────────────┘

Step 5: Credentials
┌────────────────────────────────────┐
│  Agent Created! 🎉                 │
│                                    │
│  Copy these credentials to your    │
│  AI agent configuration:           │
│                                    │
│  Client ID:                        │
│  ┌────────────────────────────┐   │
│  │ agent_abc123def456         │ 📋│
│  └────────────────────────────┘   │
│                                    │
│  Client Secret:                    │
│  ┌────────────────────────────┐   │
│  │ ••••••••••••••••••••••••• │ 👁️│
│  └────────────────────────────┘   │
│  ⚠️ This won't be shown again!    │
│                                    │
│       [Copy All]  [Done]           │
└────────────────────────────────────┘
```

**API Calls**:
```typescript
// Register agent
POST /api/mobile/agents
Authorization: Bearer {mobile_jwt}
Body: {
  name: string;
  description?: string;
  permissions: AgentPermission[];
  spendingLimits: SpendingLimits;
}

// List agents
GET /api/mobile/agents
Authorization: Bearer {mobile_jwt}

// Get agent details
GET /api/mobile/agents/:id
Authorization: Bearer {mobile_jwt}
```

---

### P1 - Important (Phase 2)

#### 4. Agent Detail Screen

```
┌────────────────────────────────────┐
│  ← My Shopping Assistant           │
│                                    │
│  Status: ● Active                  │
│  Created: Jan 15, 2026             │
│  Last used: 2 hours ago            │
│                                    │
│  ─────────────────────────────────│
│  SPENDING                          │
│  ─────────────────────────────────│
│  Today:        $45.67 / $200       │
│  [████████░░░░░░░░░░░░░░] 23%     │
│                                    │
│  This month:   $245.50 / $500      │
│  [██████████████░░░░░░░░] 49%     │
│                                    │
│  ─────────────────────────────────│
│  RECENT ACTIVITY                   │
│  ─────────────────────────────────│
│  Today                             │
│  ┌────────────────────────────┐   │
│  │ Regal Moose          $45.67│   │
│  │ 2 hours ago • Approved     │   │
│  └────────────────────────────┘   │
│                                    │
│  Yesterday                         │
│  ┌────────────────────────────┐   │
│  │ Coffee Co             $24.99│   │
│  │ Auto-approved              │   │
│  └────────────────────────────┘   │
│                                    │
│  ─────────────────────────────────│
│  [Edit Settings]  [🔴 Suspend]     │
└────────────────────────────────────┘
```

#### 5. Edit Agent Settings

Allow users to:
- Change name/description
- Update permissions
- Adjust spending limits
- Suspend/resume agent
- Revoke agent (with confirmation)
- Rotate credentials

#### 6. Transaction History

Full transaction history per agent:
- Filter by date range
- Filter by status (completed, pending approval, rejected)
- Search by merchant
- Export capability

---

### P2 - Nice to Have (Phase 3)

#### 7. Real-Time Activity Feed

In-app activity feed showing live agent actions:
- "My Shopping Assistant added 3 items to cart at Regal Moose"
- "My Shopping Assistant completed $24.99 purchase at Coffee Co"

Uses websocket or push for real-time updates.

#### 8. Quick Actions Widget (iOS)

iOS widget showing:
- Pending approvals count
- Today's agent spending
- Quick approve/reject from widget

#### 9. Siri/Shortcuts Integration

"Hey Siri, approve my agent's purchase"
"Hey Siri, how much has my agent spent today?"

---

## Technical Implementation

### New Screens

| Screen | Route | Priority |
|--------|-------|----------|
| Agent List | `/settings/agents` | P0 |
| Register Agent | `/settings/agents/new` | P0 |
| Agent Detail | `/settings/agents/:id` | P1 |
| Edit Agent | `/settings/agents/:id/edit` | P1 |
| Step-Up Approval | `/step-up/:stepUpId` | P0 |
| Transaction History | `/settings/agents/:id/transactions` | P1 |

### New API Service

```typescript
// services/agent-api.ts

export const agentApi = {
  // Agent Management
  listAgents: () => api.get<AgentListResponse>('/api/mobile/agents'),
  getAgent: (id: string) => api.get<AgentResponse>(`/api/mobile/agents/${id}`),
  createAgent: (data: CreateAgentRequest) => api.post<CreateAgentResponse>('/api/mobile/agents', data),
  updateAgent: (id: string, data: UpdateAgentRequest) => api.patch(`/api/mobile/agents/${id}`, data),
  deleteAgent: (id: string) => api.delete(`/api/mobile/agents/${id}`),
  rotateSecret: (id: string) => api.post<RotateSecretResponse>(`/api/mobile/agents/${id}/rotate-secret`),

  // Step-Up
  getStepUp: (id: string) => api.get<StepUpResponse>(`/api/mobile/step-up/${id}`),
  approveStepUp: (id: string) => api.post(`/api/mobile/step-up/${id}/approve`, { consent: true }),
  rejectStepUp: (id: string, reason?: string) => api.post(`/api/mobile/step-up/${id}/reject`, { reason }),

  // Transactions
  getAgentTransactions: (agentId: string, params?: TransactionQueryParams) =>
    api.get<TransactionListResponse>(`/api/mobile/agents/${agentId}/transactions`, { params }),
};
```

### Push Notification Handler

```typescript
// hooks/useAgentNotifications.ts

export function useAgentNotifications() {
  const navigation = useNavigation();

  useEffect(() => {
    const unsubscribe = messaging().onNotificationOpenedApp((message) => {
      if (message.data?.type === 'agent.step_up') {
        navigation.navigate('StepUpApproval', {
          stepUpId: message.data.stepUpId,
        });
      }
    });

    return unsubscribe;
  }, [navigation]);
}
```

### Deep Linking

```typescript
// app.config.ts (Expo)
{
  scheme: 'mwsim',
  // Handles: mwsim://step-up/stepup_xyz789
}

// Linking configuration
const linking = {
  prefixes: ['mwsim://'],
  config: {
    screens: {
      StepUpApproval: 'step-up/:stepUpId',
      AgentDetail: 'agents/:agentId',
    },
  },
};
```

---

## UI Components Needed

### New Components
- `AgentCard` - List item showing agent status/spending
- `SpendingProgress` - Progress bar for limits
- `StepUpDetails` - Purchase details for approval
- `CredentialDisplay` - Secure display/copy for client credentials
- `PermissionSelector` - Checkbox list for permissions
- `LimitInput` - Currency input with validation

### Existing Components to Extend
- `PushNotificationHandler` - Add agent notification types
- `BiometricAuth` - Reuse for step-up approval

---

## Dependencies

| Dependency | From | Status |
|-----------|------|--------|
| Mobile JWT auth | WSIM | ✅ Existing |
| APNs push notifications | WSIM | ✅ Existing |
| Step-up API endpoints | WSIM | ⏳ Needs WSIM Phase 1 |
| Agent management API | WSIM | ⏳ Needs WSIM Phase 1 |
| Biometric auth | mwsim | ✅ Existing |

---

## Timeline Estimate

| Task | Estimate |
|------|----------|
| Push notification handling | 1-2 days |
| Step-up approval screen | 3-4 days |
| Agent list/registration UI | 4-5 days |
| Agent detail screen | 2-3 days |
| Edit agent settings | 2-3 days |
| Transaction history | 2-3 days |
| Deep linking | 1 day |
| Testing | 3-4 days |
| **Total** | **~3-4 weeks** |

**Note**: Can start in parallel with WSIM once API contracts are defined. Can use mock responses initially.

---

## Questions for Design Review

1. Should agent registration be mobile-only, or also support web?
2. How should credentials be shared? (Copy to clipboard, QR code, email?)
3. Should we support biometric-only approval or require passkey for high-value?
4. What's the minimum iOS/Android version for agent features?
5. Should we show pending step-ups on the home screen?

---

## Contact

**mwsim Team Lead**: [TBD]
**Design Review**: Schedule with WSIM team
