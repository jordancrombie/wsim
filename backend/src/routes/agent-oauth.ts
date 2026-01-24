/**
 * Agent OAuth Routes
 *
 * OAuth 2.0 endpoints for AI agent authentication.
 *
 * Routes:
 * - POST /api/agent/v1/oauth/device_authorization - Device Authorization Grant (RFC 8628)
 * - POST /api/agent/v1/oauth/token - Client credentials & device_code grants
 * - POST /api/agent/v1/oauth/introspect - Token introspection
 * - POST /api/agent/v1/oauth/revoke - Token revocation
 */

import { Router, Request, Response } from 'express';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database';
import { env } from '../config/env';
import {
  validateAgentCredentials,
  generateAgentAccessToken,
  storeAgentAccessToken,
  introspectAgentToken,
  verifyIntrospectionAuth,
  getTokenHash,
  revokeToken,
  verifyAgentAccessToken,
  generateAgentClientId,
  generateAgentClientSecret,
  hashClientSecret,
} from '../services/agent-auth';
import { getSpendingUsage } from '../services/spending-limits';
import { dispatchTokenRevoked } from '../services/webhook-dispatch';
import { sendNotificationToUser } from '../services/notification';

const router = Router();

// =============================================================================
// DEVICE AUTHORIZATION ENDPOINT (RFC 8628)
// =============================================================================

/**
 * Generate a user code in format: WSIM-XXXXXX-XXXXXX
 */
function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars (0, O, 1, I)
  const part1 = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const part2 = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `WSIM-${part1}-${part2}`;
}

/**
 * POST /api/agent/v1/oauth/device_authorization
 * OAuth 2.0 Device Authorization Grant (RFC 8628)
 *
 * Agents call this to initiate authorization. Returns a device_code for polling
 * and user_code for the user to enter in their mobile app.
 */
router.post('/device_authorization', async (req: Request, res: Response) => {
  try {
    const {
      scope,
      agent_name,
      agent_description,
      spending_limits,
    } = req.body;

    // agent_name is required for device authorization
    if (!agent_name) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'agent_name is required',
      });
    }

    // Parse scope into permissions (default to browse if not specified)
    const permissions = scope
      ? scope.split(' ').filter((s: string) => ['browse', 'cart', 'purchase', 'history'].includes(s))
      : ['browse'];

    if (permissions.length === 0) {
      return res.status(400).json({
        error: 'invalid_scope',
        error_description: 'At least one valid scope is required (browse, cart, purchase, history)',
      });
    }

    // Parse spending limits (use defaults if not provided)
    let perTransaction = new Decimal('50.00');
    let daily = new Decimal('200.00');
    let monthly = new Decimal('1000.00');
    let currency = 'CAD';

    if (spending_limits) {
      if (spending_limits.per_transaction) perTransaction = new Decimal(spending_limits.per_transaction);
      if (spending_limits.daily) daily = new Decimal(spending_limits.daily);
      if (spending_limits.monthly) monthly = new Decimal(spending_limits.monthly);
      if (spending_limits.currency) currency = spending_limits.currency;
    }

    // Generate unique user code (this is what the user will see/enter)
    let userCode: string;
    let attempts = 0;
    do {
      userCode = generateUserCode();
      const exists = await prisma.pairingCode.findUnique({ where: { code: userCode } });
      if (!exists) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      return res.status(500).json({
        error: 'server_error',
        error_description: 'Failed to generate unique code',
      });
    }

    // Device authorization requests expire in 15 minutes (shorter than pairing codes)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Create the device authorization record
    // We use pairingCode + accessRequest together but with 'device_authorization' delivery
    const result = await prisma.$transaction(async (tx) => {
      // Create pairing code (without user - will be claimed when user enters code)
      const pairingCode = await tx.pairingCode.create({
        data: {
          code: userCode,
          expiresAt,
          status: 'active',
          // No userId - this is device-initiated, user claims it
          userId: '', // Placeholder - will be updated when claimed
        },
      });

      // Create access request linked to the pairing code
      const accessRequest = await tx.accessRequest.create({
        data: {
          pairingCodeId: pairingCode.id,
          agentName: agent_name,
          agentDescription: agent_description,
          requestedPermissions: permissions,
          requestedPerTransaction: perTransaction,
          requestedDailyLimit: daily,
          requestedMonthlyLimit: monthly,
          requestedCurrency: currency,
          deliveryMethod: 'device_authorization',
          expiresAt,
          // Mark as 'pending_claim' until a user claims it
          status: 'pending_claim',
        },
      });

      return { pairingCode, accessRequest };
    });

    console.log(`[Device Auth] Created device authorization ${result.accessRequest.id}, user_code: ${userCode}`);

    // Return RFC 8628 compliant response
    return res.json({
      device_code: result.accessRequest.id,
      user_code: userCode,
      verification_uri: `${env.APP_URL}/m/device`,
      verification_uri_complete: `${env.APP_URL}/m/device?code=${encodeURIComponent(userCode)}`,
      expires_in: 900, // 15 minutes
      interval: 5, // Poll every 5 seconds
    });
  } catch (error) {
    console.error('[Device Auth] Error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

// =============================================================================
// TOKEN ENDPOINT
// =============================================================================

/**
 * POST /api/agent/v1/oauth/token
 * OAuth 2.0 token endpoint
 *
 * Supported grant types:
 * - client_credentials: Exchange client credentials for access token
 * - urn:ietf:params:oauth:grant-type:device_code: Device Authorization Grant (RFC 8628)
 */
router.post('/token', async (req: Request, res: Response) => {
  try {
    // Support both form-urlencoded and JSON
    const {
      grant_type,
      client_id,
      client_secret,
      device_code,
      scope,
    } = req.body;

    // Handle Device Authorization Grant (RFC 8628)
    if (grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
      return handleDeviceCodeGrant(req, res, device_code);
    }

    // Handle Client Credentials Grant
    if (grant_type !== 'client_credentials') {
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Supported grant types: client_credentials, urn:ietf:params:oauth:grant-type:device_code',
      });
    }

    // Validate required fields
    if (!client_id || !client_secret) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_id and client_secret are required',
      });
    }

    // Validate credentials
    const agent = await validateAgentCredentials(client_id, client_secret);

    if (!agent) {
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Invalid client credentials',
      });
    }

    // Check agent status
    if (agent.status === 'suspended') {
      return res.status(403).json({
        error: 'access_denied',
        error_description: 'Agent is suspended',
      });
    }

    if (agent.status === 'revoked') {
      return res.status(403).json({
        error: 'access_denied',
        error_description: 'Agent has been revoked',
      });
    }

    // Generate access token
    const { token, tokenHash, expiresAt } = generateAgentAccessToken(agent, scope);

    // Store token record for tracking/revocation
    await storeAgentAccessToken(agent.id, tokenHash, expiresAt, scope);

    console.log(`[Agent OAuth] Token issued for agent ${agent.clientId}`);

    // Return token response (RFC 6749)
    return res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      scope: scope || agent.permissions.join(' '),
    });
  } catch (error) {
    console.error('[Agent OAuth] Token error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

/**
 * Handle Device Authorization Grant token exchange (RFC 8628)
 */
async function handleDeviceCodeGrant(req: Request, res: Response, deviceCode: string) {
  if (!deviceCode) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'device_code is required',
    });
  }

  // Look up the access request
  const accessRequest = await prisma.accessRequest.findUnique({
    where: { id: deviceCode },
    include: {
      agent: true,
      pairingCode: true,
    },
  });

  if (!accessRequest) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid or expired device code',
    });
  }

  // Check expiration
  if (accessRequest.expiresAt < new Date()) {
    return res.status(400).json({
      error: 'expired_token',
      error_description: 'The device code has expired',
    });
  }

  // Handle different statuses per RFC 8628
  switch (accessRequest.status) {
    case 'pending_claim':
      // User hasn't entered the code yet
      return res.status(400).json({
        error: 'authorization_pending',
        error_description: 'User has not yet entered the code',
      });

    case 'pending':
      // User has claimed but not yet approved
      return res.status(400).json({
        error: 'authorization_pending',
        error_description: 'Authorization request is pending user approval',
      });

    case 'rejected':
      return res.status(400).json({
        error: 'access_denied',
        error_description: 'User denied the authorization request',
      });

    case 'expired':
      return res.status(400).json({
        error: 'expired_token',
        error_description: 'The authorization request has expired',
      });

    case 'approved':
      // Success! Return credentials
      if (!accessRequest.agent) {
        return res.status(500).json({
          error: 'server_error',
          error_description: 'Agent not found for approved request',
        });
      }

      // Generate new client secret (one-time retrieval)
      const clientSecret = generateAgentClientSecret();
      const clientSecretHash = await hashClientSecret(clientSecret);

      // Update the agent with the new secret
      await prisma.agent.update({
        where: { id: accessRequest.agent.id },
        data: { clientSecretHash },
      });

      console.log(`[Device Auth] Credentials issued for agent ${accessRequest.agent.clientId}`);

      // Return credentials (device code flow returns credentials, not tokens directly)
      return res.json({
        client_id: accessRequest.agent.clientId,
        client_secret: clientSecret,
        token_endpoint: `${env.APP_URL}/api/agent/v1/oauth/token`,
        permissions: accessRequest.grantedPermissions || accessRequest.requestedPermissions,
        spending_limits: {
          per_transaction: (accessRequest.grantedPerTransaction || accessRequest.requestedPerTransaction).toString(),
          daily: (accessRequest.grantedDailyLimit || accessRequest.requestedDailyLimit).toString(),
          monthly: (accessRequest.grantedMonthlyLimit || accessRequest.requestedMonthlyLimit).toString(),
          currency: accessRequest.requestedCurrency,
        },
      });

    default:
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: `Unknown authorization status: ${accessRequest.status}`,
      });
  }
}

// =============================================================================
// INTROSPECTION ENDPOINT
// =============================================================================

/**
 * POST /api/agent/v1/oauth/introspect
 * Token introspection endpoint (RFC 7662)
 *
 * For merchants (SSIM) to validate agent tokens and get agent context.
 * Requires Basic Auth with introspection credentials.
 */
router.post('/introspect', async (req: Request, res: Response) => {
  try {
    // Verify introspection credentials (Basic Auth)
    const authHeader = req.headers.authorization;

    if (!verifyIntrospectionAuth(authHeader)) {
      return res.status(401).json({
        error: 'unauthorized',
        error_description: 'Invalid introspection credentials',
      });
    }

    // Get token from request body
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'token parameter is required',
      });
    }

    // Introspect the token
    const result = await introspectAgentToken(token);

    // If active, add current spending usage
    if (result.active && result.agent_id) {
      const usage = await getSpendingUsage(result.agent_id);
      result.current_usage = {
        daily: usage.daily.toString(),
        monthly: usage.monthly.toString(),
      };
    }

    return res.json(result);
  } catch (error) {
    console.error('[Agent OAuth] Introspect error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

// =============================================================================
// REVOCATION ENDPOINT
// =============================================================================

/**
 * POST /api/agent/v1/oauth/revoke
 * Token revocation endpoint (RFC 7009)
 *
 * Agents can revoke their own tokens.
 */
router.post('/revoke', async (req: Request, res: Response) => {
  try {
    const { token, client_id, client_secret } = req.body;

    if (!token) {
      // Per RFC 7009, invalid tokens should return 200
      return res.status(200).json({ revoked: true });
    }

    // If credentials provided, verify they match the token's agent
    if (client_id && client_secret) {
      const agent = await validateAgentCredentials(client_id, client_secret);

      if (!agent) {
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Invalid client credentials',
        });
      }

      // Verify token belongs to this agent
      const payload = verifyAgentAccessToken(token);

      if (payload && payload.client_id !== client_id) {
        // Token doesn't belong to this client, but per RFC 7009, still return 200
        console.warn(`[Agent OAuth] Revoke attempt for token not owned by client ${client_id}`);
        return res.status(200).json({ revoked: true });
      }
    }

    // Get token payload for webhook dispatch (before revoking)
    const payload = verifyAgentAccessToken(token);

    // Revoke the token
    const tokenHash = getTokenHash(token);
    await revokeToken(tokenHash);

    console.log('[Agent OAuth] Token revoked');

    // Dispatch webhook notification (fire and forget)
    if (payload) {
      dispatchTokenRevoked(
        tokenHash,
        payload.sub,
        payload.client_id,
        'explicit_revocation'
      ).catch((err) => {
        console.error('[Agent OAuth] Webhook dispatch error:', err);
      });
    }

    return res.status(200).json({ revoked: true });
  } catch (error) {
    console.error('[Agent OAuth] Revoke error:', error);
    // Per RFC 7009, errors should still return 200 for the token
    return res.status(200).json({ revoked: true });
  }
});

export default router;
