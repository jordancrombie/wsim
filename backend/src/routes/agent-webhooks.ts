/**
 * Agent Webhook Routes
 *
 * Webhook management endpoints for merchants to receive real-time
 * notifications about token revocations and agent status changes.
 *
 * Routes:
 * - POST /api/agent/v1/webhooks - Register/update webhook
 * - GET /api/agent/v1/webhooks - Get current webhook registration
 * - DELETE /api/agent/v1/webhooks - Unregister webhook
 * - GET /api/agent/v1/webhooks/logs - Get delivery logs
 * - POST /api/agent/v1/webhooks/test - Send test event
 *
 * Authentication: Basic Auth with introspection credentials
 */

import { Router, Request, Response } from 'express';
import { verifyIntrospectionAuth } from '../services/agent-auth';
import {
  registerWebhook,
  unregisterWebhook,
  getWebhookRegistration,
  getWebhookDeliveryLogs,
  dispatchWebhookEvent,
  WebhookEventType,
} from '../services/webhook-dispatch';

const router = Router();

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Verify introspection credentials (Basic Auth)
 * Merchants use the same credentials as for token introspection
 */
function requireIntrospectionAuth(req: Request, res: Response, next: () => void) {
  const authHeader = req.headers.authorization;

  if (!verifyIntrospectionAuth(authHeader)) {
    return res.status(401).json({
      error: 'unauthorized',
      error_description: 'Invalid credentials',
    });
  }

  // Extract merchant ID from Basic Auth for context
  const base64Credentials = authHeader!.slice(6);
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [merchantId] = credentials.split(':');

  // Attach merchant ID to request
  (req as any).merchantId = merchantId;

  next();
}

// =============================================================================
// REGISTRATION
// =============================================================================

const VALID_EVENTS: WebhookEventType[] = [
  'token.revoked',
  'agent.deactivated',
  'agent.secret_rotated',
];

/**
 * POST /api/agent/v1/webhooks
 * Register or update a webhook subscription
 */
router.post('/', requireIntrospectionAuth, async (req: Request, res: Response) => {
  try {
    const merchantId = (req as any).merchantId;
    const { webhook_url, webhook_secret, events } = req.body;

    // Validate webhook_url
    if (!webhook_url || typeof webhook_url !== 'string') {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'webhook_url is required',
      });
    }

    // Must be HTTPS in production
    if (!webhook_url.startsWith('https://') && process.env.NODE_ENV === 'production') {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'webhook_url must use HTTPS',
      });
    }

    // Validate webhook_secret
    if (!webhook_secret || typeof webhook_secret !== 'string' || webhook_secret.length < 32) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'webhook_secret is required and must be at least 32 characters',
      });
    }

    // Validate events array
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'events array is required and must not be empty',
      });
    }

    const invalidEvents = events.filter((e: string) => !VALID_EVENTS.includes(e as WebhookEventType));
    if (invalidEvents.length > 0) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: `Invalid event types: ${invalidEvents.join(', ')}. Valid types: ${VALID_EVENTS.join(', ')}`,
      });
    }

    const webhook = await registerWebhook(
      merchantId,
      webhook_url,
      webhook_secret,
      events as WebhookEventType[]
    );

    console.log(`[Webhook API] Registered webhook for ${merchantId}`);

    return res.status(201).json({
      id: webhook.id,
      merchant_id: merchantId,
      webhook_url,
      events,
      enabled: true,
    });
  } catch (error) {
    console.error('[Webhook API] Registration error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

/**
 * GET /api/agent/v1/webhooks
 * Get current webhook registration
 */
router.get('/', requireIntrospectionAuth, async (req: Request, res: Response) => {
  try {
    const merchantId = (req as any).merchantId;

    const registration = await getWebhookRegistration(merchantId);

    if (!registration) {
      return res.status(404).json({
        error: 'not_found',
        error_description: 'No webhook registered',
      });
    }

    return res.json({
      id: registration.id,
      merchant_id: registration.merchantId,
      webhook_url: registration.webhookUrl,
      events: registration.events,
      enabled: registration.enabled,
      created_at: registration.createdAt.toISOString(),
      updated_at: registration.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error('[Webhook API] Get registration error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

/**
 * DELETE /api/agent/v1/webhooks
 * Unregister webhook
 */
router.delete('/', requireIntrospectionAuth, async (req: Request, res: Response) => {
  try {
    const merchantId = (req as any).merchantId;

    await unregisterWebhook(merchantId);

    console.log(`[Webhook API] Unregistered webhook for ${merchantId}`);

    return res.status(204).send();
  } catch (error) {
    console.error('[Webhook API] Unregister error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

// =============================================================================
// DELIVERY LOGS
// =============================================================================

/**
 * GET /api/agent/v1/webhooks/logs
 * Get recent delivery logs
 */
router.get('/logs', requireIntrospectionAuth, async (req: Request, res: Response) => {
  try {
    const merchantId = (req as any).merchantId;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const logs = await getWebhookDeliveryLogs(merchantId, limit);

    return res.json({
      logs: logs.map((log) => ({
        id: log.id,
        event_type: log.eventType,
        status_code: log.statusCode,
        error: log.error,
        attempted_at: log.attemptedAt.toISOString(),
        duration_ms: log.durationMs,
      })),
    });
  } catch (error) {
    console.error('[Webhook API] Get logs error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

// =============================================================================
// TESTING
// =============================================================================

/**
 * POST /api/agent/v1/webhooks/test
 * Send a test webhook event
 */
router.post('/test', requireIntrospectionAuth, async (req: Request, res: Response) => {
  try {
    const merchantId = (req as any).merchantId;

    const registration = await getWebhookRegistration(merchantId);

    if (!registration) {
      return res.status(404).json({
        error: 'not_found',
        error_description: 'No webhook registered',
      });
    }

    // Send a test event
    await dispatchWebhookEvent('token.revoked', {
      token_hash: 'test_' + Date.now().toString(36),
      agent_id: 'test_agent_id',
      client_id: 'test_client_id',
      reason: 'explicit_revocation',
      _test: true,
    });

    console.log(`[Webhook API] Sent test event to ${merchantId}`);

    return res.json({
      success: true,
      message: 'Test event dispatched. Check your webhook endpoint.',
    });
  } catch (error) {
    console.error('[Webhook API] Test error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

export default router;
