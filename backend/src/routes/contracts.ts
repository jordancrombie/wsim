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
import {
  fetchAccounts,
  refreshBsimToken,
  BsimProviderConfig,
} from '../services/bsim-oidc';
import { decrypt, encrypt } from '../utils/crypto';

const router = Router();

// Parse BSIM providers from environment
function getBsimProviders(): BsimProviderConfig[] {
  try {
    return JSON.parse(env.BSIM_PROVIDERS);
  } catch {
    console.warn('[Contracts] Failed to parse BSIM_PROVIDERS');
    return [];
  }
}

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

// =============================================================================
// RESPONSE TRANSFORMERS (ContractSim snake_case → Mobile camelCase)
// =============================================================================

interface ContractSimParty {
  wallet_id: string;
  bank_id?: string;
  display_name: string;
  role: string;
  stake: string;
  accepted: boolean;
  accepted_at?: string;
  funded: boolean;
  funded_at?: string;
  escrow_id?: string;
}

interface ContractSimCondition {
  index: number;
  oracle_id: string;
  event_type: string;
  event_id: string;
  predicate: {
    field: string;
    operator: string;
    value: string;
  };
  status: string;
  result?: boolean;
}

interface ContractSimListParty {
  wallet_id: string;
  display_name: string;
  role: string;
}

interface ContractSimListItem {
  contract_id: string;
  type: string;
  status: string;
  title: string;
  total_pot: string;
  currency: string;
  parties_count: number;
  parties: ContractSimListParty[];
  expires_at: string;
  created_at: string;
}

interface ContractSimDetail {
  contract_id: string;
  type: string;
  status: string;
  title: string;
  description?: string;
  total_pot: string;
  currency: string;
  escrow_type: string;
  settlement_type: string;
  parties: ContractSimParty[];
  conditions: ContractSimCondition[];
  expires_at: string;
  funding_deadline: string;
  created_at: string;
  accepted_at?: string;
  funded_at?: string;
  resolved_at?: string;
  settled_at?: string;
}

interface ContractSimCreateResponse {
  contract_id: string;
  status: string;
  title: string;
  total_pot: string;
  currency: string;
  parties: ContractSimParty[];
  conditions_count: number;
  expires_at: string;
  funding_deadline: string;
  created_at: string;
}

/**
 * Transform ContractSim list item to mobile format
 */
function transformContractListItem(
  item: ContractSimListItem,
  userWalletId: string
): Record<string, unknown> {
  // Determine user's role and counterparty from parties array
  let myRole = 'creator';
  let counterpartyName = 'Unknown';

  if (item.parties && item.parties.length >= 2) {
    const myParty = item.parties.find(p => p.wallet_id === userWalletId);
    const counterparty = item.parties.find(p => p.wallet_id !== userWalletId);

    if (myParty) {
      myRole = myParty.role;
    }
    if (counterparty) {
      counterpartyName = counterparty.display_name || 'Unknown';
    }
  }

  return {
    id: item.contract_id,
    type: item.type,
    status: item.status,
    title: item.title,
    totalPot: parseFloat(item.total_pot),
    currency: item.currency,
    myRole,
    counterpartyName,
    expiresAt: item.expires_at,
    createdAt: item.created_at,
  };
}

/**
 * Transform ContractSim party to mobile format
 */
function transformParty(party: ContractSimParty): Record<string, unknown> {
  return {
    id: party.wallet_id,
    walletId: party.wallet_id,
    bankId: party.bank_id,
    role: party.role,
    displayName: party.display_name,
    stake: {
      amount: parseFloat(party.stake),
      currency: 'CAD',
    },
    accepted: party.accepted,
    acceptedAt: party.accepted_at,
    funded: party.funded,
    fundedAt: party.funded_at,
    escrowId: party.escrow_id,
  };
}

/**
 * Transform ContractSim condition to mobile format
 */
function transformCondition(condition: ContractSimCondition): Record<string, unknown> {
  return {
    index: condition.index,
    oracleId: condition.oracle_id,
    eventType: condition.event_type,
    eventId: condition.event_id,
    predicate: condition.predicate,
    status: condition.status,
    result: condition.result,
  };
}

/**
 * Transform ContractSim contract detail to mobile format
 */
function transformContractDetail(
  contract: ContractSimDetail,
  userWalletId: string
): Record<string, unknown> {
  const parties = contract.parties.map(transformParty);
  const conditions = contract.conditions.map(transformCondition);

  // Determine user's role and counterparty
  const myParty = contract.parties.find(p => p.wallet_id === userWalletId);
  const counterparty = contract.parties.find(p => p.wallet_id !== userWalletId);
  const myRole = myParty?.role || 'creator';

  // Generate conditions summary
  const conditionsSummary = conditions.length > 0
    ? `${conditions.length} condition${conditions.length > 1 ? 's' : ''}`
    : undefined;

  return {
    id: contract.contract_id,
    type: contract.type,
    status: contract.status,
    title: contract.title,
    description: contract.description,
    parties,
    conditions,
    escrowType: contract.escrow_type,
    settlementType: contract.settlement_type,
    totalPot: parseFloat(contract.total_pot),
    currency: contract.currency,
    createdAt: contract.created_at,
    acceptedAt: contract.accepted_at,
    fundedAt: contract.funded_at,
    resolvedAt: contract.resolved_at,
    settledAt: contract.settled_at,
    expiresAt: contract.expires_at,
    fundingDeadline: contract.funding_deadline,
    myRole,
    counterparty: counterparty ? transformParty(counterparty) : undefined,
    conditionsSummary,
  };
}

/**
 * Transform ContractSim create response to mobile format
 */
function transformCreateResponse(
  response: ContractSimCreateResponse,
  userWalletId: string
): Record<string, unknown> {
  const parties = response.parties.map(transformParty);
  const myParty = response.parties.find(p => p.wallet_id === userWalletId);
  const counterparty = response.parties.find(p => p.wallet_id !== userWalletId);

  return {
    id: response.contract_id,
    status: response.status,
    title: response.title,
    totalPot: parseFloat(response.total_pot),
    currency: response.currency,
    parties,
    expiresAt: response.expires_at,
    fundingDeadline: response.funding_deadline,
    createdAt: response.created_at,
    myRole: myParty?.role || 'creator',
    counterparty: counterparty ? transformParty(counterparty) : undefined,
  };
}

/**
 * Resolve alias to user info (walletId, bankId, displayName)
 *
 * Resolution strategy:
 * 1. Try local email lookup (backwards compatibility for email-based aliases)
 * 2. If not found, call TransferSim's internal alias API
 * 3. Use returned userId + bsimId to find user via BsimEnrollment
 *
 * @param alias - User alias (@username, email, etc.)
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

  // Strategy 1: Try local email lookup first (backwards compatibility)
  const userByEmail = await prisma.walletUser.findFirst({
    where: {
      OR: [
        { email: cleanAlias },                      // Full email address
        { email: `${cleanAlias}@banksim.ca` },      // @username -> username@banksim.ca
        { email: `${cleanAlias}@example.com` },     // Allow short usernames in dev
        { email: { startsWith: `${cleanAlias}@` } }, // Match any email starting with the alias
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

  if (userByEmail) {
    console.log(`[resolveAlias] Found user by email lookup: ${userByEmail.walletId}`);
    return {
      found: true,
      walletId: userByEmail.walletId,
      bankId: userByEmail.enrollments[0]?.bsimId || 'bsim',
      displayName: getDisplayName(userByEmail),
      userId: userByEmail.id,
    };
  }

  // Strategy 2: Call TransferSim's internal alias API
  console.log(`[resolveAlias] Email lookup failed, trying TransferSim for alias: ${alias}`);

  try {
    const transferSimUrl = `${env.TRANSFERSIM_API_URL}/api/internal/aliases/resolve`;
    const response = await fetch(transferSimUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': env.TRANSFERSIM_API_KEY,
      },
      body: JSON.stringify({ alias }),
    });

    if (!response.ok) {
      console.log(`[resolveAlias] TransferSim alias lookup failed: ${response.status}`);
      return { found: false };
    }

    const aliasData = await response.json() as {
      found: boolean;
      userId?: string;      // BSIM user ID (fiUserRef)
      bsimId?: string;      // Bank ID
      displayName?: string;
    };

    if (!aliasData.found || !aliasData.userId || !aliasData.bsimId) {
      console.log(`[resolveAlias] TransferSim alias not found or incomplete`);
      return { found: false };
    }

    console.log(`[resolveAlias] TransferSim found alias: userId=${aliasData.userId}, bsimId=${aliasData.bsimId}`);

    // Strategy 3: Look up WSIM user via BsimEnrollment
    const enrollment = await prisma.bsimEnrollment.findFirst({
      where: {
        fiUserRef: aliasData.userId,
        bsimId: aliasData.bsimId,
      },
      include: {
        user: {
          select: {
            id: true,
            walletId: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!enrollment?.user) {
      console.log(`[resolveAlias] No WSIM enrollment found for TransferSim user`);
      return { found: false };
    }

    console.log(`[resolveAlias] Found WSIM user via enrollment: ${enrollment.user.walletId}`);
    return {
      found: true,
      walletId: enrollment.user.walletId,
      bankId: aliasData.bsimId,
      displayName: aliasData.displayName || getDisplayName(enrollment.user),
      userId: enrollment.user.id,
    };
  } catch (error) {
    console.error(`[resolveAlias] TransferSim API error:`, error);
    return { found: false };
  }
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

    // Transform response to mobile format
    const data = result.data as { contracts: ContractSimListItem[]; total: number };
    const contracts = (data.contracts || []).map(c => transformContractListItem(c, user.walletId));

    return res.json({
      contracts,
      total: data.total || contracts.length,
    });
  } catch (error) {
    console.error(`[Contracts:${requestId}] List contracts error:`, error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to list contracts',
    });
  }
});

/**
 * GET /api/mobile/contracts/events
 *
 * Get available oracle events for contract creation.
 * Proxies to ContractSim's oracle events endpoint.
 */
router.get('/events', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { userId } = req;
    console.log(`[Contracts:${requestId}] Get contract events for userId=${userId}`);

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

    // Proxy to ContractSim oracles endpoint
    const result = await callContractSim('GET', '/oracles/test/events/upcoming', user.walletId);

    if (!result.ok) {
      console.error(`[Contracts:${requestId}] ContractSim error:`, result.data);
      return res.status(result.status).json(result.data);
    }

    // Transform response to mobile format
    const data = result.data as { oracle_id?: string; events?: any[] };
    const events = data.events || [];
    return res.json({
      events: events.map((e: any) => ({
        oracle: data.oracle_id || 'test_oracle',
        event_id: e.event_id,
        title: e.title,
        teams: e.teams,
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        status: e.status,
      })),
    });
  } catch (error) {
    console.error(`[Contracts:${requestId}] Get events error:`, error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get events',
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

    // Transform response to mobile format
    const contract = transformContractDetail(result.data as ContractSimDetail, user.walletId);
    return res.json(contract);
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
    // Support both camelCase (mobile) and snake_case field names
    const {
      type,
      counterparty_alias,
      counterpartyAlias,
      title,
      description,
      event,
      my_stake,
      myStake,
      their_stake,
      theirStake,
      expires_in_hours,
      expiresInHours,
    } = req.body as {
      type: string;
      counterparty_alias?: string;
      counterpartyAlias?: string;
      title?: string;
      description?: string;
      event: {
        oracle: string;
        event_id?: string;
        eventId?: string;
        my_prediction?: string;
        myPrediction?: string;
      };
      my_stake?: number;
      myStake?: number;
      their_stake?: number;
      theirStake?: number;
      expires_in_hours?: number;
      expiresInHours?: number;
    };

    // Normalize to snake_case for internal use
    const counterpartyAliasNorm = counterparty_alias || counterpartyAlias;
    const myStakeNorm = my_stake ?? myStake;
    const theirStakeNorm = their_stake ?? theirStake;
    const expiresInHoursNorm = expires_in_hours ?? expiresInHours;
    const eventIdNorm = event?.event_id || event?.eventId;
    const myPredictionNorm = event?.my_prediction || event?.myPrediction;

    console.log(`[Contracts:${requestId}] Create contract for userId=${userId}`);
    console.log(`[Contracts:${requestId}] Counterparty alias: ${counterpartyAliasNorm}`);

    // Validate required fields
    if (!type || !counterpartyAliasNorm || !event || !myStakeNorm || !theirStakeNorm) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Missing required fields: type, counterpartyAlias, event, myStake, theirStake',
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
    const counterparty = await resolveAlias(counterpartyAliasNorm!);

    if (!counterparty.found) {
      return res.status(404).json({
        error: 'counterparty_not_found',
        message: `Could not find user with alias: ${counterpartyAliasNorm}`,
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
    const expiresAt = new Date(Date.now() + (expiresInHoursNorm || 24) * 60 * 60 * 1000).toISOString();

    // ContractSim expects camelCase field names and uppercase enums
    const contractSimPayload = {
      type: type.toUpperCase(), // WAGER, ESCROW
      title: title || `${type} with ${counterparty.displayName}`,
      description,
      parties: [
        {
          walletId: creator.walletId,
          bankId: creator.enrollments[0]?.bsimId || 'bsim',
          displayName: getDisplayName(creator),
          role: 'CREATOR',
          stakeAmount: myStakeNorm,
        },
        {
          walletId: counterparty.walletId,
          bankId: counterparty.bankId,
          displayName: counterparty.displayName,
          role: 'COUNTERPARTY',
          stakeAmount: theirStakeNorm,
        },
      ],
      conditions: [
        {
          oracleId: event.oracle,
          eventType: 'game_outcome',
          eventId: eventIdNorm,
          predicateField: 'winner',
          predicateOperator: 'EQUALS',
          predicateValue: myPredictionNorm,
        },
      ],
      escrowType: 'FULL',
      settlementType: 'WINNER_TAKES_ALL',
      expiresAt: expiresAt,
      fundingDeadline: expiresAt,
    };

    console.log(`[Contracts:${requestId}] Sending to ContractSim:`, JSON.stringify(contractSimPayload, null, 2));

    // Proxy to ContractSim
    const result = await callContractSim('POST', '/contracts', creator.walletId, contractSimPayload);

    if (!result.ok) {
      console.error(`[Contracts:${requestId}] ContractSim error:`, result.data);
      return res.status(result.status).json(result.data);
    }

    // Transform response to mobile format
    const contract = transformCreateResponse(result.data as ContractSimCreateResponse, creator.walletId);
    console.log(`[Contracts:${requestId}] Contract created successfully: ${contract.id}`);
    return res.status(201).json(contract);
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
 * If account_id is not provided, fetches user's first account from BSIM.
 */
router.post('/:contractId/fund', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { userId } = req;
    const { contractId } = req.params;
    const { account_id } = req.body as { account_id?: string };

    console.log(`[Contracts:${requestId}] Fund contract ${contractId} for userId=${userId}, account_id=${account_id || 'not provided'}`);

    // Get user's walletId and enrollment details including tokens for account fetch
    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      select: {
        walletId: true,
        enrollments: {
          select: {
            id: true,
            bsimId: true,
            fiUserRef: true,
            accessToken: true,
            refreshToken: true,
            credentialExpiry: true,
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

    const enrollment = user.enrollments[0];
    let accountId = account_id;

    // If no account_id provided, fetch user's accounts from BSIM
    if (!accountId) {
      console.log(`[Contracts:${requestId}] No account_id provided, fetching from BSIM...`);

      const providers = getBsimProviders();
      const provider = providers.find(p => p.bsimId === enrollment.bsimId);

      if (!provider) {
        return res.status(400).json({
          error: 'provider_not_found',
          message: `Bank provider ${enrollment.bsimId} not configured`,
        });
      }

      if (!enrollment.accessToken) {
        return res.status(400).json({
          error: 'no_access_token',
          message: 'Bank re-enrollment required to fund contracts',
        });
      }

      let accessToken = decrypt(enrollment.accessToken);

      // Check if token is expired and refresh if needed
      if (enrollment.credentialExpiry && new Date() > enrollment.credentialExpiry) {
        console.log(`[Contracts:${requestId}] Access token expired, attempting refresh...`);

        if (enrollment.refreshToken) {
          const refreshResult = await refreshBsimToken(provider, decrypt(enrollment.refreshToken));

          if (refreshResult) {
            // Update stored tokens
            await prisma.bsimEnrollment.update({
              where: { id: enrollment.id },
              data: {
                accessToken: encrypt(refreshResult.accessToken),
                refreshToken: encrypt(refreshResult.refreshToken),
                credentialExpiry: new Date(Date.now() + refreshResult.expiresIn * 1000),
              },
            });
            accessToken = refreshResult.accessToken;
            console.log(`[Contracts:${requestId}] Token refreshed successfully`);
          } else {
            return res.status(400).json({
              error: 'token_refresh_failed',
              message: 'Please re-enroll with your bank to fund contracts',
            });
          }
        } else {
          return res.status(400).json({
            error: 'token_expired',
            message: 'Please re-enroll with your bank to fund contracts',
          });
        }
      }

      // Fetch accounts from BSIM
      try {
        const accounts = await fetchAccounts(provider, accessToken);
        console.log(`[Contracts:${requestId}] Fetched ${accounts.length} accounts from BSIM`);

        if (accounts.length === 0) {
          return res.status(400).json({
            error: 'no_accounts',
            message: 'No bank accounts available for funding',
          });
        }

        // Use the first account
        accountId = accounts[0].accountId;
        console.log(`[Contracts:${requestId}] Using account ${accountId}`);
      } catch (fetchError) {
        console.error(`[Contracts:${requestId}] Failed to fetch accounts:`, fetchError);
        return res.status(400).json({
          error: 'account_fetch_failed',
          message: 'Failed to fetch bank accounts. Please try again.',
        });
      }
    }

    // Proxy to ContractSim - it orchestrates escrow creation with BSIM
    const result = await callContractSim('POST', `/contracts/${contractId}/fund`, user.walletId, {
      account_id: accountId,
      bsim_user_id: enrollment.fiUserRef,
    });

    if (!result.ok) {
      console.error(`[Contracts:${requestId}] ContractSim error:`, result.data);
      return res.status(result.status).json(result.data);
    }

    console.log(`[Contracts:${requestId}] Contract funding initiated with account ${accountId}`);
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
