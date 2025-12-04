# NSIM Sub-Plan: Multi-BSIM Routing

> **AI Context**: This document describes changes needed to the Network Simulator (nsim) to support routing payments to multiple bsims. The nsim codebase is located at `/Users/jcrombie/ai/nsim`. It uses Express.js + TypeScript with BullMQ for async processing. Review the payment authorization flow in `src/routes/payments.ts` and the bsim client in `src/services/bsim-client.ts`.

## Overview

NSIM currently connects to a single bsim. With the introduction of wsim (wallet simulator), nsim needs to:
1. Maintain a registry of multiple bsims
2. Route payment authorizations to the correct bsim based on `walletCardToken`
3. Support dynamic bsim registration

## Prerequisites

- Current single-bsim flow works correctly
- Understanding of payment authorization flow
- Redis is available for registry storage (optional, can use in-memory)

---

## Task 1: BSIM Registry Data Structure

### Context for AI
> Currently, bsim connection is configured via environment variables (`BSIM_BASE_URL`, `BSIM_API_KEY`). This needs to become a registry that can hold multiple bsims.

### Requirements

Create a registry service to manage bsim connections:

```typescript
// src/types/registry.ts
export interface BsimRegistryEntry {
  bsimId: string;              // Unique identifier, e.g., "td-bank"
  name: string;                // Display name, e.g., "TD Canada Trust"
  apiBaseUrl: string;          // e.g., "https://td.banksim.ca"
  apiKey: string;              // API key for this bsim (encrypted at rest)
  supportedCardTypes: string[]; // ["VISA", "MC", "VISA_DEBIT"]
  isActive: boolean;           // Can be disabled without removal
  registeredAt: Date;
  lastHealthCheck?: Date;
  healthStatus?: 'healthy' | 'degraded' | 'unhealthy';
}

// For future: BIN-based routing
export interface BinRange {
  bsimId: string;
  binPrefix: string;           // e.g., "4532" for specific Visa range
  priority: number;            // For overlapping ranges
}
```

### Implementation

```typescript
// src/services/bsim-registry.ts
import { BsimRegistryEntry } from '../types/registry';

class BsimRegistry {
  private entries: Map<string, BsimRegistryEntry> = new Map();

  constructor() {
    // Load default bsim from environment (backward compatibility)
    if (process.env.BSIM_BASE_URL) {
      this.register({
        bsimId: process.env.BSIM_ID || 'default-bsim',
        name: process.env.BSIM_NAME || 'Default Bank',
        apiBaseUrl: process.env.BSIM_BASE_URL,
        apiKey: process.env.BSIM_API_KEY!,
        supportedCardTypes: ['VISA', 'MC', 'AMEX', 'VISA_DEBIT', 'MC_DEBIT'],
        isActive: true,
        registeredAt: new Date(),
      });
    }
  }

  register(entry: Omit<BsimRegistryEntry, 'registeredAt'>): BsimRegistryEntry {
    const fullEntry: BsimRegistryEntry = {
      ...entry,
      registeredAt: new Date(),
    };
    this.entries.set(entry.bsimId, fullEntry);
    console.log(`[Registry] Registered bsim: ${entry.bsimId} at ${entry.apiBaseUrl}`);
    return fullEntry;
  }

  get(bsimId: string): BsimRegistryEntry | undefined {
    return this.entries.get(bsimId);
  }

  getAll(): BsimRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  getActive(): BsimRegistryEntry[] {
    return this.getAll().filter(e => e.isActive);
  }

  deactivate(bsimId: string): boolean {
    const entry = this.entries.get(bsimId);
    if (entry) {
      entry.isActive = false;
      return true;
    }
    return false;
  }

  remove(bsimId: string): boolean {
    return this.entries.delete(bsimId);
  }

  // Parse walletCardToken to extract bsimId
  // Format: wsim_{bsimId}_{cardId}
  extractBsimId(walletCardToken: string): string | null {
    const parts = walletCardToken.split('_');
    if (parts.length >= 2 && parts[0] === 'wsim') {
      return parts[1];
    }
    return null;
  }
}

export const bsimRegistry = new BsimRegistry();
```

### Acceptance Criteria
- [ ] Registry can store multiple bsim entries
- [ ] Default bsim loads from environment (backward compatible)
- [ ] Can parse bsimId from walletCardToken
- [ ] Can activate/deactivate bsims

---

## Task 2: Registry API Endpoints

### Context for AI
> Add new routes under `/api/v1/registry/`. These will be called by bsims on startup and by admins for management.

### Requirements

Create registry management routes:

```typescript
// src/routes/registry.ts
import { Router } from 'express';
import { bsimRegistry } from '../services/bsim-registry';
import { validateApiKey } from '../middleware/auth';

const router = Router();

// Register a new bsim
// Called by bsim on startup or by admin
router.post('/bsims', validateApiKey, async (req, res) => {
  const {
    bsimId,
    name,
    apiBaseUrl,
    apiKey,
    supportedCardTypes,
  } = req.body;

  // Validate required fields
  if (!bsimId || !apiBaseUrl || !apiKey) {
    return res.status(400).json({
      error: 'missing_fields',
      message: 'bsimId, apiBaseUrl, and apiKey are required',
    });
  }

  // Check for duplicate
  if (bsimRegistry.get(bsimId)) {
    return res.status(409).json({
      error: 'already_exists',
      message: `bsim ${bsimId} is already registered`,
    });
  }

  const entry = bsimRegistry.register({
    bsimId,
    name: name || bsimId,
    apiBaseUrl,
    apiKey,
    supportedCardTypes: supportedCardTypes || ['VISA', 'MC'],
    isActive: true,
  });

  res.status(201).json({
    message: 'bsim registered successfully',
    bsim: {
      bsimId: entry.bsimId,
      name: entry.name,
      registeredAt: entry.registeredAt,
    },
  });
});

// List all registered bsims (masked API keys)
router.get('/bsims', async (req, res) => {
  const entries = bsimRegistry.getAll().map(e => ({
    bsimId: e.bsimId,
    name: e.name,
    apiBaseUrl: e.apiBaseUrl,
    supportedCardTypes: e.supportedCardTypes,
    isActive: e.isActive,
    healthStatus: e.healthStatus,
    registeredAt: e.registeredAt,
    // Never expose apiKey
  }));

  res.json({ bsims: entries });
});

// Get specific bsim
router.get('/bsims/:bsimId', async (req, res) => {
  const entry = bsimRegistry.get(req.params.bsimId);

  if (!entry) {
    return res.status(404).json({
      error: 'not_found',
      message: `bsim ${req.params.bsimId} not found`,
    });
  }

  res.json({
    bsimId: entry.bsimId,
    name: entry.name,
    apiBaseUrl: entry.apiBaseUrl,
    supportedCardTypes: entry.supportedCardTypes,
    isActive: entry.isActive,
    healthStatus: entry.healthStatus,
    registeredAt: entry.registeredAt,
  });
});

// Update bsim (e.g., rotate API key)
router.patch('/bsims/:bsimId', validateApiKey, async (req, res) => {
  const entry = bsimRegistry.get(req.params.bsimId);

  if (!entry) {
    return res.status(404).json({
      error: 'not_found',
      message: `bsim ${req.params.bsimId} not found`,
    });
  }

  // Update allowed fields
  const { name, apiBaseUrl, apiKey, supportedCardTypes, isActive } = req.body;

  if (name !== undefined) entry.name = name;
  if (apiBaseUrl !== undefined) entry.apiBaseUrl = apiBaseUrl;
  if (apiKey !== undefined) entry.apiKey = apiKey;
  if (supportedCardTypes !== undefined) entry.supportedCardTypes = supportedCardTypes;
  if (isActive !== undefined) entry.isActive = isActive;

  res.json({
    message: 'bsim updated successfully',
    bsimId: entry.bsimId,
  });
});

// Deregister bsim
router.delete('/bsims/:bsimId', validateApiKey, async (req, res) => {
  const removed = bsimRegistry.remove(req.params.bsimId);

  if (!removed) {
    return res.status(404).json({
      error: 'not_found',
      message: `bsim ${req.params.bsimId} not found`,
    });
  }

  res.json({
    message: 'bsim deregistered successfully',
    bsimId: req.params.bsimId,
  });
});

export default router;
```

### Acceptance Criteria
- [ ] POST /bsims registers a new bsim
- [ ] GET /bsims lists all (with masked keys)
- [ ] GET /bsims/:id returns specific bsim
- [ ] PATCH /bsims/:id updates bsim config
- [ ] DELETE /bsims/:id removes bsim
- [ ] API key required for mutating operations

---

## Task 3: Update BSIM Client for Multi-BSIM

### Context for AI
> Current `bsim-client.ts` connects to a single bsim via environment config. Update to accept bsim connection info as parameters.

### Requirements

Refactor bsim client to be registry-aware:

```typescript
// src/services/bsim-client.ts
import { BsimRegistryEntry } from '../types/registry';
import { bsimRegistry } from './bsim-registry';

interface BsimAuthorizationRequest {
  cardToken: string;
  amount: number;
  currency: string;
  merchantId: string;
  merchantName: string;
  orderId: string;
  description?: string;
}

interface BsimAuthorizationResponse {
  status: 'approved' | 'declined' | 'error';
  authorizationCode?: string;
  declineReason?: string;
  availableCredit?: number;
}

class BsimClient {
  private async callBsim<T>(
    bsim: BsimRegistryEntry,
    endpoint: string,
    body: unknown
  ): Promise<T> {
    const url = `${bsim.apiBaseUrl}${endpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': bsim.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`BSIM ${bsim.bsimId} error: ${response.status} - ${errorBody}`);
    }

    return response.json();
  }

  // Get bsim from walletCardToken or fall back to default
  private resolveBsim(walletCardToken?: string): BsimRegistryEntry {
    if (walletCardToken) {
      const bsimId = bsimRegistry.extractBsimId(walletCardToken);
      if (bsimId) {
        const bsim = bsimRegistry.get(bsimId);
        if (bsim && bsim.isActive) {
          return bsim;
        }
        throw new Error(`BSIM ${bsimId} not found or inactive`);
      }
    }

    // Fall back to default (first active bsim)
    const activeBsims = bsimRegistry.getActive();
    if (activeBsims.length === 0) {
      throw new Error('No active BSIMs registered');
    }
    return activeBsims[0];
  }

  async authorize(
    request: BsimAuthorizationRequest,
    walletCardToken?: string
  ): Promise<BsimAuthorizationResponse> {
    const bsim = this.resolveBsim(walletCardToken);

    console.log(`[BsimClient] Routing authorization to ${bsim.bsimId} (${bsim.name})`);

    return this.callBsim<BsimAuthorizationResponse>(
      bsim,
      '/api/payment-network/authorize',
      request
    );
  }

  async capture(
    authorizationCode: string,
    amount?: number,
    walletCardToken?: string
  ): Promise<{ success: boolean }> {
    const bsim = this.resolveBsim(walletCardToken);

    return this.callBsim(bsim, '/api/payment-network/capture', {
      authorizationCode,
      amount,
    });
  }

  async void(
    authorizationCode: string,
    walletCardToken?: string
  ): Promise<{ success: boolean }> {
    const bsim = this.resolveBsim(walletCardToken);

    return this.callBsim(bsim, '/api/payment-network/void', {
      authorizationCode,
    });
  }

  async refund(
    authorizationCode: string,
    amount: number,
    walletCardToken?: string
  ): Promise<{ success: boolean }> {
    const bsim = this.resolveBsim(walletCardToken);

    return this.callBsim(bsim, '/api/payment-network/refund', {
      authorizationCode,
      amount,
    });
  }
}

export const bsimClient = new BsimClient();
```

### Acceptance Criteria
- [ ] Client routes to correct bsim based on walletCardToken
- [ ] Falls back to default bsim if no walletCardToken
- [ ] Throws clear error if bsim not found
- [ ] All operations (authorize, capture, void, refund) use routing

---

## Task 4: Update Payment Routes

### Context for AI
> Payment authorization route in `src/routes/payments.ts` currently uses hardcoded bsim config. Update to use the routed bsim client.

### Requirements

Update authorization flow to accept and use `walletCardToken`:

```typescript
// src/routes/payments.ts
import { bsimClient } from '../services/bsim-client';

// POST /api/v1/payments/authorize
router.post('/authorize', async (req, res) => {
  const {
    merchantId,
    merchantName,
    amount,
    currency,
    cardToken,
    walletCardToken,  // NEW: optional, for routing
    orderId,
    description,
    metadata,
  } = req.body;

  // Validate required fields
  if (!merchantId || !amount || !cardToken || !orderId) {
    return res.status(400).json({
      error: 'missing_fields',
      message: 'merchantId, amount, cardToken, and orderId are required',
    });
  }

  try {
    // Create transaction record
    const transaction = await createTransaction({
      merchantId,
      merchantName,
      amount,
      currency: currency || 'CAD',
      cardToken,
      walletCardToken,  // Store for future operations
      orderId,
      description,
      metadata,
      status: 'pending',
    });

    // Route to correct bsim and authorize
    const bsimResponse = await bsimClient.authorize(
      {
        cardToken,
        amount,
        currency: currency || 'CAD',
        merchantId,
        merchantName: merchantName || merchantId,
        orderId,
        description,
      },
      walletCardToken  // Pass for routing
    );

    // Update transaction based on response
    if (bsimResponse.status === 'approved') {
      await updateTransaction(transaction.id, {
        status: 'authorized',
        authorizationCode: bsimResponse.authorizationCode,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      });

      // Queue webhook
      await queueWebhook(merchantId, 'payment.authorized', {
        transactionId: transaction.id,
        orderId,
        amount,
        authorizationCode: bsimResponse.authorizationCode,
      });

      return res.status(200).json({
        transactionId: transaction.id,
        status: 'authorized',
        authorizationCode: bsimResponse.authorizationCode,
        timestamp: new Date().toISOString(),
      });
    } else {
      await updateTransaction(transaction.id, {
        status: 'declined',
        declineReason: bsimResponse.declineReason,
      });

      // Queue webhook
      await queueWebhook(merchantId, 'payment.declined', {
        transactionId: transaction.id,
        orderId,
        declineReason: bsimResponse.declineReason,
      });

      return res.status(200).json({
        transactionId: transaction.id,
        status: 'declined',
        declineReason: bsimResponse.declineReason,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('[Payment] Authorization error:', error);

    return res.status(500).json({
      error: 'authorization_failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
```

### Update Transaction Model

```typescript
// Add walletCardToken to transaction type
interface PaymentTransaction {
  id: string;
  merchantId: string;
  merchantName?: string;
  amount: number;
  currency: string;
  cardToken: string;
  walletCardToken?: string;  // NEW
  orderId: string;
  status: TransactionStatus;
  authorizationCode?: string;
  // ... rest of fields
}
```

### Update Capture/Void/Refund Routes

These operations need to pass the stored `walletCardToken` for routing:

```typescript
// POST /api/v1/payments/:transactionId/capture
router.post('/:transactionId/capture', async (req, res) => {
  const transaction = await getTransaction(req.params.transactionId);

  if (!transaction) {
    return res.status(404).json({ error: 'transaction_not_found' });
  }

  // Pass walletCardToken for routing
  const result = await bsimClient.capture(
    transaction.authorizationCode!,
    req.body.amount,
    transaction.walletCardToken  // Route to same bsim
  );

  // ... rest of logic
});

// Similar updates for void and refund
```

### Acceptance Criteria
- [ ] Authorization accepts optional walletCardToken
- [ ] Routing works based on walletCardToken
- [ ] Transaction stores walletCardToken
- [ ] Capture/void/refund use stored walletCardToken for routing
- [ ] Backward compatible (works without walletCardToken)

---

## Task 5: Health Check for BSIMs

### Context for AI
> Add periodic health checks to monitor bsim availability. This helps with graceful degradation and monitoring.

### Requirements

Implement bsim health checking:

```typescript
// src/services/bsim-health.ts
import { bsimRegistry } from './bsim-registry';

interface HealthCheckResult {
  bsimId: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  error?: string;
  checkedAt: Date;
}

async function checkBsimHealth(bsimId: string): Promise<HealthCheckResult> {
  const bsim = bsimRegistry.get(bsimId);

  if (!bsim) {
    return {
      bsimId,
      status: 'unhealthy',
      error: 'BSIM not found in registry',
      checkedAt: new Date(),
    };
  }

  const startTime = Date.now();

  try {
    const response = await fetch(`${bsim.apiBaseUrl}/health`, {
      method: 'GET',
      headers: { 'X-API-Key': bsim.apiKey },
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      bsim.healthStatus = 'healthy';
      bsim.lastHealthCheck = new Date();

      return {
        bsimId,
        status: 'healthy',
        latencyMs,
        checkedAt: new Date(),
      };
    } else {
      bsim.healthStatus = 'degraded';
      return {
        bsimId,
        status: 'degraded',
        latencyMs,
        error: `HTTP ${response.status}`,
        checkedAt: new Date(),
      };
    }
  } catch (error) {
    bsim.healthStatus = 'unhealthy';

    return {
      bsimId,
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      checkedAt: new Date(),
    };
  }
}

export async function runHealthChecks(): Promise<HealthCheckResult[]> {
  const bsims = bsimRegistry.getAll();
  const results = await Promise.all(
    bsims.map(b => checkBsimHealth(b.bsimId))
  );
  return results;
}

// Start periodic health checks
export function startHealthChecker(intervalMs: number = 60000) {
  setInterval(async () => {
    const results = await runHealthChecks();
    const unhealthy = results.filter(r => r.status === 'unhealthy');

    if (unhealthy.length > 0) {
      console.warn('[Health] Unhealthy BSIMs:', unhealthy.map(r => r.bsimId));
    }
  }, intervalMs);
}
```

### Add Health Endpoint

```typescript
// In registry routes or health routes
router.get('/health', async (req, res) => {
  const results = await runHealthChecks();

  const allHealthy = results.every(r => r.status === 'healthy');
  const anyUnhealthy = results.some(r => r.status === 'unhealthy');

  res.status(anyUnhealthy ? 503 : 200).json({
    status: allHealthy ? 'healthy' : anyUnhealthy ? 'unhealthy' : 'degraded',
    bsims: results,
    checkedAt: new Date().toISOString(),
  });
});
```

### Acceptance Criteria
- [ ] Health checks run periodically
- [ ] Registry entries updated with health status
- [ ] Health endpoint returns aggregate status
- [ ] Unhealthy bsims are logged

---

## Testing Checklist

### Unit Tests
- [ ] Registry CRUD operations
- [ ] walletCardToken parsing
- [ ] Routing logic

### Integration Tests
- [ ] Register multiple bsims
- [ ] Route authorization to correct bsim
- [ ] Fallback to default when no walletCardToken
- [ ] Capture/void/refund route to same bsim
- [ ] Health check updates status

### Manual Testing
- [ ] Register two different bsims
- [ ] Payment with bsim A's walletCardToken goes to bsim A
- [ ] Payment with bsim B's walletCardToken goes to bsim B
- [ ] Payment without walletCardToken goes to default

---

## Environment Variables

Update `.env`:

```bash
# Default BSIM (backward compatibility)
BSIM_ID=default-bsim
BSIM_NAME="Default Bank Simulator"
BSIM_BASE_URL=http://localhost:3001
BSIM_API_KEY=your-api-key

# Registry Settings
REGISTRY_ADMIN_API_KEY=admin-key-for-registry-mutations

# Health Check
BSIM_HEALTH_CHECK_INTERVAL_MS=60000
```

---

## Dependencies

### Depends On (must be completed first):
1. **BSIM Changes** - BSIMs must expose `/api/registry/info` and health endpoints

### Depended On By:
1. **WSIM** - Needs routing to work for wallet payments
2. **SSIM** - Will pass walletCardToken for routing

### Estimated Effort
2-3 days

---

## Future Considerations

### TODO: BIN-Based Routing (Option C)

Current implementation parses `walletCardToken` prefix for bsimId. Future enhancement:

```typescript
// Instead of parsing prefix, decode routing info from token
interface DecodedWalletToken {
  bsimId: string;
  cardRef: string;
  issuedAt: number;
  signature: string;
}

function decodeWalletCardToken(token: string): DecodedWalletToken {
  // Token could be a signed JWT or encrypted payload
  // containing routing information
}
```

Benefits:
- Harder to spoof
- Can include additional metadata
- More similar to real card network BIN routing

---

## API Reference

### Registry Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /api/v1/registry/bsims | Register new bsim | Admin API Key |
| GET | /api/v1/registry/bsims | List all bsims | None |
| GET | /api/v1/registry/bsims/:id | Get specific bsim | None |
| PATCH | /api/v1/registry/bsims/:id | Update bsim | Admin API Key |
| DELETE | /api/v1/registry/bsims/:id | Remove bsim | Admin API Key |
| GET | /api/v1/registry/health | Check all bsim health | None |

### Updated Payment Endpoints

| Method | Endpoint | Change |
|--------|----------|--------|
| POST | /api/v1/payments/authorize | Accepts optional `walletCardToken` |
| POST | /api/v1/payments/:id/capture | Uses stored `walletCardToken` for routing |
| POST | /api/v1/payments/:id/void | Uses stored `walletCardToken` for routing |
| POST | /api/v1/payments/:id/refund | Uses stored `walletCardToken` for routing |
