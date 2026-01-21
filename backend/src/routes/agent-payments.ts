/**
 * Agent Payments Routes
 *
 * Payment token API for AI agent purchases.
 *
 * Routes:
 * - POST /api/agent/v1/payments/token - Request payment token
 * - GET /api/agent/v1/payments/:paymentId/status - Check payment status
 * - GET /api/agent/v1/payments/methods - List available payment methods
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database';
import { env } from '../config/env';
import {
  verifyAgentAccessToken,
  isTokenRevoked,
  getTokenHash,
  AgentAccessTokenPayload,
} from '../services/agent-auth';
import {
  checkSpendingLimits,
  getPeriodBoundaries,
  getSpendingUsage,
} from '../services/spending-limits';
import { sendNotificationToUser } from '../services/notification';

const router = Router();

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================

interface AgentAuthenticatedRequest extends Request {
  agentPayload?: AgentAccessTokenPayload;
}

async function requireAgentAuth(
  req: AgentAuthenticatedRequest,
  res: Response,
  next: () => void
) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'unauthorized',
      error_description: 'Missing or invalid authorization header',
    });
  }

  const token = authHeader.slice(7);
  const payload = verifyAgentAccessToken(token);

  if (!payload) {
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Invalid or expired access token',
    });
  }

  // Check if token was revoked
  const tokenHash = getTokenHash(token);
  const revoked = await isTokenRevoked(tokenHash);

  if (revoked) {
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Token has been revoked',
    });
  }

  req.agentPayload = payload;
  next();
}

// =============================================================================
// PAYMENT TOKEN ENDPOINT
// =============================================================================

/**
 * POST /api/agent/v1/payments/token
 * Request a payment token for a purchase
 */
router.post('/token', requireAgentAuth, async (req: AgentAuthenticatedRequest, res: Response) => {
  try {
    const { agentPayload } = req;
    const {
      amount,
      currency = 'CAD',
      merchant_id,
      merchant_name,
      session_id,
      items,
      payment_method_id,
    } = req.body;

    // Validate required fields
    if (!amount || !merchant_id) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'amount and merchant_id are required',
      });
    }

    // Validate amount
    let amountDecimal: Decimal;
    try {
      amountDecimal = new Decimal(amount);
      if (amountDecimal.lessThanOrEqualTo(0)) {
        throw new Error('Amount must be positive');
      }
    } catch {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'amount must be a positive number',
      });
    }

    // Fetch agent
    const agent = await prisma.agent.findUnique({
      where: { id: agentPayload!.sub },
      include: {
        user: {
          include: {
            walletCards: {
              where: { isActive: true },
              orderBy: { isDefault: 'desc' },
            },
          },
        },
      },
    });

    if (!agent) {
      return res.status(404).json({
        error: 'not_found',
        error_description: 'Agent not found',
      });
    }

    if (agent.status !== 'active') {
      return res.status(403).json({
        error: 'access_denied',
        error_description: `Agent is ${agent.status}`,
      });
    }

    // Check if agent has purchase permission
    if (!agent.permissions.includes('purchase')) {
      return res.status(403).json({
        error: 'insufficient_scope',
        error_description: 'Agent does not have purchase permission',
      });
    }

    // Get payment method
    let paymentMethod = null;
    if (payment_method_id) {
      paymentMethod = agent.user.walletCards.find(c => c.id === payment_method_id);
      if (!paymentMethod) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Invalid payment method',
        });
      }
    } else {
      // Use default payment method
      paymentMethod = agent.user.walletCards.find(c => c.isDefault) || agent.user.walletCards[0];
    }

    if (!paymentMethod) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'No payment methods available',
      });
    }

    // Check spending limits
    const limitResult = await checkSpendingLimits(agent, amountDecimal);

    if (!limitResult.allowed) {
      // Create step-up request
      const stepUp = await prisma.stepUpRequest.create({
        data: {
          agentId: agent.id,
          amount: amountDecimal,
          currency,
          merchantId: merchant_id,
          merchantName: merchant_name,
          sessionId: session_id,
          items: items ? JSON.parse(JSON.stringify(items)) : null,
          reason: limitResult.reason!,
          triggerType: limitResult.triggerType!,
          status: 'pending',
          expiresAt: new Date(Date.now() + env.STEP_UP_EXPIRY_MINUTES * 60 * 1000),
          requestedPaymentMethodId: paymentMethod.id,
        },
      });

      // Send push notification to user
      try {
        await sendNotificationToUser(
          agent.userId,
          'agent.step_up',
          {
            title: `${agent.name} wants to make a purchase`,
            body: `${new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(amountDecimal.toNumber())} at ${merchant_name || merchant_id}`,
            data: {
              type: 'agent.step_up',
              screen: 'AgentStepUp',
              params: { stepUpId: stepUp.id },
              step_up_id: stepUp.id,
              agent_id: agent.id,
              agent_name: agent.name,
              merchant_name: merchant_name || merchant_id,
              amount: amountDecimal.toString(),
              currency,
              reason: limitResult.reason,
              expires_at: stepUp.expiresAt.toISOString(),
            },
          },
          stepUp.id
        );
      } catch (notifError) {
        console.error('[Agent Payments] Failed to send step-up notification:', notifError);
        // Continue - step-up still created
      }

      console.log(`[Agent Payments] Step-up required for agent ${agent.clientId}: ${limitResult.reason}`);

      return res.status(200).json({
        step_up_required: true,
        step_up_id: stepUp.id,
        payment_id: null,
        reason: limitResult.reason,
        trigger_type: limitResult.triggerType,
        expires_at: stepUp.expiresAt.toISOString(),
      });
    }

    // Create transaction record
    const periodBoundaries = getPeriodBoundaries();

    const transaction = await prisma.agentTransaction.create({
      data: {
        agentId: agent.id,
        amount: amountDecimal,
        currency,
        merchantId: merchant_id,
        merchantName: merchant_name,
        sessionId: session_id,
        paymentMethodId: paymentMethod.id,
        paymentMethodLastFour: paymentMethod.lastFour,
        status: 'pending',
        approvalType: 'auto',
        dailyPeriodStart: periodBoundaries.dailyPeriodStart,
        monthlyPeriodStart: periodBoundaries.monthlyPeriodStart,
      },
    });

    // Generate payment token
    const paymentToken = jwt.sign(
      {
        payment_id: transaction.id,
        agent_id: agent.id,
        owner_id: agent.userId,
        merchant_id,
        amount: amountDecimal.toString(),
        currency,
        payment_method_id: paymentMethod.id,
        wallet_card_token: paymentMethod.walletCardToken,
      },
      env.PAYMENT_TOKEN_SECRET,
      {
        expiresIn: env.PAYMENT_TOKEN_EXPIRY,
        issuer: env.APP_URL,
      }
    );

    // Update agent lastUsedAt
    await prisma.agent.update({
      where: { id: agent.id },
      data: { lastUsedAt: new Date() },
    });

    console.log(`[Agent Payments] Payment token issued for agent ${agent.clientId}, transaction ${transaction.id}`);

    return res.status(200).json({
      step_up_required: false,
      step_up_id: null,
      payment_id: transaction.id,
      payment_token: paymentToken,
      expires_in: env.PAYMENT_TOKEN_EXPIRY,
      payment_method: {
        id: paymentMethod.id,
        type: paymentMethod.cardType,
        last_four: paymentMethod.lastFour,
      },
    });
  } catch (error) {
    console.error('[Agent Payments] Token error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

// =============================================================================
// PAYMENT STATUS ENDPOINT
// =============================================================================

/**
 * GET /api/agent/v1/payments/:paymentId/status
 * Check payment or step-up status
 */
router.get('/:paymentId/status', requireAgentAuth, async (req: AgentAuthenticatedRequest, res: Response) => {
  try {
    const { agentPayload } = req;
    const { paymentId } = req.params;

    // First check if this is a step-up ID
    const stepUp = await prisma.stepUpRequest.findUnique({
      where: { id: paymentId },
      include: { transaction: true },
    });

    if (stepUp) {
      // Verify agent ownership
      if (stepUp.agentId !== agentPayload!.sub) {
        return res.status(404).json({
          error: 'not_found',
          error_description: 'Step-up request not found',
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

      const response: Record<string, unknown> = {
        type: 'step_up',
        step_up_id: stepUp.id,
        status: stepUp.status,
        reason: stepUp.reason,
        trigger_type: stepUp.triggerType,
        amount: stepUp.amount.toString(),
        currency: stepUp.currency,
        merchant_id: stepUp.merchantId,
        merchant_name: stepUp.merchantName,
        created_at: stepUp.createdAt.toISOString(),
        expires_at: stepUp.expiresAt.toISOString(),
      };

      // If approved, include payment token info
      if (stepUp.status === 'approved' && stepUp.transaction) {
        // Get payment method
        const paymentMethod = await prisma.walletCard.findUnique({
          where: { id: stepUp.approvedPaymentMethodId || stepUp.requestedPaymentMethodId! },
        });

        if (paymentMethod) {
          // Generate payment token
          const paymentToken = jwt.sign(
            {
              payment_id: stepUp.transaction.id,
              agent_id: stepUp.agentId,
              owner_id: agentPayload!.owner_id,
              merchant_id: stepUp.merchantId,
              amount: stepUp.amount.toString(),
              currency: stepUp.currency,
              payment_method_id: paymentMethod.id,
              wallet_card_token: paymentMethod.walletCardToken,
            },
            env.PAYMENT_TOKEN_SECRET,
            {
              expiresIn: env.PAYMENT_TOKEN_EXPIRY,
              issuer: env.APP_URL,
            }
          );

          response.payment_id = stepUp.transaction.id;
          response.payment_token = paymentToken;
          response.expires_in = env.PAYMENT_TOKEN_EXPIRY;
          response.payment_method = {
            id: paymentMethod.id,
            type: paymentMethod.cardType,
            last_four: paymentMethod.lastFour,
          };
        }
      }

      if (stepUp.status === 'rejected') {
        response.rejection_reason = stepUp.rejectionReason;
      }

      return res.json(response);
    }

    // Check if it's a transaction ID
    const transaction = await prisma.agentTransaction.findUnique({
      where: { id: paymentId },
    });

    if (transaction) {
      // Verify agent ownership
      if (transaction.agentId !== agentPayload!.sub) {
        return res.status(404).json({
          error: 'not_found',
          error_description: 'Payment not found',
        });
      }

      return res.json({
        type: 'payment',
        payment_id: transaction.id,
        status: transaction.status,
        amount: transaction.amount.toString(),
        currency: transaction.currency,
        merchant_id: transaction.merchantId,
        merchant_name: transaction.merchantName,
        approval_type: transaction.approvalType,
        created_at: transaction.createdAt.toISOString(),
        completed_at: transaction.completedAt?.toISOString() || null,
      });
    }

    return res.status(404).json({
      error: 'not_found',
      error_description: 'Payment or step-up request not found',
    });
  } catch (error) {
    console.error('[Agent Payments] Status error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

// =============================================================================
// PAYMENT METHODS ENDPOINT
// =============================================================================

/**
 * GET /api/agent/v1/payments/methods
 * List available payment methods for the agent's owner
 */
router.get('/methods', requireAgentAuth, async (req: AgentAuthenticatedRequest, res: Response) => {
  try {
    const { agentPayload } = req;

    // Fetch agent with user's cards
    const agent = await prisma.agent.findUnique({
      where: { id: agentPayload!.sub },
      include: {
        user: {
          include: {
            walletCards: {
              where: { isActive: true },
              orderBy: { isDefault: 'desc' },
            },
          },
        },
      },
    });

    if (!agent) {
      return res.status(404).json({
        error: 'not_found',
        error_description: 'Agent not found',
      });
    }

    const methods = agent.user.walletCards.map(card => ({
      id: card.id,
      type: card.cardType,
      last_four: card.lastFour,
      cardholder_name: card.cardholderName,
      expiry_month: card.expiryMonth,
      expiry_year: card.expiryYear,
      is_default: card.isDefault,
    }));

    // Get current spending info
    const usage = await getSpendingUsage(agent.id);

    return res.json({
      payment_methods: methods,
      spending: {
        limits: {
          per_transaction: agent.perTransactionLimit.toString(),
          daily: agent.dailyLimit.toString(),
          monthly: agent.monthlyLimit.toString(),
          currency: agent.limitCurrency,
        },
        usage: {
          daily: usage.daily.toString(),
          monthly: usage.monthly.toString(),
        },
      },
    });
  } catch (error) {
    console.error('[Agent Payments] Methods error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

export default router;
