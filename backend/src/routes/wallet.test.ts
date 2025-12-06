// Wallet Routes Tests
// Tests for /api/wallet/* endpoints

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createMockPrismaClient, MockPrismaClient } from '../test/mocks/mockPrisma';

// Mock the database module BEFORE importing the router
vi.mock('../config/database', () => ({
  prisma: null as any, // Will be set in beforeEach
}));

// Mock auth middleware BEFORE importing the router
vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn((req: any, res: any, next: () => void) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.userId = req.session.userId;
    req.user = { id: req.session.userId, email: 'test@example.com' };
    next();
  }),
}));

let mockPrismaInstance: MockPrismaClient;

// Get the mocked module
import * as database from '../config/database';
import walletRouter from './wallet';

// Helper to create authenticated app
function createAuthenticatedApp(userId: string) {
  const app = express();
  app.use(express.json());
  app.use((req: any, res, next) => {
    req.session = { userId };
    next();
  });
  app.use('/api/wallet', walletRouter);
  return app;
}

// Helper to create unauthenticated app
function createUnauthenticatedApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, res, next) => {
    req.session = {};
    next();
  });
  app.use('/api/wallet', walletRouter);
  return app;
}

describe('Wallet Routes', () => {
  beforeEach(() => {
    mockPrismaInstance = createMockPrismaClient();
    (database as any).prisma = mockPrismaInstance;

    // Add $transaction mock
    (mockPrismaInstance as any).$transaction = vi.fn(async (operations: any[]) => {
      // Execute all operations in sequence
      const results = [];
      for (const op of operations) {
        results.push(await op);
      }
      return results;
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    mockPrismaInstance._clear();
  });

  describe('GET /api/wallet/cards', () => {
    it('should require authentication', async () => {
      const app = createUnauthenticatedApp();
      const response = await request(app).get('/api/wallet/cards');

      expect(response.status).toBe(401);
    });

    it('should return empty array when user has no cards', async () => {
      const app = createAuthenticatedApp('user-123');
      const response = await request(app).get('/api/wallet/cards');

      expect(response.status).toBe(200);
      expect(response.body.cards).toEqual([]);
    });

    it('should return user cards with enrollment info', async () => {
      // Add enrollment first
      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId: 'user-123',
        bsimId: 'test-bank',
        bsimIssuer: 'https://auth.testbank.ca',
        fiUserRef: 'fi-user-ref',
        walletCredential: 'encrypted-credential',
        credentialExpiry: null,
        refreshToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Add cards
      mockPrismaInstance._addWalletCard({
        id: 'card-1',
        userId: 'user-123',
        enrollmentId: 'enrollment-123',
        cardType: 'VISA',
        lastFour: '4242',
        cardholderName: 'Test User',
        expiryMonth: 12,
        expiryYear: 2025,
        bsimCardRef: 'bsim-card-1',
        walletCardToken: 'wsim_test-bank_abc',
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrismaInstance._addWalletCard({
        id: 'card-2',
        userId: 'user-123',
        enrollmentId: 'enrollment-123',
        cardType: 'MC',
        lastFour: '5555',
        cardholderName: 'Test User',
        expiryMonth: 6,
        expiryYear: 2026,
        bsimCardRef: 'bsim-card-2',
        walletCardToken: 'wsim_test-bank_def',
        isDefault: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createAuthenticatedApp('user-123');
      const response = await request(app).get('/api/wallet/cards');

      expect(response.status).toBe(200);
      expect(response.body.cards).toHaveLength(2);
      expect(response.body.cards[0]).toMatchObject({
        id: 'card-1',
        cardType: 'VISA',
        lastFour: '4242',
        bsimId: 'test-bank',
        isDefault: true,
      });
    });

    it('should not return inactive cards', async () => {
      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId: 'user-123',
        bsimId: 'test-bank',
        bsimIssuer: 'https://auth.testbank.ca',
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
        bsimCardRef: 'bsim-card-inactive',
        walletCardToken: 'wsim_test-bank_xyz',
        isDefault: false,
        isActive: false, // Inactive
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createAuthenticatedApp('user-123');
      const response = await request(app).get('/api/wallet/cards');

      expect(response.status).toBe(200);
      expect(response.body.cards).toHaveLength(0);
    });

    it('should not return cards belonging to another user', async () => {
      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-other',
        userId: 'other-user',
        bsimId: 'test-bank',
        bsimIssuer: 'https://auth.testbank.ca',
        fiUserRef: 'fi-user-ref',
        walletCredential: 'encrypted-credential',
        credentialExpiry: null,
        refreshToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrismaInstance._addWalletCard({
        id: 'card-other',
        userId: 'other-user',
        enrollmentId: 'enrollment-other',
        cardType: 'AMEX',
        lastFour: '9999',
        cardholderName: 'Other User',
        expiryMonth: 3,
        expiryYear: 2027,
        bsimCardRef: 'bsim-card-other',
        walletCardToken: 'wsim_test-bank_other',
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createAuthenticatedApp('user-123');
      const response = await request(app).get('/api/wallet/cards');

      expect(response.status).toBe(200);
      expect(response.body.cards).toHaveLength(0);
    });
  });

  describe('GET /api/wallet/cards/:cardId', () => {
    beforeEach(() => {
      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId: 'user-123',
        bsimId: 'test-bank',
        bsimIssuer: 'https://auth.testbank.ca',
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
        bsimCardRef: 'bsim-card-1',
        walletCardToken: 'wsim_test-bank_abc',
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should require authentication', async () => {
      const app = createUnauthenticatedApp();
      const response = await request(app).get('/api/wallet/cards/card-123');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent card', async () => {
      const app = createAuthenticatedApp('user-123');
      const response = await request(app).get('/api/wallet/cards/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });

    it('should return 404 for card belonging to another user', async () => {
      const app = createAuthenticatedApp('different-user');
      const response = await request(app).get('/api/wallet/cards/card-123');

      expect(response.status).toBe(404);
    });

    it('should return card details', async () => {
      const app = createAuthenticatedApp('user-123');
      const response = await request(app).get('/api/wallet/cards/card-123');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: 'card-123',
        cardType: 'VISA',
        lastFour: '4242',
        cardholderName: 'Test User',
        bsimId: 'test-bank',
        isDefault: true,
        isActive: true,
        walletCardToken: 'wsim_test-bank_abc',
      });
    });
  });

  describe('POST /api/wallet/cards/:cardId/default', () => {
    beforeEach(() => {
      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId: 'user-123',
        bsimId: 'test-bank',
        bsimIssuer: 'https://auth.testbank.ca',
        fiUserRef: 'fi-user-ref',
        walletCredential: 'encrypted-credential',
        credentialExpiry: null,
        refreshToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrismaInstance._addWalletCard({
        id: 'card-1',
        userId: 'user-123',
        enrollmentId: 'enrollment-123',
        cardType: 'VISA',
        lastFour: '4242',
        cardholderName: 'Test User',
        expiryMonth: 12,
        expiryYear: 2025,
        bsimCardRef: 'bsim-card-1',
        walletCardToken: 'wsim_test-bank_abc',
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrismaInstance._addWalletCard({
        id: 'card-2',
        userId: 'user-123',
        enrollmentId: 'enrollment-123',
        cardType: 'MC',
        lastFour: '5555',
        cardholderName: 'Test User',
        expiryMonth: 6,
        expiryYear: 2026,
        bsimCardRef: 'bsim-card-2',
        walletCardToken: 'wsim_test-bank_def',
        isDefault: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should require authentication', async () => {
      const app = createUnauthenticatedApp();
      const response = await request(app).post('/api/wallet/cards/card-2/default');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent card', async () => {
      const app = createAuthenticatedApp('user-123');
      const response = await request(app).post('/api/wallet/cards/non-existent/default');

      expect(response.status).toBe(404);
    });

    it('should return 404 for inactive card', async () => {
      // Make card inactive
      const cards = mockPrismaInstance._getWalletCards();
      cards[1].isActive = false;

      const app = createAuthenticatedApp('user-123');
      const response = await request(app).post('/api/wallet/cards/card-2/default');

      expect(response.status).toBe(404);
    });

    it('should set card as default', async () => {
      const app = createAuthenticatedApp('user-123');
      const response = await request(app).post('/api/wallet/cards/card-2/default');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.cardId).toBe('card-2');
    });
  });

  describe('DELETE /api/wallet/cards/:cardId', () => {
    beforeEach(() => {
      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId: 'user-123',
        bsimId: 'test-bank',
        bsimIssuer: 'https://auth.testbank.ca',
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
        bsimCardRef: 'bsim-card-1',
        walletCardToken: 'wsim_test-bank_abc',
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should require authentication', async () => {
      const app = createUnauthenticatedApp();
      const response = await request(app).delete('/api/wallet/cards/card-123');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent card', async () => {
      const app = createAuthenticatedApp('user-123');
      const response = await request(app).delete('/api/wallet/cards/non-existent');

      expect(response.status).toBe(404);
    });

    it('should return 404 for card belonging to another user', async () => {
      const app = createAuthenticatedApp('different-user');
      const response = await request(app).delete('/api/wallet/cards/card-123');

      expect(response.status).toBe(404);
    });

    it('should soft delete card (set isActive=false)', async () => {
      const app = createAuthenticatedApp('user-123');
      const response = await request(app).delete('/api/wallet/cards/card-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.cardId).toBe('card-123');

      // Verify card is now inactive
      const cards = mockPrismaInstance._getWalletCards();
      expect(cards[0].isActive).toBe(false);
    });
  });

  describe('GET /api/wallet/enrollments', () => {
    it('should require authentication', async () => {
      const app = createUnauthenticatedApp();
      const response = await request(app).get('/api/wallet/enrollments');

      expect(response.status).toBe(401);
    });

    it('should return empty array when user has no enrollments', async () => {
      const app = createAuthenticatedApp('user-123');
      const response = await request(app).get('/api/wallet/enrollments');

      expect(response.status).toBe(200);
      expect(response.body.enrollments).toEqual([]);
    });

    it('should return user enrollments with card counts', async () => {
      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId: 'user-123',
        bsimId: 'test-bank',
        bsimIssuer: 'https://auth.testbank.ca',
        fiUserRef: 'fi-user-ref',
        walletCredential: 'encrypted-credential',
        credentialExpiry: null,
        refreshToken: null,
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date(),
      });

      mockPrismaInstance._addWalletCard({
        id: 'card-1',
        userId: 'user-123',
        enrollmentId: 'enrollment-123',
        cardType: 'VISA',
        lastFour: '4242',
        cardholderName: 'Test User',
        expiryMonth: 12,
        expiryYear: 2025,
        bsimCardRef: 'bsim-card-1',
        walletCardToken: 'wsim_test-bank_abc',
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Override findMany to return proper count structure
      mockPrismaInstance.bsimEnrollment.findMany = vi.fn().mockResolvedValue([
        {
          id: 'enrollment-123',
          bsimId: 'test-bank',
          createdAt: new Date('2024-01-15'),
          _count: { cards: 1 },
        },
      ]);

      const app = createAuthenticatedApp('user-123');
      const response = await request(app).get('/api/wallet/enrollments');

      expect(response.status).toBe(200);
      expect(response.body.enrollments).toHaveLength(1);
      expect(response.body.enrollments[0]).toMatchObject({
        id: 'enrollment-123',
        bsimId: 'test-bank',
        cardCount: 1,
      });
    });
  });

  describe('GET /api/wallet/profile', () => {
    it('should require authentication', async () => {
      const app = createUnauthenticatedApp();
      const response = await request(app).get('/api/wallet/profile');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent user', async () => {
      const app = createAuthenticatedApp('non-existent-user');
      const response = await request(app).get('/api/wallet/profile');

      expect(response.status).toBe(404);
    });

    it('should return user profile with counts', async () => {
      mockPrismaInstance._addWalletUser({
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: null,
        firstName: 'Test',
        lastName: 'User',
        walletId: 'wallet-abc123',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date(),
      });

      // Override findUnique to return proper count structure
      mockPrismaInstance.walletUser.findUnique = vi.fn().mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        walletId: 'wallet-abc123',
        createdAt: new Date('2024-01-01'),
        _count: {
          walletCards: 3,
          enrollments: 2,
        },
      });

      const app = createAuthenticatedApp('user-123');
      const response = await request(app).get('/api/wallet/profile');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: 'user-123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        walletId: 'wallet-abc123',
        cardCount: 3,
        enrollmentCount: 2,
      });
    });
  });
});
