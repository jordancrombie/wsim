/**
 * Agent Management Routes
 *
 * Mobile API endpoints for managing AI agents.
 * All endpoints require mobile JWT authentication.
 *
 * Routes:
 * - POST /api/mobile/agents - Register new agent
 * - GET /api/mobile/agents - List user's agents
 * - GET /api/mobile/agents/:id - Get agent details
 * - PATCH /api/mobile/agents/:id - Update agent settings
 * - DELETE /api/mobile/agents/:id - Revoke agent
 * - POST /api/mobile/agents/:id/rotate-secret - Rotate client secret
 * - GET /api/mobile/agents/:id/transactions - Get agent transaction history
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database';
import { env } from '../config/env';
import {
  generateAgentClientId,
  generateAgentClientSecret,
  hashClientSecret,
  revokeAllAgentTokens,
} from '../services/agent-auth';
import {
  getSpendingUsage,
  getRemainingLimits,
  formatCurrency,
} from '../services/spending-limits';

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
// VALIDATION HELPERS
// =============================================================================

const VALID_PERMISSIONS = ['browse', 'cart', 'purchase', 'history'];

function validatePermissions(permissions: unknown): string[] | null {
  if (!Array.isArray(permissions)) return null;

  for (const perm of permissions) {
    if (typeof perm !== 'string' || !VALID_PERMISSIONS.includes(perm)) {
      return null;
    }
  }

  return permissions;
}

function validateSpendingLimit(value: unknown, fieldName: string): Decimal | { error: string } {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return { error: `${fieldName} must be a number` };
  }

  try {
    const decimal = new Decimal(value);

    if (decimal.lessThanOrEqualTo(0)) {
      return { error: `${fieldName} must be greater than 0` };
    }

    if (decimal.decimalPlaces() > 2) {
      return { error: `${fieldName} must have at most 2 decimal places` };
    }

    return decimal;
  } catch {
    return { error: `${fieldName} is not a valid number` };
  }
}

// =============================================================================
// ROUTES
// =============================================================================

/**
 * POST /api/mobile/agents
 * Register a new AI agent
 */
router.post('/', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const {
      name,
      description,
      permissions,
      perTransactionLimit,
      dailyLimit,
      monthlyLimit,
    } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'name is required and must be a non-empty string',
      });
    }

    if (name.length > 100) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'name must be 100 characters or less',
      });
    }

    // Validate permissions
    const validatedPermissions = validatePermissions(permissions);
    if (!validatedPermissions || validatedPermissions.length === 0) {
      return res.status(400).json({
        error: 'bad_request',
        message: `permissions must be an array containing at least one of: ${VALID_PERMISSIONS.join(', ')}`,
      });
    }

    // Validate spending limits
    const perTxLimit = validateSpendingLimit(perTransactionLimit, 'perTransactionLimit');
    if ('error' in perTxLimit) {
      return res.status(400).json({ error: 'bad_request', message: perTxLimit.error });
    }

    const dailyLimitDecimal = validateSpendingLimit(dailyLimit, 'dailyLimit');
    if ('error' in dailyLimitDecimal) {
      return res.status(400).json({ error: 'bad_request', message: dailyLimitDecimal.error });
    }

    const monthlyLimitDecimal = validateSpendingLimit(monthlyLimit, 'monthlyLimit');
    if ('error' in monthlyLimitDecimal) {
      return res.status(400).json({ error: 'bad_request', message: monthlyLimitDecimal.error });
    }

    // Validate limit relationships
    if (perTxLimit.greaterThan(dailyLimitDecimal)) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'perTransactionLimit cannot be greater than dailyLimit',
      });
    }

    if (dailyLimitDecimal.greaterThan(monthlyLimitDecimal)) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'dailyLimit cannot be greater than monthlyLimit',
      });
    }

    // Generate credentials
    const clientId = generateAgentClientId();
    const clientSecret = generateAgentClientSecret();
    const clientSecretHash = await hashClientSecret(clientSecret);

    // Create agent
    const agent = await prisma.agent.create({
      data: {
        userId: userId!,
        clientId,
        clientSecretHash,
        name: name.trim(),
        description: description?.trim() || null,
        permissions: validatedPermissions,
        perTransactionLimit: perTxLimit,
        dailyLimit: dailyLimitDecimal,
        monthlyLimit: monthlyLimitDecimal,
      },
    });

    console.log(`[Agent] Created agent ${agent.id} (${clientId}) for user ${userId}`);

    // Return credentials (secret shown only once!)
    return res.status(201).json({
      id: agent.id,
      client_id: agent.clientId,
      client_secret: clientSecret, // Only returned on creation!
      name: agent.name,
      description: agent.description,
      permissions: agent.permissions,
      spending_limits: {
        per_transaction: agent.perTransactionLimit.toString(),
        daily: agent.dailyLimit.toString(),
        monthly: agent.monthlyLimit.toString(),
        currency: agent.limitCurrency,
      },
      status: agent.status,
      created_at: agent.createdAt.toISOString(),
      message: 'Save the client_secret now - it will not be shown again!',
    });
  } catch (error) {
    console.error('[Agent] Create error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to create agent',
    });
  }
});

/**
 * GET /api/mobile/agents
 * List user's agents
 */
router.get('/', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const includeRevoked = req.query.include_revoked === 'true';

    const agents = await prisma.agent.findMany({
      where: {
        userId: userId!,
        // Exclude revoked agents by default
        ...(includeRevoked ? {} : { status: { not: 'revoked' } }),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        clientId: true,
        name: true,
        description: true,
        permissions: true,
        perTransactionLimit: true,
        dailyLimit: true,
        monthlyLimit: true,
        limitCurrency: true,
        status: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    // Get usage for each agent
    const agentsWithUsage = await Promise.all(
      agents.map(async (agent) => {
        const usage = await getSpendingUsage(agent.id);

        return {
          id: agent.id,
          client_id: agent.clientId,
          name: agent.name,
          description: agent.description,
          permissions: agent.permissions,
          spending_limits: {
            per_transaction: agent.perTransactionLimit.toString(),
            daily: agent.dailyLimit.toString(),
            monthly: agent.monthlyLimit.toString(),
            currency: agent.limitCurrency,
          },
          spending_usage: {
            daily: usage.daily.toString(),
            monthly: usage.monthly.toString(),
          },
          status: agent.status,
          created_at: agent.createdAt.toISOString(),
          last_used_at: agent.lastUsedAt?.toISOString() || null,
        };
      })
    );

    return res.json({ agents: agentsWithUsage });
  } catch (error) {
    console.error('[Agent] List error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to list agents',
    });
  }
});

/**
 * GET /api/mobile/agents/:id
 * Get agent details
 */
router.get('/:id', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { id } = req.params;

    const agent = await prisma.agent.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        clientId: true,
        name: true,
        description: true,
        permissions: true,
        perTransactionLimit: true,
        dailyLimit: true,
        monthlyLimit: true,
        limitCurrency: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        lastUsedAt: true,
        secretRotatedAt: true,
      },
    });

    if (!agent) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Agent not found',
      });
    }

    // Verify ownership
    if (agent.userId !== userId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'You do not own this agent',
      });
    }

    // Get usage and remaining limits
    const usage = await getSpendingUsage(agent.id);
    const remaining = await getRemainingLimits(agent);

    return res.json({
      id: agent.id,
      client_id: agent.clientId,
      name: agent.name,
      description: agent.description,
      permissions: agent.permissions,
      spending_limits: {
        per_transaction: agent.perTransactionLimit.toString(),
        daily: agent.dailyLimit.toString(),
        monthly: agent.monthlyLimit.toString(),
        currency: agent.limitCurrency,
      },
      spending_usage: {
        daily: usage.daily.toString(),
        monthly: usage.monthly.toString(),
      },
      remaining_limits: {
        daily: remaining.dailyRemaining.toString(),
        monthly: remaining.monthlyRemaining.toString(),
      },
      status: agent.status,
      created_at: agent.createdAt.toISOString(),
      updated_at: agent.updatedAt.toISOString(),
      last_used_at: agent.lastUsedAt?.toISOString() || null,
      secret_rotated_at: agent.secretRotatedAt?.toISOString() || null,
    });
  } catch (error) {
    console.error('[Agent] Get error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get agent',
    });
  }
});

/**
 * PATCH /api/mobile/agents/:id
 * Update agent settings
 */
router.patch('/:id', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { id } = req.params;
    const {
      name,
      description,
      permissions,
      perTransactionLimit,
      dailyLimit,
      monthlyLimit,
      status,
    } = req.body;

    // Find agent
    const agent = await prisma.agent.findUnique({
      where: { id },
    });

    if (!agent) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Agent not found',
      });
    }

    // Verify ownership
    if (agent.userId !== userId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'You do not own this agent',
      });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    // Name
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'name must be a non-empty string',
        });
      }
      if (name.length > 100) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'name must be 100 characters or less',
        });
      }
      updateData.name = name.trim();
    }

    // Description
    if (description !== undefined) {
      updateData.description = description?.trim() || null;
    }

    // Permissions
    if (permissions !== undefined) {
      const validatedPermissions = validatePermissions(permissions);
      if (!validatedPermissions || validatedPermissions.length === 0) {
        return res.status(400).json({
          error: 'bad_request',
          message: `permissions must be an array containing at least one of: ${VALID_PERMISSIONS.join(', ')}`,
        });
      }
      updateData.permissions = validatedPermissions;
    }

    // Spending limits (get current values for validation)
    const currentPerTx = perTransactionLimit !== undefined
      ? validateSpendingLimit(perTransactionLimit, 'perTransactionLimit')
      : agent.perTransactionLimit;
    const currentDaily = dailyLimit !== undefined
      ? validateSpendingLimit(dailyLimit, 'dailyLimit')
      : agent.dailyLimit;
    const currentMonthly = monthlyLimit !== undefined
      ? validateSpendingLimit(monthlyLimit, 'monthlyLimit')
      : agent.monthlyLimit;

    if ('error' in currentPerTx) {
      return res.status(400).json({ error: 'bad_request', message: currentPerTx.error });
    }
    if ('error' in currentDaily) {
      return res.status(400).json({ error: 'bad_request', message: currentDaily.error });
    }
    if ('error' in currentMonthly) {
      return res.status(400).json({ error: 'bad_request', message: currentMonthly.error });
    }

    // Validate relationships
    if (currentPerTx.greaterThan(currentDaily)) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'perTransactionLimit cannot be greater than dailyLimit',
      });
    }
    if (currentDaily.greaterThan(currentMonthly)) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'dailyLimit cannot be greater than monthlyLimit',
      });
    }

    if (perTransactionLimit !== undefined) updateData.perTransactionLimit = currentPerTx;
    if (dailyLimit !== undefined) updateData.dailyLimit = currentDaily;
    if (monthlyLimit !== undefined) updateData.monthlyLimit = currentMonthly;

    // Status (only allow active/suspended, not revoked via patch)
    if (status !== undefined) {
      if (!['active', 'suspended'].includes(status)) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'status must be "active" or "suspended"',
        });
      }
      updateData.status = status;
    }

    // Update agent
    const updatedAgent = await prisma.agent.update({
      where: { id },
      data: updateData,
    });

    console.log(`[Agent] Updated agent ${id} for user ${userId}`);

    return res.json({
      id: updatedAgent.id,
      client_id: updatedAgent.clientId,
      name: updatedAgent.name,
      description: updatedAgent.description,
      permissions: updatedAgent.permissions,
      spending_limits: {
        per_transaction: updatedAgent.perTransactionLimit.toString(),
        daily: updatedAgent.dailyLimit.toString(),
        monthly: updatedAgent.monthlyLimit.toString(),
        currency: updatedAgent.limitCurrency,
      },
      status: updatedAgent.status,
      updated_at: updatedAgent.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error('[Agent] Update error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to update agent',
    });
  }
});

/**
 * DELETE /api/mobile/agents/:id
 * Revoke an agent (soft delete)
 */
router.delete('/:id', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { id } = req.params;

    // Find agent
    const agent = await prisma.agent.findUnique({
      where: { id },
    });

    if (!agent) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Agent not found',
      });
    }

    // Verify ownership
    if (agent.userId !== userId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'You do not own this agent',
      });
    }

    // Revoke all outstanding tokens
    await revokeAllAgentTokens(id);

    // Mark agent as revoked
    await prisma.agent.update({
      where: { id },
      data: { status: 'revoked' },
    });

    console.log(`[Agent] Revoked agent ${id} for user ${userId}`);

    return res.json({
      success: true,
      message: 'Agent revoked successfully',
    });
  } catch (error) {
    console.error('[Agent] Revoke error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to revoke agent',
    });
  }
});

/**
 * POST /api/mobile/agents/:id/rotate-secret
 * Rotate agent client secret
 */
router.post('/:id/rotate-secret', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { id } = req.params;

    // Find agent
    const agent = await prisma.agent.findUnique({
      where: { id },
    });

    if (!agent) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Agent not found',
      });
    }

    // Verify ownership
    if (agent.userId !== userId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'You do not own this agent',
      });
    }

    // Cannot rotate secret for revoked agents
    if (agent.status === 'revoked') {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Cannot rotate secret for revoked agents',
      });
    }

    // Generate new secret
    const newClientSecret = generateAgentClientSecret();
    const newClientSecretHash = await hashClientSecret(newClientSecret);

    // Revoke all existing tokens (per Q5 - re-authorization required)
    await revokeAllAgentTokens(id);

    // Update agent with new secret
    await prisma.agent.update({
      where: { id },
      data: {
        clientSecretHash: newClientSecretHash,
        secretRotatedAt: new Date(),
      },
    });

    console.log(`[Agent] Rotated secret for agent ${id}`);

    return res.json({
      client_id: agent.clientId,
      client_secret: newClientSecret, // Only returned on rotation!
      rotated_at: new Date().toISOString(),
      message: 'Save the new client_secret now - it will not be shown again! All existing tokens have been revoked.',
    });
  } catch (error) {
    console.error('[Agent] Rotate secret error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to rotate secret',
    });
  }
});

/**
 * GET /api/mobile/agents/:id/transactions
 * Get agent transaction history
 */
router.get('/:id/transactions', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { id } = req.params;
    const { limit = '20', offset = '0', status: statusFilter } = req.query;

    // Find agent
    const agent = await prisma.agent.findUnique({
      where: { id },
    });

    if (!agent) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Agent not found',
      });
    }

    // Verify ownership
    if (agent.userId !== userId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'You do not own this agent',
      });
    }

    // Parse pagination
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 20, 1), 100);
    const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);

    // Build where clause
    const where: Record<string, unknown> = { agentId: id };
    if (statusFilter && ['pending', 'completed', 'failed', 'refunded'].includes(statusFilter as string)) {
      where.status = statusFilter;
    }

    // Fetch transactions
    const [transactions, total] = await Promise.all([
      prisma.agentTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        skip: offsetNum,
        select: {
          id: true,
          amount: true,
          currency: true,
          merchantId: true,
          merchantName: true,
          sessionId: true,
          paymentMethodLastFour: true,
          status: true,
          approvalType: true,
          createdAt: true,
          completedAt: true,
        },
      }),
      prisma.agentTransaction.count({ where }),
    ]);

    return res.json({
      transactions: transactions.map(tx => ({
        id: tx.id,
        amount: tx.amount.toString(),
        currency: tx.currency,
        merchant_id: tx.merchantId,
        merchant_name: tx.merchantName,
        session_id: tx.sessionId,
        payment_method_last_four: tx.paymentMethodLastFour,
        status: tx.status,
        approval_type: tx.approvalType,
        created_at: tx.createdAt.toISOString(),
        completed_at: tx.completedAt?.toISOString() || null,
      })),
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        has_more: offsetNum + limitNum < total,
      },
    });
  } catch (error) {
    console.error('[Agent] Transactions error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get transactions',
    });
  }
});

export default router;
