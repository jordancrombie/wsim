import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { createMockPrismaClient, MockPrismaClient } from '../test/mocks/mockPrisma';

// Mock the database module
vi.mock('../config/database', () => ({
  prisma: {},
}));

// Mock notification service
vi.mock('../services/notification', () => ({
  sendNotificationToUser: vi.fn(),
}));

import * as database from '../config/database';
import { sendNotificationToUser } from '../services/notification';
import webhookRoutes from './webhooks';

const mockSendNotificationToUser = sendNotificationToUser as Mock;

let mockPrismaInstance: MockPrismaClient;

const WEBHOOK_SECRET = 'test-webhook-secret';

// Helper to generate HMAC signature
function generateSignature(payload: object): string {
  const rawBody = JSON.stringify(payload);
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

describe('Webhook Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    mockPrismaInstance = createMockPrismaClient();
    (database as any).prisma = mockPrismaInstance;

    vi.clearAllMocks();

    // Set test environment
    process.env.TRANSFERSIM_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NODE_ENV = 'test';

    app = express();
    app.use(express.json());
    app.use('/api/webhooks', webhookRoutes);
  });

  describe('GET /api/webhooks/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/webhooks/health');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        service: 'webhooks',
      });
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('POST /api/webhooks/transfersim', () => {
    const validPayload = {
      eventType: 'transfer.completed',
      timestamp: '2026-01-04T12:00:00Z',
      idempotencyKey: 'p2p_abc123',
      data: {
        transferId: 'p2p_abc123',
        recipientUserId: 'bsim_user_xyz789',
        recipientBsimId: 'bsim_alpha',
        recipientAlias: '@mobile',
        recipientAliasType: 'USERNAME',
        senderDisplayName: 'John D.',
        senderAlias: '@john',
        senderBankName: 'Alpha Bank',
        recipientBankName: 'Beta Bank',
        amount: '100.00',
        currency: 'CAD',
        description: 'Lunch money',
        isCrossBank: true,
      },
    };

    it('should process transfer.completed webhook and send notification', async () => {
      // Mock enrollment lookup
      mockPrismaInstance.bsimEnrollment.findFirst.mockResolvedValue({
        userId: 'wsim-user-123',
        user: {
          firstName: 'Jane',
          email: 'jane@example.com',
        },
      });

      // Mock notification send
      mockSendNotificationToUser.mockResolvedValue({
        success: true,
        totalDevices: 2,
        successCount: 2,
        failureCount: 0,
        tickets: [],
        errors: [],
      });

      const res = await request(app)
        .post('/api/webhooks/transfersim')
        .set('X-Webhook-Signature', generateSignature(validPayload))
        .send(validPayload);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        received: true,
        processed: true,
        notification: {
          success: true,
          devicesNotified: 2,
          devicesFailed: 0,
        },
      });

      // Verify enrollment lookup
      expect(mockPrismaInstance.bsimEnrollment.findFirst).toHaveBeenCalledWith({
        where: {
          fiUserRef: 'bsim_user_xyz789',
          bsimId: 'bsim_alpha',
        },
        select: expect.any(Object),
      });

      // Verify notification was sent
      expect(mockSendNotificationToUser).toHaveBeenCalledWith(
        'wsim-user-123',
        'transfer.received',
        expect.objectContaining({
          title: 'Money Received!',
          body: 'John D. from Alpha Bank sent you $100.00',
        }),
        'p2p_abc123'
      );
    });

    it('should return 200 with processed=false when recipient not enrolled', async () => {
      // Mock no enrollment found
      mockPrismaInstance.bsimEnrollment.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/webhooks/transfersim')
        .set('X-Webhook-Signature', generateSignature(validPayload))
        .send(validPayload);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        received: true,
        processed: false,
        reason: 'Recipient not enrolled in WSIM',
      });

      // Notification should NOT be sent
      expect(mockSendNotificationToUser).not.toHaveBeenCalled();
    });

    it('should ignore non-transfer.completed events', async () => {
      const payload = {
        ...validPayload,
        eventType: 'transfer.failed',
      };

      const res = await request(app)
        .post('/api/webhooks/transfersim')
        .set('X-Webhook-Signature', generateSignature(payload))
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        received: true,
        processed: false,
      });

      expect(mockPrismaInstance.bsimEnrollment.findFirst).not.toHaveBeenCalled();
    });

    it('should format notification for same-bank transfer', async () => {
      const sameBankPayload = {
        ...validPayload,
        data: {
          ...validPayload.data,
          isCrossBank: false,
          senderBankName: 'Alpha Bank',
          recipientBankName: 'Alpha Bank',
        },
      };

      mockPrismaInstance.bsimEnrollment.findFirst.mockResolvedValue({
        userId: 'wsim-user-123',
        user: { firstName: 'Jane', email: 'jane@example.com' },
      });

      mockSendNotificationToUser.mockResolvedValue({
        success: true,
        totalDevices: 1,
        successCount: 1,
        failureCount: 0,
        tickets: [],
        errors: [],
      });

      const res = await request(app)
        .post('/api/webhooks/transfersim')
        .set('X-Webhook-Signature', generateSignature(sameBankPayload))
        .send(sameBankPayload);

      expect(res.status).toBe(200);

      // Same-bank transfer should NOT include bank name in notification
      expect(mockSendNotificationToUser).toHaveBeenCalledWith(
        'wsim-user-123',
        'transfer.received',
        expect.objectContaining({
          body: 'John D. sent you $100.00', // No "from Alpha Bank"
        }),
        expect.any(String)
      );
    });

    it('should handle notification service errors gracefully', async () => {
      mockPrismaInstance.bsimEnrollment.findFirst.mockResolvedValue({
        userId: 'wsim-user-123',
        user: { firstName: 'Jane', email: 'jane@example.com' },
      });

      // Mock notification failure
      mockSendNotificationToUser.mockRejectedValue(new Error('APNs connection error'));

      const res = await request(app)
        .post('/api/webhooks/transfersim')
        .set('X-Webhook-Signature', generateSignature(validPayload))
        .send(validPayload);

      // Should return 500 to trigger retry
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        error: 'Internal server error',
        message: 'APNs connection error',
      });
    });

    it('should include deep link in notification data', async () => {
      mockPrismaInstance.bsimEnrollment.findFirst.mockResolvedValue({
        userId: 'wsim-user-123',
        user: { firstName: 'Jane', email: 'jane@example.com' },
      });

      mockSendNotificationToUser.mockResolvedValue({
        success: true,
        totalDevices: 1,
        successCount: 1,
        failureCount: 0,
        tickets: [],
        errors: [],
      });

      await request(app)
        .post('/api/webhooks/transfersim')
        .set('X-Webhook-Signature', generateSignature(validPayload))
        .send(validPayload);

      expect(mockSendNotificationToUser).toHaveBeenCalledWith(
        'wsim-user-123',
        'transfer.received',
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'transfer.received',
            transferId: 'p2p_abc123',
            deepLink: 'mwsim://transfer/p2p_abc123',
          }),
        }),
        expect.any(String)
      );
    });

    describe('Signature Verification', () => {
      it('should reject invalid signature in production', async () => {
        process.env.NODE_ENV = 'production';

        const res = await request(app)
          .post('/api/webhooks/transfersim')
          .set('X-Webhook-Signature', 'invalid-signature')
          .send(validPayload);

        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({
          error: 'Invalid webhook signature',
        });
      });

      it('should reject missing signature in production', async () => {
        process.env.NODE_ENV = 'production';

        const res = await request(app).post('/api/webhooks/transfersim').send(validPayload);

        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({
          error: 'Invalid webhook signature',
        });
      });

      it('should allow requests without signature in dev mode', async () => {
        process.env.NODE_ENV = 'development';

        mockPrismaInstance.bsimEnrollment.findFirst.mockResolvedValue(null);

        const res = await request(app).post('/api/webhooks/transfersim').send(validPayload);

        // Should process normally, not reject
        expect(res.status).toBe(200);
      });
    });
  });
});
