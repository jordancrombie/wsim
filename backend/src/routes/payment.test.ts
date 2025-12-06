// Payment Routes Tests
// Tests for /api/payment/* endpoints

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createMockPrismaClient, MockPrismaClient } from '../test/mocks/mockPrisma';

// Mock the database module
vi.mock('../config/database', () => ({
  prisma: null as any, // Will be set in beforeEach
}));

// Mock the crypto module
vi.mock('../utils/crypto', () => ({
  decrypt: vi.fn((value: string) => `decrypted-${value}`),
  encrypt: vi.fn((value: string) => `encrypted-${value}`),
}));

// Mock the env module
vi.mock('../config/env', () => ({
  env: {
    INTERNAL_API_SECRET: 'test-internal-secret',
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

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

let mockPrismaInstance: MockPrismaClient;

// Get the mocked module
import * as database from '../config/database';
import paymentRouter from './payment';

// Create Express app with payment router
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/payment', paymentRouter);
  return app;
}

describe('Payment Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    mockPrismaInstance = createMockPrismaClient();
    (database as any).prisma = mockPrismaInstance;
    vi.clearAllMocks();
    app = createTestApp();
  });

  afterEach(() => {
    mockPrismaInstance._clear();
  });

  describe('POST /api/payment/request-token', () => {
    const validCard = {
      id: 'card-123',
      userId: 'user-123',
      enrollmentId: 'enrollment-123',
      cardType: 'VISA',
      lastFour: '4242',
      cardholderName: 'Test User',
      expiryMonth: 12,
      expiryYear: 2025,
      bsimCardRef: 'bsim-card-ref-123',
      walletCardToken: 'wsim_test-bank_abc123',
      isDefault: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const validEnrollment = {
      id: 'enrollment-123',
      userId: 'user-123',
      bsimId: 'test-bank',
      bsimIssuer: 'http://localhost:3001',
      fiUserRef: 'fi-user-ref-123',
      walletCredential: 'encrypted-wallet-credential',
      credentialExpiry: null,
      refreshToken: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should reject requests without authorization', async () => {
      const response = await request(app)
        .post('/api/payment/request-token')
        .send({ walletCardId: 'card-123' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });

    it('should reject requests with invalid authorization', async () => {
      const response = await request(app)
        .post('/api/payment/request-token')
        .set('Authorization', 'Bearer wrong-secret')
        .send({ walletCardId: 'card-123' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });

    it('should require walletCardId', async () => {
      const response = await request(app)
        .post('/api/payment/request-token')
        .set('Authorization', 'Bearer test-internal-secret')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_request');
      expect(response.body.message).toBe('walletCardId is required');
    });

    it('should return 404 for non-existent card', async () => {
      const response = await request(app)
        .post('/api/payment/request-token')
        .set('Authorization', 'Bearer test-internal-secret')
        .send({ walletCardId: 'non-existent-card' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });

    it('should return 404 for missing provider config', async () => {
      // Add card with an enrollment that has unknown bsimId
      const unknownEnrollment = {
        ...validEnrollment,
        id: 'unknown-enrollment',
        bsimId: 'unknown-bank',
      };
      const cardWithUnknownProvider = {
        ...validCard,
        enrollmentId: 'unknown-enrollment',
      };

      mockPrismaInstance._addBsimEnrollment(unknownEnrollment);
      mockPrismaInstance._addWalletCard(cardWithUnknownProvider);

      const response = await request(app)
        .post('/api/payment/request-token')
        .set('Authorization', 'Bearer test-internal-secret')
        .send({ walletCardId: 'card-123' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('provider_not_found');
    });

    it('should successfully request token from BSIM', async () => {
      mockPrismaInstance._addBsimEnrollment(validEnrollment);
      mockPrismaInstance._addWalletCard(validCard);

      // Mock successful BSIM response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'card-token-xyz',
          tokenId: 'token-id-abc',
          expiresAt: '2025-01-01T00:00:00Z',
          cardInfo: {
            lastFour: '4242',
            cardType: 'VISA',
          },
        }),
      });

      const response = await request(app)
        .post('/api/payment/request-token')
        .set('Authorization', 'Bearer test-internal-secret')
        .send({
          walletCardId: 'card-123',
          merchantId: 'merchant-123',
          merchantName: 'Test Merchant',
          amount: '100.00',
          currency: 'CAD',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        cardToken: 'card-token-xyz',
        tokenId: 'token-id-abc',
        expiresAt: '2025-01-01T00:00:00Z',
        walletCardToken: 'wsim_test-bank_abc123',
        cardInfo: {
          lastFour: '4242',
          cardType: 'VISA',
        },
      });

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/wallet/tokens',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer decrypted-encrypted-wallet-credential',
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should handle BSIM error response', async () => {
      mockPrismaInstance._addBsimEnrollment(validEnrollment);
      mockPrismaInstance._addWalletCard(validCard);

      // Mock failed BSIM response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const response = await request(app)
        .post('/api/payment/request-token')
        .set('Authorization', 'Bearer test-internal-secret')
        .send({ walletCardId: 'card-123' });

      expect(response.status).toBe(502);
      expect(response.body.error).toBe('bsim_error');
    });

    it('should default currency to CAD', async () => {
      mockPrismaInstance._addBsimEnrollment(validEnrollment);
      mockPrismaInstance._addWalletCard(validCard);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'card-token-xyz',
          tokenId: 'token-id-abc',
          expiresAt: '2025-01-01T00:00:00Z',
          cardInfo: { lastFour: '4242', cardType: 'VISA' },
        }),
      });

      await request(app)
        .post('/api/payment/request-token')
        .set('Authorization', 'Bearer test-internal-secret')
        .send({ walletCardId: 'card-123', amount: '50.00' });

      // Check that CAD was used as default
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.currency).toBe('CAD');
    });
  });

  describe('POST /api/payment/context', () => {
    it('should reject requests without authorization', async () => {
      const response = await request(app)
        .post('/api/payment/context')
        .send({
          grantId: 'grant-123',
          walletCardId: 'card-123',
          walletCardToken: 'wsim_test_abc',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });

    it('should require grantId, walletCardId, and walletCardToken', async () => {
      const response = await request(app)
        .post('/api/payment/context')
        .set('Authorization', 'Bearer test-internal-secret')
        .send({ grantId: 'grant-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_request');
      expect(response.body.message).toContain('grantId, walletCardId, and walletCardToken are required');
    });

    it('should create payment context successfully', async () => {
      const response = await request(app)
        .post('/api/payment/context')
        .set('Authorization', 'Bearer test-internal-secret')
        .send({
          grantId: 'grant-123',
          walletCardId: 'card-123',
          walletCardToken: 'wsim_test_abc',
          bsimCardToken: 'bsim-token-xyz',
          merchantId: 'merchant-123',
          merchantName: 'Test Merchant',
          amount: '99.99',
          currency: 'CAD',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.contextId).toBeDefined();

      // Verify context was stored
      const contexts = mockPrismaInstance._getPaymentContexts();
      expect(contexts).toHaveLength(1);
      expect(contexts[0].grantId).toBe('grant-123');
      expect(contexts[0].walletCardToken).toBe('wsim_test_abc');
    });

    it('should update existing context with same grantId (upsert)', async () => {
      // Create initial context
      await request(app)
        .post('/api/payment/context')
        .set('Authorization', 'Bearer test-internal-secret')
        .send({
          grantId: 'grant-123',
          walletCardId: 'card-old',
          walletCardToken: 'wsim_test_old',
        });

      // Update with same grantId
      const response = await request(app)
        .post('/api/payment/context')
        .set('Authorization', 'Bearer test-internal-secret')
        .send({
          grantId: 'grant-123',
          walletCardId: 'card-new',
          walletCardToken: 'wsim_test_new',
        });

      expect(response.status).toBe(200);

      // Verify context was updated, not duplicated
      const contexts = mockPrismaInstance._getPaymentContexts();
      expect(contexts).toHaveLength(1);
      expect(contexts[0].walletCardToken).toBe('wsim_test_new');
    });
  });

  describe('GET /api/payment/context/:grantId', () => {
    it('should reject requests without authorization', async () => {
      const response = await request(app)
        .get('/api/payment/context/grant-123');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });

    it('should return 404 for non-existent context', async () => {
      const response = await request(app)
        .get('/api/payment/context/non-existent-grant')
        .set('Authorization', 'Bearer test-internal-secret');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });

    it('should return 410 for expired context', async () => {
      // Add expired context
      mockPrismaInstance._addPaymentContext({
        id: 'context-123',
        grantId: 'expired-grant',
        walletCardId: 'card-123',
        walletCardToken: 'wsim_test_abc',
        bsimCardToken: null,
        merchantId: null,
        merchantName: null,
        amount: null,
        currency: null,
        createdAt: new Date(Date.now() - 20 * 60 * 1000), // 20 mins ago
        expiresAt: new Date(Date.now() - 10 * 60 * 1000), // Expired 10 mins ago
      });

      const response = await request(app)
        .get('/api/payment/context/expired-grant')
        .set('Authorization', 'Bearer test-internal-secret');

      expect(response.status).toBe(410);
      expect(response.body.error).toBe('expired');
    });

    it('should return context data successfully', async () => {
      // Add valid context
      mockPrismaInstance._addPaymentContext({
        id: 'context-123',
        grantId: 'valid-grant',
        walletCardId: 'card-123',
        walletCardToken: 'wsim_test_abc',
        bsimCardToken: 'bsim-token-xyz',
        merchantId: 'merchant-123',
        merchantName: 'Test Merchant',
        amount: { toString: () => '150.00' },
        currency: 'CAD',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // Valid for 10 more mins
      });

      const response = await request(app)
        .get('/api/payment/context/valid-grant')
        .set('Authorization', 'Bearer test-internal-secret');

      expect(response.status).toBe(200);
      expect(response.body.walletCardToken).toBe('wsim_test_abc');
      expect(response.body.bsimCardToken).toBe('bsim-token-xyz');
      expect(response.body.merchantId).toBe('merchant-123');
      expect(response.body.merchantName).toBe('Test Merchant');
      expect(response.body.currency).toBe('CAD');
      // amount is a Decimal object that may serialize differently
      expect(response.body.amount).toBeDefined();
    });

    it('should return context without optional fields', async () => {
      // Add minimal context
      mockPrismaInstance._addPaymentContext({
        id: 'context-456',
        grantId: 'minimal-grant',
        walletCardId: 'card-123',
        walletCardToken: 'wsim_test_def',
        bsimCardToken: null,
        merchantId: null,
        merchantName: null,
        amount: null,
        currency: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      const response = await request(app)
        .get('/api/payment/context/minimal-grant')
        .set('Authorization', 'Bearer test-internal-secret');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        walletCardToken: 'wsim_test_def',
        bsimCardToken: null,
        merchantId: null,
        merchantName: null,
        amount: null,
        currency: null,
      });
    });
  });
});
