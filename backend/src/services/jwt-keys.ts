/**
 * JWT Key Management Service
 *
 * Handles RSA key pairs for RS256 JWT signing and verification.
 * Exposes public keys in JWKS format for external services to verify tokens.
 *
 * Key loading priority:
 * 1. Environment variables (AGENT_JWT_RSA_PRIVATE_KEY_PEM, AGENT_JWT_RSA_PUBLIC_KEY_PEM)
 * 2. Auto-generated ephemeral keys (development only - logs warning)
 *
 * For production:
 * - Generate a 2048-bit RSA key pair
 * - Set AGENT_JWT_RSA_PRIVATE_KEY_PEM and AGENT_JWT_RSA_PUBLIC_KEY_PEM as base64-encoded PEM
 */

import * as crypto from 'crypto';
import { env } from '../config/env';

export interface JWK {
  kty: 'RSA';
  use: 'sig';
  alg: 'RS256';
  kid: string;
  n: string;  // Base64url-encoded modulus
  e: string;  // Base64url-encoded exponent
}

export interface JWKS {
  keys: JWK[];
}

// Cached key pair
let cachedKeyPair: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject; kid: string } | null = null;

/**
 * Convert a buffer to base64url encoding (no padding)
 */
function base64url(buffer: Buffer): string {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generate a key ID from the public key (SHA-256 thumbprint)
 */
function generateKeyId(publicKey: crypto.KeyObject): string {
  const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const hash = crypto.createHash('sha256').update(pem).digest();
  return base64url(hash).slice(0, 16);  // First 16 chars for brevity
}

/**
 * Load keys from environment variables or generate ephemeral keys
 */
function loadOrGenerateKeys(): { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject; kid: string } {
  const privateKeyPem = process.env.AGENT_JWT_RSA_PRIVATE_KEY_PEM;
  const publicKeyPem = process.env.AGENT_JWT_RSA_PUBLIC_KEY_PEM;

  if (privateKeyPem && publicKeyPem) {
    // Load from environment (base64-encoded PEM)
    try {
      const privateKeyDecoded = Buffer.from(privateKeyPem, 'base64').toString('utf8');
      const publicKeyDecoded = Buffer.from(publicKeyPem, 'base64').toString('utf8');

      const privateKey = crypto.createPrivateKey(privateKeyDecoded);
      const publicKey = crypto.createPublicKey(publicKeyDecoded);
      const kid = generateKeyId(publicKey);

      console.log(`[JWT Keys] Loaded RSA key pair from environment (kid: ${kid})`);
      return { publicKey, privateKey, kid };
    } catch (error) {
      console.error('[JWT Keys] Failed to load RSA keys from environment:', error);
      throw new Error('Invalid RSA key configuration');
    }
  }

  // Generate ephemeral keys (development only)
  if (env.NODE_ENV === 'production') {
    console.warn('[JWT Keys] WARNING: No RSA keys configured in production. Generating ephemeral keys.');
    console.warn('[JWT Keys] Set AGENT_JWT_RSA_PRIVATE_KEY_PEM and AGENT_JWT_RSA_PUBLIC_KEY_PEM for persistent keys.');
  } else {
    console.log('[JWT Keys] Generating ephemeral RSA key pair for development');
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const privateKeyObj = crypto.createPrivateKey(privateKey);
  const publicKeyObj = crypto.createPublicKey(publicKey);
  const kid = generateKeyId(publicKeyObj);

  console.log(`[JWT Keys] Generated ephemeral RSA key pair (kid: ${kid})`);
  return { publicKey: publicKeyObj, privateKey: privateKeyObj, kid };
}

/**
 * Get the current key pair (loads/generates on first call)
 */
export function getKeyPair(): { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject; kid: string } {
  if (!cachedKeyPair) {
    cachedKeyPair = loadOrGenerateKeys();
  }
  return cachedKeyPair;
}

/**
 * Get the public key in JWK format
 */
export function getPublicKeyJWK(): JWK {
  const { publicKey, kid } = getKeyPair();

  // Export as JWK object (Node.js 15.9.0+)
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };

  return {
    kty: 'RSA',
    use: 'sig',
    alg: 'RS256',
    kid,
    n: jwk.n,
    e: jwk.e,
  };
}

/**
 * Get the JWKS (JSON Web Key Set) containing all public keys
 */
export function getJWKS(): JWKS {
  return {
    keys: [getPublicKeyJWK()],
  };
}

/**
 * Get the private key for signing JWTs (RS256)
 */
export function getSigningKey(): { key: crypto.KeyObject; kid: string; algorithm: 'RS256' } {
  const { privateKey, kid } = getKeyPair();
  return { key: privateKey, kid, algorithm: 'RS256' };
}

/**
 * Get the public key for verifying JWTs (RS256)
 */
export function getVerifyKey(): { key: crypto.KeyObject; kid: string } {
  const { publicKey, kid } = getKeyPair();
  return { key: publicKey, kid };
}
