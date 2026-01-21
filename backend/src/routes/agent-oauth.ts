/**
 * Agent OAuth Routes
 *
 * OAuth 2.0 endpoints for AI agent authentication.
 *
 * Routes:
 * - POST /api/agent/v1/oauth/token - Client credentials grant
 * - POST /api/agent/v1/oauth/introspect - Token introspection
 * - POST /api/agent/v1/oauth/revoke - Token revocation
 */

import { Router, Request, Response } from 'express';
import {
  validateAgentCredentials,
  generateAgentAccessToken,
  storeAgentAccessToken,
  introspectAgentToken,
  verifyIntrospectionAuth,
  getTokenHash,
  revokeToken,
  verifyAgentAccessToken,
} from '../services/agent-auth';
import { getSpendingUsage } from '../services/spending-limits';

const router = Router();

// =============================================================================
// TOKEN ENDPOINT
// =============================================================================

/**
 * POST /api/agent/v1/oauth/token
 * OAuth 2.0 token endpoint - client credentials grant
 */
router.post('/token', async (req: Request, res: Response) => {
  try {
    // Support both form-urlencoded and JSON
    const {
      grant_type,
      client_id,
      client_secret,
      scope,
    } = req.body;

    // Validate grant type
    if (grant_type !== 'client_credentials') {
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only client_credentials grant type is supported',
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

    // Revoke the token
    const tokenHash = getTokenHash(token);
    await revokeToken(tokenHash);

    console.log('[Agent OAuth] Token revoked');

    return res.status(200).json({ revoked: true });
  } catch (error) {
    console.error('[Agent OAuth] Revoke error:', error);
    // Per RFC 7009, errors should still return 200 for the token
    return res.status(200).json({ revoked: true });
  }
});

export default router;
