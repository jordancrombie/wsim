/**
 * Agent OAuth Routes
 *
 * OAuth 2.0 endpoints for AI agent authentication.
 *
 * Routes:
 * - GET  /api/agent/v1/oauth/authorize - Authorization Code flow entry (browser redirect)
 * - POST /api/agent/v1/oauth/authorize/identify - Submit email for push notification
 * - GET  /api/agent/v1/oauth/authorize/status/:id - Poll for authorization status
 * - POST /api/agent/v1/oauth/device_authorization - Device Authorization Grant (RFC 8628)
 * - POST /api/agent/v1/oauth/token - Client credentials, device_code, & authorization_code grants
 * - POST /api/agent/v1/oauth/introspect - Token introspection
 * - POST /api/agent/v1/oauth/revoke - Token revocation
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { nanoid } from 'nanoid';
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
  verifyClientSecret as verifyClientSecretBcrypt,
} from '../services/agent-auth';
import { getSpendingUsage } from '../services/spending-limits';
import { dispatchTokenRevoked } from '../services/webhook-dispatch';
import { sendNotificationToUser } from '../services/notification';

const router = Router();

// =============================================================================
// DEVICE AUTHORIZATION ENDPOINT (RFC 8628)
// =============================================================================

/**
 * Generate a user code in format: WSIM-XXXXXX
 * Per RFC 8628 Section 6.1: ~8 characters recommended for easy entry
 * Using 6 chars from 32-char alphabet = ~1 billion combinations
 */
function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars (0, O, 1, I, L)
  const code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `WSIM-${code}`;
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
      response_type,
      buyer_email, // Optional: if provided, send push notification to user
      // Payment-Bootstrapped OAuth fields (NEW)
      request_type, // 'first_purchase' | 'step_up' | 'permission_only'
      existing_agent_id, // For step_up: the agent that already has delegation
      payment_context, // { amount, currency, item_description, merchant_name, merchant_id }
      exceeded_limit, // For step_up: { type, limit, requested, currency }
    } = req.body;

    // Validate response_type if provided (default to 'credentials')
    const responseType = response_type === 'token' ? 'token' : 'credentials';

    // Validate request_type (default to 'permission_only' for backward compatibility)
    const validRequestTypes = ['first_purchase', 'step_up', 'permission_only'];
    const requestType = validRequestTypes.includes(request_type) ? request_type : 'permission_only';

    // For step_up requests, validate that we have the required fields
    if (requestType === 'step_up') {
      if (!existing_agent_id) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'existing_agent_id is required for step_up requests',
        });
      }
      if (!exceeded_limit || !exceeded_limit.type) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'exceeded_limit with type is required for step_up requests',
        });
      }
    }

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
      // For Device Authorization (RFC 8628), no user context exists at code creation
      const pairingCode = await tx.pairingCode.create({
        data: {
          code: userCode,
          expiresAt,
          status: 'active',
          userId: null, // Device-initiated: user claims the code later
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
          responseType, // 'credentials' for agent onboarding, 'token' for guest checkout
          expiresAt,
          // Mark as 'pending_claim' until a user claims it
          status: 'pending_claim',
          // Payment-Bootstrapped OAuth fields
          requestType,
          paymentContext: payment_context || null,
          exceededLimit: exceeded_limit || null,
          // showDelegationOption will be determined after user is identified
          showDelegationOption: requestType !== 'step_up', // No delegation option for step-up
        },
      });

      return { pairingCode, accessRequest };
    });

    console.log(`[Device Auth] Created device authorization ${result.accessRequest.id}, user_code: ${userCode}`);

    // Track if we sent a push notification
    let notificationSent = false;
    let notificationUserId: string | null = null;

    // If buyer_email is provided, try to send push notification
    if (buyer_email && typeof buyer_email === 'string') {
      try {
        // Look up user by email
        const user = await prisma.walletUser.findUnique({
          where: { email: buyer_email.toLowerCase().trim() },
        });

        if (user) {
          // Check if user has declined delegation 3+ times for this merchant
          let showDelegation = requestType !== 'step_up'; // Never show for step-up
          if (showDelegation && payment_context?.merchant_id) {
            const preference = await prisma.agentDelegationPreference.findUnique({
              where: {
                userId_agentClientId_merchantId: {
                  userId: user.id,
                  agentClientId: 'chatgpt-mcp', // TODO: make this dynamic based on client_id
                  merchantId: payment_context.merchant_id,
                },
              },
            });
            if (preference && preference.declineCount >= 3) {
              showDelegation = false;
              console.log(`[Device Auth] Suppressing delegation option for user ${user.id} (${preference.declineCount} declines)`);
            }
          }

          // Pre-link the pairing code to this user and update status
          await prisma.$transaction(async (tx) => {
            await tx.pairingCode.update({
              where: { id: result.pairingCode.id },
              data: { userId: user.id },
            });
            await tx.accessRequest.update({
              where: { id: result.accessRequest.id },
              data: {
                status: 'pending', // Skip 'pending_claim' since we know the user
                showDelegationOption: showDelegation,
              },
            });
          });

          // Build notification content based on request type
          let notifTitle: string;
          let notifBody: string;
          const paymentAmount = payment_context?.amount || perTransaction.toString();
          const paymentCurrency = payment_context?.currency || currency;
          const itemDescription = payment_context?.item_description;

          if (requestType === 'step_up' && exceeded_limit) {
            // Step-up: emphasize that this exceeds their limit
            notifTitle = `${agent_name} wants to charge ${paymentCurrency} ${paymentAmount}`;
            notifBody = `Exceeds your ${paymentCurrency} ${exceeded_limit.limit} ${exceeded_limit.type.replace('_', ' ')} limit`;
          } else if (requestType === 'first_purchase' && itemDescription) {
            // First purchase with item context
            notifTitle = `${agent_name} wants to charge ${paymentCurrency} ${paymentAmount}`;
            notifBody = `for: ${itemDescription}`;
          } else {
            // Default/permission_only or first_purchase without item
            notifTitle = `${agent_name} wants to pay`;
            notifBody = `Tap to authorize ${paymentCurrency} ${paymentAmount} payment`;
          }

          // Send push notification
          await sendNotificationToUser(
            user.id,
            'agent.access_request',
            {
              title: notifTitle,
              body: notifBody,
              data: {
                type: 'device_authorization.payment',
                screen: 'DeviceAuthApproval',
                params: { accessRequestId: result.accessRequest.id },
                access_request_id: result.accessRequest.id,
                user_code: userCode,
                agent_name,
                amount: paymentAmount,
                currency: paymentCurrency,
                // Payment-Bootstrapped OAuth: include request_type for mwsim routing
                request_type: requestType,
                ...(payment_context && { payment_context }),
                ...(exceeded_limit && { exceeded_limit }),
              },
            },
            result.accessRequest.id
          );

          notificationSent = true;
          notificationUserId = user.id;
          console.log(`[Device Auth] Push notification sent to user ${user.id} (${buyer_email})`);
        } else {
          console.log(`[Device Auth] No user found for email ${buyer_email}, skipping push notification`);
        }
      } catch (notifError) {
        console.error('[Device Auth] Failed to send push notification:', notifError);
        // Continue - user can still enter code manually
      }
    }

    // Return RFC 8628 compliant response with optional notification status
    return res.json({
      device_code: result.accessRequest.id,
      user_code: userCode,
      verification_uri: `${env.APP_URL}/api/m/device`,
      verification_uri_complete: `${env.APP_URL}/api/m/device?code=${encodeURIComponent(userCode)}`,
      expires_in: 900, // 15 minutes
      interval: 5, // Poll every 5 seconds
      // Extension: notification status (not part of RFC 8628, but useful for Gateway)
      ...(buyer_email && {
        notification_sent: notificationSent,
        notification_user_id: notificationUserId,
      }),
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
// AUTHORIZATION CODE FLOW (RFC 6749 + PKCE RFC 7636)
// =============================================================================

/**
 * OAuth client configuration
 * - confidential: Server-side clients that can securely store client_secret (e.g., ChatGPT)
 * - public: Browser/mobile clients that use PKCE instead (e.g., MCP clients)
 *
 * In production, these would be stored in database
 */
interface OAuthClientConfig {
  name: string;
  type: 'confidential' | 'public';
  allowedRedirectUris: string[];
  // For confidential clients, secret is stored in env: OAUTH_CLIENT_SECRET_<CLIENT_ID>
  // e.g., OAUTH_CLIENT_SECRET_CHATGPT
}

const KNOWN_OAUTH_CLIENTS: Record<string, OAuthClientConfig> = {
  'chatgpt': {
    name: 'ChatGPT',
    type: 'confidential',  // ChatGPT is a server-side client with client_secret
    allowedRedirectUris: [
      'https://chat.openai.com/aip/*/oauth/callback',
      'https://chatgpt.com/aip/*/oauth/callback',
    ],
  },
  // ChatGPT MCP - OAuth for Model Context Protocol tools
  // ChatGPT hosts the OAuth popup, WSIM is the auth server
  // Uses PKCE for security (MCP pattern)
  'chatgpt-mcp': {
    name: 'ChatGPT (MCP)',
    type: 'public',  // MCP uses PKCE, no client_secret needed
    allowedRedirectUris: [
      // OpenAI Apps SDK OAuth redirect URIs (current)
      'https://chatgpt.com/connector_platform_oauth_redirect',
      'https://platform.openai.com/apps-manage/oauth',
      // Legacy/alternative OAuth callback endpoints
      'https://chat.openai.com/oauth/callback',
      'https://chatgpt.com/oauth/callback',
      'https://platform.openai.com/oauth/callback',
      // MCP-specific callback patterns
      'https://chatgpt.com/mcp/*/oauth/callback',
      'https://chat.openai.com/mcp/*/oauth/callback',
    ],
  },
  'claude-mcp': {
    name: 'Claude (MCP)',
    type: 'public',  // MCP uses PKCE
    allowedRedirectUris: [
      'http://localhost:*',
      'https://claude.ai/oauth/callback',
    ],
  },
  'gemini': {
    name: 'Google Gemini',
    type: 'confidential',  // Google is server-side
    allowedRedirectUris: [
      'https://gemini.google.com/oauth/callback',
    ],
  },
  // Development/testing client (public, uses PKCE)
  'wsim-test': {
    name: 'WSIM Test Client',
    type: 'public',
    allowedRedirectUris: [
      'http://localhost:3000/callback',
      'http://localhost:3004/callback',
      'http://127.0.0.1:*/callback',
    ],
  },
  // SACP Gateway - server-side service for guest checkout
  // Uses Device Authorization flow (RFC 8628), not redirect-based OAuth
  // Secret stored in env: OAUTH_CLIENT_SECRET_SACP_GATEWAY
  'sacp-gateway': {
    name: 'SACP Gateway',
    type: 'confidential',
    allowedRedirectUris: [], // Uses Device Authorization, not redirect flow
  },
};

/**
 * Get client secret from environment variable
 * Format: OAUTH_CLIENT_SECRET_<CLIENT_ID_UPPERCASE>
 */
function getClientSecret(clientId: string): string | null {
  const envKey = `OAUTH_CLIENT_SECRET_${clientId.toUpperCase().replace(/-/g, '_')}`;
  return process.env[envKey] || null;
}

/**
 * Verify client_secret for confidential clients
 */
function verifyClientSecret(clientId: string, clientSecret: string): boolean {
  const storedSecret = getClientSecret(clientId);
  if (!storedSecret) {
    console.warn(`[OAuth] No client secret configured for ${clientId}`);
    return false;
  }
  // Use timing-safe comparison to prevent timing attacks
  if (storedSecret.length !== clientSecret.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(storedSecret),
    Buffer.from(clientSecret)
  );
}

/**
 * Generate authorization code (URL-safe random string)
 */
function generateAuthorizationCode(): string {
  return nanoid(32);
}

/**
 * Verify PKCE code_verifier against stored code_challenge
 */
function verifyPkceChallenge(codeVerifier: string, codeChallenge: string, method: string): boolean {
  if (method !== 'S256') {
    return false; // Only S256 supported
  }

  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const computed = hash.toString('base64url');
  return computed === codeChallenge;
}

/**
 * Resolved client info - either from hardcoded list or database
 */
interface ResolvedClient {
  name: string;
  type: 'confidential' | 'public';
  allowedRedirectUris: string[];
  isDynamic: boolean; // true if from database (DCR)
}

/**
 * Look up a client by ID, checking both hardcoded clients and database
 * Dynamically registered clients (dyn_*) are stored in the OAuthClient table
 */
async function resolveClient(clientId: string): Promise<ResolvedClient | null> {
  // First check hardcoded clients
  const knownClient = KNOWN_OAUTH_CLIENTS[clientId];
  if (knownClient) {
    return {
      name: knownClient.name,
      type: knownClient.type,
      allowedRedirectUris: knownClient.allowedRedirectUris,
      isDynamic: false,
    };
  }

  // Check database for dynamically registered clients
  const dbClient = await prisma.oAuthClient.findUnique({
    where: { clientId },
  });

  if (dbClient) {
    return {
      name: dbClient.clientName,
      // Dynamic clients are treated as confidential (they have a client_secret from DCR)
      // But they can also use PKCE - we'll check which auth method they use at token exchange
      type: 'confidential',
      allowedRedirectUris: dbClient.redirectUris,
      isDynamic: true,
    };
  }

  return null;
}

/**
 * Validate redirect URI against a resolved client's allowed URIs
 */
function isValidRedirectUriForClient(client: ResolvedClient, redirectUri: string): boolean {
  return client.allowedRedirectUris.some(pattern => {
    if (pattern.includes('*')) {
      // Convert wildcard pattern to regex - match alphanumeric, hyphens, underscores
      const regex = new RegExp('^' + pattern.replace(/\*/g, '[\\w-]+') + '$');
      return regex.test(redirectUri);
    }
    return pattern === redirectUri;
  });
}

/**
 * GET /api/agent/v1/oauth/authorize
 * OAuth 2.0 Authorization endpoint (RFC 6749)
 *
 * Browser-based authorization for AI platforms like ChatGPT Connectors.
 * Renders a page asking user to enter their email, then sends push notification.
 *
 * Supports both:
 * - Hardcoded clients (chatgpt, chatgpt-mcp, claude-mcp, etc.)
 * - Dynamically registered clients (dyn_* from /register endpoint)
 */
router.get('/authorize', async (req: Request, res: Response) => {
  try {
    const {
      response_type,
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      state,
      scope,
    } = req.query as Record<string, string>;

    // Validate required parameters
    // Default to 'code' if not specified, as it's the only supported flow
    // Also handle case-insensitive comparison for compatibility
    const normalizedResponseType = (response_type || 'code').toLowerCase();
    if (normalizedResponseType !== 'code') {
      return res.status(400).send(renderErrorPage(
        'Invalid Request',
        'Only response_type=code is supported',
        redirect_uri,
        state
      ));
    }

    if (!client_id) {
      return res.status(400).send(renderErrorPage(
        'Invalid Request',
        'client_id is required',
        redirect_uri,
        state
      ));
    }

    // Check if client is known (hardcoded or dynamically registered)
    const client = await resolveClient(client_id);
    if (!client) {
      return res.status(400).send(renderErrorPage(
        'Unknown Client',
        `Client "${client_id}" is not registered. Contact support to register your application.`,
        redirect_uri,
        state
      ));
    }

    if (!redirect_uri) {
      return res.status(400).send(renderErrorPage(
        'Invalid Request',
        'redirect_uri is required',
        undefined,
        state
      ));
    }

    // Validate redirect URI against client's allowed URIs
    if (!isValidRedirectUriForClient(client, redirect_uri)) {
      console.log(`[OAuth Authorize] Invalid redirect_uri: ${redirect_uri} for client ${client_id}`);
      console.log(`[OAuth Authorize] Allowed URIs: ${JSON.stringify(client.allowedRedirectUris)}`);
      return res.status(400).send(renderErrorPage(
        'Invalid Redirect URI',
        'The redirect_uri is not registered for this client',
        undefined,
        state
      ));
    }

    // PKCE validation
    // - Required for hardcoded public clients (they can't securely store client_secret)
    // - Optional for confidential and dynamic clients (they have client_secret but can also use PKCE)
    const hasPkce = code_challenge && code_challenge_method === 'S256';

    if (!client.isDynamic && client.type === 'public' && !hasPkce) {
      // Hardcoded public clients MUST use PKCE
      return res.status(400).send(renderErrorPage(
        'PKCE Required',
        'code_challenge with method S256 is required for this client type',
        redirect_uri,
        state
      ));
    }

    // For hardcoded confidential clients without PKCE, verify they have a secret configured
    if (!client.isDynamic && client.type === 'confidential' && !hasPkce) {
      const hasSecret = getClientSecret(client_id) !== null;
      if (!hasSecret) {
        console.error(`[OAuth Authorize] Confidential client ${client_id} has no secret configured`);
        return res.status(400).send(renderErrorPage(
          'Configuration Error',
          'Client is not properly configured. Please contact support.',
          redirect_uri,
          state
        ));
      }
    }

    // Create authorization request (PKCE fields are nullable for confidential clients)
    const authRequest = await prisma.oAuthAuthorizationCode.create({
      data: {
        clientId: client_id,
        redirectUri: redirect_uri,
        codeChallenge: hasPkce ? code_challenge : null,
        codeChallengeMethod: hasPkce ? code_challenge_method : null,
        state,
        scope,
        status: 'pending_identification',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      },
    });

    console.log(`[OAuth Authorize] Created authorization request ${authRequest.id} for ${client.name}${client.isDynamic ? ' (dynamic)' : ''}`);

    // Generate a cryptographic nonce for CSP
    const nonce = crypto.randomBytes(16).toString('base64');

    // Set Content-Security-Policy header with nonce (most secure option for inline scripts)
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`);

    // Render the consent page with nonce
    return res.send(renderAuthorizePage(authRequest.id, client.name, scope, nonce));
  } catch (error) {
    console.error('[OAuth Authorize] Error:', error);
    return res.status(500).send(renderErrorPage(
      'Server Error',
      'An unexpected error occurred. Please try again.',
      undefined,
      undefined
    ));
  }
});

/**
 * POST /api/agent/v1/oauth/authorize/identify
 * User submits their email to receive push notification
 *
 * Handles both:
 * - JSON requests from JavaScript fetch (returns JSON)
 * - Form submissions when JS is blocked by CSP (returns HTML)
 */
router.post('/authorize/identify', async (req: Request, res: Response) => {
  // Detect if this is a form submission (defense in depth for when CSP blocks JS)
  const isFormSubmission = req.headers['content-type']?.includes('application/x-www-form-urlencoded') &&
                           !req.headers['accept']?.includes('application/json');

  // Helper to respond with error (JSON or HTML depending on request type)
  const respondError = (status: number, error: string, description: string, authId?: string) => {
    if (isFormSubmission && authId) {
      return res.status(status).send(renderIdentifyErrorPage(description, authId));
    }
    return res.status(status).json({ error, error_description: description });
  };

  try {
    const { authorization_id, email } = req.body;

    if (!authorization_id || !email) {
      return respondError(400, 'invalid_request', 'authorization_id and email are required');
    }

    // Find the authorization request
    const authRequest = await prisma.oAuthAuthorizationCode.findUnique({
      where: { id: authorization_id },
    });

    if (!authRequest) {
      return respondError(404, 'not_found', 'Authorization request not found', authorization_id);
    }

    if (authRequest.status !== 'pending_identification') {
      return respondError(400, 'invalid_request', 'Authorization request is not in pending identification state', authorization_id);
    }

    if (authRequest.expiresAt < new Date()) {
      await prisma.oAuthAuthorizationCode.update({
        where: { id: authorization_id },
        data: { status: 'expired' },
      });
      return respondError(400, 'expired', 'Authorization request has expired', authorization_id);
    }

    // Find user by email
    const user = await prisma.walletUser.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        mobileDevices: {
          where: {
            pushToken: { not: null },
            pushTokenActive: true,
          },
        },
      },
    });

    if (!user) {
      return respondError(404, 'user_not_found', 'No WSIM account found with this email. Please create an account first.', authorization_id);
    }

    if (user.mobileDevices.length === 0) {
      return respondError(400, 'no_devices', 'No mobile devices registered. Please open the WSIM app first.', authorization_id);
    }

    // Update authorization request with user
    await prisma.oAuthAuthorizationCode.update({
      where: { id: authorization_id },
      data: {
        userId: user.id,
        status: 'pending_approval',
      },
    });

    // Get client name for notification
    const client = KNOWN_OAUTH_CLIENTS[authRequest.clientId];
    const clientName = client?.name || authRequest.clientId;

    // Send push notification
    await sendNotificationToUser(
      user.id,
      'oauth.authorization',
      {
        title: 'Authorization Request',
        body: `${clientName} wants to connect to your wallet`,
        data: {
          type: 'oauth.authorization',
          screen: 'OAuthAuthorization',
          params: {
            oauthAuthorizationId: authorization_id,
          },
          clientName,
          scope: authRequest.scope,
        },
        sound: 'default',
        priority: 'high',
      }
    );

    console.log(`[OAuth Authorize] Push notification sent to user ${user.id} for ${clientName}`);

    const pollUrl = `${env.APP_URL}/api/agent/v1/oauth/authorize/status/${authorization_id}`;

    // Return HTML waiting page for form submissions, JSON for AJAX
    if (isFormSubmission) {
      return res.send(renderWaitingPage(authorization_id, clientName, pollUrl));
    }

    return res.json({
      status: 'pending_approval',
      message: 'Check your WSIM app to approve this request',
      poll_url: pollUrl,
      expires_in: Math.floor((authRequest.expiresAt.getTime() - Date.now()) / 1000),
    });
  } catch (error) {
    console.error('[OAuth Authorize] Identify error:', error);
    if (isFormSubmission) {
      return res.status(500).send(renderIdentifyErrorPage('Internal server error. Please try again.'));
    }
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

/**
 * GET /api/agent/v1/oauth/authorize/status/:id
 * Poll for authorization status (called by browser)
 */
router.get('/authorize/status/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const authRequest = await prisma.oAuthAuthorizationCode.findUnique({
      where: { id },
    });

    if (!authRequest) {
      return res.status(404).json({
        error: 'not_found',
        error_description: 'Authorization request not found',
      });
    }

    // Check expiration
    if (authRequest.expiresAt < new Date() && authRequest.status !== 'approved') {
      if (authRequest.status !== 'expired') {
        await prisma.oAuthAuthorizationCode.update({
          where: { id },
          data: { status: 'expired' },
        });
      }
      return res.json({
        status: 'expired',
        message: 'Authorization request has expired',
      });
    }

    switch (authRequest.status) {
      case 'pending_identification':
        return res.json({
          status: 'pending_identification',
          message: 'Waiting for user to enter email',
        });

      case 'pending_approval':
        return res.json({
          status: 'pending_approval',
          message: 'Waiting for user approval in mobile app',
        });

      case 'approved':
        // Return redirect URL with authorization code
        const redirectUrl = new URL(authRequest.redirectUri);
        redirectUrl.searchParams.set('code', authRequest.code!);
        if (authRequest.state) {
          redirectUrl.searchParams.set('state', authRequest.state);
        }
        return res.json({
          status: 'approved',
          redirect_uri: redirectUrl.toString(),
        });

      case 'rejected':
        return res.json({
          status: 'rejected',
          message: 'User rejected the authorization request',
        });

      case 'used':
        return res.json({
          status: 'used',
          message: 'Authorization code has already been used',
        });

      default:
        return res.json({
          status: authRequest.status,
        });
    }
  } catch (error) {
    console.error('[OAuth Authorize] Status error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

/**
 * GET /api/agent/v1/oauth/authorize/wait/:id
 * HTML-based waiting page with meta refresh (for when JS is blocked by CSP)
 * This endpoint is called via meta refresh from the waiting page
 */
router.get('/authorize/wait/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const authRequest = await prisma.oAuthAuthorizationCode.findUnique({
      where: { id },
    });

    if (!authRequest) {
      return res.status(404).send(renderIdentifyErrorPage('Authorization request not found'));
    }

    const client = KNOWN_OAUTH_CLIENTS[authRequest.clientId];
    const clientName = client?.name || authRequest.clientId;

    // Check expiration
    if (authRequest.expiresAt < new Date() && authRequest.status !== 'approved') {
      if (authRequest.status !== 'expired') {
        await prisma.oAuthAuthorizationCode.update({
          where: { id },
          data: { status: 'expired' },
        });
      }
      return res.send(renderWaitResultPage('expired', clientName));
    }

    switch (authRequest.status) {
      case 'approved':
        // Redirect to OAuth callback with authorization code
        const redirectUrl = new URL(authRequest.redirectUri);
        redirectUrl.searchParams.set('code', authRequest.code!);
        if (authRequest.state) {
          redirectUrl.searchParams.set('state', authRequest.state);
        }
        return res.redirect(redirectUrl.toString());

      case 'rejected':
        return res.send(renderWaitResultPage('rejected', clientName));

      case 'used':
        return res.send(renderWaitResultPage('used', clientName));

      default:
        // Still waiting - show waiting page again with meta refresh
        const pollUrl = `${env.APP_URL}/api/agent/v1/oauth/authorize/status/${id}`;
        return res.send(renderWaitingPage(id, clientName, pollUrl));
    }
  } catch (error) {
    console.error('[OAuth Authorize] Wait error:', error);
    return res.status(500).send(renderIdentifyErrorPage('Internal server error'));
  }
});

// =============================================================================
// HTML PAGE RENDERERS
// =============================================================================

function renderAuthorizePage(authorizationId: string, clientName: string, scope?: string | null, nonce?: string): string {
  const scopeList = scope ? scope.split(' ') : ['browse'];
  const scopeDescriptions: Record<string, string> = {
    browse: 'View products and prices',
    cart: 'Manage shopping cart',
    purchase: 'Make purchases on your behalf',
    history: 'View transaction history',
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect to WSIM Wallet</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
    }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo svg { width: 64px; height: 64px; }
    h1 { font-size: 24px; text-align: center; margin-bottom: 8px; color: #1a1a2e; }
    .subtitle { text-align: center; color: #666; margin-bottom: 24px; }
    .client-name { font-weight: 600; color: #667eea; }
    .permissions { background: #f5f5f7; border-radius: 12px; padding: 16px; margin-bottom: 24px; }
    .permissions h3 { font-size: 14px; color: #666; margin-bottom: 12px; }
    .permission { display: flex; align-items: center; padding: 8px 0; }
    .permission svg { width: 20px; height: 20px; margin-right: 12px; color: #667eea; }
    .permission span { color: #333; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 14px; color: #666; margin-bottom: 8px; }
    input[type="email"] {
      width: 100%;
      padding: 14px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 12px;
      font-size: 16px;
      transition: border-color 0.2s;
    }
    input[type="email"]:focus { outline: none; border-color: #667eea; }
    button {
      width: 100%;
      padding: 14px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: #5a6fd6; }
    button:disabled { background: #ccc; cursor: not-allowed; }
    .status { text-align: center; padding: 20px; }
    .spinner {
      width: 40px; height: 40px;
      border: 3px solid #e0e0e0;
      border-top-color: #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error { background: #fee; color: #c00; padding: 12px; border-radius: 8px; margin-bottom: 16px; text-align: center; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="64" height="64" rx="16" fill="#667eea"/>
        <path d="M20 32L28 40L44 24" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>

    <div id="step-email">
      <h1>Connect to WSIM</h1>
      <p class="subtitle"><span class="client-name">${escapeHtml(clientName)}</span> wants to connect to your wallet</p>

      <div class="permissions">
        <h3>Requested permissions:</h3>
        ${scopeList.map(s => `
          <div class="permission">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
            <span>${escapeHtml(scopeDescriptions[s] || s)}</span>
          </div>
        `).join('')}
      </div>

      <div id="error" class="error hidden"></div>

      <!-- Form has action/method as fallback when JavaScript is blocked by CSP -->
      <form id="email-form" method="POST" action="/api/agent/v1/oauth/authorize/identify">
        <input type="hidden" name="authorization_id" value="${authorizationId}">
        <div class="form-group">
          <label for="email">Enter your WSIM account email</label>
          <input type="email" id="email" name="email" required placeholder="you@example.com" autocomplete="email">
        </div>
        <button type="submit" id="submit-btn">Continue</button>
      </form>
    </div>

    <div id="step-waiting" class="status hidden">
      <div class="spinner"></div>
      <h2>Check your phone</h2>
      <p class="subtitle">Open the WSIM app to approve this request</p>
    </div>

    <div id="step-success" class="status hidden">
      <svg viewBox="0 0 64 64" fill="none" style="width:64px;height:64px;margin-bottom:16px;">
        <circle cx="32" cy="32" r="32" fill="#4CAF50"/>
        <path d="M20 32L28 40L44 24" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h2>Approved!</h2>
      <p class="subtitle">Redirecting you back...</p>
    </div>

    <div id="step-rejected" class="status hidden">
      <svg viewBox="0 0 64 64" fill="none" style="width:64px;height:64px;margin-bottom:16px;">
        <circle cx="32" cy="32" r="32" fill="#f44336"/>
        <path d="M24 24L40 40M40 24L24 40" stroke="white" stroke-width="4" stroke-linecap="round"/>
      </svg>
      <h2>Rejected</h2>
      <p class="subtitle">You declined the authorization request</p>
    </div>
  </div>

  <script nonce="${nonce || ''}">
    const authorizationId = '${authorizationId}';
    const form = document.getElementById('email-form');
    const emailInput = document.getElementById('email');
    const submitBtn = document.getElementById('submit-btn');
    const errorDiv = document.getElementById('error');
    const stepEmail = document.getElementById('step-email');
    const stepWaiting = document.getElementById('step-waiting');
    const stepSuccess = document.getElementById('step-success');
    const stepRejected = document.getElementById('step-rejected');

    function showError(msg) {
      errorDiv.textContent = msg;
      errorDiv.classList.remove('hidden');
    }

    function hideError() {
      errorDiv.classList.add('hidden');
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';

      try {
        const res = await fetch('/api/agent/v1/oauth/authorize/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            authorization_id: authorizationId,
            email: emailInput.value
          })
        });

        const data = await res.json();

        if (!res.ok) {
          showError(data.error_description || data.message || 'An error occurred');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Continue';
          return;
        }

        // Switch to waiting state
        stepEmail.classList.add('hidden');
        stepWaiting.classList.remove('hidden');

        // Start polling
        pollStatus(data.poll_url);
      } catch (err) {
        showError('Network error. Please try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue';
      }
    });

    async function pollStatus(pollUrl) {
      try {
        const res = await fetch(pollUrl);
        const data = await res.json();

        switch (data.status) {
          case 'approved':
            stepWaiting.classList.add('hidden');
            stepSuccess.classList.remove('hidden');
            setTimeout(() => {
              window.location.href = data.redirect_uri;
            }, 1500);
            break;
          case 'rejected':
            stepWaiting.classList.add('hidden');
            stepRejected.classList.remove('hidden');
            break;
          case 'expired':
            showError('Request expired. Please try again.');
            stepWaiting.classList.add('hidden');
            stepEmail.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Continue';
            break;
          default:
            // Keep polling
            setTimeout(() => pollStatus(pollUrl), 2000);
        }
      } catch (err) {
        setTimeout(() => pollStatus(pollUrl), 3000);
      }
    }
  </script>
</body>
</html>`;
}

function renderErrorPage(title: string, message: string, redirectUri?: string, state?: string): string {
  let redirectInfo = '';
  if (redirectUri) {
    const url = new URL(redirectUri);
    url.searchParams.set('error', 'invalid_request');
    url.searchParams.set('error_description', message);
    if (state) url.searchParams.set('state', state);
    redirectInfo = `<p style="margin-top:16px;"><a href="${escapeHtml(url.toString())}">Return to application</a></p>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - WSIM</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f7;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      text-align: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    h1 { color: #c00; margin-bottom: 16px; }
    p { color: #666; }
    a { color: #667eea; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${redirectInfo}
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render waiting page for form submissions (when JS is blocked by CSP)
 * This page uses meta refresh to poll for status
 */
function renderWaitingPage(authorizationId: string, clientName: string, pollUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="3;url=/api/agent/v1/oauth/authorize/wait/${authorizationId}">
  <title>Waiting for Approval - WSIM</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
    }
    .spinner {
      width: 48px; height: 48px;
      border: 4px solid #e0e0e0;
      border-top-color: #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 24px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 24px; margin-bottom: 12px; color: #1a1a2e; }
    p { color: #666; margin-bottom: 8px; }
    .client { color: #667eea; font-weight: 600; }
    .small { font-size: 14px; color: #999; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>Check Your Phone</h1>
    <p>Open the <span class="client">WSIM app</span> to approve the connection request from <span class="client">${escapeHtml(clientName)}</span></p>
    <p class="small">This page will automatically update when you respond.</p>
  </div>
</body>
</html>`;
}

/**
 * Render error page for identify endpoint (form submission fallback)
 */
function renderIdentifyErrorPage(message: string, authorizationId?: string): string {
  const retryLink = authorizationId
    ? `<p style="margin-top:16px;"><a href="javascript:history.back()">← Try again</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - WSIM</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { color: #c00; margin-bottom: 16px; font-size: 20px; }
    p { color: #666; }
    a { color: #667eea; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>Something went wrong</h1>
    <p>${escapeHtml(message)}</p>
    ${retryLink}
  </div>
</body>
</html>`;
}

/**
 * Render result page for wait endpoint (approved/rejected/expired/used)
 */
function renderWaitResultPage(status: 'rejected' | 'expired' | 'used', clientName: string): string {
  const configs = {
    rejected: {
      icon: '❌',
      title: 'Request Rejected',
      message: `You declined the connection request from ${clientName}.`,
      color: '#c00',
    },
    expired: {
      icon: '⏱️',
      title: 'Request Expired',
      message: 'The authorization request has expired. Please try again.',
      color: '#f90',
    },
    used: {
      icon: '✓',
      title: 'Already Used',
      message: 'This authorization has already been completed.',
      color: '#667eea',
    },
  };

  const config = configs[status];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.title} - WSIM</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { color: ${config.color}; margin-bottom: 16px; font-size: 20px; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${config.icon}</div>
    <h1>${config.title}</h1>
    <p>${escapeHtml(config.message)}</p>
  </div>
</body>
</html>`;
}

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
 * - authorization_code: Authorization Code Grant with PKCE (RFC 6749 + RFC 7636)
 */
router.post('/token', async (req: Request, res: Response) => {
  try {
    // Support both form-urlencoded and JSON
    const {
      grant_type,
      client_id,
      client_secret,
      device_code,
      code,
      code_verifier,
      redirect_uri,
      scope,
    } = req.body;

    // Handle Device Authorization Grant (RFC 8628)
    if (grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
      return handleDeviceCodeGrant(req, res, device_code);
    }

    // Handle Authorization Code Grant (RFC 6749 + PKCE RFC 7636)
    if (grant_type === 'authorization_code') {
      return handleAuthorizationCodeGrant(req, res, code, code_verifier, redirect_uri, client_id, client_secret);
    }

    // Handle Client Credentials Grant
    if (grant_type !== 'client_credentials') {
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Supported grant types: client_credentials, authorization_code, urn:ietf:params:oauth:grant-type:device_code',
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
 * Handle Authorization Code Grant token exchange (RFC 6749 + PKCE RFC 7636)
 *
 * This grant type is used by browser-based OAuth clients like ChatGPT Connectors.
 * Security is enforced via either:
 * - PKCE (code_verifier) for public clients
 * - client_secret for confidential clients
 */
async function handleAuthorizationCodeGrant(
  req: Request,
  res: Response,
  code: string,
  codeVerifier: string | undefined,
  redirectUri: string,
  clientId: string,
  clientSecret: string | undefined
) {
  // Validate required fields
  if (!code) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'code is required',
    });
  }

  if (!clientId) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'client_id is required',
    });
  }

  // Find the authorization code
  const authRequest = await prisma.oAuthAuthorizationCode.findUnique({
    where: { code },
    include: { user: true },
  });

  if (!authRequest) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid authorization code',
    });
  }

  // Verify client_id matches
  if (authRequest.clientId !== clientId) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'client_id mismatch',
    });
  }

  // Verify redirect_uri matches (if provided)
  if (redirectUri && authRequest.redirectUri !== redirectUri) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'redirect_uri mismatch',
    });
  }

  // Check if already used
  if (authRequest.status === 'used') {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code has already been used',
    });
  }

  // Check expiration
  if (authRequest.expiresAt < new Date()) {
    await prisma.oAuthAuthorizationCode.update({
      where: { id: authRequest.id },
      data: { status: 'expired' },
    });
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code has expired',
    });
  }

  // Verify authentication: either PKCE (public client) or client_secret (confidential client)
  const usedPkce = authRequest.codeChallenge !== null;

  if (usedPkce) {
    // Authorization used PKCE, verify code_verifier
    if (!codeVerifier) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'code_verifier is required (PKCE was used during authorization)',
      });
    }
    if (!verifyPkceChallenge(codeVerifier, authRequest.codeChallenge!, authRequest.codeChallengeMethod!)) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid code_verifier',
      });
    }
  } else {
    // Authorization did not use PKCE, require client_secret (confidential client)
    if (!clientSecret) {
      return res.status(400).json({
        error: 'invalid_client',
        error_description: 'client_secret is required for this client',
      });
    }

    // Verify client_secret - check both hardcoded clients and database (DCR) clients
    let secretValid = false;

    // First try hardcoded clients (from environment variables)
    if (verifyClientSecret(clientId, clientSecret)) {
      secretValid = true;
    } else {
      // Check database for dynamically registered clients
      const dbClient = await prisma.oAuthClient.findUnique({
        where: { clientId },
      });
      if (dbClient && dbClient.clientSecret) {
        secretValid = await verifyClientSecretBcrypt(clientSecret, dbClient.clientSecret);
      }
    }

    if (!secretValid) {
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Invalid client credentials',
      });
    }
  }

  // Mark as used
  await prisma.oAuthAuthorizationCode.update({
    where: { id: authRequest.id },
    data: {
      status: 'used',
      usedAt: new Date(),
    },
  });

  // Get or create an agent for this user + client combination
  // For OAuth Authorization Code flow, we create a "virtual" agent representing
  // the AI platform's access to the user's wallet
  // Resolve client name from hardcoded list or database
  const resolvedClient = await resolveClient(clientId);
  const clientName = resolvedClient?.name || clientId;
  const agentClientId = `oauth_${clientId}_${authRequest.userId!.slice(0, 8)}`;

  let agent = await prisma.agent.findUnique({
    where: { clientId: agentClientId },
  });

  if (!agent) {
    // Create new agent for this OAuth client
    const clientSecret = generateAgentClientSecret();
    const clientSecretHash = await hashClientSecret(clientSecret);

    // Parse scope into permissions
    const permissions = authRequest.scope
      ? authRequest.scope.split(' ').filter(s => ['browse', 'cart', 'purchase', 'history'].includes(s))
      : ['browse'];

    agent = await prisma.agent.create({
      data: {
        userId: authRequest.userId!,
        clientId: agentClientId,
        clientSecretHash,
        name: `${clientName} (OAuth)`,
        description: `Connected via OAuth Authorization Code flow`,
        permissions,
        perTransactionLimit: new Decimal('50.00'),
        dailyLimit: new Decimal('200.00'),
        monthlyLimit: new Decimal('1000.00'),
        limitCurrency: 'CAD',
        status: 'active',
      },
    });

    console.log(`[OAuth Token] Created agent ${agentClientId} for OAuth client ${clientId}`);
  }

  // Generate access token with audience set to the OAuth client_id
  // This allows the MCP Gateway (or other clients) to verify the token is intended for them
  const { token, tokenHash, expiresAt } = generateAgentAccessToken(
    agent,
    authRequest.scope || undefined,
    clientId  // audience - e.g., 'chatgpt-mcp'
  );

  // Store token record
  await storeAgentAccessToken(agent.id, tokenHash, expiresAt, authRequest.scope || undefined);

  console.log(`[OAuth Token] Access token issued for ${clientId} (user: ${authRequest.userId?.slice(0, 8)})`);

  // Return token response (RFC 6749)
  return res.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    scope: authRequest.scope || agent.permissions.join(' '),
  });
}

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
      // Success! Return credentials or token based on responseType
      if (!accessRequest.agent) {
        return res.status(500).json({
          error: 'server_error',
          error_description: 'Agent not found for approved request',
        });
      }

      // Check if this is a token-based response (guest checkout)
      if (accessRequest.responseType === 'token') {
        // Guest checkout flow - return access token directly (RFC 8628 compliant)
        const scope = (accessRequest.grantedPermissions || accessRequest.requestedPermissions).join(' ');
        const { token: accessToken, tokenHash, expiresAt } = generateAgentAccessToken(
          accessRequest.agent,
          scope
        );

        // Store the token for tracking/revocation
        await storeAgentAccessToken(accessRequest.agent.id, tokenHash, expiresAt, scope);

        console.log(`[Device Auth] Access token issued for agent ${accessRequest.agent.clientId} (guest checkout)`);

        // Return RFC 8628 Section 3.5 compliant response
        // Extended with Payment-Bootstrapped OAuth delegation fields
        return res.json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
          scope,
          // Payment-Bootstrapped OAuth: delegation status
          delegation_granted: accessRequest.delegationGranted,
          delegation_pending: accessRequest.delegationPending,
        });
      }

      // Agent onboarding flow - return credentials for repeated use
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
      // Extended with Payment-Bootstrapped OAuth delegation fields
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
        // Payment-Bootstrapped OAuth: delegation status
        delegation_granted: accessRequest.delegationGranted,
        delegation_pending: accessRequest.delegationPending,
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

// =============================================================================
// DYNAMIC CLIENT REGISTRATION (RFC 7591)
// =============================================================================

/**
 * POST /api/agent/v1/oauth/register
 * OAuth 2.0 Dynamic Client Registration (RFC 7591)
 *
 * ChatGPT and other MCP clients call this to register themselves as OAuth clients
 * when a user adds the MCP server. Returns client credentials for subsequent OAuth flows.
 *
 * Required for ChatGPT MCP integration - ChatGPT needs to dynamically register
 * to get a client_id before initiating OAuth flows.
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const {
      client_name,
      redirect_uris,
      grant_types,
      token_endpoint_auth_method,
      scope,
      logo_uri,
      // These are accepted per RFC 7591 but not currently stored
      client_uri: _client_uri,
      policy_uri: _policy_uri,
      tos_uri: _tos_uri,
      software_id: _software_id,
      software_version: _software_version,
    } = req.body;

    // Log optional fields for debugging (not stored)
    if (_client_uri || _policy_uri || _tos_uri || _software_id || _software_version) {
      console.log(`[OAuth Register] Optional fields received: client_uri=${_client_uri}, software_id=${_software_id}`);
    }

    // Validate required fields (RFC 7591 Section 2)
    if (!client_name || typeof client_name !== 'string') {
      return res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'client_name is required',
      });
    }

    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uris is required and must be a non-empty array',
      });
    }

    // Validate redirect URIs are valid HTTPS URLs (except localhost for dev)
    for (const uri of redirect_uris) {
      try {
        const url = new URL(uri);
        if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
          return res.status(400).json({
            error: 'invalid_redirect_uri',
            error_description: `redirect_uri must use HTTPS: ${uri}`,
          });
        }
      } catch {
        return res.status(400).json({
          error: 'invalid_redirect_uri',
          error_description: `Invalid redirect_uri format: ${uri}`,
        });
      }
    }

    // Default grant types if not specified
    const grantTypesArray = grant_types && Array.isArray(grant_types)
      ? grant_types
      : ['authorization_code'];

    // Validate grant types
    const allowedGrantTypes = ['authorization_code', 'refresh_token', 'client_credentials', 'urn:ietf:params:oauth:grant-type:device_code'];
    for (const gt of grantTypesArray) {
      if (!allowedGrantTypes.includes(gt)) {
        return res.status(400).json({
          error: 'invalid_client_metadata',
          error_description: `Unsupported grant_type: ${gt}`,
        });
      }
    }

    // Default token endpoint auth method
    const authMethod = token_endpoint_auth_method || 'client_secret_post';
    const allowedAuthMethods = ['client_secret_post', 'client_secret_basic', 'none'];
    if (!allowedAuthMethods.includes(authMethod)) {
      return res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: `Unsupported token_endpoint_auth_method: ${authMethod}`,
      });
    }

    // Default scope
    const scopeString = scope || 'browse cart purchase';

    // Check if a client with these exact redirect_uris already exists
    // This provides idempotent registration for the same client
    const sortedUris = [...redirect_uris].sort();
    const existingClients = await prisma.oAuthClient.findMany({
      where: {
        clientName: client_name,
      },
    });

    // Check for exact redirect_uris match
    for (const existing of existingClients) {
      const existingSortedUris = [...existing.redirectUris].sort();
      if (JSON.stringify(existingSortedUris) === JSON.stringify(sortedUris)) {
        // Found existing client - return it (but can't return the secret)
        // Per RFC 7591, we should return the existing registration
        // For security, we don't return the secret again
        console.log(`[OAuth Register] Returning existing client ${existing.clientId} for ${client_name}`);

        return res.status(200).json({
          client_id: existing.clientId,
          // Note: client_secret is NOT returned for existing registrations (security)
          client_id_issued_at: Math.floor(existing.createdAt.getTime() / 1000),
          client_name: existing.clientName,
          redirect_uris: existing.redirectUris,
          grant_types: existing.grantTypes,
          token_endpoint_auth_method: authMethod,
          scope: existing.scope,
          ...(existing.logoUri && { logo_uri: existing.logoUri }),
        });
      }
    }

    // Generate new client credentials
    const clientId = `dyn_${nanoid(16)}`; // Prefix with 'dyn_' to identify dynamically registered clients
    const clientSecret = generateAgentClientSecret();
    const clientSecretHash = await hashClientSecret(clientSecret);

    // Create the client
    const client = await prisma.oAuthClient.create({
      data: {
        clientId,
        clientSecret: clientSecretHash,
        clientName: client_name,
        redirectUris: redirect_uris,
        postLogoutRedirectUris: [],
        grantTypes: grantTypesArray,
        scope: scopeString,
        logoUri: logo_uri || null,
        trusted: false, // Dynamically registered clients are never trusted
      },
    });

    console.log(`[OAuth Register] Created new client ${clientId} for ${client_name}`);

    // Return RFC 7591 compliant response (Section 3.2)
    return res.status(201).json({
      client_id: client.clientId,
      client_secret: clientSecret, // Only returned on initial registration
      client_secret_expires_at: 0, // 0 = never expires
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      token_endpoint_auth_method: authMethod,
      scope: client.scope,
      ...(client.logoUri && { logo_uri: client.logoUri }),
    });

  } catch (error) {
    console.error('[OAuth Register] Error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to register client',
    });
  }
});

export default router;
