/**
 * Agent Authentication Service
 *
 * Handles OAuth 2.0 client credentials flow for AI agents:
 * - Client ID and secret generation
 * - Secret hashing and verification
 * - Access token generation and validation
 * - Token introspection for merchants
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { Agent, AgentAccessToken, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { getSigningKey, getVerifyKey } from './jwt-keys';

// =============================================================================
// TYPES
// =============================================================================

export interface AgentAccessTokenPayload {
  sub: string;        // agent.id (UUID) - or WalletUser ID for MCP OAuth
  client_id: string;  // agent.clientId or OAuth client_id (e.g., 'chatgpt-mcp')
  owner_id: string;   // agent.userId (owner) - WalletUser ID
  permissions: string[];
  scope?: string;
  aud?: string;       // Audience - the intended recipient (e.g., 'chatgpt-mcp')
  iat: number;
  exp: number;
  iss: string;
}

export interface IntrospectionResult {
  active: boolean;
  client_id?: string;
  agent_id?: string;
  owner_id?: string;
  permissions?: string[];
  scope?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  // Spending limits
  spending_limits?: {
    per_transaction: string;
    daily: string;
    monthly: string;
    currency: string;
  };
  // Current usage (for merchant context)
  current_usage?: {
    daily: string;
    monthly: string;
  };
  // Agent metadata
  agent_name?: string;
  agent_status?: string;
}

// =============================================================================
// CLIENT CREDENTIALS GENERATION
// =============================================================================

const BCRYPT_COST = 12;

/**
 * Generate a unique client ID for an agent
 * Format: agent_{nanoid(12)}
 */
export function generateAgentClientId(): string {
  return `agent_${nanoid(12)}`;
}

/**
 * Generate a secure client secret for an agent
 * Format: sk_agent_{base64url(24 bytes)} = 32 chars
 */
export function generateAgentClientSecret(): string {
  const randomPart = crypto.randomBytes(24).toString('base64url');
  return `sk_agent_${randomPart}`;
}

/**
 * Hash a client secret using bcrypt
 */
export async function hashClientSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, BCRYPT_COST);
}

/**
 * Verify a client secret against its hash
 */
export async function verifyClientSecret(secret: string, hash: string): Promise<boolean> {
  return bcrypt.compare(secret, hash);
}

// =============================================================================
// ACCESS TOKEN GENERATION
// =============================================================================

/**
 * Generate an access token for an agent
 * Returns both the token string and its SHA-256 hash (for storage/revocation)
 *
 * Uses RS256 (asymmetric) for tokens that need external verification via JWKS.
 * The `aud` claim identifies the intended recipient (e.g., 'chatgpt-mcp').
 */
export function generateAgentAccessToken(
  agent: Pick<Agent, 'id' | 'clientId' | 'userId' | 'permissions'>,
  scope?: string,
  audience?: string
): { token: string; tokenHash: string; expiresAt: Date } {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = env.AGENT_ACCESS_TOKEN_EXPIRY;
  const expiresAt = new Date((now + expiresIn) * 1000);

  const payload: Omit<AgentAccessTokenPayload, 'iat' | 'exp' | 'iss'> = {
    sub: agent.id,
    client_id: agent.clientId,
    owner_id: agent.userId,
    permissions: agent.permissions,
    ...(scope && { scope }),
    ...(audience && { aud: audience }),
  };

  // Use RS256 for tokens that may be verified externally via JWKS
  const { key: privateKey, kid, algorithm } = getSigningKey();

  const token = jwt.sign(payload, privateKey, {
    algorithm,
    expiresIn,
    issuer: env.APP_URL,
    keyid: kid,
  });

  // Hash token for storage (used for revocation lookup)
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  return { token, tokenHash, expiresAt };
}

/**
 * Verify and decode an agent access token
 * Returns null if invalid or expired
 *
 * Supports both RS256 (new) and HS256 (legacy) tokens for backwards compatibility.
 */
export function verifyAgentAccessToken(token: string): AgentAccessTokenPayload | null {
  try {
    // First, try RS256 verification (new tokens)
    const { key: publicKey } = getVerifyKey();

    try {
      const payload = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        issuer: env.APP_URL,
      }) as AgentAccessTokenPayload;
      return payload;
    } catch {
      // Fall back to HS256 for legacy tokens
      const payload = jwt.verify(token, env.AGENT_JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: env.APP_URL,
      }) as AgentAccessTokenPayload;
      return payload;
    }
  } catch {
    return null;
  }
}

/**
 * Get the hash of a token (for revocation lookup)
 */
export function getTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// =============================================================================
// TOKEN STORAGE AND REVOCATION
// =============================================================================

/**
 * Store an access token record for tracking/revocation
 */
export async function storeAgentAccessToken(
  agentId: string,
  tokenHash: string,
  expiresAt: Date,
  scope?: string
): Promise<AgentAccessToken> {
  return prisma.agentAccessToken.create({
    data: {
      agentId,
      tokenHash,
      expiresAt,
      scope,
    },
  });
}

/**
 * Check if a token has been revoked
 */
export async function isTokenRevoked(tokenHash: string): Promise<boolean> {
  const tokenRecord = await prisma.agentAccessToken.findUnique({
    where: { tokenHash },
    select: { revokedAt: true },
  });

  // If not found in storage, it's not a valid tracked token
  // (this is acceptable for stateless validation, but introspection should require storage)
  if (!tokenRecord) {
    return false;
  }

  return tokenRecord.revokedAt !== null;
}

/**
 * Revoke an access token
 */
export async function revokeToken(tokenHash: string): Promise<void> {
  await prisma.agentAccessToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revoke all tokens for an agent
 */
export async function revokeAllAgentTokens(agentId: string): Promise<void> {
  await prisma.agentAccessToken.updateMany({
    where: { agentId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// =============================================================================
// TOKEN INTROSPECTION
// =============================================================================

/**
 * Introspect an agent token (RFC 7662)
 * Returns full agent context for merchants to validate
 */
export async function introspectAgentToken(token: string): Promise<IntrospectionResult> {
  // Verify the token signature and expiration
  const payload = verifyAgentAccessToken(token);

  if (!payload) {
    return { active: false };
  }

  const tokenHash = getTokenHash(token);

  // Check if token was revoked
  const isRevoked = await isTokenRevoked(tokenHash);
  if (isRevoked) {
    return { active: false };
  }

  // Fetch the agent to get current limits and status
  const agent = await prisma.agent.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      clientId: true,
      userId: true,
      name: true,
      permissions: true,
      perTransactionLimit: true,
      dailyLimit: true,
      monthlyLimit: true,
      limitCurrency: true,
      status: true,
    },
  });

  // Agent may have been deleted or suspended
  if (!agent || agent.status !== 'active') {
    return { active: false };
  }

  // Calculate current usage (import from spending-limits when available)
  // For now, we'll return placeholders - this will be filled in by spending-limits service
  const currentUsage = {
    daily: '0.00',
    monthly: '0.00',
  };

  return {
    active: true,
    client_id: agent.clientId,
    agent_id: agent.id,
    owner_id: agent.userId,
    permissions: agent.permissions,
    scope: payload.scope,
    exp: payload.exp,
    iat: payload.iat,
    iss: payload.iss,
    spending_limits: {
      per_transaction: agent.perTransactionLimit.toString(),
      daily: agent.dailyLimit.toString(),
      monthly: agent.monthlyLimit.toString(),
      currency: agent.limitCurrency,
    },
    current_usage: currentUsage,
    agent_name: agent.name,
    agent_status: agent.status,
  };
}

// =============================================================================
// AGENT VALIDATION
// =============================================================================

/**
 * Validate client credentials and return the agent if valid
 */
export async function validateAgentCredentials(
  clientId: string,
  clientSecret: string
): Promise<Agent | null> {
  const agent = await prisma.agent.findUnique({
    where: { clientId },
  });

  if (!agent) {
    return null;
  }

  // Check agent status
  if (agent.status !== 'active') {
    return null;
  }

  // Verify secret
  const isValid = await verifyClientSecret(clientSecret, agent.clientSecretHash);
  if (!isValid) {
    return null;
  }

  // Update lastUsedAt
  await prisma.agent.update({
    where: { id: agent.id },
    data: { lastUsedAt: new Date() },
  });

  return agent;
}

// =============================================================================
// INTROSPECTION AUTH (for merchants)
// =============================================================================

/**
 * Verify introspection credentials (Basic Auth for merchants)
 * Supports multiple merchants via INTROSPECTION_CLIENTS config
 */
export function verifyIntrospectionCredentials(
  clientId: string,
  clientSecret: string
): boolean {
  // Check against all configured introspection clients
  return env.INTROSPECTION_CLIENTS.some(
    client => client.clientId === clientId && client.clientSecret === clientSecret
  );
}

/**
 * Parse Basic Auth header and verify introspection credentials
 * Returns the matched client ID if valid, null otherwise
 */
export function verifyIntrospectionAuth(authHeader: string | undefined): boolean {
  if (!authHeader?.startsWith('Basic ')) {
    return false;
  }

  try {
    const base64Credentials = authHeader.slice(6);
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [clientId, clientSecret] = credentials.split(':');

    return verifyIntrospectionCredentials(clientId, clientSecret);
  } catch {
    return false;
  }
}
