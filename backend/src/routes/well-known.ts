/**
 * Well-Known Discovery Routes
 *
 * RFC-compliant discovery endpoints for AI agents and OAuth clients.
 *
 * Routes:
 * - GET /.well-known/openapi.json - OpenAPI 3.0 specification
 * - GET /.well-known/agent-api - Agent API discovery document
 * - GET /.well-known/oauth-authorization-server - OAuth server metadata (RFC 8414)
 */

import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { env } from '../config/env';

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
        version: '1.0.9',
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
      version: '1.0.9',
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
      token_endpoint: `${baseUrl}/api/agent/v1/oauth/token`,
      introspection_endpoint: `${baseUrl}/api/agent/v1/oauth/introspect`,
      revocation_endpoint: `${baseUrl}/api/agent/v1/oauth/revoke`,
      grant_types_supported: ['client_credentials'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
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
 * GET /.well-known/oauth-authorization-server
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 *
 * Standard OAuth discovery endpoint for clients to discover server capabilities.
 */
router.get('/oauth-authorization-server', (req: Request, res: Response) => {
  const baseUrl = env.APP_URL;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

  res.json({
    // Required fields (RFC 8414)
    issuer: baseUrl,
    token_endpoint: `${baseUrl}/api/agent/v1/oauth/token`,

    // Optional but recommended
    introspection_endpoint: `${baseUrl}/api/agent/v1/oauth/introspect`,
    revocation_endpoint: `${baseUrl}/api/agent/v1/oauth/revoke`,

    // Supported features
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    introspection_endpoint_auth_methods_supported: ['client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['client_secret_post'],

    // Token info
    response_types_supported: ['token'],
    token_endpoint_auth_signing_alg_values_supported: ['HS256'],

    // Scopes (mapped from permissions)
    scopes_supported: ['browse', 'cart', 'purchase', 'history'],

    // Service documentation
    service_documentation: `${baseUrl}/.well-known/openapi.json`,
    op_policy_uri: `${baseUrl}/privacy`,
    op_tos_uri: `${baseUrl}/terms`,
  });
});

export default router;
