/**
 * Webhook Routes
 *
 * Internal webhook endpoints for partner services (TransferSim, BSIM, etc.)
 * Authenticated via HMAC-SHA256 signature verification.
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database';
import {
  sendNotificationToUser,
  NotificationType,
  NotificationPayload,
} from '../services/notification';

const router = Router();

// Webhook secret for HMAC signature verification
const WEBHOOK_SECRET = process.env.TRANSFERSIM_WEBHOOK_SECRET || 'dev-webhook-secret';

/**
 * Verify HMAC-SHA256 signature from webhook request
 */
function verifyWebhookSignature(req: Request): boolean {
  const signatureHeader = req.headers['x-webhook-signature'] as string;
  if (!signatureHeader) {
    console.warn('[Webhook] Missing X-Webhook-Signature header');
    return false;
  }

  // TransferSim sends signature as "sha256=<hex>", extract just the hex part
  const signature = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader;

  // Get raw body for signature verification
  const rawBody = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (signatureBuffer.length !== expectedBuffer.length) {
    console.warn('[Webhook] Signature length mismatch');
    return false;
  }

  const isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  if (!isValid) {
    console.warn('[Webhook] Invalid signature');
  }

  return isValid;
}

/**
 * TransferSim Webhook Payload (per AD5 - enhanced format)
 */
interface TransferWebhookPayload {
  eventType: 'transfer.completed';
  timestamp: string;
  idempotencyKey: string;
  data: {
    transferId: string;
    recipientUserId: string; // fiUserRef from BSIM
    recipientBsimId: string; // bsimId for enrollment lookup
    recipientAlias?: string;
    recipientAliasType?: 'USERNAME' | 'EMAIL' | 'PHONE';
    recipientType?: 'individual' | 'merchant'; // NEW: For Micro Merchant support
    merchantName?: string | null; // NEW: Business name for merchant payments
    senderDisplayName: string;
    senderAlias?: string;
    senderBankName: string;
    recipientBankName: string;
    amount: string; // String to preserve decimal precision
    currency: string;
    description?: string;
    isCrossBank: boolean;
  };
}

/**
 * POST /api/webhooks/transfersim
 *
 * Webhook endpoint for TransferSim to notify WSIM of completed transfers.
 * This triggers push notifications to the recipient's mobile devices.
 *
 * Authentication: HMAC-SHA256 signature in X-Webhook-Signature header
 * Idempotency: Deduplicates based on idempotencyKey (transferId)
 *
 * Flow:
 * 1. TransferSim completes a P2P transfer
 * 2. TransferSim calls this webhook with transfer details
 * 3. WSIM looks up recipient: fiUserRef + bsimId → BsimEnrollment → userId
 * 4. WSIM sends push notification to all user's active devices
 * 5. Returns 200 OK (fire-and-forget from TransferSim perspective)
 */
router.post('/transfersim', async (req: Request, res: Response) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();

  console.log(`[Webhook:${requestId}] ========== INCOMING WEBHOOK ==========`);
  console.log(`[Webhook:${requestId}] Timestamp: ${new Date().toISOString()}`);
  console.log(`[Webhook:${requestId}] Headers:`, {
    'content-type': req.headers['content-type'],
    'x-webhook-signature': req.headers['x-webhook-signature'] ? 'present' : 'missing',
    'user-agent': req.headers['user-agent'],
  });

  // Log full incoming payload from TransferSim
  console.log(`[Webhook:${requestId}] Raw payload from TransferSim:`, JSON.stringify(req.body, null, 2));

  // Verify signature in production
  if (process.env.NODE_ENV === 'production' && !verifyWebhookSignature(req)) {
    console.error(`[Webhook:${requestId}] Signature verification FAILED`);
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // In development, log if signature is missing but don't reject
  if (process.env.NODE_ENV !== 'production') {
    const signature = req.headers['x-webhook-signature'];
    if (!signature) {
      console.log(`[Webhook:${requestId}] Dev mode: No signature provided, proceeding anyway`);
    } else if (!verifyWebhookSignature(req)) {
      console.warn(`[Webhook:${requestId}] Dev mode: Invalid signature, proceeding anyway`);
    } else {
      console.log(`[Webhook:${requestId}] Signature verification passed`);
    }
  }

  try {
    const payload = req.body as TransferWebhookPayload;

    // Validate event type
    if (payload.eventType !== 'transfer.completed') {
      console.log(`[Webhook:${requestId}] Ignoring event type: ${payload.eventType}`);
      return res.status(200).json({ received: true, processed: false });
    }

    const { data } = payload;

    console.log(`[Webhook:${requestId}] Processing transfer.completed`);
    console.log(`[Webhook:${requestId}] Transfer details:`, {
      transferId: data.transferId,
      idempotencyKey: payload.idempotencyKey,
      recipientBsimId: data.recipientBsimId,
      recipientUserId: data.recipientUserId,
      recipientType: data.recipientType,
      merchantName: data.merchantName,
      senderDisplayName: data.senderDisplayName,
      senderBankName: data.senderBankName,
      amount: data.amount,
      currency: data.currency,
      isCrossBank: data.isCrossBank,
    });

    // Look up WSIM user from BSIM enrollment
    // W2: fiUserRef + bsimId → BsimEnrollment → userId → MobileDevice
    const enrollment = await prisma.bsimEnrollment.findFirst({
      where: {
        fiUserRef: data.recipientUserId,
        bsimId: data.recipientBsimId,
      },
      select: {
        userId: true,
        user: {
          select: {
            firstName: true,
            email: true,
          },
        },
      },
    });

    if (!enrollment) {
      console.log(
        `[Webhook:${requestId}] No enrollment found for fiUserRef=${data.recipientUserId}, bsimId=${data.recipientBsimId}`
      );
      const duration = Date.now() - startTime;
      console.log(`[Webhook:${requestId}] Response: 200 (not enrolled) in ${duration}ms`);
      // Return 200 to prevent TransferSim from retrying - user just isn't enrolled in WSIM
      return res.status(200).json({
        received: true,
        processed: false,
        reason: 'Recipient not enrolled in WSIM',
      });
    }

    console.log(`[Webhook:${requestId}] Enrollment found:`, {
      wsimUserId: enrollment.userId,
      userName: enrollment.user?.firstName,
      userEmail: enrollment.user?.email,
    });

    // Build notification content
    const amount = parseFloat(data.amount).toLocaleString('en-CA', {
      style: 'currency',
      currency: data.currency || 'CAD',
    });

    // Determine if this is a merchant payment
    const isMerchantPayment = data.recipientType === 'merchant' && data.merchantName;

    // Rich notification copy - different for merchant vs individual
    let title: string;
    let body: string;

    if (isMerchantPayment) {
      // Merchant payment: "Java Joe's Coffee received $25.00"
      title = 'Payment Received!';
      body = `${data.merchantName} received ${amount}`;
    } else {
      // Individual P2P: "John Doe sent you $25.00"
      const senderInfo = data.senderDisplayName || 'Someone';
      const bankInfo = data.isCrossBank ? ` from ${data.senderBankName}` : '';
      title = 'Money Received!';
      body = `${senderInfo}${bankInfo} sent you ${amount}`;
    }

    const notificationPayload: NotificationPayload = {
      title,
      body,
      data: {
        type: 'transfer.received',
        transferId: data.transferId,
        amount: data.amount,
        currency: data.currency,
        senderName: data.senderDisplayName,
        senderBank: data.senderBankName,
        recipientType: data.recipientType || 'individual', // For mwsim dashboard refresh
        merchantName: data.merchantName || null, // For merchant dashboard
        deepLink: `mwsim://transfer/${data.transferId}`,
      },
      sound: 'default',
      priority: 'high',
    };

    // Log the full notification payload being sent to APNs
    console.log(`[Webhook:${requestId}] Notification payload for APNs:`, JSON.stringify(notificationPayload, null, 2));

    // Send notification to all user's devices (per AD3)
    console.log(`[Webhook:${requestId}] Sending notification to user ${enrollment.userId}...`);
    const result = await sendNotificationToUser(
      enrollment.userId,
      'transfer.received' as NotificationType,
      notificationPayload,
      payload.idempotencyKey // Use transferId for deduplication
    );

    const duration = Date.now() - startTime;
    console.log(`[Webhook:${requestId}] Notification result:`, {
      userId: enrollment.userId,
      success: result.success,
      totalDevices: result.totalDevices,
      successCount: result.successCount,
      failureCount: result.failureCount,
      errors: result.errors,
    });
    console.log(`[Webhook:${requestId}] Response: 200 (processed) in ${duration}ms`);
    console.log(`[Webhook:${requestId}] ========== END WEBHOOK ==========`);

    return res.status(200).json({
      received: true,
      processed: true,
      notification: {
        success: result.success,
        devicesNotified: result.successCount,
        devicesFailed: result.failureCount,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Webhook:${requestId}] Error processing TransferSim webhook:`, error);
    console.log(`[Webhook:${requestId}] Response: 500 (error) in ${duration}ms`);
    console.log(`[Webhook:${requestId}] ========== END WEBHOOK (ERROR) ==========`);

    // Return 500 to trigger retry
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/webhooks/health
 *
 * Health check endpoint for webhook service
 */
router.get('/health', (_req: Request, res: Response) => {
  return res.json({
    status: 'ok',
    service: 'webhooks',
    timestamp: new Date().toISOString(),
  });
});

export default router;
