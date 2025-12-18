// Popup Routes Tests
// Tests for /popup/* endpoints (card picker, passkey auth in popup)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock Prisma before importing the router
vi.mock('../adapters/prisma', () => ({
  prisma: {
    walletCard: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    passkeyCredential: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    walletUser: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock env config
vi.mock('../config/env', () => ({
  env: {
    ALLOWED_POPUP_ORIGINS: ['https://ssim.banksim.ca', 'https://store.example.com'],
    WEBAUTHN_RP_ID: 'banksim.ca',
    WEBAUTHN_ORIGINS: ['https://wsim.banksim.ca', 'https://wsim-auth.banksim.ca'],
    JWT_SECRET: 'test-jwt-secret-that-is-long-enough',
    FRONTEND_URL: 'https://wsim.banksim.ca',
    BACKEND_URL: 'http://localhost:3003',
    INTERNAL_API_SECRET: 'test-internal-secret',
  },
}));

// Mock @simplewebauthn/server
vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: 'test-challenge-12345678',
    rpId: 'banksim.ca',
    timeout: 60000,
    userVerification: 'preferred',
  }),
  verifyAuthenticationResponse: vi.fn(),
}));

// Mock jose for JWT - SignJWT needs to be a proper class
vi.mock('jose', () => {
  class MockSignJWT {
    setProtectedHeader() { return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    async sign() { return 'mock-jwt-token'; }
  }
  return { SignJWT: MockSignJWT };
});

// Mock fetch for backend API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { prisma } from '../adapters/prisma';
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import popupRouter from './popup';

// Create test app
function createApp(sessionData: Record<string, any> = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mock session middleware
  app.use((req: any, res, next) => {
    req.session = {
      userId: sessionData.userId,
      lastPasskeyAuthAt: sessionData.lastPasskeyAuthAt,
      save: vi.fn((cb: () => void) => cb?.()),
      destroy: vi.fn((cb: () => void) => cb?.()),
    };
    next();
  });

  // Mock EJS render to return JSON for testing
  app.use((req, res, next) => {
    res.render = (view: string, locals?: any) => {
      res.json({ view, ...locals });
    };
    next();
  });

  app.use('/popup', popupRouter);
  return app;
}

describe('Popup Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('GET /popup/card-picker', () => {
    it('should return 403 for unauthorized origin', async () => {
      const app = createApp();

      const response = await request(app)
        .get('/popup/card-picker?origin=https://malicious.com');

      expect(response.status).toBe(403);
      expect(response.body.view).toBe('popup/error');
      expect(response.body.message).toContain('not authorized');
    });

    it('should return 403 when origin is missing', async () => {
      const app = createApp();

      const response = await request(app)
        .get('/popup/card-picker');

      expect(response.status).toBe(403);
    });

    it('should render auth-required when user not logged in', async () => {
      const app = createApp(); // No userId in session

      const response = await request(app)
        .get('/popup/card-picker?origin=https://ssim.banksim.ca&merchantName=Test%20Store&amount=50.00');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('popup/auth-required');
      expect(response.body.merchantName).toBe('Test Store');
    });

    it('should render card-picker with user cards when logged in', async () => {
      const app = createApp({ userId: 'user-123' });

      const mockCards = [
        {
          id: 'card-1',
          cardNumber: '****1234',
          cardType: 'VISA',
          isActive: true,
          enrollment: { bsimId: 'bsim' },
        },
      ];
      const mockPasskeys = [{ id: 'passkey-1', credentialId: 'cred-123' }];

      (prisma.walletCard.findMany as any).mockResolvedValue(mockCards);
      (prisma.passkeyCredential.findMany as any).mockResolvedValue(mockPasskeys);

      const response = await request(app)
        .get('/popup/card-picker?origin=https://ssim.banksim.ca&merchantName=Test%20Store&amount=50.00&currency=CAD');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('popup/card-picker');
      expect(response.body.cards).toHaveLength(1);
      expect(response.body.hasPasskeys).toBe(true);
      expect(response.body.payment.merchantName).toBe('Test Store');
      expect(response.body.payment.amount).toBe(50);
    });

    it('should indicate canSkipPasskey when within grace period', async () => {
      const app = createApp({
        userId: 'user-123',
        lastPasskeyAuthAt: Date.now() - 60000, // 1 minute ago (within 5 min grace)
      });

      (prisma.walletCard.findMany as any).mockResolvedValue([]);
      (prisma.passkeyCredential.findMany as any).mockResolvedValue([]);

      const response = await request(app)
        .get('/popup/card-picker?origin=https://ssim.banksim.ca');

      expect(response.status).toBe(200);
      expect(response.body.canSkipPasskey).toBe(true);
    });

    it('should not skip passkey when outside grace period', async () => {
      const app = createApp({
        userId: 'user-123',
        lastPasskeyAuthAt: Date.now() - 10 * 60 * 1000, // 10 minutes ago (outside 5 min grace)
      });

      (prisma.walletCard.findMany as any).mockResolvedValue([]);
      (prisma.passkeyCredential.findMany as any).mockResolvedValue([]);

      const response = await request(app)
        .get('/popup/card-picker?origin=https://ssim.banksim.ca');

      expect(response.status).toBe(200);
      expect(response.body.canSkipPasskey).toBe(false);
    });
  });

  describe('POST /popup/login/options', () => {
    it('should generate authentication options', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/popup/login/options')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.challenge).toBe('test-challenge-12345678');
      expect(response.body._tempKey).toContain('login_');
      expect(generateAuthenticationOptions).toHaveBeenCalledWith({
        rpID: 'banksim.ca',
        userVerification: 'preferred',
      });
    });
  });

  describe('POST /popup/login/verify', () => {
    it('should return 400 when response is missing', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/popup/login/verify')
        .send({ _tempKey: 'some-key' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields');
    });

    it('should return 400 when tempKey is missing', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/popup/login/verify')
        .send({ response: { id: 'cred-123' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields');
    });

    it('should return 400 when challenge expired', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/popup/login/verify')
        .send({
          response: { id: 'cred-123', type: 'public-key' },
          _tempKey: 'expired-key',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Challenge expired or not found');
    });
  });

  describe('POST /popup/passkey/options', () => {
    it('should return 400 when userId is missing', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/popup/passkey/options')
        .send({ walletCardId: 'card-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing userId');
    });

    it('should generate passkey options for valid user', async () => {
      const app = createApp();

      const mockPasskeys = [
        {
          id: 'passkey-1',
          credentialId: 'cred-123',
          transports: ['internal'],
        },
      ];
      (prisma.passkeyCredential.findMany as any).mockResolvedValue(mockPasskeys);

      const response = await request(app)
        .post('/popup/passkey/options')
        .send({ userId: 'user-123', walletCardId: 'card-123' });

      expect(response.status).toBe(200);
      expect(response.body.challenge).toBe('test-challenge-12345678');
      expect(generateAuthenticationOptions).toHaveBeenCalled();
    });

    it('should return 400 when user has no passkeys', async () => {
      const app = createApp();
      (prisma.passkeyCredential.findMany as any).mockResolvedValue([]);

      const response = await request(app)
        .post('/popup/passkey/options')
        .send({ userId: 'user-123', walletCardId: 'card-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No passkeys registered');
    });
  });

  describe('POST /popup/passkey/verify', () => {
    it('should return 400 when required fields are missing', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/popup/passkey/verify')
        .send({
          response: { id: 'cred-123' },
          // Missing _challengeKey and walletCardId
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields');
    });

    it('should return 403 for unauthorized origin', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/popup/passkey/verify')
        .send({
          response: { id: 'cred-123' },
          _challengeKey: 'some-key',
          walletCardId: 'card-123',
          origin: 'https://malicious.com',
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Unauthorized origin');
    });
  });

  describe('POST /popup/select-card-simple', () => {
    it('should return 403 for unauthorized origin', async () => {
      const app = createApp({ userId: 'user-123' });

      const response = await request(app)
        .post('/popup/select-card-simple')
        .send({ walletCardId: 'card-123', origin: 'https://malicious.com' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Unauthorized origin');
    });

    it('should return 401 when not authenticated', async () => {
      const app = createApp(); // No session userId

      const response = await request(app)
        .post('/popup/select-card-simple')
        .send({ walletCardId: 'card-123', origin: 'https://ssim.banksim.ca' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Not authenticated');
    });

    it('should return 400 when card not found', async () => {
      const app = createApp({ userId: 'user-123' });
      (prisma.walletCard.findFirst as any).mockResolvedValue(null);

      const response = await request(app)
        .post('/popup/select-card-simple')
        .send({ walletCardId: 'nonexistent-card', origin: 'https://ssim.banksim.ca' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Card not found');
    });

    it('should return card token on success', async () => {
      const app = createApp({ userId: 'user-123' });

      const mockCard = {
        id: 'card-123',
        userId: 'user-123',
        lastFour: '1234',
        cardType: 'VISA',
        isActive: true,
      };
      (prisma.walletCard.findFirst as any).mockResolvedValue(mockCard);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          cardToken: 'card-token-xyz',
          walletCardToken: 'wallet-card-token-xyz',
        }),
      });

      const response = await request(app)
        .post('/popup/select-card-simple')
        .send({
          walletCardId: 'card-123',
          merchantId: 'merchant-1',
          amount: '50.00',
          origin: 'https://ssim.banksim.ca',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.cardToken).toBe('card-token-xyz');
    });
  });

  describe('POST /popup/confirm-with-grace-period', () => {
    it('should return 403 for unauthorized origin', async () => {
      const app = createApp({ userId: 'user-123' });

      const response = await request(app)
        .post('/popup/confirm-with-grace-period')
        .send({ walletCardId: 'card-123', origin: 'https://malicious.com' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Unauthorized origin');
    });

    it('should return 401 when not authenticated', async () => {
      const app = createApp(); // No session userId

      const response = await request(app)
        .post('/popup/confirm-with-grace-period')
        .send({ walletCardId: 'card-123', origin: 'https://ssim.banksim.ca' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Not authenticated');
    });

    it('should return 403 when not within grace period', async () => {
      const app = createApp({
        userId: 'user-123',
        lastPasskeyAuthAt: Date.now() - 10 * 60 * 1000, // Outside grace period
      });

      const response = await request(app)
        .post('/popup/confirm-with-grace-period')
        .send({ walletCardId: 'card-123', origin: 'https://ssim.banksim.ca' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('grace_period_expired');
    });

    it('should process payment when within grace period', async () => {
      const app = createApp({
        userId: 'user-123',
        lastPasskeyAuthAt: Date.now() - 60000, // 1 minute ago, within grace
      });

      const mockCard = {
        id: 'card-123',
        userId: 'user-123',
        lastFour: '5678',
        cardType: 'MASTERCARD',
        isActive: true,
      };
      (prisma.walletCard.findFirst as any).mockResolvedValue(mockCard);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          cardToken: 'grace-card-token',
          walletCardToken: 'grace-wallet-token',
        }),
      });

      const response = await request(app)
        .post('/popup/confirm-with-grace-period')
        .send({
          walletCardId: 'card-123',
          merchantId: 'merchant-1',
          origin: 'https://ssim.banksim.ca',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.cardToken).toBe('grace-card-token');
    });
  });

  describe('GET /popup/grace-period-status', () => {
    it('should return not authenticated when no session', async () => {
      const app = createApp();

      const response = await request(app)
        .get('/popup/grace-period-status');

      expect(response.status).toBe(200);
      expect(response.body.authenticated).toBe(false);
    });

    it('should return grace period status for authenticated user', async () => {
      const app = createApp({
        userId: 'user-123',
        lastPasskeyAuthAt: Date.now() - 60000, // 1 minute ago
      });

      const response = await request(app)
        .get('/popup/grace-period-status');

      expect(response.status).toBe(200);
      expect(response.body.authenticated).toBe(true);
      expect(response.body.withinGracePeriod).toBe(true);
    });

    it('should show expired grace period', async () => {
      const app = createApp({
        userId: 'user-123',
        lastPasskeyAuthAt: Date.now() - 10 * 60 * 1000, // 10 minutes ago
      });

      const response = await request(app)
        .get('/popup/grace-period-status');

      expect(response.status).toBe(200);
      expect(response.body.authenticated).toBe(true);
      expect(response.body.withinGracePeriod).toBe(false);
    });
  });
});
