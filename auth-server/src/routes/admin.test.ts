// Admin Routes Tests
// Tests for /administration/* endpoints (OAuth client management)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock Prisma before importing the router
vi.mock('../adapters/prisma', () => ({
  prisma: {
    oAuthClient: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    walletPaymentConsent: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    walletUser: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '../adapters/prisma';
import adminRouter from './admin';

// Create test app with mock admin middleware
function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mock admin user attached to request (normally done by requireAdminAuth middleware)
  app.use((req: any, res, next) => {
    req.admin = {
      id: 'admin-123',
      email: 'admin@example.com',
      role: 'SUPER_ADMIN',
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

  app.use('/administration', adminRouter);
  return app;
}

describe('Admin Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('GET /administration', () => {
    it('should list all OAuth clients', async () => {
      const mockClients = [
        {
          id: 'client-1',
          clientId: 'test-client',
          clientName: 'Test Client',
          redirectUris: ['https://example.com/callback'],
          scope: 'openid profile',
          trusted: false,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];

      (prisma.oAuthClient.findMany as any).mockResolvedValue(mockClients);

      const response = await request(app).get('/administration');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/clients');
      expect(response.body.clients).toHaveLength(1);
      expect(response.body.clients[0].clientId).toBe('test-client');
    });

    it('should return empty array when no clients exist', async () => {
      (prisma.oAuthClient.findMany as any).mockResolvedValue([]);

      const response = await request(app).get('/administration');

      expect(response.status).toBe(200);
      expect(response.body.clients).toEqual([]);
    });

    it('should pass message and error query params', async () => {
      (prisma.oAuthClient.findMany as any).mockResolvedValue([]);

      const response = await request(app)
        .get('/administration?message=Success&error=Warning');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Success');
      expect(response.body.error).toBe('Warning');
    });
  });

  describe('GET /administration/clients/new', () => {
    it('should render new client form', async () => {
      const response = await request(app).get('/administration/clients/new');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/client-form');
      expect(response.body.client).toBeNull();
      expect(response.body.isNew).toBe(true);
    });
  });

  describe('POST /administration/clients', () => {
    it('should create a new client', async () => {
      const newClient = {
        clientId: 'new-client',
        clientName: 'New Client',
        redirectUris: 'https://example.com/callback',
        postLogoutRedirectUris: '',
        scope: 'openid profile',
        logoUri: '',
        trusted: '',
      };

      (prisma.oAuthClient.create as any).mockResolvedValue({
        id: 'client-new',
        ...newClient,
      });

      const response = await request(app)
        .post('/administration/clients')
        .send(newClient);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/administration?message=');
      expect(prisma.oAuthClient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientId: 'new-client',
            clientName: 'New Client',
            grantTypes: ['authorization_code', 'refresh_token'],
          }),
        })
      );
    });

    it('should handle duplicate client ID error', async () => {
      const error: any = new Error('Unique constraint failed');
      error.code = 'P2002';
      (prisma.oAuthClient.create as any).mockRejectedValue(error);

      const response = await request(app)
        .post('/administration/clients')
        .send({
          clientId: 'existing-client',
          clientName: 'Duplicate',
          redirectUris: 'https://example.com/callback',
          scope: 'openid',
        });

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/client-form');
      expect(response.body.error).toBe('A client with this ID already exists');
    });

    it('should parse multiple redirect URIs', async () => {
      (prisma.oAuthClient.create as any).mockResolvedValue({ id: 'test' });

      await request(app)
        .post('/administration/clients')
        .send({
          clientId: 'multi-uri-client',
          clientName: 'Multi URI',
          redirectUris: 'https://a.com/callback\nhttps://b.com/callback',
          scope: 'openid',
        });

      expect(prisma.oAuthClient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            redirectUris: ['https://a.com/callback', 'https://b.com/callback'],
          }),
        })
      );
    });
  });

  describe('GET /administration/clients/:id', () => {
    it('should show client edit form', async () => {
      const mockClient = {
        id: 'client-123',
        clientId: 'test-client',
        clientName: 'Test Client',
        redirectUris: ['https://example.com/callback'],
        scope: 'openid profile',
      };

      (prisma.oAuthClient.findUnique as any).mockResolvedValue(mockClient);

      const response = await request(app).get('/administration/clients/client-123');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/client-form');
      expect(response.body.client.clientId).toBe('test-client');
      expect(response.body.isNew).toBe(false);
    });

    it('should redirect if client not found', async () => {
      (prisma.oAuthClient.findUnique as any).mockResolvedValue(null);

      const response = await request(app).get('/administration/clients/non-existent');

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/administration?error=');
      expect(decodeURIComponent(response.headers.location)).toContain('Client not found');
    });
  });

  describe('POST /administration/clients/:id', () => {
    it('should update client', async () => {
      (prisma.oAuthClient.update as any).mockResolvedValue({ id: 'client-123' });

      const response = await request(app)
        .post('/administration/clients/client-123')
        .send({
          clientName: 'Updated Name',
          redirectUris: 'https://new.com/callback',
          scope: 'openid profile email',
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/administration?message=');
      expect(prisma.oAuthClient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'client-123' },
          data: expect.objectContaining({
            clientName: 'Updated Name',
          }),
        })
      );
    });

    it('should regenerate secret when requested', async () => {
      (prisma.oAuthClient.update as any).mockResolvedValue({ id: 'client-123' });

      const response = await request(app)
        .post('/administration/clients/client-123')
        .send({
          clientName: 'Updated Name',
          redirectUris: 'https://new.com/callback',
          scope: 'openid',
          regenerateSecret: 'on',
        });

      expect(response.status).toBe(302);
      expect(decodeURIComponent(response.headers.location)).toContain('New secret:');
      expect(prisma.oAuthClient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientSecret: expect.any(String),
          }),
        })
      );
    });
  });

  describe('POST /administration/clients/:id/delete', () => {
    it('should delete client', async () => {
      (prisma.oAuthClient.findUnique as any).mockResolvedValue({
        clientName: 'Test Client',
      });
      (prisma.oAuthClient.delete as any).mockResolvedValue({ id: 'client-123' });

      const response = await request(app)
        .post('/administration/clients/client-123/delete');

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('deleted');
      expect(prisma.oAuthClient.delete).toHaveBeenCalledWith({
        where: { id: 'client-123' },
      });
    });

    it('should redirect with error if client not found', async () => {
      (prisma.oAuthClient.findUnique as any).mockResolvedValue(null);

      const response = await request(app)
        .post('/administration/clients/non-existent/delete');

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/administration?error=');
      expect(decodeURIComponent(response.headers.location)).toContain('Client not found');
    });
  });

  describe('GET /administration/sessions', () => {
    it('should list active payment consents', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          merchantId: 'test-merchant',
          merchantName: 'Test Merchant',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 3600000),
          user: {
            id: 'user-1',
            email: 'user@example.com',
            firstName: 'Test',
            lastName: 'User',
          },
        },
      ];

      (prisma.walletPaymentConsent.findMany as any).mockResolvedValue(mockConsents);
      (prisma.oAuthClient.findMany as any).mockResolvedValue([
        { clientId: 'test-merchant', clientName: 'Test Merchant', logoUri: null },
      ]);

      const response = await request(app).get('/administration/sessions');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/sessions');
      expect(response.body.consents).toHaveLength(1);
    });

    it('should return empty array when no active sessions', async () => {
      (prisma.walletPaymentConsent.findMany as any).mockResolvedValue([]);
      (prisma.oAuthClient.findMany as any).mockResolvedValue([]);

      const response = await request(app).get('/administration/sessions');

      expect(response.status).toBe(200);
      expect(response.body.consents).toEqual([]);
    });
  });

  describe('POST /administration/sessions/:id/revoke', () => {
    it('should revoke a payment consent', async () => {
      (prisma.walletPaymentConsent.findUnique as any).mockResolvedValue({
        id: 'consent-1',
        merchantName: 'Test Merchant',
        user: { email: 'user@example.com' },
      });
      (prisma.walletPaymentConsent.update as any).mockResolvedValue({ id: 'consent-1' });

      const response = await request(app)
        .post('/administration/sessions/consent-1/revoke');

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('revoked');
      expect(prisma.walletPaymentConsent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'consent-1' },
          data: { revokedAt: expect.any(Date) },
        })
      );
    });

    it('should redirect with error if consent not found', async () => {
      (prisma.walletPaymentConsent.findUnique as any).mockResolvedValue(null);

      const response = await request(app)
        .post('/administration/sessions/non-existent/revoke');

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/administration/sessions?error=');
      expect(decodeURIComponent(response.headers.location)).toContain('Session not found');
    });
  });

  describe('POST /administration/sessions/revoke-all', () => {
    it('should revoke all sessions for a user', async () => {
      (prisma.walletPaymentConsent.findMany as any).mockResolvedValue([
        { id: 'consent-1', user: { email: 'user@example.com' } },
        { id: 'consent-2', user: { email: 'user@example.com' } },
      ]);
      (prisma.walletPaymentConsent.updateMany as any).mockResolvedValue({ count: 2 });

      const response = await request(app)
        .post('/administration/sessions/revoke-all')
        .send({ userId: 'user-123' });

      expect(response.status).toBe(302);
      expect(decodeURIComponent(response.headers.location)).toContain('2 session(s)');
      expect(prisma.walletPaymentConsent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-123', revokedAt: null },
        })
      );
    });

    it('should redirect with error if userId not provided', async () => {
      const response = await request(app)
        .post('/administration/sessions/revoke-all')
        .send({});

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/administration/sessions?error=');
      expect(decodeURIComponent(response.headers.location)).toContain('User ID required');
    });

    it('should redirect with error if no active sessions found', async () => {
      (prisma.walletPaymentConsent.findMany as any).mockResolvedValue([]);

      const response = await request(app)
        .post('/administration/sessions/revoke-all')
        .send({ userId: 'user-123' });

      expect(response.status).toBe(302);
      expect(decodeURIComponent(response.headers.location)).toContain('No active sessions found');
    });
  });

  describe('GET /administration/users', () => {
    it('should list wallet users', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          email: 'user@example.com',
          firstName: 'Test',
          lastName: 'User',
          createdAt: new Date(),
          _count: {
            walletCards: 3,
            enrollments: 2,
            paymentConsents: 5,
          },
        },
      ];

      (prisma.walletUser.findMany as any).mockResolvedValue(mockUsers);

      const response = await request(app).get('/administration/users');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('admin/users');
      expect(response.body.users).toHaveLength(1);
      expect(response.body.users[0]._count.walletCards).toBe(3);
    });
  });
});
