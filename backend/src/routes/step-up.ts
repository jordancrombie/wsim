/**
 * Step-Up Authorization Routes
 *
 * Mobile API endpoints for approving/rejecting step-up requests.
 * All endpoints require mobile JWT authentication.
 *
 * Routes:
 * - GET /api/mobile/step-up/:stepUpId - Get step-up details
 * - POST /api/mobile/step-up/:stepUpId/approve - Approve step-up
 * - POST /api/mobile/step-up/:stepUpId/reject - Reject step-up
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { getPeriodBoundaries } from '../services/spending-limits';

const router = Router();

// =============================================================================
// AUTH MIDDLEWARE (copied from mobile.ts pattern)
// =============================================================================

interface MobileAccessTokenPayload {
  sub: string;
  deviceId: string;
  type: 'access';
}

interface AuthenticatedRequest extends Request {
  userId?: string;
  deviceId?: string;
}

function verifyMobileToken(token: string): MobileAccessTokenPayload | null {
  try {
    return jwt.verify(token, env.MOBILE_JWT_SECRET) as MobileAccessTokenPayload;
  } catch {
    return null;
  }
}

async function requireMobileAuth(req: AuthenticatedRequest, res: Response, next: () => void) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid authorization header',
    });
  }

  const token = authHeader.slice(7);
  const payload = verifyMobileToken(token);

  if (!payload || payload.type !== 'access') {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid or expired access token',
    });
  }

  req.userId = payload.sub;
  req.deviceId = payload.deviceId;
  next();
}

// =============================================================================
// GET STEP-UP DETAILS
// =============================================================================

/**
 * GET /api/mobile/step-up/:stepUpId
 * Get step-up request details for approval screen
 */
router.get('/:stepUpId', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { stepUpId } = req.params;

    // Fetch step-up with agent details
    const stepUp = await prisma.stepUpRequest.findUnique({
      where: { id: stepUpId },
      include: {
        agent: {
          select: {
            id: true,
            userId: true,
            name: true,
            perTransactionLimit: true,
            dailyLimit: true,
            monthlyLimit: true,
            limitCurrency: true,
          },
        },
      },
    });

    if (!stepUp) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Step-up request not found',
      });
    }

    // Verify the agent belongs to this user
    if (stepUp.agent.userId !== userId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'You do not own this agent',
      });
    }

    // Check if expired
    if (stepUp.status === 'pending' && stepUp.expiresAt < new Date()) {
      // Mark as expired
      await prisma.stepUpRequest.update({
        where: { id: stepUp.id },
        data: { status: 'expired' },
      });
      stepUp.status = 'expired';
    }

    // Get available payment methods
    const paymentMethods = await prisma.walletCard.findMany({
      where: {
        userId: userId!,
        isActive: true,
      },
      orderBy: { isDefault: 'desc' },
      select: {
        id: true,
        cardType: true,
        lastFour: true,
        cardholderName: true,
        expiryMonth: true,
        expiryYear: true,
        isDefault: true,
      },
    });

    // Calculate time remaining
    const timeRemainingMs = Math.max(0, stepUp.expiresAt.getTime() - Date.now());
    const timeRemainingSeconds = Math.floor(timeRemainingMs / 1000);

    return res.json({
      id: stepUp.id,
      status: stepUp.status,
      agent: {
        id: stepUp.agent.id,
        name: stepUp.agent.name,
      },
      purchase: {
        amount: stepUp.amount.toString(),
        currency: stepUp.currency,
        merchantId: stepUp.merchantId,
        merchantName: stepUp.merchantName,
        sessionId: stepUp.sessionId,
        items: stepUp.items,
      },
      reason: stepUp.reason,
      triggerType: stepUp.triggerType,
      limits: {
        perTransaction: stepUp.agent.perTransactionLimit.toString(),
        daily: stepUp.agent.dailyLimit.toString(),
        monthly: stepUp.agent.monthlyLimit.toString(),
        currency: stepUp.agent.limitCurrency,
      },
      paymentMethods: paymentMethods.map(pm => ({
        id: pm.id,
        type: pm.cardType,
        lastFour: pm.lastFour,
        cardholderName: pm.cardholderName,
        expiryMonth: pm.expiryMonth,
        expiryYear: pm.expiryYear,
        isDefault: pm.isDefault,
      })),
      requestedPaymentMethodId: stepUp.requestedPaymentMethodId,
      expiresAt: stepUp.expiresAt.toISOString(),
      timeRemainingSeconds,
      createdAt: stepUp.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[Step-Up] Get error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get step-up details',
    });
  }
});

// =============================================================================
// APPROVE STEP-UP
// =============================================================================

/**
 * POST /api/mobile/step-up/:stepUpId/approve
 * Approve a step-up request
 */
router.post('/:stepUpId/approve', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { stepUpId } = req.params;
    const { paymentMethodId, consent } = req.body;

    // Consent is required
    if (consent !== true) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'consent must be true to approve',
      });
    }

    // Fetch step-up with agent
    const stepUp = await prisma.stepUpRequest.findUnique({
      where: { id: stepUpId },
      include: {
        agent: {
          select: {
            id: true,
            userId: true,
            name: true,
          },
        },
      },
    });

    if (!stepUp) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Step-up request not found',
      });
    }

    // Verify ownership
    if (stepUp.agent.userId !== userId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'You do not own this agent',
      });
    }

    // Check status
    if (stepUp.status !== 'pending') {
      return res.status(400).json({
        error: 'invalid_state',
        message: `Step-up request is already ${stepUp.status}`,
      });
    }

    // Check expiration
    if (stepUp.expiresAt < new Date()) {
      await prisma.stepUpRequest.update({
        where: { id: stepUp.id },
        data: { status: 'expired' },
      });

      return res.status(400).json({
        error: 'expired',
        message: 'Step-up request has expired',
      });
    }

    // Get payment method (use requested if not overridden)
    const selectedPaymentMethodId = paymentMethodId || stepUp.requestedPaymentMethodId;

    if (!selectedPaymentMethodId) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'paymentMethodId is required',
      });
    }

    // Verify payment method belongs to user
    const paymentMethod = await prisma.walletCard.findFirst({
      where: {
        id: selectedPaymentMethodId,
        userId: userId!,
        isActive: true,
      },
    });

    if (!paymentMethod) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Invalid payment method',
      });
    }

    // Create transaction and update step-up in a transaction
    const periodBoundaries = getPeriodBoundaries();

    const result = await prisma.$transaction(async (tx) => {
      // Create transaction
      const transaction = await tx.agentTransaction.create({
        data: {
          agentId: stepUp.agentId,
          amount: stepUp.amount,
          currency: stepUp.currency,
          merchantId: stepUp.merchantId,
          merchantName: stepUp.merchantName,
          sessionId: stepUp.sessionId,
          paymentMethodId: paymentMethod.id,
          paymentMethodLastFour: paymentMethod.lastFour,
          status: 'pending',
          approvalType: 'step_up',
          dailyPeriodStart: periodBoundaries.dailyPeriodStart,
          monthlyPeriodStart: periodBoundaries.monthlyPeriodStart,
          stepUpId: stepUp.id,
        },
      });

      // Update step-up status
      await tx.stepUpRequest.update({
        where: { id: stepUp.id },
        data: {
          status: 'approved',
          approvedPaymentMethodId: paymentMethod.id,
          resolvedAt: new Date(),
        },
      });

      // Update agent lastUsedAt
      await tx.agent.update({
        where: { id: stepUp.agentId },
        data: { lastUsedAt: new Date() },
      });

      return transaction;
    });

    console.log(`[Step-Up] Approved step-up ${stepUpId} for agent ${stepUp.agent.name}`);

    return res.json({
      success: true,
      transactionId: result.id,
      paymentMethod: {
        id: paymentMethod.id,
        type: paymentMethod.cardType,
        lastFour: paymentMethod.lastFour,
      },
      message: 'Step-up approved. Agent can now complete the purchase.',
    });
  } catch (error) {
    console.error('[Step-Up] Approve error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to approve step-up',
    });
  }
});

// =============================================================================
// REJECT STEP-UP
// =============================================================================

/**
 * POST /api/mobile/step-up/:stepUpId/reject
 * Reject a step-up request
 */
router.post('/:stepUpId/reject', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { stepUpId } = req.params;
    const { reason } = req.body;

    // Fetch step-up with agent
    const stepUp = await prisma.stepUpRequest.findUnique({
      where: { id: stepUpId },
      include: {
        agent: {
          select: {
            id: true,
            userId: true,
            name: true,
          },
        },
      },
    });

    if (!stepUp) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Step-up request not found',
      });
    }

    // Verify ownership
    if (stepUp.agent.userId !== userId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'You do not own this agent',
      });
    }

    // Check status
    if (stepUp.status !== 'pending') {
      return res.status(400).json({
        error: 'invalid_state',
        message: `Step-up request is already ${stepUp.status}`,
      });
    }

    // Check expiration (still mark as rejected, not expired)
    const wasExpired = stepUp.expiresAt < new Date();

    // Update step-up status
    await prisma.stepUpRequest.update({
      where: { id: stepUp.id },
      data: {
        status: 'rejected',
        rejectionReason: reason || (wasExpired ? 'Expired - User rejected' : 'User rejected'),
        resolvedAt: new Date(),
      },
    });

    console.log(`[Step-Up] Rejected step-up ${stepUpId} for agent ${stepUp.agent.name}`);

    return res.json({
      success: true,
      message: 'Step-up request rejected',
    });
  } catch (error) {
    console.error('[Step-Up] Reject error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to reject step-up',
    });
  }
});

// =============================================================================
// LIST PENDING STEP-UPS
// =============================================================================

/**
 * GET /api/mobile/step-up
 * List all pending step-up requests for the user
 */
router.get('/', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;

    // Get all user's agents
    const agents = await prisma.agent.findMany({
      where: { userId: userId! },
      select: { id: true },
    });

    const agentIds = agents.map(a => a.id);

    // Get pending step-ups for these agents
    const stepUps = await prisma.stepUpRequest.findMany({
      where: {
        agentId: { in: agentIds },
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        agent: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return res.json({
      stepUps: stepUps.map(su => ({
        id: su.id,
        agent: {
          id: su.agent.id,
          name: su.agent.name,
        },
        amount: su.amount.toString(),
        currency: su.currency,
        merchantId: su.merchantId,
        merchantName: su.merchantName,
        reason: su.reason,
        triggerType: su.triggerType,
        expiresAt: su.expiresAt.toISOString(),
        timeRemainingSeconds: Math.floor(Math.max(0, su.expiresAt.getTime() - Date.now()) / 1000),
        createdAt: su.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[Step-Up] List error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to list step-ups',
    });
  }
});

export default router;
