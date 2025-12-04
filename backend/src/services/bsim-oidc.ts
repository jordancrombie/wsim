import * as client from 'openid-client';
import crypto from 'crypto';

// BSIM provider configuration type
export interface BsimProviderConfig {
  bsimId: string;
  name: string;
  issuer: string;           // OIDC issuer URL (e.g., https://auth-dev.banksim.ca)
  clientId: string;
  clientSecret: string;
  apiUrl?: string;          // Optional: explicit API base URL (e.g., https://dev.banksim.ca)
  logoUrl?: string;
}

// Cached OIDC configurations per issuer
const configCache = new Map<string, client.Configuration>();

/**
 * Discover OIDC configuration for a BSIM issuer
 */
async function discoverConfig(provider: BsimProviderConfig): Promise<client.Configuration> {
  const cached = configCache.get(provider.issuer);
  if (cached) {
    return cached;
  }

  console.log(`[BSIM OIDC] Discovering configuration for ${provider.issuer}`);

  const config = await client.discovery(
    new URL(provider.issuer),
    provider.clientId,
    provider.clientSecret
  );

  configCache.set(provider.issuer, config);
  return config;
}

/**
 * Generate PKCE code verifier and challenge
 */
export async function generatePkce(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
}

/**
 * Generate random state for CSRF protection
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate random nonce for replay protection
 */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Build authorization URL for wallet enrollment
 */
export async function buildAuthorizationUrl(
  provider: BsimProviderConfig,
  redirectUri: string,
  state: string,
  nonce: string,
  codeChallenge: string
): Promise<string> {
  const config = await discoverConfig(provider);

  const authUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: 'openid profile email wallet:enroll',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return authUrl.href;
}

/**
 * Token response from BSIM
 */
export interface BsimTokenResponse {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresIn: number;
  walletCredential?: string;
  fiUserRef: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(
  provider: BsimProviderConfig,
  redirectUri: string,
  code: string,
  codeVerifier: string,
  expectedState: string,
  expectedNonce: string
): Promise<BsimTokenResponse> {
  const config = await discoverConfig(provider);

  // Build the callback URL with the code
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set('code', code);

  // Exchange code for tokens
  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState,
    expectedNonce,
  });

  // Get claims from id_token
  const claims = tokens.claims();
  if (!claims) {
    throw new Error('No claims in token response');
  }

  // Extract wallet_credential from access token claims if present
  // The BSIM should include this in the access token when wallet:enroll scope is granted
  let walletCredential: string | undefined;

  // Try to get wallet_credential from access token claims
  // openid-client v6 doesn't expose access token claims directly,
  // so we may need to decode it or get it from a userinfo call
  if (tokens.access_token) {
    // For now, store the access token itself as the wallet credential
    // BSIM may return wallet_credential as a separate claim or in the access token
    walletCredential = tokens.access_token;
  }

  return {
    accessToken: tokens.access_token,
    idToken: tokens.id_token || '',
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in || 3600,
    walletCredential,
    fiUserRef: claims.sub as string,
    email: claims.email as string,
    firstName: claims.given_name as string | undefined,
    lastName: claims.family_name as string | undefined,
  };
}

/**
 * Card information from BSIM
 */
export interface BsimCard {
  cardRef: string;
  cardType: string;
  lastFour: string;
  cardholderName: string;
  expiryMonth: number;
  expiryYear: number;
  isActive: boolean;
}

/**
 * Derive the BSIM API base URL from the issuer URL
 * Examples:
 *   https://auth-dev.banksim.ca -> https://dev.banksim.ca
 *   https://auth.banksim.ca -> https://banksim.ca (or https://api.banksim.ca)
 *   http://localhost:3002 -> http://localhost:3001
 */
function getBsimApiUrl(issuer: string): string {
  const url = new URL(issuer);

  // Handle local development (port-based)
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    // Auth is on :3002, API is on :3001
    url.port = '3001';
    return url.origin;
  }

  // Handle dev/prod environments (subdomain-based)
  // auth-dev.banksim.ca -> dev.banksim.ca
  // auth.banksim.ca -> banksim.ca (API at root or api.banksim.ca)
  if (url.hostname.startsWith('auth-')) {
    url.hostname = url.hostname.replace('auth-', '');
  } else if (url.hostname.startsWith('auth.')) {
    url.hostname = url.hostname.replace('auth.', '');
  }

  return url.origin;
}

/**
 * Fetch user's cards from BSIM using wallet credential
 */
export async function fetchCards(
  provider: BsimProviderConfig,
  accessToken: string
): Promise<BsimCard[]> {
  // Use explicit apiUrl if provided, otherwise derive from issuer
  const baseUrl = provider.apiUrl || getBsimApiUrl(provider.issuer);
  const cardsUrl = `${baseUrl}/api/wallet/cards`;

  console.log(`[BSIM OIDC] Fetching cards from ${cardsUrl}`);

  const response = await fetch(cardsUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[BSIM OIDC] Failed to fetch cards: ${response.status} - ${errorText}`);
    throw new Error(`Failed to fetch cards from BSIM: ${response.status}`);
  }

  const data = await response.json() as { cards?: BsimCard[] };
  return data.cards || [];
}

/**
 * Clear the configuration cache (useful for testing or reconnecting)
 */
export function clearConfigCache(): void {
  configCache.clear();
}
