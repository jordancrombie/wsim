// Embed Routes Tests
// Tests for /embed/* endpoints (card picker iframe flow)

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    ALLOWED_EMBED_ORIGINS: ['https://ssim.banksim.ca', 'https://store.example.com'],
    WEBAUTHN_RP_ID: 'banksim.ca',
    WEBAUTHN_ORIGINS: ['https://wsim.banksim.ca', 'https://wsim-auth.banksim.ca'],
    JWT_SECRET: 'test-jwt-secret-that-is-long-enough',
    FRONTEND_URL: 'https://wsim.banksim.ca',
    BACKEND_URL: 'http://localhost:3003',
    INTERNAL_API_SECRET: 'test-internal-secret',
  },
}));

// Mock embed-headers middleware
vi.mock('../middleware/embed-headers', () => ({
  embedSecurityHeaders: (req: any, res: any, next: any) => next(),
  isAllowedEmbedOrigin: (origin: string | undefined) => {
    if (!origin) return false;
    return ['https://ssim.banksim.ca', 'https://store.example.com'].includes(origin);
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

// Mock fetch for backend API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { prisma } from '../adapters/prisma';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import embedRouter from './embed';

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

  app.use('/embed', embedRouter);
  return app;
}

describe('Embed Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('GET /embed/card-picker', () => {
    it('should return 403 for unauthorized origin', async () => {
      const app = createApp();

      const response = await request(app)
        .get('/embed/card-picker?origin=https://malicious.com');

      expect(response.status).toBe(403);
      expect(response.body.view).toBe('embed/error');
    });

    it('should render auth-required when user not logged in', async () => {
      const app = createApp(); // No userId in session

      const response = await request(app)
        .get('/embed/card-picker?origin=https://ssim.banksim.ca&merchantName=Test%20Store&amount=50.00');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('embed/auth-required');
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
        .get('/embed/card-picker?origin=https://ssim.banksim.ca&merchantName=Test%20Store&amount=50.00');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('embed/card-picker');
      expect(response.body.cards).toHaveLength(1);
      expect(response.body.hasPasskeys).toBe(true);
    });

    it('should indicate canSkipPasskey when within grace period', async () => {
      const app = createApp({
        userId: 'user-123',
        lastPasskeyAuthAt: Date.now() - 60000, // 1 minute ago (within 5 min grace)
      });

      (prisma.walletCard.findMany as any).mockResolvedValue([]);
      (prisma.passkeyCredential.findMany as any).mockResolvedValue([]);

      const response = await request(app)
        .get('/embed/card-picker?origin=https://ssim.banksim.ca');

      expect(response.status).toBe(200);
      expect(response.body.canSkipPasskey).toBe(true);
    });
  });

  describe('POST /embed/login/options', () => {
    it('should generate authentication options', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/embed/login/options')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.challenge).toBe('test-challenge-12345678');
      expect(response.body._tempKey).toContain('embed_login_');
      expect(generateAuthenticationOptions).toHaveBeenCalled();
    });
  });

  describe('POST /embed/login/verify', () => {
    it('should return 400 when response is missing', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/embed/login/verify')
        .send({ _tempKey: 'some-key' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields');
    });

    it('should return 400 when challenge expired', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/embed/login/verify')
        .send({
          response: { id: 'cred-123', type: 'public-key' },
          _tempKey: 'expired-key',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Challenge expired or not found');
    });
  });

  describe('POST /embed/passkey/options', () => {
    it('should return 400 when userId is missing', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/embed/passkey/options')
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
        .post('/embed/passkey/options')
        .send({ userId: 'user-123', walletCardId: 'card-123' });

      expect(response.status).toBe(200);
      expect(response.body.challenge).toBe('test-challenge-12345678');
    });

    it('should return 400 when user has no passkeys', async () => {
      const app = createApp();
      (prisma.passkeyCredential.findMany as any).mockResolvedValue([]);

      const response = await request(app)
        .post('/embed/passkey/options')
        .send({ userId: 'user-123', walletCardId: 'card-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No passkeys registered');
    });
  });

  describe('POST /embed/passkey/verify', () => {
    it('should return 400 when required fields are missing', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/embed/passkey/verify')
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
        .post('/embed/passkey/verify')
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

  describe('POST /embed/select-card-simple', () => {
    it('should return 403 for unauthorized origin', async () => {
      const app = createApp({ userId: 'user-123' });

      const response = await request(app)
        .post('/embed/select-card-simple')
        .send({ walletCardId: 'card-123', origin: 'https://malicious.com' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Unauthorized origin');
    });

    it('should return 401 when not authenticated', async () => {
      const app = createApp(); // No session userId

      const response = await request(app)
        .post('/embed/select-card-simple')
        .send({ walletCardId: 'card-123', origin: 'https://ssim.banksim.ca' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Not authenticated');
    });

    it('should return 400 when card not found', async () => {
      const app = createApp({ userId: 'user-123' });
      (prisma.walletCard.findFirst as any).mockResolvedValue(null);

      const response = await request(app)
        .post('/embed/select-card-simple')
        .send({ walletCardId: 'nonexistent-card', origin: 'https://ssim.banksim.ca' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Card not found');
    });
  });

  describe('POST /embed/confirm-with-grace-period', () => {
    it('should return 403 for unauthorized origin', async () => {
      const app = createApp({ userId: 'user-123' });

      const response = await request(app)
        .post('/embed/confirm-with-grace-period')
        .send({ walletCardId: 'card-123', origin: 'https://malicious.com' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Unauthorized origin');
    });

    it('should return 401 when not authenticated', async () => {
      const app = createApp(); // No session userId

      const response = await request(app)
        .post('/embed/confirm-with-grace-period')
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
        .post('/embed/confirm-with-grace-period')
        .send({ walletCardId: 'card-123', origin: 'https://ssim.banksim.ca' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('grace_period_expired');
    });
  });

  describe('GET /embed/grace-period-status', () => {
    it('should return not authenticated when no session', async () => {
      const app = createApp();

      const response = await request(app)
        .get('/embed/grace-period-status');

      expect(response.status).toBe(200);
      expect(response.body.authenticated).toBe(false);
    });

    it('should return grace period status for authenticated user', async () => {
      const app = createApp({
        userId: 'user-123',
        lastPasskeyAuthAt: Date.now() - 60000, // 1 minute ago
      });

      const response = await request(app)
        .get('/embed/grace-period-status');

      expect(response.status).toBe(200);
      expect(response.body.authenticated).toBe(true);
      expect(response.body.withinGracePeriod).toBe(true);
    });
  });
});
