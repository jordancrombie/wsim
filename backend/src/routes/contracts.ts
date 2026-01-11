/**
 * Contracts API Routes
 *
 * Proxy endpoints for ContractSim integration.
 * WSIM acts as the intermediary between mwsim (mobile) and ContractSim.
 *
 * Mobile API endpoints (JWT auth):
 * - GET    /api/mobile/contracts           - List user's contracts
 * - GET    /api/mobile/contracts/:id       - Get contract details
 * - POST   /api/mobile/contracts           - Create new contract
 * - POST   /api/mobile/contracts/:id/accept - Accept contract invitation
 * - POST   /api/mobile/contracts/:id/fund   - Fund contract (trigger escrow)
 * - POST   /api/mobile/contracts/:id/cancel - Cancel contract
 *
 * Internal API endpoints (X-Internal-Api-Key auth):
 * - GET    /api/internal/contracts/profile/:walletId - Get profile by walletId
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { env } from '../config/env';
import {
  generateInitialsColor,
  generateInitials,
} from '../services/image-upload';

const router = Router();

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================

interface MobileAccessTokenPayload {
  sub: string;
  iss: string;
  aud: string;
  deviceId: string;
  type: 'access';
}

interface AuthenticatedRequest extends Request {
  userId?: string;
  deviceId?: string;
}

function verifyMobileToken(token: string): MobileAccessTokenPayload | null {
  try {
    const payload = jwt.verify(token, env.MOBILE_JWT_SECRET) as MobileAccessTokenPayload;
    if (payload.type !== 'access') {
      return null;
    }
    return payload;
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

  if (!payload) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid or expired access token',
    });
  }

  req.userId = payload.sub;
  req.deviceId = payload.deviceId;
  next();
}

/**
 * Middleware to verify internal API key for ContractSim communication
 */
async function requireInternalApiKey(req: Request, res: Response, next: () => void) {
  const apiKey = req.headers['x-internal-api-key'] as string;

  if (!apiKey) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'X-Internal-Api-Key header is required',
    });
  }

  if (apiKey !== env.INTERNAL_API_SECRET) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid internal API key',
    });
  }

  next();
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate display name from first/last name if not set
 */
function getDisplayName(user: { displayName: string | null; firstName: string | null; lastName: string | null }): string {
  if (user.displayName) {
    return user.displayName;
  }
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User';
}

/**
 * Resolve alias to user info (walletId, bankId, displayName)
 * Supports @username format
 */
async function resolveAlias(alias: string): Promise<{
  found: boolean;
  walletId?: string;
  bankId?: string;
  displayName?: string;
  userId?: string;
}> {
  // Strip @ prefix if present
  const cleanAlias = alias.startsWith('@') ? alias.slice(1) : alias;

  // For now, try to find user by email (future: add username/phone support)
  const user = await prisma.walletUser.findFirst({
    where: {
      OR: [
        { email: cleanAlias },
        { email: `${cleanAlias}@example.com` }, // Allow short usernames in dev
      ],
    },
    select: {
      id: true,
      walletId: true,
      displayName: true,
      firstName: true,
      lastName: true,
      enrollments: {
        select: {
          bsimId: true,
        },
        take: 1,
      },
    },
  });

  if (!user) {
    return { found: false };
  }

  return {
    found: true,
    walletId: user.walletId,
    bankId: user.enrollments[0]?.bsimId || 'bsim',
    displayName: getDisplayName(user),
    userId: user.id,
  };
}

/**
 * Call ContractSim API
 */
async function callContractSim(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  walletId: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${env.CONTRACTSIM_API_URL}${path}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.CONTRACTSIM_API_KEY,
        'X-Wallet-Id': walletId,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    console.error(`[Contracts] ContractSim API call failed: ${method} ${path}`, error);
    return { ok: false, status: 500, data: { error: 'contractsim_unavailable' } };
  }
}

// =============================================================================
// MOBILE API ENDPOINTS
// =============================================================================

/**
 * GET /api/mobile/contracts
 *
 * List user's contracts.
 * Query params: ?status=active,proposed (comma-separated)
 */
router.get('/', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { userId } = req;
    const { status } = req.query as { status?: string };

    console.log(`[Contracts:${requestId}] List contracts for userId=${userId}, status=${status}`);

    // Get user's walletId
    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      select: { walletId: true },
    });

    if (!user) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User not found',
      });
    }

    // Proxy to ContractSim
    const queryParams = status ? `?wallet_id=${user.walletId}&status=${status}` : `?wallet_id=${user.walletId}`;
    const result = await callContractSim('GET', `/contracts${queryParams}`, user.walletId);

    if (!result.ok) {
      console.error(`[Contracts:${requestId}] ContractSim error:`, result.data);
      return res.status(result.status).json(result.data);
    }

    return res.json(result.data);
  } catch (error) {
    console.error(`[Contracts:${requestId}] List contracts error:`, error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to list contracts',
    });
  }
});

/**
 * GET /api/mobile/contracts/:contractId
 *
 * Get contract details.
 */
router.get('/:contractId', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { userId } = req;
    const { contractId } = req.params;

    console.log(`[Contracts:${requestId}] Get contract ${contractId} for userId=${userId}`);

    // Get user's walletId
    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      select: { walletId: true },
    });

    if (!user) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User not found',
      });
    }

    // Proxy to ContractSim
    const result = await callContractSim('GET', `/contracts/${contractId}`, user.walletId);

    if (!result.ok) {
      console.error(`[Contracts:${requestId}] ContractSim error:`, result.data);
      return res.status(result.status).json(result.data);
    }

    return res.json(result.data);
  } catch (error) {
    console.error(`[Contracts:${requestId}] Get contract error:`, error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get contract',
    });
  }
});

/**
 * POST /api/mobile/contracts
 *
 * Create new contract.
 * WSIM resolves counterparty alias and enriches with profile data before proxying.
 */
router.post('/', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { userId } = req;
    const {
      type,
      counterparty_alias,
      title,
      description,
      event,
      my_stake,
      their_stake,
      expires_in_hours,
    } = req.body as {
      type: string;
      counterparty_alias: string;
      title?: string;
      description?: string;
      event: {
        oracle: string;
        event_id: string;
        my_prediction: string;
      };
      my_stake: number;
      their_stake: number;
      expires_in_hours?: number;
    };

    console.log(`[Contracts:${requestId}] Create contract for userId=${userId}`);
    console.log(`[Contracts:${requestId}] Counterparty alias: ${counterparty_alias}`);

    // Validate required fields
    if (!type || !counterparty_alias || !event || !my_stake || !their_stake) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Missing required fields: type, counterparty_alias, event, my_stake, their_stake',
      });
    }

    // Get creator's info
    const creator = await prisma.walletUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        walletId: true,
        displayName: true,
        firstName: true,
        lastName: true,
        enrollments: {
          select: { bsimId: true },
          take: 1,
        },
      },
    });

    if (!creator) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User not found',
      });
    }

    // Resolve counterparty alias
    const counterparty = await resolveAlias(counterparty_alias);

    if (!counterparty.found) {
      return res.status(404).json({
        error: 'counterparty_not_found',
        message: `Could not find user with alias: ${counterparty_alias}`,
      });
    }

    // Prevent self-contracts
    if (counterparty.walletId === creator.walletId) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Cannot create a contract with yourself',
      });
    }

    // Build ContractSim request with enriched party data
    const expiresAt = new Date(Date.now() + (expires_in_hours || 24) * 60 * 60 * 1000).toISOString();

    const contractSimPayload = {
      type,
      title: title || `${type} with ${counterparty.displayName}`,
      description,
      parties: [
        {
          wallet_id: creator.walletId,
          bank_id: creator.enrollments[0]?.bsimId || 'bsim',
          display_name: getDisplayName(creator),
          role: 'creator',
          stake: { amount: my_stake, currency: 'CAD' },
        },
        {
          wallet_id: counterparty.walletId,
          bank_id: counterparty.bankId,
          display_name: counterparty.displayName,
          role: 'counterparty',
          stake: { amount: their_stake, currency: 'CAD' },
        },
      ],
      conditions: [
        {
          oracle_id: event.oracle,
          event_type: 'game_outcome',
          event_id: event.event_id,
          predicate: {
            field: 'winner',
            operator: 'equals',
            value: event.my_prediction,
          },
        },
      ],
      escrow_type: 'full',
      settlement_type: 'winner_takes_all',
      expires_at: expiresAt,
      funding_deadline: expiresAt,
    };

    console.log(`[Contracts:${requestId}] Sending to ContractSim:`, JSON.stringify(contractSimPayload, null, 2));

    // Proxy to ContractSim
    const result = await callContractSim('POST', '/contracts', creator.walletId, contractSimPayload);

    if (!result.ok) {
      console.error(`[Contracts:${requestId}] ContractSim error:`, result.data);
      return res.status(result.status).json(result.data);
    }

    console.log(`[Contracts:${requestId}] Contract created successfully`);
    return res.status(201).json(result.data);
  } catch (error) {
    console.error(`[Contracts:${requestId}] Create contract error:`, error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to create contract',
    });
  }
});

/**
 * POST /api/mobile/contracts/:contractId/accept
 *
 * Accept contract invitation.
 */
router.post('/:contractId/accept', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { userId } = req;
    const { contractId } = req.params;
    const { consent } = req.body as { consent?: boolean };

    console.log(`[Contracts:${requestId}] Accept contract ${contractId} for userId=${userId}`);

    if (consent !== true) {
      return res.status(400).json({
        error: 'consent_required',
        message: 'consent: true is required to accept a contract',
      });
    }

    // Get user's walletId
    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      select: { walletId: true },
    });

    if (!user) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User not found',
      });
    }

    // Proxy to ContractSim
    const result = await callContractSim('POST', `/contracts/${contractId}/accept`, user.walletId, {
      party_id: user.walletId,
      consent_timestamp: new Date().toISOString(),
    });

    if (!result.ok) {
      console.error(`[Contracts:${requestId}] ContractSim error:`, result.data);
      return res.status(result.status).json(result.data);
    }

    console.log(`[Contracts:${requestId}] Contract accepted successfully`);
    return res.json(result.data);
  } catch (error) {
    console.error(`[Contracts:${requestId}] Accept contract error:`, error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to accept contract',
    });
  }
});

/**
 * POST /api/mobile/contracts/:contractId/fund
 *
 * Fund contract (trigger escrow hold).
 */
router.post('/:contractId/fund', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { userId } = req;
    const { contractId } = req.params;
    const { account_id } = req.body as { account_id?: string };

    console.log(`[Contracts:${requestId}] Fund contract ${contractId} for userId=${userId}`);

    // Get user's walletId and verify they have a BSIM enrollment
    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      select: {
        walletId: true,
        enrollments: {
          select: {
            bsimId: true,
            fiUserRef: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User not found',
      });
    }

    if (user.enrollments.length === 0) {
      return res.status(400).json({
        error: 'no_bank_linked',
        message: 'No bank account linked. Please enroll with a bank first.',
      });
    }

    // Proxy to ContractSim - it will coordinate with BSIM for escrow
    const result = await callContractSim('POST', `/contracts/${contractId}/fund`, user.walletId, {
      party_id: user.walletId,
      bank_id: user.enrollments[0].bsimId,
      account_id: account_id || 'default',
    });

    if (!result.ok) {
      console.error(`[Contracts:${requestId}] ContractSim error:`, result.data);
      return res.status(result.status).json(result.data);
    }

    console.log(`[Contracts:${requestId}] Contract funding initiated`);
    return res.json(result.data);
  } catch (error) {
    console.error(`[Contracts:${requestId}] Fund contract error:`, error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to fund contract',
    });
  }
});

/**
 * POST /api/mobile/contracts/:contractId/cancel
 *
 * Cancel contract (only before funding).
 */
router.post('/:contractId/cancel', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { userId } = req;
    const { contractId } = req.params;

    console.log(`[Contracts:${requestId}] Cancel contract ${contractId} for userId=${userId}`);

    // Get user's walletId
    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      select: { walletId: true },
    });

    if (!user) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User not found',
      });
    }

    // Proxy to ContractSim
    const result = await callContractSim('POST', `/contracts/${contractId}/cancel`, user.walletId, {
      party_id: user.walletId,
    });

    if (!result.ok) {
      console.error(`[Contracts:${requestId}] ContractSim error:`, result.data);
      return res.status(result.status).json(result.data);
    }

    console.log(`[Contracts:${requestId}] Contract cancelled`);
    return res.json(result.data);
  } catch (error) {
    console.error(`[Contracts:${requestId}] Cancel contract error:`, error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to cancel contract',
    });
  }
});

// =============================================================================
// INTERNAL API ENDPOINTS (for ContractSim)
// =============================================================================

/**
 * Router for internal ContractSim API endpoints
 */
export const internalContractsRouter = Router();

/**
 * GET /api/internal/contracts/profile/:walletId
 *
 * Get user profile by walletId.
 * Used by ContractSim to fetch party display info.
 */
internalContractsRouter.get('/profile/:walletId', requireInternalApiKey, async (req: Request, res: Response) => {
  try {
    const { walletId } = req.params;

    if (!walletId) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'walletId parameter is required',
      });
    }

    // Find user by walletId
    const user = await prisma.walletUser.findUnique({
      where: { walletId },
      select: {
        id: true,
        walletId: true,
        displayName: true,
        firstName: true,
        lastName: true,
        profileImageUrl: true,
        initialsColor: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User not found for given walletId',
      });
    }

    const displayName = getDisplayName(user);

    return res.json({
      success: true,
      profile: {
        walletId: user.walletId,
        displayName,
        profileImageUrl: user.profileImageUrl || null,
        thumbnails: user.profileImageUrl
          ? {
              small: user.profileImageUrl.replace('/avatar.jpg', '/avatar_64.jpg'),
              medium: user.profileImageUrl.replace('/avatar.jpg', '/avatar_128.jpg'),
            }
          : null,
        initials: generateInitials(displayName),
        initialsColor: user.initialsColor || generateInitialsColor(user.id),
      },
    });
  } catch (error) {
    console.error('[Contracts Internal] Get profile error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get profile',
    });
  }
});

export default router;
