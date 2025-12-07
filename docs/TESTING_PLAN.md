# WSIM Unit Testing Plan

> **Date**: 2025-12-06
> **Status**: Phase 3 P1 tests complete, P2 in progress

## Current State

**199 tests passing** across backend and auth-server:
- ✅ Backend: 163 tests (crypto, auth, passkey, payment, bsim-oidc, enrollment, wallet, wallet-api)
- ✅ Auth-server: 36 tests (adminAuth.ts middleware, admin.ts routes)

Run tests with:
```bash
cd backend && npm test       # 163 tests
cd auth-server && npm test   # 36 tests
```

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

| Component | Location | Complexity | Risk | Status |
|-----------|----------|------------|------|--------|
| `crypto.ts` | backend/src/utils/ | Low | High | ✅ 23 tests |
| `auth.ts` (middleware) | backend/src/middleware/ | Medium | High | ✅ 20 tests |
| `adminAuth.ts` (middleware) | auth-server/src/middleware/ | Medium | High | ✅ 15 tests |
| `bsim-oidc.ts` | backend/src/services/ | High | High | ✅ 21 tests |
| `passkey.ts` | backend/src/routes/ | High | High | ✅ 18 tests |
| `payment.ts` | backend/src/routes/ | Medium | High | ✅ 17 tests |

### P1: High (Business Logic)

Core business flows that users depend on.

| Component | Location | Complexity | Risk | Status |
|-----------|----------|------------|------|--------|
| `enrollment.ts` | backend/src/routes/ | High | Medium | ✅ 21 tests |
| `wallet.ts` | backend/src/routes/ | Medium | Medium | ✅ 23 tests |
| `wallet-api.ts` | backend/src/routes/ | High | Medium | ✅ 20 tests |
| `interaction.ts` | auth-server/src/routes/ | High | Medium | ⏭️ Skipped (tightly coupled to oidc-provider) |
| `admin.ts` (routes) | auth-server/src/routes/ | Medium | Medium | ✅ 21 tests |

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

### Phase 1: Setup Test Infrastructure ✅ COMPLETE

**Backend** (`backend/`)
- ✅ `vitest`, `@vitest/coverage-v8`, `vitest-mock-extended` installed
- ✅ `vitest.config.ts` created
- ✅ `src/test/setup.ts` created with environment config
- ✅ Test scripts added to package.json

**Auth Server** (`auth-server/`)
- ✅ `vitest`, `@vitest/coverage-v8`, `vitest-mock-extended` installed
- ✅ `vitest.config.ts` created
- ✅ `src/test/setup.ts` created with environment config
- ✅ Test scripts added to package.json

### Phase 2: P0 Critical Tests (Week 1-2)

#### 2.1 crypto.ts - Encryption Utilities ✅ COMPLETE (23 tests)
```typescript
// Tests implemented in backend/src/utils/crypto.test.ts:
✅ encrypt/decrypt roundtrip
✅ encrypt/decrypt empty string
✅ encrypt/decrypt special characters
✅ encrypt/decrypt long text
✅ different ciphertext for same input (random IV)
✅ ciphertext format validation (iv:authTag:encrypted)
✅ throw on invalid format
✅ throw on tampered ciphertext
✅ throw on tampered auth tag
✅ generateToken default length
✅ generateToken specified length
✅ generateToken uniqueness
✅ generateToken edge case (0 length)
✅ generateWalletCardToken format
✅ generateWalletCardToken includes bsimId
✅ generateWalletCardToken uniqueness
✅ generateWalletCardToken special characters
✅ parseWalletCardToken valid token
✅ parseWalletCardToken hyphenated bsimId
✅ parseWalletCardToken invalid prefix
✅ parseWalletCardToken wrong number of parts
✅ parseWalletCardToken empty string
✅ parseWalletCardToken roundtrip
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

#### 2.3 auth.ts (middleware) ✅ COMPLETE (20 tests)
```typescript
// Tests implemented in backend/src/middleware/auth.test.ts:
// generateJwt (5 tests)
✅ should generate a valid JWT token
✅ should generate tokens that can be verified
✅ should generate different tokens for different users
✅ should accept custom expiration time
✅ should accept numeric expiration time

// verifyJwt (5 tests)
✅ should return payload for valid token
✅ should return null for invalid token
✅ should return null for empty token
✅ should return null for malformed JWT
✅ should return null for tampered token

// requireAuth middleware (5 tests)
✅ should return 401 if no session userId
✅ should return 401 if session is undefined
✅ should return 401 if user not found in database
✅ should call next and attach user to request if valid
✅ should return 500 on database error

// optionalAuth middleware (5 tests)
✅ should call next without user if no session
✅ should call next without user if session userId is undefined
✅ should call next without user if user not found
✅ should attach user to request if found
✅ should call next on database error without throwing
```

#### 2.3b adminAuth.ts (auth-server middleware) ✅ COMPLETE (15 tests)
```typescript
// Tests implemented in auth-server/src/middleware/adminAuth.test.ts:
// createAdminToken (3 tests)
✅ should create a valid JWT token
✅ should create tokens that can be verified
✅ should create different tokens for different sessions

// verifyAdminToken (5 tests)
✅ should return session data for valid token
✅ should return null for invalid token
✅ should return null for empty token
✅ should return null for malformed JWT
✅ should return null for tampered token

// requireAdminAuth middleware (5 tests)
✅ should redirect to login if no token cookie
✅ should redirect to login if token is invalid
✅ should redirect to login if admin not found in database
✅ should call next and attach admin to request if valid
✅ should verify SUPER_ADMIN role correctly

// Cookie functions (2 tests)
✅ setAdminCookie should set cookie with correct options
✅ clearAdminCookie should clear cookie with correct options
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
