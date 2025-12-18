// Interaction Routes Tests
// Tests for /interaction/* endpoints (OIDC interaction flow)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock Prisma before importing the router
vi.mock('../adapters/prisma', () => ({
  prisma: {
    walletUser: {
      findUnique: vi.fn(),
    },
    walletCard: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

// Mock env config
vi.mock('../config/env', () => ({
  env: {
    BACKEND_URL: 'http://localhost:3003',
    INTERNAL_API_SECRET: 'test-internal-secret',
  },
}));

// Mock fetch for backend API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { prisma } from '../adapters/prisma';
import { createInteractionRoutes } from './interaction';

// Mock Grant class
class MockGrant {
  static lastInstance: MockGrant | null = null;
  addOIDCScope = vi.fn();
  addResourceScope = vi.fn();
  save = vi.fn().mockResolvedValue('mock-grant-id');

  constructor(public config: { accountId: string; clientId: string }) {
    MockGrant.lastInstance = this;
  }
}

// Create mock OIDC provider
function createMockProvider(overrides: any = {}) {
  // Reset the static instance
  MockGrant.lastInstance = null;

  return {
    interactionDetails: vi.fn().mockResolvedValue({
      uid: 'test-uid',
      prompt: { name: 'login' },
      params: { scope: 'openid', client_id: 'test-client' },
      session: null,
      ...overrides,
    }),
    // interactionFinished redirects, so we need to actually end the response
    interactionFinished: vi.fn().mockImplementation((req: any, res: any, result: any) => {
      res.redirect('/callback');
      return Promise.resolve();
    }),
    Grant: MockGrant,
  };
}

// Create test app
function createApp(provider: any) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mock EJS render to return JSON for testing
  app.use((req, res, next) => {
    res.render = (view: string, locals?: any) => {
      res.json({ view, ...locals });
    };
    next();
  });

  app.use('/interaction', createInteractionRoutes(provider));
  return app;
}

describe('Interaction Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('GET /interaction/:uid', () => {
    it('should render login page for login prompt', async () => {
      const provider = createMockProvider({
        prompt: { name: 'login' },
        params: { scope: 'openid' },
      });
      const app = createApp(provider);

      const response = await request(app).get('/interaction/test-uid');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('login');
      expect(response.body.uid).toBe('test-uid');
      expect(response.body.title).toBe('Sign in to WSIM');
    });

    it('should indicate payment flow when scope includes payment:authorize', async () => {
      const provider = createMockProvider({
        prompt: { name: 'login' },
        params: { scope: 'openid payment:authorize' },
      });
      const app = createApp(provider);

      const response = await request(app).get('/interaction/test-uid');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('login');
      expect(response.body.isPaymentFlow).toBe(true);
    });

    it('should render consent page for consent prompt', async () => {
      const provider = createMockProvider({
        prompt: { name: 'consent' },
        params: { scope: 'openid profile', client_id: 'test-client' },
        session: { accountId: 'user-123' },
      });
      const app = createApp(provider);

      const response = await request(app).get('/interaction/test-uid');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('consent');
      expect(response.body.title).toBe('Authorize Access');
      expect(response.body.scopes).toEqual(['openid', 'profile']);
    });

    it('should render card-select for payment consent', async () => {
      const provider = createMockProvider({
        prompt: { name: 'consent' },
        params: {
          scope: 'openid payment:authorize',
          client_id: 'merchant-client',
          claims: JSON.stringify({ payment: { amount: 100, currency: 'CAD' } }),
        },
        session: { accountId: 'user-123' },
      });
      const app = createApp(provider);

      const mockCards = [
        {
          id: 'card-1',
          cardNumber: '****1234',
          cardType: 'VISA',
          isActive: true,
          enrollment: { bsimId: 'bsim' },
        },
      ];
      (prisma.walletCard.findMany as any).mockResolvedValue(mockCards);

      const response = await request(app).get('/interaction/test-uid');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('card-select');
      expect(response.body.title).toBe('Select Payment Card');
      expect(response.body.cards).toHaveLength(1);
      expect(response.body.payment).toEqual({ amount: 100, currency: 'CAD' });
    });

    it('should render error for unknown prompt', async () => {
      const provider = createMockProvider({
        prompt: { name: 'unknown_prompt' },
        params: {},
      });
      const app = createApp(provider);

      const response = await request(app).get('/interaction/test-uid');

      expect(response.status).toBe(400);
      expect(response.body.view).toBe('error');
      expect(response.body.message).toBe('Unknown interaction type: unknown_prompt');
    });

    it('should render error on provider exception', async () => {
      const provider = createMockProvider();
      provider.interactionDetails.mockRejectedValue(new Error('Provider error'));
      const app = createApp(provider);

      const response = await request(app).get('/interaction/test-uid');

      expect(response.status).toBe(500);
      expect(response.body.view).toBe('error');
      expect(response.body.message).toBe('Failed to load interaction');
    });
  });

  describe('POST /interaction/:uid/login', () => {
    it('should render error when user not found', async () => {
      const provider = createMockProvider();
      const app = createApp(provider);
      (prisma.walletUser.findUnique as any).mockResolvedValue(null);

      const response = await request(app)
        .post('/interaction/test-uid/login')
        .send({ email: 'nonexistent@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('login');
      expect(response.body.error).toBe('User not found. Please enroll a bank first.');
    });

    it('should complete login interaction for valid user', async () => {
      const provider = createMockProvider();
      const app = createApp(provider);
      (prisma.walletUser.findUnique as any).mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
      });

      await request(app)
        .post('/interaction/test-uid/login')
        .send({ email: 'user@example.com' });

      expect(provider.interactionFinished).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        {
          login: {
            accountId: 'user-123',
            remember: true,
          },
        },
        { mergeWithLastSubmission: false }
      );
    });

    it('should render error on login exception', async () => {
      const provider = createMockProvider();
      // Override to throw instead of redirecting
      provider.interactionFinished.mockImplementation(() => {
        throw new Error('Finish failed');
      });
      const app = createApp(provider);
      (prisma.walletUser.findUnique as any).mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
      });

      const response = await request(app)
        .post('/interaction/test-uid/login')
        .send({ email: 'user@example.com' });

      expect(response.status).toBe(500);
      expect(response.body.view).toBe('error');
      expect(response.body.message).toBe('Login failed');
    });
  });

  describe('POST /interaction/:uid/consent', () => {
    it('should complete consent interaction', async () => {
      const provider = createMockProvider({
        prompt: { name: 'consent' },
        params: { scope: 'openid profile' },
      });
      const app = createApp(provider);

      await request(app).post('/interaction/test-uid/consent');

      expect(provider.interactionFinished).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { consent: {} },
        { mergeWithLastSubmission: true }
      );
    });

    it('should render error on consent exception', async () => {
      const provider = createMockProvider();
      provider.interactionDetails.mockRejectedValue(new Error('Details failed'));
      const app = createApp(provider);

      const response = await request(app).post('/interaction/test-uid/consent');

      expect(response.status).toBe(500);
      expect(response.body.view).toBe('error');
      expect(response.body.message).toBe('Consent failed');
    });
  });

  describe('POST /interaction/:uid/select-card', () => {
    it('should render error when not authenticated', async () => {
      const provider = createMockProvider({
        prompt: { name: 'consent' },
        params: { scope: 'openid payment:authorize', client_id: 'merchant' },
        session: null, // No session
      });
      const app = createApp(provider);

      const response = await request(app)
        .post('/interaction/test-uid/select-card')
        .send({ walletCardId: 'card-123' });

      expect(response.status).toBe(401);
      expect(response.body.view).toBe('error');
      expect(response.body.message).toBe('Not authenticated');
    });

    it('should render error when card not found', async () => {
      const provider = createMockProvider({
        prompt: { name: 'consent' },
        params: { scope: 'openid payment:authorize', client_id: 'merchant' },
        session: { accountId: 'user-123' },
      });
      const app = createApp(provider);
      (prisma.walletCard.findFirst as any).mockResolvedValue(null);

      const response = await request(app)
        .post('/interaction/test-uid/select-card')
        .send({ walletCardId: 'nonexistent-card' });

      expect(response.status).toBe(400);
      expect(response.body.view).toBe('error');
      expect(response.body.message).toBe('Card not found');
    });

    it('should complete card selection and create grant', async () => {
      const provider = createMockProvider({
        prompt: { name: 'consent' },
        params: {
          scope: 'openid payment:authorize',
          client_id: 'merchant',
          claims: JSON.stringify({ payment: { amount: 50, merchantId: 'merchant-1' } }),
        },
        session: { accountId: 'user-123' },
      });
      const app = createApp(provider);

      const mockCard = {
        id: 'card-123',
        walletCardToken: 'wallet-token-123',
        enrollment: { bsimId: 'bsim-123' },
      };
      (prisma.walletCard.findFirst as any).mockResolvedValue(mockCard);

      // Mock backend API calls
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ cardToken: 'bsim-card-token', walletCardToken: 'wallet-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

      await request(app)
        .post('/interaction/test-uid/select-card')
        .send({ walletCardId: 'card-123' });

      // Verify grant was created - check via static instance
      expect(MockGrant.lastInstance).not.toBeNull();
      expect(MockGrant.lastInstance!.config).toEqual({
        accountId: 'user-123',
        clientId: 'merchant',
      });
      expect(MockGrant.lastInstance!.addOIDCScope).toHaveBeenCalled();
      expect(MockGrant.lastInstance!.save).toHaveBeenCalled();

      // Verify interaction was finished
      expect(provider.interactionFinished).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { consent: { grantId: 'mock-grant-id' } },
        { mergeWithLastSubmission: true }
      );
    });

    it('should render error on card selection exception', async () => {
      const provider = createMockProvider();
      provider.interactionDetails.mockRejectedValue(new Error('Details failed'));
      const app = createApp(provider);

      const response = await request(app)
        .post('/interaction/test-uid/select-card')
        .send({ walletCardId: 'card-123' });

      expect(response.status).toBe(500);
      expect(response.body.view).toBe('error');
      expect(response.body.message).toBe('Card selection failed');
    });
  });

  describe('POST /interaction/:uid/abort', () => {
    it('should finish interaction with access_denied error', async () => {
      const provider = createMockProvider();
      const app = createApp(provider);

      await request(app).post('/interaction/test-uid/abort');

      expect(provider.interactionFinished).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        {
          error: 'access_denied',
          error_description: 'User cancelled the authorization',
        },
        { mergeWithLastSubmission: false }
      );
    });

    it('should redirect to home on abort exception', async () => {
      const provider = createMockProvider();
      // Override to throw instead of redirecting
      provider.interactionFinished.mockImplementation(() => {
        throw new Error('Finish failed');
      });
      const app = createApp(provider);

      const response = await request(app).post('/interaction/test-uid/abort');

      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/');
    });
  });
});

describe('requestCardToken helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('should return null on fetch error', async () => {
    // This tests the helper function indirectly through select-card
    const provider = createMockProvider({
      prompt: { name: 'consent' },
      params: { scope: 'openid payment:authorize', client_id: 'merchant' },
      session: { accountId: 'user-123' },
    });
    const app = createApp(provider);

    const mockCard = {
      id: 'card-123',
      walletCardToken: 'wallet-token-123',
      enrollment: { bsimId: 'bsim-123' },
    };
    (prisma.walletCard.findFirst as any).mockResolvedValue(mockCard);

    // Mock failed token request but successful context storage
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Token error'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

    // Should still complete (with null cardToken)
    await request(app)
      .post('/interaction/test-uid/select-card')
      .send({ walletCardId: 'card-123' });

    expect(provider.interactionFinished).toHaveBeenCalled();
  });
});
