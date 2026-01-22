/**
 * Webhook Dispatch Service
 *
 * Dispatches webhook events to registered merchants (e.g., SSIM) for
 * real-time notifications about token revocations and agent status changes.
 *
 * Events:
 * - token.revoked: When an agent access token is revoked
 * - agent.deactivated: When an agent is suspended or revoked
 * - agent.secret_rotated: When an agent's client secret is rotated
 */

import crypto from 'crypto';
import { prisma } from '../config/database';

// =============================================================================
// TYPES
// =============================================================================

export type WebhookEventType =
  | 'token.revoked'
  | 'agent.deactivated'
  | 'agent.secret_rotated';

export interface TokenRevokedPayload {
  token_hash: string;
  agent_id: string;
  client_id: string;
  reason: 'explicit_revocation' | 'agent_deactivated' | 'secret_rotated' | 'owner_revoked';
}

export interface AgentDeactivatedPayload {
  agent_id: string;
  client_id: string;
  status: 'suspended' | 'revoked';
  reason?: string;
}

export interface AgentSecretRotatedPayload {
  agent_id: string;
  client_id: string;
}

export interface WebhookEvent<T = unknown> {
  event: WebhookEventType;
  timestamp: string;
  data: T;
}

// =============================================================================
// SIGNATURE GENERATION
// =============================================================================

/**
 * Generate HMAC-SHA256 signature for webhook payload
 */
export function generateWebhookSignature(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Generate webhook headers including signature
 */
function generateWebhookHeaders(payload: string, secret: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signaturePayload = `${timestamp}.${payload}`;
  const signature = generateWebhookSignature(signaturePayload, secret);

  return {
    'Content-Type': 'application/json',
    'X-Webhook-Timestamp': timestamp,
    'X-Webhook-Signature': `sha256=${signature}`,
  };
}

// =============================================================================
// WEBHOOK DISPATCH
// =============================================================================

/**
 * Dispatch a webhook event to all subscribed merchants
 */
export async function dispatchWebhookEvent<T>(
  eventType: WebhookEventType,
  data: T
): Promise<void> {
  // Find all enabled webhooks subscribed to this event type
  const webhooks = await prisma.merchantWebhook.findMany({
    where: {
      enabled: true,
      events: {
        has: eventType,
      },
    },
  });

  if (webhooks.length === 0) {
    console.log(`[Webhook] No subscribers for event ${eventType}`);
    return;
  }

  const event: WebhookEvent<T> = {
    event: eventType,
    timestamp: new Date().toISOString(),
    data,
  };

  const payload = JSON.stringify(event);

  // Dispatch to all webhooks in parallel (fire and forget, but log results)
  const dispatches = webhooks.map(async (webhook) => {
    const startTime = Date.now();
    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;

    try {
      const headers = generateWebhookHeaders(payload, webhook.webhookSecret);

      const response = await fetch(webhook.webhookUrl, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      statusCode = response.status;
      responseBody = await response.text().catch(() => null);

      // Truncate response body for logging
      if (responseBody && responseBody.length > 500) {
        responseBody = responseBody.substring(0, 500) + '...';
      }

      if (response.ok) {
        console.log(`[Webhook] Delivered ${eventType} to ${webhook.merchantId} (${statusCode})`);
      } else {
        console.warn(`[Webhook] Failed to deliver ${eventType} to ${webhook.merchantId}: ${statusCode}`);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Webhook] Error delivering ${eventType} to ${webhook.merchantId}:`, error);
    }

    const durationMs = Date.now() - startTime;

    // Log the delivery attempt
    await prisma.webhookDeliveryLog.create({
      data: {
        webhookId: webhook.id,
        eventType,
        payload: event as object,
        statusCode,
        responseBody,
        error,
        durationMs,
      },
    }).catch((logErr) => {
      console.error('[Webhook] Failed to log delivery:', logErr);
    });
  });

  // Wait for all dispatches to complete (but don't block on errors)
  await Promise.allSettled(dispatches);
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Dispatch token.revoked event
 */
export async function dispatchTokenRevoked(
  tokenHash: string,
  agentId: string,
  clientId: string,
  reason: TokenRevokedPayload['reason']
): Promise<void> {
  await dispatchWebhookEvent<TokenRevokedPayload>('token.revoked', {
    token_hash: tokenHash,
    agent_id: agentId,
    client_id: clientId,
    reason,
  });
}

/**
 * Dispatch agent.deactivated event
 */
export async function dispatchAgentDeactivated(
  agentId: string,
  clientId: string,
  status: 'suspended' | 'revoked',
  reason?: string
): Promise<void> {
  await dispatchWebhookEvent<AgentDeactivatedPayload>('agent.deactivated', {
    agent_id: agentId,
    client_id: clientId,
    status,
    reason,
  });
}

/**
 * Dispatch agent.secret_rotated event
 */
export async function dispatchAgentSecretRotated(
  agentId: string,
  clientId: string
): Promise<void> {
  await dispatchWebhookEvent<AgentSecretRotatedPayload>('agent.secret_rotated', {
    agent_id: agentId,
    client_id: clientId,
  });
}

// =============================================================================
// WEBHOOK MANAGEMENT
// =============================================================================

/**
 * Register or update a merchant webhook
 */
export async function registerWebhook(
  merchantId: string,
  webhookUrl: string,
  webhookSecret: string,
  events: WebhookEventType[]
): Promise<{ id: string }> {
  const webhook = await prisma.merchantWebhook.upsert({
    where: { merchantId },
    update: {
      webhookUrl,
      webhookSecret,
      events,
      enabled: true,
    },
    create: {
      merchantId,
      webhookUrl,
      webhookSecret,
      events,
    },
    select: { id: true },
  });

  console.log(`[Webhook] Registered webhook for ${merchantId}`);
  return webhook;
}

/**
 * Unregister a merchant webhook
 */
export async function unregisterWebhook(merchantId: string): Promise<void> {
  await prisma.merchantWebhook.deleteMany({
    where: { merchantId },
  });

  console.log(`[Webhook] Unregistered webhook for ${merchantId}`);
}

/**
 * Get webhook registration for a merchant
 */
export async function getWebhookRegistration(merchantId: string) {
  return prisma.merchantWebhook.findUnique({
    where: { merchantId },
    select: {
      id: true,
      merchantId: true,
      webhookUrl: true,
      events: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Get recent delivery logs for a merchant
 */
export async function getWebhookDeliveryLogs(
  merchantId: string,
  limit: number = 50
) {
  const webhook = await prisma.merchantWebhook.findUnique({
    where: { merchantId },
    select: { id: true },
  });

  if (!webhook) {
    return [];
  }

  return prisma.webhookDeliveryLog.findMany({
    where: { webhookId: webhook.id },
    orderBy: { attemptedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      eventType: true,
      statusCode: true,
      error: true,
      attemptedAt: true,
      durationMs: true,
    },
  });
}
