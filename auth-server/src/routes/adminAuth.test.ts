// Admin Auth Routes Tests
// Tests for /administration/* endpoints (admin authentication flow)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';

// Mock Prisma before importing the router
vi.mock('../adapters/prisma', () => ({
  prisma: {
    adminUser: {
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    adminPasskey: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    adminInvite: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock env config
vi.mock('../config/env', () => ({
  env: {
    WEBAUTHN_RP_ID: 'banksim.ca',
    WEBAUTHN_ORIGINS: ['https://wsim.banksim.ca', 'https://wsim-auth.banksim.ca'],
    JWT_SECRET: 'test-jwt-secret-that-is-long-enough-for-testing',
  },
}));

// Mock adminAuth middleware
vi.mock('../middleware/adminAuth', () => ({
  createAdminToken: vi.fn().mockResolvedValue('mock-admin-jwt-token'),
  setAdminCookie: vi.fn(),
  clearAdminCookie: vi.fn(),
  verifyAdminToken: vi.fn(),
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
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    challenge: 'test-reg-challenge-12345678',
    rp: { name: 'WSIM Auth Server Admin', id: 'banksim.ca' },
    user: { id: 'encoded-user-id', name: 'admin@example.com', displayName: 'Test Admin' },
    timeout: 60000,
  }),
  verifyRegistrationResponse: vi.fn(),
}));

import { prisma } from '../adapters/prisma';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { verifyAdminToken, clearAdminCookie } from '../middleware/adminAuth';
import adminAuthRouter from './adminAuth';

// Create test app
function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Mock EJS render to return JSON for testing
  app.use((req, res, next) => {
    res.render = (view: string, locals?: any) => {
      res.json({ view, ...locals });
    };
    next();
  });

  app.use('/administration', adminAuthRouter);
  return app;
}

describe('Admin Auth Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /administration/setup', () => {
    it('should render setup page when no admins exist', async () => {
      const app = createApp();
      (prisma.adminUser.count as any).mockResolvedValue(0);

      const response = await request(app).get('/administration/setup');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/setup');
      expect(response.body.rpId).toBe('banksim.ca');
    });

    it('should redirect to login when admins already exist', async () => {
      const app = createApp();
      (prisma.adminUser.count as any).mockResolvedValue(1);

      const response = await request(app).get('/administration/setup');

      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/administration/login?error=Setup+already+complete');
    });
  });

  describe('POST /administration/setup', () => {
    it('should return 403 when admins already exist', async () => {
      const app = createApp();
      (prisma.adminUser.count as any).mockResolvedValue(1);

      const response = await request(app)
        .post('/administration/setup')
        .send({ email: 'admin@example.com', firstName: 'Test', lastName: 'Admin' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Setup already complete. Admin user already exists.');
    });

    it('should return 400 when required fields are missing', async () => {
      const app = createApp();
      (prisma.adminUser.count as any).mockResolvedValue(0);

      const response = await request(app)
        .post('/administration/setup')
        .send({ email: 'admin@example.com' }); // Missing firstName and lastName

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Email, first name, and last name are required');
    });

    it('should create first admin user as SUPER_ADMIN', async () => {
      const app = createApp();
      (prisma.adminUser.count as any).mockResolvedValue(0);
      (prisma.adminUser.create as any).mockResolvedValue({
        id: 'admin-1',
        email: 'admin@example.com',
        firstName: 'Test',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
      });

      const response = await request(app)
        .post('/administration/setup')
        .send({ email: 'admin@example.com', firstName: 'Test', lastName: 'Admin' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.admin.role).toBe('SUPER_ADMIN');
      expect(prisma.adminUser.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'admin@example.com',
          role: 'SUPER_ADMIN',
        }),
      });
    });
  });

  describe('POST /administration/register-options', () => {
    it('should return 400 when email is missing', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/administration/register-options')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Email is required');
    });

    it('should return 404 when admin not found', async () => {
      const app = createApp();
      (prisma.adminUser.findUnique as any).mockResolvedValue(null);

      const response = await request(app)
        .post('/administration/register-options')
        .send({ email: 'nonexistent@example.com' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Admin user not found');
    });

    it('should return 400 when admin already has passkey', async () => {
      const app = createApp();
      (prisma.adminUser.findUnique as any).mockResolvedValue({
        id: 'admin-1',
        email: 'admin@example.com',
        passkeys: [{ credentialId: 'existing-cred' }],
      });

      const response = await request(app)
        .post('/administration/register-options')
        .send({ email: 'admin@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Admin already has a passkey registered. Use login instead.');
    });

    it('should generate registration options for admin without passkey', async () => {
      const app = createApp();
      (prisma.adminUser.findUnique as any).mockResolvedValue({
        id: 'admin-1',
        email: 'admin@example.com',
        firstName: 'Test',
        lastName: 'Admin',
        passkeys: [],
      });

      const response = await request(app)
        .post('/administration/register-options')
        .send({ email: 'admin@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.options.challenge).toBe('test-reg-challenge-12345678');
      expect(generateRegistrationOptions).toHaveBeenCalled();
    });
  });

  describe('POST /administration/register-verify', () => {
    it('should return 400 when challenge expired', async () => {
      const app = createApp();

      // Use a unique email that definitely has no challenge stored
      const response = await request(app)
        .post('/administration/register-verify')
        .send({
          credential: { id: 'cred-123' },
          email: 'no-challenge-stored@example.com',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Registration challenge expired');
    });
  });

  describe('GET /administration/login', () => {
    it('should render login page when not logged in', async () => {
      const app = createApp();
      (verifyAdminToken as any).mockResolvedValue(null);

      const response = await request(app).get('/administration/login');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/login');
    });

    it('should redirect to admin panel when already logged in', async () => {
      const app = createApp();
      (verifyAdminToken as any).mockResolvedValue({ userId: 'admin-1' });

      const response = await request(app)
        .get('/administration/login')
        .set('Cookie', 'wsim_admin_token=valid-token');

      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/administration');
    });
  });

  describe('POST /administration/login-options', () => {
    it('should generate authentication options without email', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/administration/login-options')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.options.challenge).toBe('test-challenge-12345678');
      expect(generateAuthenticationOptions).toHaveBeenCalled();
    });

    it('should generate options with allowCredentials when admin has passkeys', async () => {
      const app = createApp();
      (prisma.adminUser.findUnique as any).mockResolvedValue({
        id: 'admin-1',
        email: 'admin@example.com',
        passkeys: [
          { credentialId: 'cred-123', transports: ['internal'] },
        ],
      });

      const response = await request(app)
        .post('/administration/login-options')
        .send({ email: 'admin@example.com' });

      expect(response.status).toBe(200);
      expect(generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          allowCredentials: [{ id: 'cred-123', transports: ['internal'] }],
        })
      );
    });
  });

  describe('POST /administration/login-verify', () => {
    it('should return 401 when passkey not found', async () => {
      const app = createApp();
      (prisma.adminPasskey.findUnique as any).mockResolvedValue(null);

      const response = await request(app)
        .post('/administration/login-verify')
        .send({
          credential: { id: 'nonexistent-cred' },
          email: 'admin@example.com',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Passkey not found');
    });
  });

  describe('POST /administration/logout', () => {
    it('should clear cookie and redirect to login', async () => {
      const app = createApp();

      const response = await request(app).post('/administration/logout');

      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/administration/login');
      expect(clearAdminCookie).toHaveBeenCalled();
    });
  });

  describe('GET /administration/logout', () => {
    it('should clear cookie and redirect to login', async () => {
      const app = createApp();

      const response = await request(app).get('/administration/logout');

      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/administration/login');
      expect(clearAdminCookie).toHaveBeenCalled();
    });
  });

  describe('GET /administration/join/:code', () => {
    it('should render error page for invalid invite code', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue(null);

      const response = await request(app).get('/administration/join/invalid-code');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/join-error');
      expect(response.body.error).toBe('Invalid invite code');
    });

    it('should render error page for revoked invite', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue({
        code: 'revoked-code',
        revokedAt: new Date(),
        usedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });

      const response = await request(app).get('/administration/join/revoked-code');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/join-error');
      expect(response.body.error).toBe('This invite has been revoked');
    });

    it('should render error page for used invite', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue({
        code: 'used-code',
        revokedAt: null,
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      });

      const response = await request(app).get('/administration/join/used-code');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/join-error');
      expect(response.body.error).toBe('This invite has already been used');
    });

    it('should render error page for expired invite', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue({
        code: 'expired-code',
        revokedAt: null,
        usedAt: null,
        expiresAt: new Date(Date.now() - 86400000), // Expired yesterday
      });

      const response = await request(app).get('/administration/join/expired-code');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/join-error');
      expect(response.body.error).toBe('This invite has expired');
    });

    it('should render join page for valid invite', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue({
        code: 'valid-code',
        revokedAt: null,
        usedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        createdBy: { firstName: 'Super', lastName: 'Admin' },
      });

      const response = await request(app).get('/administration/join/valid-code');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/join');
      expect(response.body.code).toBe('valid-code');
      expect(response.body.rpId).toBe('banksim.ca');
    });
  });

  describe('POST /administration/join/:code', () => {
    it('should return 400 for invalid invite', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue(null);

      const response = await request(app)
        .post('/administration/join/invalid-code')
        .send({ email: 'new@example.com', firstName: 'New', lastName: 'Admin' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid invite code');
    });

    it('should return 400 when email does not match invite restriction', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue({
        code: 'valid-code',
        email: 'specific@example.com',
        revokedAt: null,
        usedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });

      const response = await request(app)
        .post('/administration/join/valid-code')
        .send({ email: 'different@example.com', firstName: 'New', lastName: 'Admin' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Email does not match the invite');
    });

    it('should return 400 when admin email already exists', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue({
        code: 'valid-code',
        email: null,
        revokedAt: null,
        usedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        role: 'ADMIN',
      });
      (prisma.adminUser.findUnique as any).mockResolvedValue({
        id: 'existing-admin',
        email: 'existing@example.com',
      });

      const response = await request(app)
        .post('/administration/join/valid-code')
        .send({ email: 'existing@example.com', firstName: 'New', lastName: 'Admin' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('An admin with this email already exists');
    });

    it('should return 400 when first or last name is missing', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue({
        code: 'valid-code',
        email: null,
        revokedAt: null,
        usedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        role: 'ADMIN',
      });
      (prisma.adminUser.findUnique as any).mockResolvedValue(null);

      const response = await request(app)
        .post('/administration/join/valid-code')
        .send({ email: 'new@example.com', firstName: 'New' }); // Missing lastName

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('First name and last name are required');
    });

    it('should create admin user from valid invite', async () => {
      const app = createApp();
      const mockInvite = {
        id: 'invite-1',
        code: 'valid-code',
        email: null,
        revokedAt: null,
        usedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        role: 'ADMIN',
      };
      (prisma.adminInvite.findUnique as any).mockResolvedValue(mockInvite);
      (prisma.adminUser.findUnique as any).mockResolvedValue(null);
      (prisma.adminUser.create as any).mockResolvedValue({
        id: 'new-admin-1',
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'Admin',
        role: 'ADMIN',
      });
      (prisma.adminInvite.update as any).mockResolvedValue({});

      const response = await request(app)
        .post('/administration/join/valid-code')
        .send({ email: 'new@example.com', firstName: 'New', lastName: 'Admin' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.admin.email).toBe('new@example.com');
      expect(prisma.adminInvite.update).toHaveBeenCalledWith({
        where: { id: 'invite-1' },
        data: expect.objectContaining({
          usedById: 'new-admin-1',
        }),
      });
    });
  });

  describe('POST /administration/join/:code/register-options', () => {
    it('should return 400 for invalid invite code', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue(null);

      const response = await request(app)
        .post('/administration/join/invalid-code/register-options')
        .send({ email: 'new@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid invite code');
    });

    it('should return 400 for revoked invite', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue({
        code: 'revoked-code',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      });

      const response = await request(app)
        .post('/administration/join/revoked-code/register-options')
        .send({ email: 'new@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('This invite has been revoked');
    });

    it('should return 404 when admin not found', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue({
        code: 'valid-code',
        revokedAt: null,
        usedAt: new Date(), // Used but that's OK for passkey registration
        expiresAt: new Date(Date.now() + 86400000),
      });
      (prisma.adminUser.findUnique as any).mockResolvedValue(null);

      const response = await request(app)
        .post('/administration/join/valid-code/register-options')
        .send({ email: 'nonexistent@example.com' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Admin user not found. Please complete registration first.');
    });

    it('should return 400 when admin already has passkey', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue({
        code: 'valid-code',
        revokedAt: null,
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      });
      (prisma.adminUser.findUnique as any).mockResolvedValue({
        id: 'admin-1',
        email: 'new@example.com',
        passkeys: [{ credentialId: 'existing-cred' }],
      });

      const response = await request(app)
        .post('/administration/join/valid-code/register-options')
        .send({ email: 'new@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Admin already has a passkey registered');
    });

    it('should generate registration options for invited admin', async () => {
      const app = createApp();
      (prisma.adminInvite.findUnique as any).mockResolvedValue({
        code: 'valid-code',
        revokedAt: null,
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      });
      (prisma.adminUser.findUnique as any).mockResolvedValue({
        id: 'admin-1',
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'Admin',
        passkeys: [],
      });

      const response = await request(app)
        .post('/administration/join/valid-code/register-options')
        .send({ email: 'new@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.options.challenge).toBe('test-reg-challenge-12345678');
      expect(generateRegistrationOptions).toHaveBeenCalled();
    });
  });

  describe('POST /administration/join/:code/register-verify', () => {
    it('should return 400 when challenge expired', async () => {
      const app = createApp();

      // Use a unique code and email that definitely have no challenge stored
      const response = await request(app)
        .post('/administration/join/no-challenge-code/register-verify')
        .send({
          credential: { id: 'cred-123' },
          email: 'no-challenge@example.com',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Registration challenge expired');
    });
  });
});
