/**
 * Access Request Routes
 *
 * Agent-initiated credential flow for binding agents to user wallets.
 *
 * Mobile Endpoints:
 * - POST /api/mobile/pairing-codes - Generate pairing code
 * - GET /api/mobile/access-requests - List pending requests
 * - GET /api/mobile/access-requests/:id - Get request details
 * - POST /api/mobile/access-requests/:id/approve - Approve request
 * - POST /api/mobile/access-requests/:id/reject - Reject request
 *
 * Agent Endpoints:
 * - POST /api/agent/v1/access-request - Create access request
 * - GET /api/agent/v1/access-request/:id - Poll for status
 * - GET /api/agent/v1/access-request/:id/qr - Get QR code data
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
} from '../services/agent-auth';
import { sendNotificationToUser } from '../services/notification';

// =============================================================================
// MOBILE ROUTER (requires JWT auth)
// =============================================================================

export const mobileAccessRequestRouter = Router();

// Auth middleware (copied from mobile.ts pattern)
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
// PAIRING CODE GENERATION
// =============================================================================

/**
 * Generate a pairing code in format: WSIM-XXXXXX-XXXXXX
 */
function generatePairingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars (0, O, 1, I)
  const part1 = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const part2 = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `WSIM-${part1}-${part2}`;
}

/**
 * POST /api/mobile/pairing-codes
 * Generate a new pairing code for agent binding
 */
mobileAccessRequestRouter.post('/pairing-codes', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;

    // Check for existing active codes (max 3)
    const activeCodes = await prisma.pairingCode.count({
      where: {
        userId: userId!,
        status: 'active',
        expiresAt: { gt: new Date() },
      },
    });

    if (activeCodes >= 3) {
      return res.status(429).json({
        error: 'too_many_codes',
        message: 'Maximum of 3 active pairing codes allowed',
      });
    }

    // Generate unique code
    let code: string;
    let attempts = 0;
    do {
      code = generatePairingCode();
      const exists = await prisma.pairingCode.findUnique({ where: { code } });
      if (!exists) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      return res.status(500).json({
        error: 'server_error',
        message: 'Failed to generate unique code',
      });
    }

    // Create pairing code (24 hour expiry)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const pairingCode = await prisma.pairingCode.create({
      data: {
        userId: userId!,
        code,
        expiresAt,
      },
    });

    console.log(`[Access Request] Pairing code generated for user ${userId}: ${code}`);

    return res.status(201).json({
      code: pairingCode.code,
      expires_at: pairingCode.expiresAt.toISOString(),
      created_at: pairingCode.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[Access Request] Generate pairing code error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to generate pairing code',
    });
  }
});

// =============================================================================
// LIST/GET ACCESS REQUESTS (Mobile)
// =============================================================================

/**
 * GET /api/mobile/access-requests
 * List access requests for the user
 */
mobileAccessRequestRouter.get('/access-requests', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const status = req.query.status as string || 'pending';

    // Get pairing codes for this user
    const pairingCodes = await prisma.pairingCode.findMany({
      where: { userId: userId! },
      select: { id: true },
    });

    const pairingCodeIds = pairingCodes.map(pc => pc.id);

    // Build where clause
    const where: Record<string, unknown> = {
      pairingCodeId: { in: pairingCodeIds },
    };

    if (status === 'pending') {
      where.status = 'pending';
      where.expiresAt = { gt: new Date() };
    } else if (status !== 'all') {
      where.status = status;
    }

    const requests = await prisma.accessRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return res.json({
      access_requests: requests.map(r => ({
        id: r.id,
        agent_name: r.agentName,
        status: r.status,
        requested_permissions: r.requestedPermissions,
        created_at: r.createdAt.toISOString(),
        expires_at: r.expiresAt.toISOString(),
        time_remaining_seconds: Math.max(0, Math.floor((r.expiresAt.getTime() - Date.now()) / 1000)),
      })),
    });
  } catch (error) {
    console.error('[Access Request] List error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to list access requests',
    });
  }
});

/**
 * GET /api/mobile/access-requests/:requestId
 * Get access request details for approval screen
 */
mobileAccessRequestRouter.get('/access-requests/:requestId', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { requestId } = req.params;

    const request = await prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: {
        pairingCode: true,
      },
    });

    if (!request) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Access request not found',
      });
    }

    // Verify ownership
    if (request.pairingCode.userId !== userId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Access request does not belong to you',
      });
    }

    // Check if expired
    if (request.status === 'pending' && request.expiresAt < new Date()) {
      await prisma.accessRequest.update({
        where: { id: request.id },
        data: { status: 'expired' },
      });
      request.status = 'expired';
    }

    return res.json({
      access_request: {
        id: request.id,
        agent_name: request.agentName,
        agent_description: request.agentDescription,
        status: request.status,
        requested_permissions: request.requestedPermissions,
        requested_limits: {
          per_transaction: request.requestedPerTransaction.toString(),
          daily: request.requestedDailyLimit.toString(),
          monthly: request.requestedMonthlyLimit.toString(),
          currency: request.requestedCurrency,
        },
        created_at: request.createdAt.toISOString(),
        expires_at: request.expiresAt.toISOString(),
        time_remaining_seconds: Math.max(0, Math.floor((request.expiresAt.getTime() - Date.now()) / 1000)),
      },
    });
  } catch (error) {
    console.error('[Access Request] Get details error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get access request details',
    });
  }
});

// =============================================================================
// APPROVE/REJECT ACCESS REQUESTS (Mobile)
// =============================================================================

/**
 * POST /api/mobile/access-requests/:requestId/approve
 * Approve an access request and create the agent
 */
mobileAccessRequestRouter.post('/access-requests/:requestId/approve', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { requestId } = req.params;
    const { consent, permissions, spending_limits } = req.body;

    // Consent is required
    if (consent !== true) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'consent must be true to approve',
      });
    }

    const request = await prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: {
        pairingCode: true,
      },
    });

    if (!request) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Access request not found',
      });
    }

    // Verify ownership
    if (request.pairingCode.userId !== userId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Access request does not belong to you',
      });
    }

    // Check status
    if (request.status !== 'pending') {
      return res.status(409).json({
        error: 'conflict',
        message: `Access request is already ${request.status}`,
      });
    }

    // Check expiration
    if (request.expiresAt < new Date()) {
      await prisma.accessRequest.update({
        where: { id: request.id },
        data: { status: 'expired' },
      });
      return res.status(400).json({
        error: 'expired',
        message: 'Access request has expired',
      });
    }

    // Determine final permissions (user can only remove, not add)
    let finalPermissions = request.requestedPermissions;
    if (permissions && Array.isArray(permissions)) {
      // Filter to only include permissions that were requested
      finalPermissions = permissions.filter(p => request.requestedPermissions.includes(p));
    }

    // Determine final limits (user can only decrease, not increase)
    let finalPerTransaction = request.requestedPerTransaction;
    let finalDaily = request.requestedDailyLimit;
    let finalMonthly = request.requestedMonthlyLimit;

    if (spending_limits) {
      if (spending_limits.per_transaction !== undefined) {
        const requested = new Decimal(spending_limits.per_transaction);
        if (requested.lessThan(request.requestedPerTransaction)) {
          finalPerTransaction = requested;
        }
      }
      if (spending_limits.daily !== undefined) {
        const requested = new Decimal(spending_limits.daily);
        if (requested.lessThan(request.requestedDailyLimit)) {
          finalDaily = requested;
        }
      }
      if (spending_limits.monthly !== undefined) {
        const requested = new Decimal(spending_limits.monthly);
        if (requested.lessThan(request.requestedMonthlyLimit)) {
          finalMonthly = requested;
        }
      }
    }

    // Generate credentials
    const clientId = generateAgentClientId();
    const clientSecret = generateAgentClientSecret();
    const clientSecretHash = await hashClientSecret(clientSecret);

    // Create agent and update request in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the agent
      const agent = await tx.agent.create({
        data: {
          userId: userId!,
          clientId,
          clientSecretHash,
          name: request.agentName,
          description: request.agentDescription,
          permissions: finalPermissions,
          perTransactionLimit: finalPerTransaction,
          dailyLimit: finalDaily,
          monthlyLimit: finalMonthly,
          limitCurrency: request.requestedCurrency,
        },
      });

      // Update the access request
      await tx.accessRequest.update({
        where: { id: request.id },
        data: {
          status: 'approved',
          grantedPermissions: finalPermissions,
          grantedPerTransaction: finalPerTransaction,
          grantedDailyLimit: finalDaily,
          grantedMonthlyLimit: finalMonthly,
          agentId: agent.id,
          resolvedAt: new Date(),
        },
      });

      // Mark pairing code as used
      await tx.pairingCode.update({
        where: { id: request.pairingCodeId },
        data: {
          status: 'used',
          usedAt: new Date(),
        },
      });

      return { agent, clientSecret };
    });

    console.log(`[Access Request] Approved request ${requestId}, created agent ${result.agent.id}`);

    return res.json({
      status: 'approved',
      agent_id: result.agent.id,
      agent_name: result.agent.name,
      permissions: finalPermissions,
      spending_limits: {
        per_transaction: finalPerTransaction.toString(),
        daily: finalDaily.toString(),
        monthly: finalMonthly.toString(),
        currency: request.requestedCurrency,
      },
      approved_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Access Request] Approve error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to approve access request',
    });
  }
});

/**
 * POST /api/mobile/access-requests/:requestId/reject
 * Reject an access request
 */
mobileAccessRequestRouter.post('/access-requests/:requestId/reject', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { requestId } = req.params;
    const { reason } = req.body;

    const request = await prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: {
        pairingCode: true,
      },
    });

    if (!request) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Access request not found',
      });
    }

    // Verify ownership
    if (request.pairingCode.userId !== userId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Access request does not belong to you',
      });
    }

    // Check status
    if (request.status !== 'pending') {
      return res.status(409).json({
        error: 'conflict',
        message: `Access request is already ${request.status}`,
      });
    }

    // Update request
    await prisma.accessRequest.update({
      where: { id: request.id },
      data: {
        status: 'rejected',
        rejectionReason: reason || 'User rejected the request',
        resolvedAt: new Date(),
      },
    });

    // Mark pairing code as used (can't be reused)
    await prisma.pairingCode.update({
      where: { id: request.pairingCodeId },
      data: {
        status: 'used',
        usedAt: new Date(),
      },
    });

    console.log(`[Access Request] Rejected request ${requestId}`);

    return res.json({
      status: 'rejected',
      rejected_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Access Request] Reject error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to reject access request',
    });
  }
});

// =============================================================================
// AGENT ROUTER (no auth - uses pairing code)
// =============================================================================

export const agentAccessRequestRouter = Router();

/**
 * POST /api/agent/v1/access-request
 * Agent requests access to a user's wallet via pairing code
 */
agentAccessRequestRouter.post('/', async (req: Request, res: Response) => {
  try {
    const {
      pairing_code,
      agent_name,
      description,
      permissions,
      spending_limits,
      delivery = 'push',
    } = req.body;

    // Validate required fields
    if (!pairing_code || !agent_name || !permissions || !spending_limits) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'pairing_code, agent_name, permissions, and spending_limits are required',
      });
    }

    // Validate permissions
    const validPermissions = ['browse', 'cart', 'purchase', 'history'];
    if (!Array.isArray(permissions) || !permissions.every(p => validPermissions.includes(p))) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'permissions must be an array of valid permission strings',
      });
    }

    // Validate spending limits
    if (!spending_limits.per_transaction || !spending_limits.daily || !spending_limits.monthly) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'spending_limits must include per_transaction, daily, and monthly',
      });
    }

    // Find pairing code
    const pairingCode = await prisma.pairingCode.findUnique({
      where: { code: pairing_code },
      include: { user: true },
    });

    if (!pairingCode) {
      return res.status(404).json({
        error: 'not_found',
        error_description: 'Pairing code not found',
      });
    }

    if (pairingCode.status !== 'active') {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Pairing code has already been used',
      });
    }

    if (pairingCode.expiresAt < new Date()) {
      await prisma.pairingCode.update({
        where: { id: pairingCode.id },
        data: { status: 'expired' },
      });
      return res.status(400).json({
        error: 'expired',
        error_description: 'Pairing code has expired',
      });
    }

    // Check if there's already an access request for this pairing code
    const existingRequest = await prisma.accessRequest.findUnique({
      where: { pairingCodeId: pairingCode.id },
    });

    if (existingRequest) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'An access request already exists for this pairing code',
      });
    }

    // Parse spending limits
    let perTransaction: Decimal;
    let daily: Decimal;
    let monthly: Decimal;
    try {
      perTransaction = new Decimal(spending_limits.per_transaction);
      daily = new Decimal(spending_limits.daily);
      monthly = new Decimal(spending_limits.monthly);

      if (perTransaction.lessThanOrEqualTo(0) || daily.lessThanOrEqualTo(0) || monthly.lessThanOrEqualTo(0)) {
        throw new Error('Limits must be positive');
      }
    } catch {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'spending_limits must contain positive numeric values',
      });
    }

    // Create access request (24 hour expiry)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const accessRequest = await prisma.accessRequest.create({
      data: {
        pairingCodeId: pairingCode.id,
        agentName: agent_name,
        agentDescription: description,
        requestedPermissions: permissions,
        requestedPerTransaction: perTransaction,
        requestedDailyLimit: daily,
        requestedMonthlyLimit: monthly,
        requestedCurrency: spending_limits.currency || 'CAD',
        deliveryMethod: delivery,
        expiresAt,
      },
    });

    // Send push notification to user
    if (delivery === 'push') {
      try {
        await sendNotificationToUser(
          pairingCode.userId,
          'agent.access_request',
          {
            title: `${agent_name} wants wallet access`,
            body: 'Tap to review permissions and approve',
            data: {
              type: 'agent.access_request',
              screen: 'AgentAccessRequest',
              params: { accessRequestId: accessRequest.id },
              access_request_id: accessRequest.id,
              agent_name,
              requested_permissions: permissions,
              expires_at: expiresAt.toISOString(),
            },
          },
          accessRequest.id
        );
      } catch (notifError) {
        console.error('[Access Request] Failed to send notification:', notifError);
        // Continue - request still created
      }
    }

    console.log(`[Access Request] Created request ${accessRequest.id} for pairing code ${pairing_code}`);

    const response: Record<string, unknown> = {
      request_id: accessRequest.id,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      poll_url: `${env.APP_URL}/api/agent/v1/access-request/${accessRequest.id}`,
    };

    // If QR delivery, include QR data
    if (delivery === 'qr') {
      response.qr_data = `wsim://access-request/${accessRequest.id}`;
      response.qr_url = `${env.APP_URL}/m/access-request/${accessRequest.id}`;
    }

    return res.status(201).json(response);
  } catch (error) {
    console.error('[Access Request] Create error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

/**
 * GET /api/agent/v1/access-request/:requestId
 * Agent polls for access request status
 */
agentAccessRequestRouter.get('/:requestId', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;

    const request = await prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: {
        agent: true,
      },
    });

    if (!request) {
      return res.status(404).json({
        error: 'not_found',
        error_description: 'Access request not found',
      });
    }

    // Check if expired
    if (request.status === 'pending' && request.expiresAt < new Date()) {
      await prisma.accessRequest.update({
        where: { id: request.id },
        data: { status: 'expired' },
      });
      request.status = 'expired';
    }

    const baseResponse = {
      request_id: request.id,
      status: request.status,
      expires_at: request.expiresAt.toISOString(),
    };

    if (request.status === 'pending') {
      return res.json({
        ...baseResponse,
        time_remaining_seconds: Math.max(0, Math.floor((request.expiresAt.getTime() - Date.now()) / 1000)),
      });
    }

    if (request.status === 'approved' && request.agent) {
      // Generate client secret for the agent (one-time retrieval)
      // Note: We need to regenerate the secret since we can't retrieve the hashed one
      const clientSecret = generateAgentClientSecret();
      const clientSecretHash = await hashClientSecret(clientSecret);

      // Update the agent with the new secret
      await prisma.agent.update({
        where: { id: request.agent.id },
        data: { clientSecretHash },
      });

      return res.json({
        ...baseResponse,
        credentials: {
          client_id: request.agent.clientId,
          client_secret: clientSecret,
          token_endpoint: `${env.APP_URL}/api/agent/v1/oauth/token`,
        },
        agent_id: request.agent.id,
        permissions: request.grantedPermissions || request.requestedPermissions,
        spending_limits: {
          per_transaction: (request.grantedPerTransaction || request.requestedPerTransaction).toString(),
          daily: (request.grantedDailyLimit || request.requestedDailyLimit).toString(),
          monthly: (request.grantedMonthlyLimit || request.requestedMonthlyLimit).toString(),
          currency: request.requestedCurrency,
        },
        approved_at: request.resolvedAt?.toISOString(),
      });
    }

    if (request.status === 'rejected' || request.status === 'expired') {
      return res.json({
        ...baseResponse,
        reason: request.rejectionReason || (request.status === 'expired' ? 'Request expired' : undefined),
        rejected_at: request.resolvedAt?.toISOString(),
      });
    }

    return res.json(baseResponse);
  } catch (error) {
    console.error('[Access Request] Poll error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

/**
 * GET /api/agent/v1/access-request/:requestId/qr
 * Get QR code data for display
 */
agentAccessRequestRouter.get('/:requestId/qr', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;

    const request = await prisma.accessRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      return res.status(404).json({
        error: 'not_found',
        error_description: 'Access request not found',
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: `Access request is ${request.status}`,
      });
    }

    if (request.expiresAt < new Date()) {
      return res.status(400).json({
        error: 'expired',
        error_description: 'Access request has expired',
      });
    }

    return res.json({
      request_id: request.id,
      qr_data: `wsim://access-request/${request.id}`,
      qr_url: `${env.APP_URL}/m/access-request/${request.id}`,
      expires_at: request.expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('[Access Request] QR error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

export default { mobileAccessRequestRouter, agentAccessRequestRouter };
