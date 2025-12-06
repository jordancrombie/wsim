// Enrollment Routes Tests
// Tests for /api/enrollment/* endpoints

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import session from 'express-session';
import { createMockPrismaClient, MockPrismaClient } from '../test/mocks/mockPrisma';

// Mock the database module
vi.mock('../config/database', () => ({
  prisma: null as any, // Will be set in beforeEach
}));

// Mock the crypto module
vi.mock('../utils/crypto', () => ({
  encrypt: vi.fn((value: string) => `encrypted-${value}`),
  decrypt: vi.fn((value: string) => value.replace('encrypted-', '')),
  generateWalletCardToken: vi.fn((bsimId: string) => `wsim_${bsimId}_test123`),
}));

// Mock the bsim-oidc service
vi.mock('../services/bsim-oidc', () => ({
  generatePkce: vi.fn(async () => ({
    codeVerifier: 'test-code-verifier',
    codeChallenge: 'test-code-challenge',
  })),
  generateState: vi.fn(() => 'test-state-12345'),
  generateNonce: vi.fn(() => 'test-nonce-67890'),
  buildAuthorizationUrl: vi.fn(async () => 'https://auth.testbank.ca/authorize?state=test-state'),
  exchangeCode: vi.fn(),
  fetchCards: vi.fn(),
}));

// Mock bcrypt
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(async (password: string) => `hashed-${password}`),
    compare: vi.fn(async (password: string, hash: string) => hash === `hashed-${password}`),
  },
}));

// Mock the env module
vi.mock('../config/env', () => ({
  env: {
    APP_URL: 'http://localhost:3003',
    FRONTEND_URL: 'http://localhost:3004',
    BSIM_PROVIDERS: JSON.stringify([
      {
        bsimId: 'test-bank',
        name: 'Test Bank',
        issuer: 'https://auth.testbank.ca',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        logoUrl: 'https://testbank.ca/logo.png',
      },
      {
        bsimId: 'other-bank',
        name: 'Other Bank',
        issuer: 'https://auth.otherbank.ca',
        clientId: 'other-client-id',
        clientSecret: 'other-client-secret',
      },
    ]),
  },
}));

let mockPrismaInstance: MockPrismaClient;

// Get the mocked modules
import * as database from '../config/database';
import * as bsimOidc from '../services/bsim-oidc';
import enrollmentRouter from './enrollment';

// Mock auth middleware
vi.mock('../middleware/auth', () => ({
  optionalAuth: (req: any, res: any, next: () => void) => {
    // Check session for userId
    if (req.session?.userId) {
      req.userId = req.session.userId;
      req.user = { id: req.session.userId, email: 'test@example.com' };
    }
    next();
  },
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.userId = req.session.userId;
    req.user = { id: req.session.userId, email: 'test@example.com' };
    next();
  },
}));

// Create Express app with enrollment router
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false },
    })
  );
  app.use('/api/enrollment', enrollmentRouter);
  return app;
}

describe('Enrollment Routes', () => {
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

  describe('GET /api/enrollment/banks', () => {
    it('should return list of available banks', async () => {
      const response = await request(app).get('/api/enrollment/banks');

      expect(response.status).toBe(200);
      expect(response.body.banks).toHaveLength(2);
      expect(response.body.banks[0]).toEqual({
        bsimId: 'test-bank',
        name: 'Test Bank',
        logoUrl: 'https://testbank.ca/logo.png',
      });
      expect(response.body.banks[1]).toEqual({
        bsimId: 'other-bank',
        name: 'Other Bank',
        logoUrl: undefined,
      });
    });
  });

  describe('POST /api/enrollment/start/:bsimId', () => {
    it('should return 404 for non-existent bank', async () => {
      const response = await request(app)
        .post('/api/enrollment/start/unknown-bank')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });

    it('should return authorization URL for valid bank', async () => {
      const response = await request(app)
        .post('/api/enrollment/start/test-bank')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.authUrl).toBe('https://auth.testbank.ca/authorize?state=test-state');
      expect(response.body.bsimId).toBe('test-bank');
      expect(response.body.bankName).toBe('Test Bank');

      // Verify OIDC functions were called
      expect(bsimOidc.generatePkce).toHaveBeenCalled();
      expect(bsimOidc.generateState).toHaveBeenCalled();
      expect(bsimOidc.generateNonce).toHaveBeenCalled();
      expect(bsimOidc.buildAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({ bsimId: 'test-bank' }),
        'http://localhost:3003/api/enrollment/callback/test-bank',
        'test-state-12345',
        'test-nonce-67890',
        'test-code-challenge'
      );
    });

    it('should hash password if provided and >= 8 characters', async () => {
      const response = await request(app)
        .post('/api/enrollment/start/test-bank')
        .send({ password: 'securepassword123' });

      expect(response.status).toBe(200);
      // Password hash is stored in session, we can verify bcrypt was called
      const bcrypt = await import('bcrypt');
      expect(bcrypt.default.hash).toHaveBeenCalledWith('securepassword123', 12);
    });

    it('should not hash password if too short', async () => {
      const response = await request(app)
        .post('/api/enrollment/start/test-bank')
        .send({ password: 'short' });

      expect(response.status).toBe(200);
      const bcrypt = await import('bcrypt');
      expect(bcrypt.default.hash).not.toHaveBeenCalled();
    });

    it('should handle OIDC errors gracefully', async () => {
      vi.mocked(bsimOidc.buildAuthorizationUrl).mockRejectedValueOnce(
        new Error('OIDC discovery failed')
      );

      const response = await request(app)
        .post('/api/enrollment/start/test-bank')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('enrollment_failed');
      expect(response.body.message).toBe('OIDC discovery failed');
    });
  });

  describe('GET /api/enrollment/list', () => {
    it('should require authentication', async () => {
      const response = await request(app).get('/api/enrollment/list');

      expect(response.status).toBe(401);
    });

    it('should return user enrollments with bank info', async () => {
      // Add user and enrollment
      mockPrismaInstance._addWalletUser({
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: null,
        firstName: 'Test',
        lastName: 'User',
        walletId: 'wallet-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId: 'user-123',
        bsimId: 'test-bank',
        bsimIssuer: 'https://auth.testbank.ca',
        fiUserRef: 'fi-user-ref',
        walletCredential: 'encrypted-credential',
        credentialExpiry: new Date(Date.now() + 3600000),
        refreshToken: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date(),
      });

      // Add some cards
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

      // Create agent to maintain session
      const agent = request.agent(app);

      // Set up session (simulate authenticated request)
      // Since we can't easily set session, we need to test differently
      // We'll mock the findMany to return data and verify it works
      const mockFindMany = vi.fn().mockResolvedValue([
        {
          id: 'enrollment-123',
          bsimId: 'test-bank',
          createdAt: new Date('2024-01-01'),
          credentialExpiry: new Date(Date.now() + 3600000),
          _count: { cards: 1 },
        },
      ]);
      mockPrismaInstance.bsimEnrollment.findMany = mockFindMany;

      // For this test, we need to simulate an authenticated session
      // Create a custom app with pre-set session
      const authApp = express();
      authApp.use(express.json());
      authApp.use((req: any, res, next) => {
        req.session = { userId: 'user-123' };
        next();
      });
      authApp.use('/api/enrollment', enrollmentRouter);

      const response = await request(authApp).get('/api/enrollment/list');

      expect(response.status).toBe(200);
      expect(response.body.enrollments).toHaveLength(1);
      expect(response.body.enrollments[0].bsimId).toBe('test-bank');
      expect(response.body.enrollments[0].bankName).toBe('Test Bank');
      expect(response.body.enrollments[0].cardCount).toBe(1);
    });
  });

  describe('DELETE /api/enrollment/:enrollmentId', () => {
    it('should require authentication', async () => {
      const response = await request(app).delete('/api/enrollment/enrollment-123');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent enrollment', async () => {
      // Create authenticated app
      const authApp = express();
      authApp.use(express.json());
      authApp.use((req: any, res, next) => {
        req.session = { userId: 'user-123' };
        next();
      });
      authApp.use('/api/enrollment', enrollmentRouter);

      const response = await request(authApp).delete('/api/enrollment/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });

    it('should delete enrollment and return deleted card count', async () => {
      // Add user
      mockPrismaInstance._addWalletUser({
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: null,
        firstName: 'Test',
        lastName: 'User',
        walletId: 'wallet-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Add enrollment
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

      // Create authenticated app
      const authApp = express();
      authApp.use(express.json());
      authApp.use((req: any, res, next) => {
        req.session = { userId: 'user-123' };
        next();
      });
      authApp.use('/api/enrollment', enrollmentRouter);

      const response = await request(authApp).delete('/api/enrollment/enrollment-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.deletedCards).toBe(2);

      // Verify enrollment was deleted
      const enrollments = mockPrismaInstance._getBsimEnrollments();
      expect(enrollments).toHaveLength(0);

      // Verify cards were cascade deleted
      const cards = mockPrismaInstance._getWalletCards();
      expect(cards).toHaveLength(0);
    });

    it('should not delete enrollment belonging to another user', async () => {
      // Add enrollment for different user
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

      // Create authenticated app as user-123
      const authApp = express();
      authApp.use(express.json());
      authApp.use((req: any, res, next) => {
        req.session = { userId: 'user-123' };
        next();
      });
      authApp.use('/api/enrollment', enrollmentRouter);

      const response = await request(authApp).delete('/api/enrollment/enrollment-other');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');

      // Verify enrollment was NOT deleted
      const enrollments = mockPrismaInstance._getBsimEnrollments();
      expect(enrollments).toHaveLength(1);
    });
  });

  describe('GET /api/enrollment/callback/:bsimId', () => {
    // Helper to create app with enrollment state in session
    function createAppWithEnrollmentState(enrollmentState: any) {
      const authApp = express();
      authApp.use(express.json());
      authApp.use((req: any, res, next) => {
        req.session = {
          enrollmentState,
          save: (cb: () => void) => cb(),
        };
        next();
      });
      authApp.use('/api/enrollment', enrollmentRouter);
      return authApp;
    }

    it('should redirect with error if BSIM returns error', async () => {
      const authApp = createAppWithEnrollmentState({
        bsimId: 'test-bank',
        state: 'test-state',
        nonce: 'test-nonce',
        codeVerifier: 'test-verifier',
      });

      const response = await request(authApp).get(
        '/api/enrollment/callback/test-bank?error=access_denied&error_description=User%20cancelled'
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/enroll?error=access_denied');
    });

    it('should redirect with error if no code provided', async () => {
      const authApp = createAppWithEnrollmentState({
        bsimId: 'test-bank',
        state: 'test-state',
        nonce: 'test-nonce',
        codeVerifier: 'test-verifier',
      });

      const response = await request(authApp).get('/api/enrollment/callback/test-bank?state=test-state');

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('error=missing_code');
    });

    it('should redirect with error if no enrollment state in session', async () => {
      const authApp = express();
      authApp.use(express.json());
      authApp.use((req: any, res, next) => {
        req.session = {};
        next();
      });
      authApp.use('/api/enrollment', enrollmentRouter);

      const response = await request(authApp).get(
        '/api/enrollment/callback/test-bank?code=auth-code&state=test-state'
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('error=invalid_session');
    });

    it('should redirect with error if state mismatch', async () => {
      const authApp = createAppWithEnrollmentState({
        bsimId: 'test-bank',
        state: 'correct-state',
        nonce: 'test-nonce',
        codeVerifier: 'test-verifier',
      });

      const response = await request(authApp).get(
        '/api/enrollment/callback/test-bank?code=auth-code&state=wrong-state'
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('error=invalid_state');
    });

    it('should redirect with error if bsimId mismatch', async () => {
      const authApp = createAppWithEnrollmentState({
        bsimId: 'test-bank',
        state: 'test-state',
        nonce: 'test-nonce',
        codeVerifier: 'test-verifier',
      });

      const response = await request(authApp).get(
        '/api/enrollment/callback/other-bank?code=auth-code&state=test-state'
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('error=invalid_bsim');
    });

    it('should create new user and enrollment on successful callback', async () => {
      // Mock token exchange
      vi.mocked(bsimOidc.exchangeCode).mockResolvedValueOnce({
        accessToken: 'access-token',
        idToken: 'id-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
        walletCredential: 'wcred_test_credential',
        fiUserRef: 'fi-user-ref-123',
        email: 'newuser@example.com',
        firstName: 'New',
        lastName: 'User',
      });

      // Mock card fetch
      vi.mocked(bsimOidc.fetchCards).mockResolvedValueOnce([
        {
          cardRef: 'card-ref-1',
          cardType: 'VISA',
          lastFour: '4242',
          cardholderName: 'New User',
          expiryMonth: 12,
          expiryYear: 2025,
          isActive: true,
        },
      ]);

      const authApp = createAppWithEnrollmentState({
        bsimId: 'test-bank',
        state: 'test-state',
        nonce: 'test-nonce',
        codeVerifier: 'test-verifier',
      });

      const response = await request(authApp).get(
        '/api/enrollment/callback/test-bank?code=auth-code&state=test-state'
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('http://localhost:3004/wallet?enrolled=test-bank');

      // Verify user was created
      const users = mockPrismaInstance._getWalletUsers();
      expect(users).toHaveLength(1);
      expect(users[0].email).toBe('newuser@example.com');
      expect(users[0].firstName).toBe('New');
      expect(users[0].lastName).toBe('User');

      // Verify enrollment was created
      const enrollments = mockPrismaInstance._getBsimEnrollments();
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0].bsimId).toBe('test-bank');
      expect(enrollments[0].fiUserRef).toBe('fi-user-ref-123');

      // Verify card was created
      const cards = mockPrismaInstance._getWalletCards();
      expect(cards).toHaveLength(1);
      expect(cards[0].cardType).toBe('VISA');
      expect(cards[0].lastFour).toBe('4242');
    });

    it('should update existing user on re-enrollment', async () => {
      // Add existing user
      mockPrismaInstance._addWalletUser({
        id: 'existing-user',
        email: 'existing@example.com',
        passwordHash: null,
        firstName: 'Old',
        lastName: 'Name',
        walletId: 'wallet-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(bsimOidc.exchangeCode).mockResolvedValueOnce({
        accessToken: 'access-token',
        idToken: 'id-token',
        expiresIn: 3600,
        fiUserRef: 'fi-user-ref-123',
        email: 'existing@example.com',
        firstName: 'Updated',
        lastName: 'Name',
      });

      vi.mocked(bsimOidc.fetchCards).mockResolvedValueOnce([]);

      const authApp = createAppWithEnrollmentState({
        bsimId: 'test-bank',
        state: 'test-state',
        nonce: 'test-nonce',
        codeVerifier: 'test-verifier',
      });

      const response = await request(authApp).get(
        '/api/enrollment/callback/test-bank?code=auth-code&state=test-state'
      );

      expect(response.status).toBe(302);

      // Verify user was updated (not duplicated)
      const users = mockPrismaInstance._getWalletUsers();
      expect(users).toHaveLength(1);
      expect(users[0].firstName).toBe('Updated');
    });

    it('should set password during enrollment if provided', async () => {
      vi.mocked(bsimOidc.exchangeCode).mockResolvedValueOnce({
        accessToken: 'access-token',
        idToken: 'id-token',
        expiresIn: 3600,
        fiUserRef: 'fi-user-ref-123',
        email: 'newuser@example.com',
      });

      vi.mocked(bsimOidc.fetchCards).mockResolvedValueOnce([]);

      const authApp = createAppWithEnrollmentState({
        bsimId: 'test-bank',
        state: 'test-state',
        nonce: 'test-nonce',
        codeVerifier: 'test-verifier',
        passwordHash: 'hashed-password123',
      });

      const response = await request(authApp).get(
        '/api/enrollment/callback/test-bank?code=auth-code&state=test-state'
      );

      expect(response.status).toBe(302);

      // Verify password was set
      const users = mockPrismaInstance._getWalletUsers();
      expect(users[0].passwordHash).toBe('hashed-password123');
    });

    it('should handle card fetch errors gracefully', async () => {
      vi.mocked(bsimOidc.exchangeCode).mockResolvedValueOnce({
        accessToken: 'access-token',
        idToken: 'id-token',
        expiresIn: 3600,
        walletCredential: 'wcred_test',
        fiUserRef: 'fi-user-ref-123',
        email: 'newuser@example.com',
      });

      vi.mocked(bsimOidc.fetchCards).mockRejectedValueOnce(new Error('BSIM API unavailable'));

      const authApp = createAppWithEnrollmentState({
        bsimId: 'test-bank',
        state: 'test-state',
        nonce: 'test-nonce',
        codeVerifier: 'test-verifier',
      });

      const response = await request(authApp).get(
        '/api/enrollment/callback/test-bank?code=auth-code&state=test-state'
      );

      // Should still succeed - card fetch failure doesn't break enrollment
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('http://localhost:3004/wallet?enrolled=test-bank');

      // User and enrollment should still be created
      const users = mockPrismaInstance._getWalletUsers();
      expect(users).toHaveLength(1);
      const enrollments = mockPrismaInstance._getBsimEnrollments();
      expect(enrollments).toHaveLength(1);
    });
  });
});
