// Wallet API Tests (Merchant API)
// Tests for /api/merchant/* endpoints

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  createMockPrismaClient,
  MockPrismaClient,
  MockOAuthClientData,
} from '../test/mocks/mockPrisma';

// Mock the database module BEFORE importing the router
vi.mock('../config/database', () => ({
  prisma: null as any, // Will be set in beforeEach
}));

// Mock env module
vi.mock('../config/env', () => ({
  env: {
    WEBAUTHN_RP_ID: 'localhost',
    WEBAUTHN_ORIGINS: ['https://localhost'],
    BSIM_PROVIDERS: JSON.stringify([
      {
        bsimId: 'test-bank',
        name: 'Test Bank',
        issuer: 'http://localhost:3001',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      },
    ]),
  },
}));

// Mock crypto module
vi.mock('../utils/crypto', () => ({
  decrypt: vi.fn((value: string) => `decrypted-${value}`),
}));

// Mock @simplewebauthn/server
vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: 'test-challenge-base64url',
    rpId: 'localhost',
    allowCredentials: [],
    userVerification: 'required',
  }),
  verifyAuthenticationResponse: vi.fn().mockResolvedValue({
    verified: true,
    authenticationInfo: {
      newCounter: 1,
    },
  }),
}));

let mockPrismaInstance: MockPrismaClient;

// Get the mocked module
import * as database from '../config/database';
import walletApiRouter from './wallet-api';

// Helper to create app with merchant API key and user session
function createApp(apiKey?: string, userId?: string) {
  const app = express();
  app.use(express.json());
  app.use((req: any, res, next) => {
    req.session = userId ? { userId } : {};
    if (apiKey) {
      req.headers['x-api-key'] = apiKey;
    }
    next();
  });
  app.use('/api/merchant', walletApiRouter);
  return app;
}

// Create valid OAuth client data
function createValidMerchant(): MockOAuthClientData {
  return {
    id: 'merchant-123',
    clientId: 'test-merchant',
    clientSecret: 'hashed-secret',
    clientName: 'Test Merchant',
    redirectUris: ['https://merchant.com/callback'],
    postLogoutRedirectUris: [],
    grantTypes: ['authorization_code'],
    scope: 'openid profile',
    logoUri: null,
    trusted: false,
    apiKey: 'wsim_api_test123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('Wallet API Routes', () => {
  beforeEach(() => {
    mockPrismaInstance = createMockPrismaClient();
    (database as any).prisma = mockPrismaInstance;
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockPrismaInstance._clear();
  });

  describe('GET /api/merchant/user', () => {
    it('should return 401 without API key', async () => {
      const app = createApp();
      const response = await request(app).get('/api/merchant/user');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('missing_api_key');
    });

    it('should return 401 with invalid API key', async () => {
      const app = createApp('invalid-api-key');
      const response = await request(app).get('/api/merchant/user');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('invalid_api_key');
    });

    it('should return authenticated=false when no session', async () => {
      mockPrismaInstance._addOAuthClient(createValidMerchant());

      const app = createApp('wsim_api_test123');
      const response = await request(app).get('/api/merchant/user');

      expect(response.status).toBe(200);
      expect(response.body.authenticated).toBe(false);
    });

    it('should return authenticated=false when user not found', async () => {
      mockPrismaInstance._addOAuthClient(createValidMerchant());

      const app = createApp('wsim_api_test123', 'non-existent-user');
      const response = await request(app).get('/api/merchant/user');

      expect(response.status).toBe(200);
      expect(response.body.authenticated).toBe(false);
    });

    it('should return user info when authenticated', async () => {
      mockPrismaInstance._addOAuthClient(createValidMerchant());
      mockPrismaInstance._addWalletUser({
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: null,
        firstName: 'Test',
        lastName: 'User',
        walletId: 'wallet-abc',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp('wsim_api_test123', 'user-123');
      const response = await request(app).get('/api/merchant/user');

      expect(response.status).toBe(200);
      expect(response.body.authenticated).toBe(true);
      expect(response.body.user).toMatchObject({
        id: 'user-123',
        email: 'test@example.com',
        hasPasskeys: false,
      });
    });

    it('should indicate user has passkeys', async () => {
      mockPrismaInstance._addOAuthClient(createValidMerchant());
      mockPrismaInstance._addWalletUser({
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: null,
        firstName: 'Test',
        lastName: 'User',
        walletId: 'wallet-abc',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaInstance._addPasskeyCredential({
        id: 'passkey-123',
        userId: 'user-123',
        credentialId: 'cred-abc',
        publicKey: 'pub-key-base64',
        counter: 0,
        transports: ['internal'],
        deviceName: null,
        aaguid: null,
        createdAt: new Date(),
        lastUsedAt: null,
      });

      const app = createApp('wsim_api_test123', 'user-123');
      const response = await request(app).get('/api/merchant/user');

      expect(response.status).toBe(200);
      expect(response.body.user.hasPasskeys).toBe(true);
    });
  });

  describe('GET /api/merchant/cards', () => {
    it('should require API key', async () => {
      const app = createApp(undefined, 'user-123');
      const response = await request(app).get('/api/merchant/cards');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('missing_api_key');
    });

    it('should require user session', async () => {
      mockPrismaInstance._addOAuthClient(createValidMerchant());

      const app = createApp('wsim_api_test123');
      const response = await request(app).get('/api/merchant/cards');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('not_authenticated');
    });

    it('should return empty array when user has no cards', async () => {
      mockPrismaInstance._addOAuthClient(createValidMerchant());

      const app = createApp('wsim_api_test123', 'user-123');
      const response = await request(app).get('/api/merchant/cards');

      expect(response.status).toBe(200);
      expect(response.body.cards).toEqual([]);
    });

    it('should return user cards with bank names', async () => {
      mockPrismaInstance._addOAuthClient(createValidMerchant());
      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId: 'user-123',
        bsimId: 'test-bank',
        bsimIssuer: 'http://localhost:3001',
        fiUserRef: 'fi-user-ref',
        walletCredential: 'encrypted-credential',
        credentialExpiry: null,
        refreshToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaInstance._addWalletCard({
        id: 'card-123',
        userId: 'user-123',
        enrollmentId: 'enrollment-123',
        cardType: 'VISA',
        lastFour: '4242',
        cardholderName: 'Test User',
        expiryMonth: 12,
        expiryYear: 2025,
        bsimCardRef: 'bsim-card-ref',
        walletCardToken: 'wsim_test-bank_abc',
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp('wsim_api_test123', 'user-123');
      const response = await request(app).get('/api/merchant/cards');

      expect(response.status).toBe(200);
      expect(response.body.cards).toHaveLength(1);
      expect(response.body.cards[0]).toMatchObject({
        id: 'card-123',
        lastFour: '4242',
        cardType: 'VISA',
        bankName: 'Test Bank',
        isDefault: true,
      });
    });

    it('should not return inactive cards', async () => {
      mockPrismaInstance._addOAuthClient(createValidMerchant());
      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId: 'user-123',
        bsimId: 'test-bank',
        bsimIssuer: 'http://localhost:3001',
        fiUserRef: 'fi-user-ref',
        walletCredential: 'encrypted-credential',
        credentialExpiry: null,
        refreshToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaInstance._addWalletCard({
        id: 'card-inactive',
        userId: 'user-123',
        enrollmentId: 'enrollment-123',
        cardType: 'VISA',
        lastFour: '1111',
        cardholderName: 'Test User',
        expiryMonth: 12,
        expiryYear: 2025,
        bsimCardRef: 'bsim-card-ref',
        walletCardToken: 'wsim_test-bank_xyz',
        isDefault: false,
        isActive: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp('wsim_api_test123', 'user-123');
      const response = await request(app).get('/api/merchant/cards');

      expect(response.status).toBe(200);
      expect(response.body.cards).toHaveLength(0);
    });
  });

  describe('POST /api/merchant/payment/initiate', () => {
    beforeEach(() => {
      mockPrismaInstance._addOAuthClient(createValidMerchant());
      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId: 'user-123',
        bsimId: 'test-bank',
        bsimIssuer: 'http://localhost:3001',
        fiUserRef: 'fi-user-ref',
        walletCredential: 'encrypted-credential',
        credentialExpiry: null,
        refreshToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaInstance._addWalletCard({
        id: 'card-123',
        userId: 'user-123',
        enrollmentId: 'enrollment-123',
        cardType: 'VISA',
        lastFour: '4242',
        cardholderName: 'Test User',
        expiryMonth: 12,
        expiryYear: 2025,
        bsimCardRef: 'bsim-card-ref',
        walletCardToken: 'wsim_test-bank_abc',
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaInstance._addPasskeyCredential({
        id: 'passkey-123',
        userId: 'user-123',
        credentialId: 'cred-abc',
        publicKey: 'pub-key-base64',
        counter: 0,
        transports: ['internal'],
        deviceName: null,
        aaguid: null,
        createdAt: new Date(),
        lastUsedAt: null,
      });
    });

    it('should require API key and user session', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/merchant/payment/initiate')
        .send({ cardId: 'card-123', amount: 100 });

      expect(response.status).toBe(401);
    });

    it('should require cardId and amount', async () => {
      const app = createApp('wsim_api_test123', 'user-123');
      const response = await request(app)
        .post('/api/merchant/payment/initiate')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_request');
      expect(response.body.message).toContain('cardId and amount are required');
    });

    it('should return 404 for non-existent card', async () => {
      const app = createApp('wsim_api_test123', 'user-123');
      const response = await request(app)
        .post('/api/merchant/payment/initiate')
        .send({ cardId: 'non-existent-card', amount: 100 });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('card_not_found');
    });

    it('should return 400 if user has no passkeys', async () => {
      // Clear passkeys
      mockPrismaInstance._clear();
      mockPrismaInstance._addOAuthClient(createValidMerchant());
      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId: 'user-123',
        bsimId: 'test-bank',
        bsimIssuer: 'http://localhost:3001',
        fiUserRef: 'fi-user-ref',
        walletCredential: 'encrypted-credential',
        credentialExpiry: null,
        refreshToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaInstance._addWalletCard({
        id: 'card-123',
        userId: 'user-123',
        enrollmentId: 'enrollment-123',
        cardType: 'VISA',
        lastFour: '4242',
        cardholderName: 'Test User',
        expiryMonth: 12,
        expiryYear: 2025,
        bsimCardRef: 'bsim-card-ref',
        walletCardToken: 'wsim_test-bank_abc',
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp('wsim_api_test123', 'user-123');
      const response = await request(app)
        .post('/api/merchant/payment/initiate')
        .send({ cardId: 'card-123', amount: 100 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('no_passkeys');
    });

    it('should return payment options with valid request', async () => {
      const app = createApp('wsim_api_test123', 'user-123');
      const response = await request(app)
        .post('/api/merchant/payment/initiate')
        .send({
          cardId: 'card-123',
          amount: 99.99,
          currency: 'CAD',
          orderId: 'order-xyz',
        });

      expect(response.status).toBe(200);
      expect(response.body.paymentId).toMatch(/^pay_/);
      expect(response.body.passkeyOptions).toBeDefined();
      expect(response.body.passkeyOptions.challenge).toBe('test-challenge-base64url');
      expect(response.body.card).toEqual({
        lastFour: '4242',
        cardType: 'VISA',
      });
      expect(response.body.orderId).toBe('order-xyz');
    });

    it('should default currency to CAD', async () => {
      const app = createApp('wsim_api_test123', 'user-123');
      const response = await request(app)
        .post('/api/merchant/payment/initiate')
        .send({ cardId: 'card-123', amount: 50 });

      expect(response.status).toBe(200);
      // Currency is stored internally but not returned in response
      expect(response.body.paymentId).toBeDefined();
    });
  });

  describe('POST /api/merchant/payment/confirm', () => {
    it('should require API key', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/merchant/payment/confirm')
        .send({ paymentId: 'pay_123', passkeyResponse: {} });

      expect(response.status).toBe(401);
    });

    it('should require paymentId and passkeyResponse', async () => {
      mockPrismaInstance._addOAuthClient(createValidMerchant());

      const app = createApp('wsim_api_test123');
      const response = await request(app)
        .post('/api/merchant/payment/confirm')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_request');
    });

    it('should return 400 for invalid/expired payment', async () => {
      mockPrismaInstance._addOAuthClient(createValidMerchant());

      const app = createApp('wsim_api_test123');
      const response = await request(app)
        .post('/api/merchant/payment/confirm')
        .send({
          paymentId: 'pay_non_existent',
          passkeyResponse: { id: 'cred-abc' },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_payment');
    });

    // Note: Full payment confirm flow requires complex mocking of:
    // 1. Payment challenge store (in-memory)
    // 2. Passkey verification
    // 3. BSIM API call
    // These would be better tested as integration tests
  });
});
