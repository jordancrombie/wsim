// Mobile API Routes Tests
// Tests for /api/mobile/* endpoints

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createMockPrismaClient, MockPrismaClient } from '../test/mocks/mockPrisma';

// Mock env before importing the router
vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3003',
    FRONTEND_URL: 'http://localhost:3004',
    MOBILE_JWT_SECRET: 'test-mobile-jwt-secret-32-chars-long',
    MOBILE_ACCESS_TOKEN_EXPIRY: 3600,
    MOBILE_REFRESH_TOKEN_EXPIRY: 2592000,
    MOBILE_DEVICE_CREDENTIAL_EXPIRY: 7776000,
    BSIM_PROVIDERS: JSON.stringify([
      {
        bsimId: 'test-bank',
        name: 'Test Bank',
        issuer: 'https://auth.testbank.ca',
        apiUrl: 'https://api.testbank.ca',
        clientId: 'wsim-wallet',
        clientSecret: 'test-secret',
      },
    ]),
  },
}));

// Mock the database module BEFORE importing the router
vi.mock('../config/database', () => ({
  prisma: null as any, // Will be set in beforeEach
}));

// Mock the crypto utilities
vi.mock('../utils/crypto', () => ({
  encrypt: vi.fn((data: string) => `encrypted:${data}`),
  decrypt: vi.fn((data: string) => data.replace('encrypted:', '')),
  generateWalletCardToken: vi.fn((bsimId: string) => `wsim_${bsimId}_${Date.now()}`),
}));

// Mock bsim-oidc for enrollment tests
vi.mock('../services/bsim-oidc', () => ({
  generatePkce: vi.fn().mockResolvedValue({
    codeVerifier: 'test-code-verifier',
    codeChallenge: 'test-code-challenge',
  }),
  generateState: vi.fn().mockReturnValue('test-state'),
  generateNonce: vi.fn().mockReturnValue('test-nonce'),
  buildAuthorizationUrl: vi.fn().mockResolvedValue('https://auth.testbank.ca/authorize?...'),
  exchangeCode: vi.fn().mockResolvedValue({
    accessToken: 'test-access-token',
    walletCredential: 'test-wallet-credential',
    refreshToken: 'test-refresh-token',
    expiresIn: 3600,
    fiUserRef: 'test-fi-user-ref',
  }),
  fetchCards: vi.fn().mockResolvedValue([
    {
      cardRef: 'card-ref-1',
      cardType: 'VISA',
      lastFour: '4242',
      cardholderName: 'Test User',
      expiryMonth: 12,
      expiryYear: 2025,
      isActive: true,
    },
  ]),
}));

let mockPrismaInstance: MockPrismaClient;

// Get the mocked modules
import * as database from '../config/database';
import { env } from '../config/env';
import mobileRouter from './mobile';

// Helper to create Express app with mobile routes
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mobile', mobileRouter);
  return app;
}

// Helper to generate valid access token
function generateTestAccessToken(userId: string, deviceId: string): string {
  return jwt.sign(
    { sub: userId, deviceId, type: 'access' },
    env.MOBILE_JWT_SECRET,
    { expiresIn: '1h', issuer: env.APP_URL, audience: 'mwsim' }
  );
}

// Helper to generate valid refresh token
function generateTestRefreshToken(userId: string, deviceId: string, jti: string): string {
  return jwt.sign(
    { sub: userId, deviceId, jti, type: 'refresh' },
    env.MOBILE_JWT_SECRET,
    { expiresIn: '30d' }
  );
}

describe('Mobile API Routes', () => {
  beforeEach(() => {
    mockPrismaInstance = createMockPrismaClient();
    (database as any).prisma = mockPrismaInstance;

    // Add $transaction mock for operations that use it
    (mockPrismaInstance as any).$transaction = vi.fn(async (operations: any[] | ((tx: any) => Promise<any>)) => {
      if (typeof operations === 'function') {
        // Handle callback-style transactions
        return operations(mockPrismaInstance);
      }
      // Handle array-style transactions
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

  // ===========================================================================
  // DEVICE REGISTRATION
  // ===========================================================================
  describe('POST /api/mobile/device/register', () => {
    it('should return 400 if deviceId is missing', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/device/register')
        .send({ platform: 'ios', deviceName: 'iPhone 15' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_request');
    });

    it('should return 400 if platform is missing', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/device/register')
        .send({ deviceId: 'device-123', deviceName: 'iPhone 15' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_request');
    });

    it('should return 400 if platform is invalid', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/device/register')
        .send({ deviceId: 'device-123', platform: 'windows', deviceName: 'Surface' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_request');
      expect(response.body.message).toContain('ios');
    });

    it('should register new device and return credential', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/device/register')
        .send({ deviceId: 'device-123', platform: 'ios', deviceName: 'iPhone 15' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('deviceCredential');
      expect(response.body).toHaveProperty('expiresAt');
      expect(response.body.message).toContain('Complete registration');
    });

    it('should update existing device and return credential', async () => {
      // Add existing device
      mockPrismaInstance._addMobileDevice({
        id: 'db-device-1',
        userId: 'user-123',
        deviceId: 'device-123',
        platform: 'ios',
        deviceName: 'Old iPhone',
        pushToken: 'old-token',
        deviceCredential: 'old-credential',
        credentialExpiry: new Date(Date.now() + 86400000),
        biometricEnabled: false,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/device/register')
        .send({
          deviceId: 'device-123',
          platform: 'ios',
          deviceName: 'New iPhone',
          pushToken: 'new-token',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('deviceCredential');
    });
  });

  // ===========================================================================
  // ACCOUNT REGISTRATION
  // ===========================================================================
  describe('POST /api/mobile/auth/register', () => {
    it('should return 400 if required fields are missing', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/register')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_request');
    });

    it('should return 400 for invalid email format', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/register')
        .send({
          email: 'invalid-email',
          name: 'Test User',
          deviceId: 'device-123',
          deviceName: 'iPhone 15',
          platform: 'ios',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_request');
      expect(response.body.message).toContain('email');
    });

    it('should return 409 if user already exists', async () => {
      // Add existing user
      mockPrismaInstance._addWalletUser({
        id: 'user-123',
        email: 'existing@example.com',
        passwordHash: null,
        firstName: 'Existing',
        lastName: 'User',
        walletId: 'wallet-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/register')
        .send({
          email: 'existing@example.com',
          name: 'Test User',
          deviceId: 'device-123',
          deviceName: 'iPhone 15',
          platform: 'ios',
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('conflict');
    });

    it('should return 409 if device is already registered', async () => {
      // Add existing device
      mockPrismaInstance._addMobileDevice({
        id: 'db-device-1',
        userId: 'other-user',
        deviceId: 'device-123',
        platform: 'ios',
        deviceName: 'Existing Device',
        pushToken: null,
        deviceCredential: 'credential',
        credentialExpiry: new Date(Date.now() + 86400000),
        biometricEnabled: false,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/register')
        .send({
          email: 'new@example.com',
          name: 'Test User',
          deviceId: 'device-123',
          deviceName: 'iPhone 15',
          platform: 'ios',
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('device_conflict');
    });

    it('should create new user and return tokens', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/register')
        .send({
          email: 'newuser@example.com',
          name: 'John Doe',
          deviceId: 'device-123',
          deviceName: 'iPhone 15',
          platform: 'ios',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe('newuser@example.com');
      expect(response.body.user.name).toBe('John Doe');
      expect(response.body).toHaveProperty('tokens');
      expect(response.body.tokens).toHaveProperty('accessToken');
      expect(response.body.tokens).toHaveProperty('refreshToken');
      expect(response.body.tokens.expiresIn).toBe(3600);
    });

    it('should parse name into firstName and lastName', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/register')
        .send({
          email: 'test@example.com',
          name: 'John Michael Doe',
          deviceId: 'device-123',
          deviceName: 'iPhone 15',
          platform: 'ios',
        });

      expect(response.status).toBe(201);
      expect(response.body.user.name).toBe('John Michael Doe');

      // Check internal storage
      const users = mockPrismaInstance._getWalletUsers();
      expect(users[0].firstName).toBe('John');
      expect(users[0].lastName).toBe('Michael Doe');
    });
  });

  // ===========================================================================
  // LOGIN (Email Code)
  // ===========================================================================
  describe('POST /api/mobile/auth/login', () => {
    it('should return 400 if email is missing', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/login')
        .send({ deviceId: 'device-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_request');
    });

    it('should return 404 if user not found', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/login')
        .send({ email: 'nonexistent@example.com', deviceId: 'device-123' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });

    it('should return challenge for existing user', async () => {
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

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/login')
        .send({ email: 'test@example.com', deviceId: 'device-123' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('challenge');
      expect(response.body.method).toBe('email');
      // Note: _devCode is only returned when NODE_ENV === 'development'
      // In test mode, it's not returned (which is correct behavior)
    });
  });

  // ===========================================================================
  // LOGIN VERIFY
  // ===========================================================================
  describe('POST /api/mobile/auth/login/verify', () => {
    it('should return 400 if required fields missing', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/login/verify')
        .send({ challenge: 'abc' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_request');
    });

    it('should return 401 for invalid challenge', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/login/verify')
        .send({
          challenge: 'invalid-challenge',
          code: '123456',
          deviceId: 'device-123',
          deviceName: 'iPhone 15',
          platform: 'ios',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });
  });

  // ===========================================================================
  // LOGIN WITH PASSWORD
  // ===========================================================================
  describe('POST /api/mobile/auth/login/password', () => {
    it('should return 400 if required fields are missing', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/login/password')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_request');
    });

    it('should return 401 for non-existent user', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/login/password')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123',
          deviceId: 'device-123',
          deviceName: 'iPhone 15',
          platform: 'ios',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('invalid_credentials');
    });

    it('should return 401 if user has no password set', async () => {
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

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/login/password')
        .send({
          email: 'test@example.com',
          password: 'password123',
          deviceId: 'device-123',
          deviceName: 'iPhone 15',
          platform: 'ios',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('no_password');
    });
  });

  // ===========================================================================
  // TOKEN REFRESH
  // ===========================================================================
  describe('POST /api/mobile/auth/token/refresh', () => {
    it('should return 400 if refreshToken is missing', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/token/refresh')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_request');
    });

    it('should return 401 for invalid refresh token', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/token/refresh')
        .send({ refreshToken: 'invalid-token' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });

    it('should return 401 if access token used as refresh token', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/token/refresh')
        .send({ refreshToken: accessToken });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });

    it('should return 401 for revoked refresh token', async () => {
      const jti = 'test-jti-123';
      const refreshToken = generateTestRefreshToken('user-123', 'device-123', jti);

      // Token exists but is revoked
      mockPrismaInstance._addMobileRefreshToken({
        id: 'token-1',
        token: jti,
        userId: 'user-123',
        deviceId: 'device-123',
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(), // Revoked
        createdAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/token/refresh')
        .send({ refreshToken });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });

    it('should issue new tokens for valid refresh token', async () => {
      const jti = 'test-jti-123';
      const refreshToken = generateTestRefreshToken('user-123', 'device-123', jti);

      // Add valid refresh token
      mockPrismaInstance._addMobileRefreshToken({
        id: 'token-1',
        token: jti,
        userId: 'user-123',
        deviceId: 'device-123',
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        createdAt: new Date(),
      });

      // Add the device
      mockPrismaInstance._addMobileDevice({
        id: 'db-device-1',
        userId: 'user-123',
        deviceId: 'device-123',
        platform: 'ios',
        deviceName: 'iPhone 15',
        pushToken: null,
        deviceCredential: 'credential',
        credentialExpiry: new Date(Date.now() + 86400000),
        biometricEnabled: false,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/token/refresh')
        .send({ refreshToken });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.expiresIn).toBe(3600);
    });
  });

  // ===========================================================================
  // LOGOUT
  // ===========================================================================
  describe('POST /api/mobile/auth/logout', () => {
    it('should return 401 without authorization header', async () => {
      const app = createApp();
      const response = await request(app).post('/api/mobile/auth/logout');

      expect(response.status).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/logout')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    it('should revoke tokens for device on logout', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      mockPrismaInstance._addMobileRefreshToken({
        id: 'token-1',
        token: 'jti-1',
        userId: 'user-123',
        deviceId: 'device-123',
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        createdAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should revoke all tokens when revokeAll=true', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      mockPrismaInstance._addMobileRefreshToken({
        id: 'token-1',
        token: 'jti-1',
        userId: 'user-123',
        deviceId: 'device-123',
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        createdAt: new Date(),
      });

      mockPrismaInstance._addMobileRefreshToken({
        id: 'token-2',
        token: 'jti-2',
        userId: 'user-123',
        deviceId: 'device-456',
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        createdAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/auth/logout?revokeAll=true')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // ===========================================================================
  // WALLET SUMMARY
  // ===========================================================================
  describe('GET /api/mobile/wallet/summary', () => {
    it('should return 401 without authorization', async () => {
      const app = createApp();
      const response = await request(app).get('/api/mobile/wallet/summary');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent user', async () => {
      const accessToken = generateTestAccessToken('nonexistent-user', 'device-123');

      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/wallet/summary')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(404);
    });

    it('should return wallet summary with cards', async () => {
      const userId = 'user-123';
      const deviceId = 'device-123';
      const accessToken = generateTestAccessToken(userId, deviceId);

      // Add user
      mockPrismaInstance._addWalletUser({
        id: userId,
        email: 'test@example.com',
        passwordHash: null,
        firstName: 'Test',
        lastName: 'User',
        walletId: 'wallet-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Add device
      mockPrismaInstance._addMobileDevice({
        id: 'db-device-1',
        userId,
        deviceId,
        platform: 'ios',
        deviceName: 'iPhone 15',
        pushToken: null,
        deviceCredential: 'credential',
        credentialExpiry: new Date(Date.now() + 86400000),
        biometricEnabled: true,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Add enrollment
      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId,
        bsimId: 'test-bank',
        bsimIssuer: 'https://auth.testbank.ca',
        fiUserRef: 'fi-user-ref',
        walletCredential: 'encrypted-credential',
        credentialExpiry: null,
        refreshToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Add card
      mockPrismaInstance._addWalletCard({
        id: 'card-123',
        userId,
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

      // Override findUnique to return properly structured data
      mockPrismaInstance.walletUser.findUnique = vi.fn().mockResolvedValue({
        id: userId,
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        walletCards: [
          {
            id: 'card-123',
            cardType: 'VISA',
            lastFour: '4242',
            isDefault: true,
            createdAt: new Date(),
            enrollment: { bsimId: 'test-bank' },
          },
        ],
        enrollments: [{ bsimId: 'test-bank', _count: { cards: 1 } }],
        mobileDevices: [{ biometricEnabled: true }],
      });

      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/wallet/summary')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe('test@example.com');
      expect(response.body).toHaveProperty('cards');
      expect(response.body.cards).toHaveLength(1);
      expect(response.body.cards[0].lastFour).toBe('4242');
      expect(response.body).toHaveProperty('enrolledBanks');
      expect(response.body.biometricEnabled).toBe(true);
    });
  });

  // ===========================================================================
  // CARD MANAGEMENT
  // ===========================================================================
  describe('POST /api/mobile/wallet/cards/:cardId/default', () => {
    it('should return 401 without authorization', async () => {
      const app = createApp();
      const response = await request(app).post('/api/mobile/wallet/cards/card-123/default');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent card', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/wallet/cards/nonexistent/default')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(404);
    });

    it('should set card as default', async () => {
      const userId = 'user-123';
      const accessToken = generateTestAccessToken(userId, 'device-123');

      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId,
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
        userId,
        enrollmentId: 'enrollment-123',
        cardType: 'VISA',
        lastFour: '4242',
        cardholderName: 'Test User',
        expiryMonth: 12,
        expiryYear: 2025,
        bsimCardRef: 'bsim-card-1',
        walletCardToken: 'wsim_test-bank_abc',
        isDefault: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/wallet/cards/card-123/default')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.cardId).toBe('card-123');
    });
  });

  describe('DELETE /api/mobile/wallet/cards/:cardId', () => {
    it('should return 401 without authorization', async () => {
      const app = createApp();
      const response = await request(app).delete('/api/mobile/wallet/cards/card-123');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent card', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      const app = createApp();
      const response = await request(app)
        .delete('/api/mobile/wallet/cards/nonexistent')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(404);
    });

    it('should soft delete card', async () => {
      const userId = 'user-123';
      const accessToken = generateTestAccessToken(userId, 'device-123');

      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId,
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
        userId,
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

      const app = createApp();
      const response = await request(app)
        .delete('/api/mobile/wallet/cards/card-123')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify card is now inactive
      const cards = mockPrismaInstance._getWalletCards();
      expect(cards[0].isActive).toBe(false);
    });
  });

  // ===========================================================================
  // BANK ENROLLMENT
  // ===========================================================================
  describe('GET /api/mobile/enrollment/banks', () => {
    it('should return list of available banks', async () => {
      const app = createApp();
      const response = await request(app).get('/api/mobile/enrollment/banks');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('banks');
      expect(response.body.banks).toHaveLength(1);
      expect(response.body.banks[0].bsimId).toBe('test-bank');
      expect(response.body.banks[0].name).toBe('Test Bank');
    });
  });

  describe('POST /api/mobile/enrollment/start/:bsimId', () => {
    it('should return 401 without authorization', async () => {
      const app = createApp();
      const response = await request(app).post('/api/mobile/enrollment/start/test-bank');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent bank', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/enrollment/start/non-existent-bank')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });

    it('should return auth URL for valid bank', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/enrollment/start/test-bank')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('authUrl');
      expect(response.body).toHaveProperty('enrollmentId');
      expect(response.body.bsimId).toBe('test-bank');
      expect(response.body.bankName).toBe('Test Bank');
    });
  });

  describe('GET /api/mobile/enrollment/list', () => {
    it('should return 401 without authorization', async () => {
      const app = createApp();
      const response = await request(app).get('/api/mobile/enrollment/list');

      expect(response.status).toBe(401);
    });

    it('should return empty list for user with no enrollments', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/enrollment/list')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.enrollments).toEqual([]);
    });

    it('should return user enrollments', async () => {
      const userId = 'user-123';
      const accessToken = generateTestAccessToken(userId, 'device-123');

      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId,
        bsimId: 'test-bank',
        bsimIssuer: 'https://auth.testbank.ca',
        fiUserRef: 'fi-user-ref',
        walletCredential: 'encrypted-credential',
        credentialExpiry: new Date(Date.now() + 86400000),
        refreshToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Override findMany to return proper count structure
      mockPrismaInstance.bsimEnrollment.findMany = vi.fn().mockResolvedValue([
        {
          id: 'enrollment-123',
          bsimId: 'test-bank',
          createdAt: new Date(),
          credentialExpiry: new Date(Date.now() + 86400000),
          _count: { cards: 2 },
        },
      ]);

      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/enrollment/list')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.enrollments).toHaveLength(1);
      expect(response.body.enrollments[0].bsimId).toBe('test-bank');
      expect(response.body.enrollments[0].bankName).toBe('Test Bank');
      expect(response.body.enrollments[0].cardCount).toBe(2);
    });
  });

  describe('DELETE /api/mobile/enrollment/:enrollmentId', () => {
    it('should return 401 without authorization', async () => {
      const app = createApp();
      const response = await request(app).delete('/api/mobile/enrollment/enrollment-123');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent enrollment', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      const app = createApp();
      const response = await request(app)
        .delete('/api/mobile/enrollment/nonexistent')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(404);
    });

    it('should return 403 for enrollment belonging to another user', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-456',
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

      const app = createApp();
      const response = await request(app)
        .delete('/api/mobile/enrollment/enrollment-456')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(403);
    });

    it('should delete enrollment', async () => {
      const userId = 'user-123';
      const accessToken = generateTestAccessToken(userId, 'device-123');

      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId,
        bsimId: 'test-bank',
        bsimIssuer: 'https://auth.testbank.ca',
        fiUserRef: 'fi-user-ref',
        walletCredential: 'encrypted-credential',
        credentialExpiry: null,
        refreshToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .delete('/api/mobile/enrollment/enrollment-123')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify enrollment is deleted
      const enrollments = mockPrismaInstance._getBsimEnrollments();
      expect(enrollments).toHaveLength(0);
    });
  });

  // ===========================================================================
  // MOBILE PAYMENT FLOW - MERCHANT ENDPOINTS
  // ===========================================================================
  describe('POST /api/mobile/payment/request', () => {
    beforeEach(() => {
      // Add OAuth client (merchant) with API key
      mockPrismaInstance._addOAuthClient({
        id: 'client-1',
        clientId: 'test-merchant',
        clientSecret: 'secret',
        clientName: 'Test Merchant',
        redirectUris: ['https://merchant.example.com/callback'],
        postLogoutRedirectUris: [],
        grantTypes: ['authorization_code'],
        scope: 'payment:authorize',
        logoUri: null,
        trusted: true,
        apiKey: 'test-api-key-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should return 401 without API key', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/request')
        .send({
          amount: '50.00',
          orderId: 'order-123',
          returnUrl: 'https://merchant.example.com/return',
        });

      expect(response.status).toBe(401);
    });

    it('should return 401 with invalid API key', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/request')
        .set('x-api-key', 'invalid-key')
        .send({
          amount: '50.00',
          orderId: 'order-123',
          returnUrl: 'https://merchant.example.com/return',
        });

      expect(response.status).toBe(401);
    });

    it('should return 400 if required fields missing', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/request')
        .set('x-api-key', 'test-api-key-123')
        .send({ amount: '50.00' });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid amount', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/request')
        .set('x-api-key', 'test-api-key-123')
        .send({
          amount: 'invalid',
          orderId: 'order-123',
          returnUrl: 'https://merchant.example.com/return',
        });

      expect(response.status).toBe(400);
    });

    it('should create payment request and return deep link', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/request')
        .set('x-api-key', 'test-api-key-123')
        .send({
          amount: 50.0,
          currency: 'CAD',
          orderId: 'order-123',
          orderDescription: 'Test Order',
          returnUrl: 'https://merchant.example.com/return',
          merchantName: 'Test Store',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('requestId');
      expect(response.body).toHaveProperty('deepLinkUrl');
      expect(response.body.deepLinkUrl).toContain('mwsim://payment/');
      expect(response.body).toHaveProperty('qrCodeUrl');
      expect(response.body).toHaveProperty('expiresAt');
      expect(response.body.status).toBe('pending');
    });
  });

  describe('GET /api/mobile/payment/:requestId/status', () => {
    beforeEach(() => {
      mockPrismaInstance._addOAuthClient({
        id: 'client-1',
        clientId: 'test-merchant',
        clientSecret: 'secret',
        clientName: 'Test Merchant',
        redirectUris: [],
        postLogoutRedirectUris: [],
        grantTypes: [],
        scope: '',
        logoUri: null,
        trusted: true,
        apiKey: 'test-api-key-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should return 401 without API key', async () => {
      const app = createApp();
      const response = await request(app).get('/api/mobile/payment/request-123/status');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent request', async () => {
      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/payment/nonexistent/status')
        .set('x-api-key', 'test-api-key-123');

      expect(response.status).toBe(404);
    });

    it('should return 403 for request belonging to another merchant', async () => {
      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'other-merchant',
        merchantName: 'Other Merchant',
        merchantLogoUrl: null,
        orderId: 'order-123',
        orderDescription: null,
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://other.example.com/return',
        status: 'pending',
        userId: null,
        selectedCardId: null,
        cardToken: null,
        walletCardToken: null,
        oneTimeToken: null,
        approvedAt: null,
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/payment/payment-123/status')
        .set('x-api-key', 'test-api-key-123');

      expect(response.status).toBe(403);
    });

    it('should return pending status', async () => {
      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: null,
        orderId: 'order-123',
        orderDescription: null,
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'pending',
        userId: null,
        selectedCardId: null,
        cardToken: null,
        walletCardToken: null,
        oneTimeToken: null,
        approvedAt: null,
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/payment/payment-123/status')
        .set('x-api-key', 'test-api-key-123');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('pending');
      expect(response.body.requestId).toBe('payment-123');
    });

    it('should return approved status with one-time token', async () => {
      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: null,
        orderId: 'order-123',
        orderDescription: null,
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'approved',
        userId: 'user-123',
        selectedCardId: 'card-123',
        cardToken: 'card-token-123',
        walletCardToken: 'wallet-card-token-123',
        oneTimeToken: 'one-time-token-abc',
        approvedAt: new Date(),
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/payment/payment-123/status')
        .set('x-api-key', 'test-api-key-123');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('approved');
      expect(response.body.oneTimePaymentToken).toBe('one-time-token-abc');
    });

    it('should detect expired payment', async () => {
      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: null,
        orderId: 'order-123',
        orderDescription: null,
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'pending',
        userId: null,
        selectedCardId: null,
        cardToken: null,
        walletCardToken: null,
        oneTimeToken: null,
        approvedAt: null,
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() - 1000), // Already expired
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/payment/payment-123/status')
        .set('x-api-key', 'test-api-key-123');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('expired');
    });
  });

  describe('POST /api/mobile/payment/:requestId/cancel', () => {
    beforeEach(() => {
      mockPrismaInstance._addOAuthClient({
        id: 'client-1',
        clientId: 'test-merchant',
        clientSecret: 'secret',
        clientName: 'Test Merchant',
        redirectUris: [],
        postLogoutRedirectUris: [],
        grantTypes: [],
        scope: '',
        logoUri: null,
        trusted: true,
        apiKey: 'test-api-key-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should return 401 without auth', async () => {
      const app = createApp();
      const response = await request(app).post('/api/mobile/payment/payment-123/cancel');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent request', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/nonexistent/cancel')
        .set('x-api-key', 'test-api-key-123');

      expect(response.status).toBe(404);
    });

    it('should cancel pending payment (merchant)', async () => {
      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: null,
        orderId: 'order-123',
        orderDescription: null,
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'pending',
        userId: null,
        selectedCardId: null,
        cardToken: null,
        walletCardToken: null,
        oneTimeToken: null,
        approvedAt: null,
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/payment-123/cancel')
        .set('x-api-key', 'test-api-key-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('cancelled');
    });

    it('should cancel pending payment (user)', async () => {
      const userId = 'user-123';
      const accessToken = generateTestAccessToken(userId, 'device-123');

      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: null,
        orderId: 'order-123',
        orderDescription: null,
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'pending',
        userId,
        selectedCardId: null,
        cardToken: null,
        walletCardToken: null,
        oneTimeToken: null,
        approvedAt: null,
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/payment-123/cancel')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 409 for already processed payment', async () => {
      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: null,
        orderId: 'order-123',
        orderDescription: null,
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'approved',
        userId: 'user-123',
        selectedCardId: 'card-123',
        cardToken: 'token',
        walletCardToken: 'wtoken',
        oneTimeToken: 'otp',
        approvedAt: new Date(),
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/payment-123/cancel')
        .set('x-api-key', 'test-api-key-123');

      expect(response.status).toBe(409);
    });
  });

  describe('POST /api/mobile/payment/:requestId/complete', () => {
    beforeEach(() => {
      mockPrismaInstance._addOAuthClient({
        id: 'client-1',
        clientId: 'test-merchant',
        clientSecret: 'secret',
        clientName: 'Test Merchant',
        redirectUris: [],
        postLogoutRedirectUris: [],
        grantTypes: [],
        scope: '',
        logoUri: null,
        trusted: true,
        apiKey: 'test-api-key-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should return 401 without API key', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/payment-123/complete')
        .send({ oneTimePaymentToken: 'token' });

      expect(response.status).toBe(401);
    });

    it('should return 400 without oneTimePaymentToken', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/payment-123/complete')
        .set('x-api-key', 'test-api-key-123')
        .send({});

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid oneTimePaymentToken', async () => {
      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: null,
        orderId: 'order-123',
        orderDescription: null,
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'approved',
        userId: 'user-123',
        selectedCardId: 'card-123',
        cardToken: 'card-token',
        walletCardToken: 'wallet-card-token',
        oneTimeToken: 'correct-token',
        approvedAt: new Date(),
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/payment-123/complete')
        .set('x-api-key', 'test-api-key-123')
        .send({ oneTimePaymentToken: 'wrong-token' });

      expect(response.status).toBe(400);
    });

    it('should complete payment and return card tokens', async () => {
      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: null,
        orderId: 'order-123',
        orderDescription: null,
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'approved',
        userId: 'user-123',
        selectedCardId: 'card-123',
        cardToken: 'ephemeral-card-token',
        walletCardToken: 'wallet-card-token',
        oneTimeToken: 'correct-token',
        approvedAt: new Date(),
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/payment-123/complete')
        .set('x-api-key', 'test-api-key-123')
        .send({ oneTimePaymentToken: 'correct-token' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('completed');
      expect(response.body.cardToken).toBe('ephemeral-card-token');
      expect(response.body.walletCardToken).toBe('wallet-card-token');
    });
  });

  // ===========================================================================
  // MOBILE PAYMENT FLOW - MOBILE APP ENDPOINTS
  // ===========================================================================
  describe('GET /api/mobile/payment/:requestId', () => {
    it('should return 401 without authorization', async () => {
      const app = createApp();
      const response = await request(app).get('/api/mobile/payment/payment-123');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent request', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/payment/nonexistent')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(404);
    });

    it('should return payment details with user cards', async () => {
      const userId = 'user-123';
      const accessToken = generateTestAccessToken(userId, 'device-123');

      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: 'https://merchant.example.com/logo.png',
        orderId: 'order-123',
        orderDescription: 'Order for stuff',
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'pending',
        userId: null,
        selectedCardId: null,
        cardToken: null,
        walletCardToken: null,
        oneTimeToken: null,
        approvedAt: null,
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Add user card
      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId,
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
        userId,
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

      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/payment/payment-123')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.requestId).toBe('payment-123');
      expect(response.body.merchantName).toBe('Test Merchant');
      expect(response.body.amount).toBe(50);
      expect(response.body.currency).toBe('CAD');
      expect(response.body).toHaveProperty('cards');
      expect(response.body.cards).toHaveLength(1);
      expect(response.body.cards[0].lastFour).toBe('4242');
    });

    it('should return 410 for expired payment', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: null,
        orderId: 'order-123',
        orderDescription: null,
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'pending',
        userId: null,
        selectedCardId: null,
        cardToken: null,
        walletCardToken: null,
        oneTimeToken: null,
        approvedAt: null,
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() - 1000), // Expired
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/payment/payment-123')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(410);
    });
  });

  describe('GET /api/mobile/payment/:requestId/public', () => {
    it('should return 404 for non-existent request', async () => {
      const app = createApp();
      const response = await request(app).get('/api/mobile/payment/nonexistent/public');

      expect(response.status).toBe(404);
    });

    it('should return public payment info without auth', async () => {
      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: 'https://merchant.example.com/logo.png',
        orderId: 'order-123',
        orderDescription: 'Test order description',
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'pending',
        userId: null,
        selectedCardId: null,
        cardToken: null,
        walletCardToken: null,
        oneTimeToken: null,
        approvedAt: null,
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app).get('/api/mobile/payment/payment-123/public');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('payment-123');
      expect(response.body.merchantName).toBe('Test Merchant');
      expect(response.body.amount).toBe(50);
      expect(response.body.currency).toBe('CAD');
      expect(response.body.orderDescription).toBe('Test order description');
      expect(response.body.status).toBe('pending');
      // Should NOT include sensitive data
      expect(response.body).not.toHaveProperty('returnUrl');
      expect(response.body).not.toHaveProperty('merchantId');
    });
  });

  describe('POST /api/mobile/payment/:requestId/approve', () => {
    it('should return 401 without authorization', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/payment-123/approve')
        .send({ cardId: 'card-123' });

      expect(response.status).toBe(401);
    });

    it('should return 400 without cardId', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/payment-123/approve')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent payment', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/nonexistent/approve')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ cardId: 'card-123' });

      expect(response.status).toBe(404);
    });

    it('should return 404 for non-existent card', async () => {
      const userId = 'user-123';
      const accessToken = generateTestAccessToken(userId, 'device-123');

      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: null,
        orderId: 'order-123',
        orderDescription: null,
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'pending',
        userId: null,
        selectedCardId: null,
        cardToken: null,
        walletCardToken: null,
        oneTimeToken: null,
        approvedAt: null,
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/payment-123/approve')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ cardId: 'nonexistent-card' });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/mobile/payment/pending', () => {
    it('should return 401 without authorization', async () => {
      const app = createApp();
      const response = await request(app).get('/api/mobile/payment/pending');

      expect(response.status).toBe(401);
    });

    it('should return empty list when no pending payments', async () => {
      const accessToken = generateTestAccessToken('user-123', 'device-123');

      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/payment/pending')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.requests).toEqual([]);
    });

    it('should return pending payments for user', async () => {
      const userId = 'user-123';
      const accessToken = generateTestAccessToken(userId, 'device-123');

      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: null,
        orderId: 'order-123',
        orderDescription: null,
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'pending',
        userId,
        selectedCardId: null,
        cardToken: null,
        walletCardToken: null,
        oneTimeToken: null,
        approvedAt: null,
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/payment/pending')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.requests).toHaveLength(1);
      expect(response.body.requests[0].requestId).toBe('payment-123');
      expect(response.body.requests[0].merchantName).toBe('Test Merchant');
      expect(response.body.requests[0].amount).toBe(50);
    });
  });

  // ===========================================================================
  // TEST ENDPOINT
  // ===========================================================================
  describe('POST /api/mobile/payment/:requestId/test-approve', () => {
    it('should return 401 without test key', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/payment-123/test-approve')
        .send({ cardId: 'card-123', userId: 'user-123' });

      expect(response.status).toBe(401);
    });

    it('should return 400 without required fields', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/payment-123/test-approve')
        .set('x-test-key', 'wsim-e2e-test')
        .send({ cardId: 'card-123' });

      expect(response.status).toBe(400);
    });

    it('should approve payment in test mode', async () => {
      const userId = 'user-123';

      mockPrismaInstance._addMobilePaymentRequest({
        id: 'payment-123',
        merchantId: 'test-merchant',
        merchantName: 'Test Merchant',
        merchantLogoUrl: null,
        orderId: 'order-123',
        orderDescription: null,
        amount: 50,
        currency: 'CAD',
        returnUrl: 'https://merchant.example.com/return',
        status: 'pending',
        userId: null,
        selectedCardId: null,
        cardToken: null,
        walletCardToken: null,
        oneTimeToken: null,
        approvedAt: null,
        completedAt: null,
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrismaInstance._addBsimEnrollment({
        id: 'enrollment-123',
        userId,
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
        userId,
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

      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/payment/payment-123/test-approve')
        .set('x-test-key', 'wsim-e2e-test')
        .send({ cardId: 'card-123', userId });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('approved');
      expect(response.body).toHaveProperty('oneTimeToken');
    });
  });
});
