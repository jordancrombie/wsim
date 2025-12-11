import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import partnerRoutes from './partner';
import { prisma } from '../config/database';

// Mock prisma
vi.mock('../config/database', () => ({
  prisma: {
    bsimEnrollment: {
      findFirst: vi.fn(),
    },
    walletUser: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock env
vi.mock('../config/env', () => ({
  env: {
    JWT_SECRET: 'test-jwt-secret',
    INTERNAL_API_SECRET: 'test-internal-secret',
    FRONTEND_URL: 'https://wsim-dev.banksim.ca',
  },
}));

const app = express();
app.use(express.json());
app.use('/api/partner', partnerRoutes);

// Helper to generate valid signature
function generateSignature(payload: Record<string, unknown>, secret: string): string {
  const signedData = JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(signedData).digest('hex');
}

describe('Partner Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/partner/sso-token', () => {
    it('should return 400 if required fields are missing', async () => {
      const response = await request(app)
        .post('/api/partner/sso-token')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing_fields');
    });

    it('should return 400 if no user identifier provided', async () => {
      const timestamp = Date.now();
      const payload = { bsimId: 'bsim', timestamp };
      const signature = generateSignature(payload, 'test-internal-secret');

      const response = await request(app)
        .post('/api/partner/sso-token')
        .send({ ...payload, signature });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing_user_identifier');
    });

    it('should return 400 if timestamp is too old', async () => {
      const timestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      const payload = { bsimId: 'bsim', bsimUserId: 'user-123', timestamp };
      const signature = generateSignature(payload, 'test-internal-secret');

      const response = await request(app)
        .post('/api/partner/sso-token')
        .send({ ...payload, signature });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('request_expired');
    });

    it('should return 403 for invalid signature', async () => {
      const timestamp = Date.now();
      const payload = { bsimId: 'bsim', bsimUserId: 'user-123', timestamp };
      const signature = 'invalid-signature';

      const response = await request(app)
        .post('/api/partner/sso-token')
        .send({ ...payload, signature });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('invalid_signature');
    });

    it('should return 404 if user not found by bsimUserId', async () => {
      (prisma.bsimEnrollment.findFirst as any).mockResolvedValue(null);
      (prisma.walletUser.findUnique as any).mockResolvedValue(null);

      const timestamp = Date.now();
      const payload = { bsimId: 'bsim', bsimUserId: 'nonexistent-user', timestamp };
      const signature = generateSignature(payload, 'test-internal-secret');

      const response = await request(app)
        .post('/api/partner/sso-token')
        .send({ ...payload, signature });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('user_not_found');
    });

    it('should return 404 if user not found by email', async () => {
      (prisma.walletUser.findUnique as any).mockResolvedValue(null);

      const timestamp = Date.now();
      const payload = { bsimId: 'bsim', email: 'nonexistent@example.com', timestamp };
      const signature = generateSignature(payload, 'test-internal-secret');

      const response = await request(app)
        .post('/api/partner/sso-token')
        .send({ ...payload, signature });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('user_not_found');
    });

    it('should generate SSO token for user found by bsimUserId', async () => {
      (prisma.bsimEnrollment.findFirst as any).mockResolvedValue({
        id: 'enrollment-123',
        fiUserRef: 'bsim-user-456',
        bsimId: 'bsim',
        user: {
          id: 'wsim-user-789',
          email: 'test@example.com',
          walletId: 'wallet-abc',
        },
      });

      const timestamp = Date.now();
      const payload = { bsimId: 'bsim', bsimUserId: 'bsim-user-456', timestamp };
      const signature = generateSignature(payload, 'test-internal-secret');

      const response = await request(app)
        .post('/api/partner/sso-token')
        .send({ ...payload, signature });

      expect(response.status).toBe(200);
      expect(response.body.ssoToken).toBeDefined();
      expect(typeof response.body.ssoToken).toBe('string');
      expect(response.body.ssoUrl).toContain('https://wsim-dev.banksim.ca/api/auth/sso?token=');
      expect(response.body.expiresIn).toBe(300); // 5 minutes
      expect(response.body.walletId).toBe('wallet-abc');
    });

    it('should generate SSO token for user found by email', async () => {
      (prisma.bsimEnrollment.findFirst as any).mockResolvedValue(null);
      (prisma.walletUser.findUnique as any).mockResolvedValue({
        id: 'wsim-user-789',
        email: 'test@example.com',
        walletId: 'wallet-abc',
      });

      const timestamp = Date.now();
      const payload = { bsimId: 'bsim', email: 'test@example.com', timestamp };
      const signature = generateSignature(payload, 'test-internal-secret');

      const response = await request(app)
        .post('/api/partner/sso-token')
        .send({ ...payload, signature });

      expect(response.status).toBe(200);
      expect(response.body.ssoToken).toBeDefined();
      expect(response.body.ssoUrl).toContain('https://wsim-dev.banksim.ca/api/auth/sso?token=');
      expect(response.body.expiresIn).toBe(300);
      expect(response.body.walletId).toBe('wallet-abc');
    });

    it('should prefer bsimUserId lookup over email', async () => {
      (prisma.bsimEnrollment.findFirst as any).mockResolvedValue({
        id: 'enrollment-123',
        fiUserRef: 'bsim-user-456',
        bsimId: 'bsim',
        user: {
          id: 'wsim-user-from-enrollment',
          email: 'enrollment@example.com',
          walletId: 'wallet-enrollment',
        },
      });

      const timestamp = Date.now();
      const payload = { bsimId: 'bsim', bsimUserId: 'bsim-user-456', email: 'different@example.com', timestamp };
      const signature = generateSignature(payload, 'test-internal-secret');

      const response = await request(app)
        .post('/api/partner/sso-token')
        .send({ ...payload, signature });

      expect(response.status).toBe(200);
      expect(response.body.walletId).toBe('wallet-enrollment');
      // Should NOT have called walletUser.findUnique since enrollment was found
      expect(prisma.walletUser.findUnique).not.toHaveBeenCalled();
    });
  });
});
