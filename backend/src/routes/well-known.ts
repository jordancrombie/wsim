/**
 * Well-Known Discovery Routes
 *
 * RFC-compliant discovery endpoints for AI agents and OAuth clients.
 *
 * Routes:
 * - GET /.well-known/openapi.json - OpenAPI 3.0 specification
 * - GET /.well-known/agent-api - Agent API discovery document (SACP-specific)
 * - GET /.well-known/oauth-authorization-server - OAuth server metadata (RFC 8414)
 * - GET /.well-known/ai-plugin.json - ChatGPT/AI plugin manifest
 * - GET /.well-known/apple-app-site-association - iOS Universal Links (mwsim app)
 * - GET /.well-known/mcp-server - Model Context Protocol tool discovery
 */

import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { env } from '../config/env';
import { getJWKS } from '../services/jwt-keys';

const router = Router();

// Cache the OpenAPI spec (loaded once at startup)
let cachedOpenApiSpec: object | null = null;

function getOpenApiSpec(): object {
  if (cachedOpenApiSpec) return cachedOpenApiSpec;

  try {
    // Load from docs/sacp/openapi-agent.yaml
    const specPath = join(__dirname, '../../../docs/sacp/openapi-agent.yaml');
    const yamlContent = readFileSync(specPath, 'utf8');
    cachedOpenApiSpec = yaml.load(yamlContent) as object;
    return cachedOpenApiSpec;
  } catch (error) {
    console.error('[Well-Known] Failed to load OpenAPI spec:', error);
    // Return minimal spec if file not found
    return {
      openapi: '3.0.3',
      info: {
        title: 'WSIM Agent Commerce API',
        version: '1.1.5',
        description: 'OpenAPI spec not available - check server configuration',
      },
      paths: {},
    };
  }
}

/**
 * GET /.well-known/openapi.json
 * Returns OpenAPI 3.0 specification in JSON format
 */
router.get('/openapi.json', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  res.json(getOpenApiSpec());
});

/**
 * GET /.well-known/agent-api
 * Agent API discovery document
 *
 * This is the primary discovery endpoint for AI agents.
 * Returns information about agent registration, authentication, and available APIs.
 */
router.get('/agent-api', (req: Request, res: Response) => {
  const baseUrl = env.APP_URL;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes

  res.json({
    // Provider identification
    provider: {
      name: 'WSIM',
      description: 'Wallet Simulator - Digital wallet for AI agent commerce',
      version: '1.1.5',
      logo_url: `${baseUrl}/logo.png`,
    },

    // Agent registration (via pairing code flow)
    registration: {
      method: 'pairing_code',
      description: 'Users generate a pairing code in their mobile wallet app, then provide it to their AI agent.',
      endpoint: `${baseUrl}/api/agent/v1/access-request`,
      documentation_url: `${baseUrl}/.well-known/openapi.json#/paths/~1api~1agent~1v1~1access-request/post`,
    },

    // OAuth 2.0 configuration
    oauth: {
      authorization_server: `${baseUrl}/.well-known/oauth-authorization-server`,
      authorization_endpoint: `${baseUrl}/api/agent/v1/oauth/authorize`,
      device_authorization_endpoint: `${baseUrl}/api/agent/v1/oauth/device_authorization`,
      token_endpoint: `${baseUrl}/api/agent/v1/oauth/token`,
      introspection_endpoint: `${baseUrl}/api/agent/v1/oauth/introspect`,
      revocation_endpoint: `${baseUrl}/api/agent/v1/oauth/revoke`,
      grant_types_supported: ['authorization_code', 'client_credentials', 'urn:ietf:params:oauth:grant-type:device_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    },

    // Available APIs
    apis: {
      payments: {
        description: 'Request payment tokens for purchases',
        base_path: '/api/agent/v1/payments',
        endpoints: {
          request_token: 'POST /api/agent/v1/payments/token',
          check_status: 'GET /api/agent/v1/payments/{paymentId}/status',
          list_methods: 'GET /api/agent/v1/payments/methods',
        },
      },
      access_request: {
        description: 'Request access to user wallets via pairing codes',
        base_path: '/api/agent/v1/access-request',
        endpoints: {
          create: 'POST /api/agent/v1/access-request',
          poll_status: 'GET /api/agent/v1/access-request/{requestId}',
          get_qr: 'GET /api/agent/v1/access-request/{requestId}/qr',
        },
      },
    },

    // Capabilities and permissions
    capabilities: {
      permissions: ['browse', 'cart', 'purchase', 'history'],
      spending_limits: {
        supported: true,
        limit_types: ['per_transaction', 'daily', 'monthly'],
        default_currency: 'CAD',
      },
      step_up_authorization: {
        supported: true,
        expiry_minutes: 15,
        delivery_methods: ['push', 'qr'],
      },
    },

    // Documentation links
    documentation: {
      openapi_spec: `${baseUrl}/.well-known/openapi.json`,
      developer_docs: 'https://github.com/jordancrombie/agents/blob/main/docs/PROTOCOL_DESIGN.md',
    },
  });
});

/**
 * GET /.well-known/oauth-protected-resource
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 *
 * Enables MCP clients (like ChatGPT) to discover the authorization server
 * for this protected resource. When a tool returns _meta["mcp/www_authenticate"],
 * the client fetches this endpoint to find where to authenticate.
 */
router.get('/oauth-protected-resource', (req: Request, res: Response) => {
  const baseUrl = env.APP_URL;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  // CORS for cross-origin OAuth discovery (ChatGPT, etc.)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  res.json({
    // The protected resource identifier (RFC 9728 Section 2)
    resource: baseUrl,

    // Authorization servers that can issue tokens for this resource
    authorization_servers: [baseUrl],

    // Scopes supported by this protected resource
    scopes_supported: ['purchase', 'browse', 'cart', 'history'],

    // Bearer token methods supported (RFC 9728 Section 2)
    bearer_methods_supported: ['header'],

    // Resource documentation
    resource_documentation: `${baseUrl}/.well-known/openapi.json`,
  });
});

/**
 * GET /.well-known/jwks.json
 * JSON Web Key Set (RFC 7517)
 *
 * Exposes the public key(s) used to sign JWTs (RS256).
 * External services (like the Agents/MCP Gateway) can fetch this endpoint
 * to verify tokens without needing shared secrets.
 */
router.get('/jwks.json', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  // CORS for cross-origin token verification
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  res.json(getJWKS());
});

/**
 * GET /.well-known/oauth-authorization-server
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 *
 * Standard OAuth discovery endpoint for clients to discover server capabilities.
 */
router.get('/oauth-authorization-server', (req: Request, res: Response) => {
  const baseUrl = env.APP_URL;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  // CORS for cross-origin OAuth discovery (ChatGPT, etc.)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  res.json({
    // Required fields (RFC 8414)
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/agent/v1/oauth/authorize`,
    token_endpoint: `${baseUrl}/api/agent/v1/oauth/token`,

    // Device Authorization Grant (RFC 8628)
    device_authorization_endpoint: `${baseUrl}/api/agent/v1/oauth/device_authorization`,

    // JWKS endpoint for token verification (RFC 7517)
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,

    // Optional but recommended
    introspection_endpoint: `${baseUrl}/api/agent/v1/oauth/introspect`,
    revocation_endpoint: `${baseUrl}/api/agent/v1/oauth/revoke`,

    // Supported features
    grant_types_supported: [
      'authorization_code',
      'client_credentials',
      'urn:ietf:params:oauth:grant-type:device_code',
    ],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
    introspection_endpoint_auth_methods_supported: ['client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['client_secret_post'],

    // Authorization Code + PKCE (RFC 7636)
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],

    // Token signing algorithms (RS256 for external verification via JWKS)
    id_token_signing_alg_values_supported: ['RS256'],

    // Scopes (mapped from permissions)
    scopes_supported: ['browse', 'cart', 'purchase', 'history'],

    // Service documentation
    service_documentation: `${baseUrl}/.well-known/openapi.json`,
    op_policy_uri: `${baseUrl}/privacy`,
    op_tos_uri: `${baseUrl}/terms`,
  });
});

/**
 * GET /.well-known/ai-plugin.json
 * ChatGPT/AI Plugin Manifest
 *
 * Standard format for ChatGPT plugins and web-based AI assistants.
 * WSIM supports three authorization flows:
 * 1. Authorization Code + PKCE (RFC 6749/7636) - Browser-based, ChatGPT Connectors
 * 2. Device Authorization Grant (RFC 8628) - Agent-initiated, user approves
 * 3. Pairing Code + client_credentials - User-initiated, agent uses code
 */
router.get('/ai-plugin.json', (req: Request, res: Response) => {
  const baseUrl = env.APP_URL;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  // CORS for browser-based AI tools
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  res.json({
    schema_version: 'v1',
    name_for_human: 'WSIM Wallet',
    name_for_model: 'wsim_wallet',
    description_for_human: 'Manage AI agent payment authorization and spending limits.',
    description_for_model: `WSIM is a wallet API for AI agents to request payment authorization.

THREE AUTHORIZATION FLOWS AVAILABLE:

FLOW 1 - Authorization Code + PKCE (RECOMMENDED for browser-based AI like ChatGPT):
Standard OAuth 2.0 Authorization Code flow with PKCE (RFC 7636).
1. Redirect to ${baseUrl}/api/agent/v1/oauth/authorize with response_type=code, client_id, redirect_uri, code_challenge, state
2. User enters email and approves via push notification to WSIM app
3. Receive authorization code at redirect_uri
4. Exchange code for access token at ${baseUrl}/api/agent/v1/oauth/token

FLOW 2 - Device Authorization (RFC 8628) - for CLI/headless agents:
1. POST ${baseUrl}/api/agent/v1/oauth/device_authorization with agent_name
2. Receive device_code and user_code (format: WSIM-XXXXXX-XXXXXX)
3. User enters code in WSIM mobile app
4. Poll token endpoint until approved

FLOW 3 - User Pairing Code (legacy):
1. User generates pairing code in mobile app
2. POST ${baseUrl}/api/agent/v1/access-request with the code
3. Poll until approved, receive credentials

SCOPES: browse, cart, purchase, history`,
    auth: {
      type: 'oauth',
      client_url: `${baseUrl}/api/agent/v1/oauth/authorize`,
      authorization_url: `${baseUrl}/api/agent/v1/oauth/token`,
      authorization_content_type: 'application/x-www-form-urlencoded',
      scope: 'browse cart purchase',
      verification_tokens: {},
    },
    api: {
      type: 'openapi',
      url: `${baseUrl}/.well-known/openapi.json`,
    },
    logo_url: `${baseUrl}/logo.png`,
    contact_email: 'support@banksim.ca',
    legal_info_url: `${baseUrl}/terms`,
  });
});

/**
 * GET /.well-known/apple-app-site-association
 * Apple Universal Links configuration
 *
 * Enables mwsim iOS app to handle WSIM URLs directly:
 * - /pay/:requestId - Payment approval (QR code from SSIM/Regalmoose)
 * - /api/m/device - Device authorization (QR code from ChatGPT/agents)
 *
 * When users scan these QR codes, iOS opens mwsim instead of Safari.
 *
 * See: https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app
 */
router.get('/apple-app-site-association', (req: Request, res: Response) => {
  // Must be served as application/json (not application/pkcs7-mime)
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

  res.json({
    applinks: {
      // Empty apps array is required
      apps: [],
      details: [
        {
          // Format: <TEAM_ID>.<BUNDLE_ID>
          appID: 'ZJHD6JAC94.com.banksim.wsim',
          // Paths that should open in the app
          paths: [
            '/pay/*',              // Payment approval (SSIM/Regalmoose QR codes)
            '/api/m/device',       // Device code entry (with or without ?code=)
            '/api/m/device/*',     // Device auth subpaths
          ],
        },
      ],
    },
    // Web credentials for password autofill (optional, for future use)
    webcredentials: {
      apps: ['ZJHD6JAC94.com.banksim.wsim'],
    },
  });
});

/**
 * GET /.well-known/mcp-server
 * Model Context Protocol (MCP) Server Discovery
 *
 * Enables AI agents to discover WSIM tools as if they were local functions.
 * See: https://modelcontextprotocol.io/specification
 */
router.get('/mcp-server', (req: Request, res: Response) => {
  const baseUrl = env.APP_URL;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  // CORS for browser-based AI tools
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  res.json({
    name: 'wsim-wallet',
    version: '1.1.5',
    description: 'WSIM Wallet - AI agent payment authorization',
    protocol_version: '2024-11-05',

    capabilities: {
      tools: true,
      resources: true,
      prompts: false,
    },

    authentication: {
      type: 'oauth2_device_code',
      device_authorization_endpoint: `${baseUrl}/api/agent/v1/oauth/device_authorization`,
      token_endpoint: `${baseUrl}/api/agent/v1/oauth/token`,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      alternative: {
        type: 'pairing_code',
        endpoint: `${baseUrl}/api/agent/v1/access-request`,
        description: 'User generates pairing code (WSIM-XXXXXX-XXXXXX) in mobile app, agent submits code to register',
      },
    },

    tools: [
      {
        name: 'start_device_authorization',
        description: 'Initiate OAuth Device Authorization flow (RFC 8628). Returns a user_code for the user to enter in their mobile wallet app. RECOMMENDED for new integrations.',
        inputSchema: {
          type: 'object',
          properties: {
            agent_name: {
              type: 'string',
              description: 'Display name for this agent (shown to user during approval)',
              maxLength: 100,
            },
            agent_description: {
              type: 'string',
              description: 'Description of what this agent does (optional)',
              maxLength: 500,
            },
            scope: {
              type: 'string',
              description: 'Space-separated list of permissions: browse, cart, purchase, history',
              default: 'browse',
            },
            spending_limits: {
              type: 'object',
              properties: {
                per_transaction: { type: 'number', description: 'Max per-transaction auto-approve limit', default: 50 },
                daily: { type: 'number', description: 'Daily spending limit', default: 200 },
                monthly: { type: 'number', description: 'Monthly spending limit', default: 1000 },
                currency: { type: 'string', default: 'CAD' },
              },
            },
          },
          required: ['agent_name'],
        },
      },
      {
        name: 'poll_device_authorization',
        description: 'Poll for device authorization status. Call this with the device_code from start_device_authorization. Returns credentials when user approves.',
        inputSchema: {
          type: 'object',
          properties: {
            device_code: {
              type: 'string',
              description: 'Device code from start_device_authorization response',
            },
          },
          required: ['device_code'],
        },
      },
      {
        name: 'register_agent',
        description: 'Register this agent using a user-provided pairing code. Alternative to device authorization - use when user already has a code.',
        inputSchema: {
          type: 'object',
          properties: {
            pairing_code: {
              type: 'string',
              description: 'Pairing code from user\'s wallet app (format: WSIM-XXXXXX-XXXXXX)',
              pattern: '^WSIM-[A-Z0-9]{6}-[A-Z0-9]{6}$',
            },
            agent_name: {
              type: 'string',
              description: 'Display name for this agent',
              maxLength: 100,
            },
            description: {
              type: 'string',
              description: 'Description of what this agent does (optional)',
              maxLength: 500,
            },
            permissions: {
              type: 'array',
              items: { type: 'string', enum: ['browse', 'cart', 'purchase', 'history'] },
              description: 'Requested permissions',
            },
            spending_limits: {
              type: 'object',
              properties: {
                per_transaction: { type: 'number', description: 'Max per-transaction auto-approve limit' },
                daily: { type: 'number', description: 'Daily spending limit' },
                monthly: { type: 'number', description: 'Monthly spending limit' },
                currency: { type: 'string', default: 'CAD' },
              },
              required: ['per_transaction', 'daily', 'monthly'],
            },
          },
          required: ['pairing_code', 'agent_name', 'permissions', 'spending_limits'],
        },
      },
      {
        name: 'check_registration_status',
        description: 'Check if the user has approved the agent registration request (for pairing code flow). Returns credentials on approval.',
        inputSchema: {
          type: 'object',
          properties: {
            request_id: {
              type: 'string',
              description: 'Registration request ID from register_agent response',
            },
          },
          required: ['request_id'],
        },
      },
      {
        name: 'get_access_token',
        description: 'Exchange client credentials for an access token (OAuth 2.0 client_credentials grant)',
        inputSchema: {
          type: 'object',
          properties: {
            client_id: {
              type: 'string',
              description: 'Client ID received after registration approval (format: agent_xxxxxxxxxxxx)',
            },
            client_secret: {
              type: 'string',
              description: 'Client secret received after registration approval',
            },
          },
          required: ['client_id', 'client_secret'],
        },
      },
      {
        name: 'get_spending_info',
        description: 'Get current spending limits, usage, and available payment methods for this agent',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'request_payment_token',
        description: 'Request authorization to make a payment. Returns a payment_token if within limits, or requires step-up approval if exceeding limits.',
        inputSchema: {
          type: 'object',
          properties: {
            amount: {
              type: 'number',
              description: 'Payment amount',
            },
            currency: {
              type: 'string',
              description: 'Currency code',
              default: 'CAD',
            },
            merchant_id: {
              type: 'string',
              description: 'Merchant ID from store\'s UCP discovery',
            },
            merchant_name: {
              type: 'string',
              description: 'Merchant display name (optional)',
            },
            session_id: {
              type: 'string',
              description: 'Checkout session ID from the store (optional)',
            },
            payment_method_id: {
              type: 'string',
              description: 'Specific payment method to use (optional, defaults to user\'s default)',
            },
          },
          required: ['amount', 'merchant_id'],
        },
      },
      {
        name: 'check_payment_status',
        description: 'Check status of a payment request or step-up authorization. Use the poll_url returned from request_payment_token, or construct URL with payment_id.',
        inputSchema: {
          type: 'object',
          properties: {
            payment_id: {
              type: 'string',
              description: 'Payment or step-up ID from request_payment_token response',
            },
          },
          required: ['payment_id'],
        },
      },
    ],

    resources: [
      {
        uri: 'wsim://spending-info',
        name: 'Spending Information',
        description: 'Current spending limits, usage, and available payment methods',
        mimeType: 'application/json',
      },
      {
        uri: 'wsim://discovery',
        name: 'Agent API Discovery',
        description: 'Full discovery document for WSIM agent API',
        mimeType: 'application/json',
      },
    ],
  });
});

export default router;
