# WSIM Unit Testing Plan

> **Date**: 2025-12-06
> **Status**: No tests currently exist

## Current State

WSIM has **zero unit test coverage**. There are:
- No test scripts in package.json
- No test framework installed (Jest, Vitest, etc.)
- No test files (*.test.ts, *.spec.ts)
- No test configuration files

---

## Testing Strategy

### Recommended Framework: **Vitest**

Vitest is recommended over Jest for this project because:
- Native TypeScript support (no separate ts-jest config)
- Faster execution (uses esbuild/swc)
- ESM support out of the box
- Compatible with Jest APIs (easy migration if needed)
- Great for monorepo setups

### Test Types

| Type | Purpose | Coverage Target |
|------|---------|-----------------|
| **Unit Tests** | Test individual functions/classes in isolation | 80%+ |
| **Integration Tests** | Test route handlers with mocked DB | Key flows |
| **E2E Tests** | Full flow testing (separate concern) | Deferred |

---

## Priority Breakdown

### P0: Critical (Security & State Management)

These components handle sensitive data and must be tested thoroughly.

| Component | Location | Complexity | Risk |
|-----------|----------|------------|------|
| `crypto.ts` | backend/src/utils/ | Low | High |
| `bsim-oidc.ts` | backend/src/services/ | High | High |
| `auth.ts` (middleware) | backend/src/middleware/ | Medium | High |
| `passkey.ts` | backend/src/routes/ | High | High |
| `payment.ts` | backend/src/routes/ | Medium | High |
| `adminAuth.ts` (middleware) | auth-server/src/middleware/ | Medium | High |

### P1: High (Business Logic)

Core business flows that users depend on.

| Component | Location | Complexity | Risk |
|-----------|----------|------------|------|
| `enrollment.ts` | backend/src/routes/ | High | Medium |
| `wallet.ts` | backend/src/routes/ | Medium | Medium |
| `wallet-api.ts` | backend/src/routes/ | High | Medium |
| `interaction.ts` | auth-server/src/routes/ | High | Medium |
| `adminAuth.ts` (routes) | auth-server/src/routes/ | Medium | Medium |

### P2: Medium (Integration)

Integration flows for popup/embed experiences.

| Component | Location | Complexity | Risk |
|-----------|----------|------------|------|
| `popup.ts` | auth-server/src/routes/ | Medium | Low |
| `embed.ts` | auth-server/src/routes/ | Medium | Low |
| `admin.ts` | auth-server/src/routes/ | Medium | Low |
| `embed-headers.ts` | auth-server/src/middleware/ | Low | Low |

### P3: Low (Infrastructure)

Basic infrastructure that rarely changes.

| Component | Location | Complexity | Risk |
|-----------|----------|------------|------|
| `health.ts` | backend/src/routes/ | Low | Low |
| `auth.ts` (routes) | backend/src/routes/ | Low | Low |
| `error.ts` | backend/src/middleware/ | Low | Low |

---

## Implementation Plan

### Phase 1: Setup Test Infrastructure

**Backend** (`backend/`)
```bash
npm install -D vitest @vitest/coverage-v8 supertest @types/supertest
```

**Auth Server** (`auth-server/`)
```bash
npm install -D vitest @vitest/coverage-v8 supertest @types/supertest
```

**Configuration files needed:**
- `backend/vitest.config.ts`
- `auth-server/vitest.config.ts`
- Mock setup files for Prisma
- Test utilities and factories

### Phase 2: P0 Critical Tests (Week 1-2)

#### 2.1 crypto.ts - Encryption Utilities
```typescript
// Tests needed:
describe('encrypt/decrypt', () => {
  it('should encrypt and decrypt a string');
  it('should produce different ciphertext for same input (random IV)');
  it('should fail decryption with wrong key');
  it('should fail on tampered ciphertext');
});

describe('generateToken', () => {
  it('should generate random tokens of specified length');
  it('should produce unique tokens');
});

describe('walletCardToken', () => {
  it('should generate token in format wsim_{bsimId}_{id}');
  it('should parse valid token');
  it('should return null for invalid token');
});
```

#### 2.2 bsim-oidc.ts - OIDC Client
```typescript
// Tests needed:
describe('generatePkce', () => {
  it('should generate valid code verifier and challenge');
  it('should produce S256 challenge');
});

describe('buildAuthorizationUrl', () => {
  it('should include required OIDC parameters');
  it('should include custom scopes');
  it('should include PKCE parameters');
});

describe('exchangeCode', () => {
  it('should exchange code for tokens');
  it('should validate state');
  it('should extract custom claims from access token');
});

describe('fetchCards', () => {
  it('should fetch cards from BSIM API');
  it('should transform card response format');
  it('should handle API errors');
});
```

#### 2.3 auth.ts (middleware)
```typescript
describe('requireAuth', () => {
  it('should pass if session has valid userId');
  it('should return 401 if no session');
  it('should return 401 if user not found');
  it('should destroy session if user deleted');
});

describe('generateJwt/verifyJwt', () => {
  it('should create valid JWT');
  it('should verify valid JWT');
  it('should reject expired JWT');
  it('should reject tampered JWT');
});
```

#### 2.4 passkey.ts - WebAuthn
```typescript
describe('registration', () => {
  it('should generate registration options');
  it('should verify registration response');
  it('should store credential in database');
  it('should prevent duplicate credential IDs');
});

describe('authentication', () => {
  it('should generate auth options for known user');
  it('should generate discoverable auth options');
  it('should verify authentication response');
  it('should update counter for replay protection');
  it('should create session on success');
});
```

#### 2.5 payment.ts
```typescript
describe('request-token', () => {
  it('should require internal API secret');
  it('should find enrollment by walletCardToken');
  it('should request token from BSIM');
  it('should handle BSIM errors');
});

describe('payment context', () => {
  it('should store context with expiry');
  it('should retrieve valid context');
  it('should reject expired context');
});
```

### Phase 3: P1 Business Logic Tests (Week 3-4)

#### 3.1 enrollment.ts
```typescript
describe('enrollment flow', () => {
  it('should list available banks');
  it('should initiate enrollment with PKCE');
  it('should handle callback and create user');
  it('should fetch and store cards');
  it('should update existing enrollment');
  it('should delete enrollment with cascade');
});
```

#### 3.2 wallet.ts
```typescript
describe('wallet management', () => {
  it('should list user cards');
  it('should set default card');
  it('should soft delete card');
  it('should get profile with counts');
});
```

#### 3.3 wallet-api.ts
```typescript
describe('merchant API', () => {
  it('should require API key');
  it('should require user session');
  it('should initiate payment with challenge');
  it('should confirm payment with passkey');
  it('should prevent challenge reuse');
});
```

### Phase 4: P2-P3 Tests (Week 5)

- popup.ts / embed.ts tests
- admin.ts OAuth client CRUD tests
- Health check tests
- Error handler tests

---

## Mocking Strategy

### Prisma Mocking

Use `vitest-mock-extended` for type-safe Prisma mocking:

```typescript
// __mocks__/prisma.ts
import { PrismaClient } from '@prisma/client';
import { mockDeep, mockReset, DeepMockProxy } from 'vitest-mock-extended';

export const prismaMock = mockDeep<PrismaClient>();

beforeEach(() => {
  mockReset(prismaMock);
});
```

### External API Mocking

Mock HTTP calls with `msw` (Mock Service Worker):

```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer(
  // BSIM OIDC discovery
  http.get('https://auth.banksim.ca/.well-known/openid-configuration', () => {
    return HttpResponse.json({
      issuer: 'https://auth.banksim.ca',
      authorization_endpoint: 'https://auth.banksim.ca/authorize',
      token_endpoint: 'https://auth.banksim.ca/token',
      // ...
    });
  }),

  // BSIM cards API
  http.get('https://banksim.ca/api/wallet/cards', () => {
    return HttpResponse.json({
      cards: [{ id: 'card-1', lastFour: '1234' }]
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### WebAuthn Mocking

Mock `@simplewebauthn/server` for deterministic testing:

```typescript
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    challenge: 'test-challenge',
    rp: { name: 'WSIM', id: 'banksim.ca' },
    // ...
  }),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: { id: 'cred-id', publicKey: new Uint8Array() },
      // ...
    }
  }),
}));
```

---

## Test Utilities Needed

### 1. Factory Functions

```typescript
// test/factories/user.ts
export function createMockUser(overrides = {}) {
  return {
    id: 'user-123',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    walletId: 'wallet-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// test/factories/card.ts
export function createMockCard(overrides = {}) {
  return {
    id: 'card-123',
    userId: 'user-123',
    walletCardToken: 'wsim_bsim_abc123',
    lastFour: '1234',
    cardType: 'VISA',
    // ...
    ...overrides
  };
}
```

### 2. Request Helpers

```typescript
// test/helpers/request.ts
import request from 'supertest';
import { app } from '../src/index';

export function authenticatedRequest(userId: string) {
  // Set up session mock
  return request(app)
    .set('Cookie', `session=${createMockSession(userId)}`);
}
```

### 3. Crypto Test Vectors

```typescript
// test/fixtures/crypto.ts
export const testVectors = {
  encryptionKey: '0123456789abcdef0123456789abcdef',
  plaintext: 'sensitive data',
  // Known-good ciphertext for regression testing
};
```

---

## Coverage Goals

| Phase | Target Coverage | Deadline |
|-------|-----------------|----------|
| Phase 1 (Setup) | Infrastructure only | Week 1 |
| Phase 2 (P0) | 80% on critical code | Week 2 |
| Phase 3 (P1) | 70% on business logic | Week 4 |
| Phase 4 (P2-P3) | 60% overall | Week 5 |

**Minimum acceptable coverage for CI gate: 60%**

---

## CI Integration

Add to GitHub Actions workflow:

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd backend && npm ci
      - run: cd backend && npm run test:coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./backend/coverage/lcov.info

  test-auth-server:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd auth-server && npm ci
      - run: cd auth-server && npm run test:coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./auth-server/coverage/lcov.info
```

---

## Key Challenges

### 1. Database Mocking Complexity
**Challenge**: Prisma's type system makes mocking complex queries difficult.
**Solution**: Use `vitest-mock-extended` for type-safe mocks, create factory functions for common entities.

### 2. OIDC Flow Testing
**Challenge**: Multi-step OAuth flows with external dependencies.
**Solution**: Use MSW to mock BSIM endpoints, test each step in isolation.

### 3. WebAuthn Testing
**Challenge**: Browser-only APIs, hardware authenticator simulation.
**Solution**: Mock `@simplewebauthn/server`, use test vectors for known-good responses.

### 4. Session State
**Challenge**: Express sessions require store setup.
**Solution**: Use in-memory session store for tests, helper functions for authenticated requests.

### 5. Time-Dependent Code
**Challenge**: Challenge expiry, token TTLs.
**Solution**: Use `vi.useFakeTimers()` to control time in tests.

---

## Next Steps

1. **Set up test infrastructure** (vitest, mocks, factories)
2. **Start with crypto.ts** (lowest complexity, highest value)
3. **Add tests incrementally** per priority order
4. **Integrate with CI** once 60% coverage achieved

---

## Appendix: Package.json Updates

### Backend

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "vitest-mock-extended": "^2.0.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0",
    "msw": "^2.0.0"
  }
}
```

### Auth Server

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "vitest-mock-extended": "^2.0.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0",
    "msw": "^2.0.0"
  }
}
```
