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

  // Build the callback URL with all required parameters
  // oauth4webapi validates the callback URL contains: code, state, and iss (RFC 9207)
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', expectedState);
  callbackUrl.searchParams.set('iss', provider.issuer);

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

  // Extract wallet_credential from access token claims
  // BSIM includes this as a custom claim when wallet:enroll scope is granted
  let walletCredential: string | undefined;
  let fiUserRef: string = claims.sub as string;

  if (tokens.access_token) {
    // Decode the access token JWT to extract custom claims
    // Access tokens are JWTs with payload in the second segment
    try {
      const parts = tokens.access_token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
        console.log('[BSIM OIDC] Access token claims:', Object.keys(payload));

        if (payload.wallet_credential) {
          walletCredential = payload.wallet_credential;
          console.log('[BSIM OIDC] Found wallet_credential in access token');
        }
        if (payload.fi_user_ref) {
          fiUserRef = payload.fi_user_ref;
        }
      }
    } catch (err) {
      console.warn('[BSIM OIDC] Failed to decode access token:', err);
    }
  }

  return {
    accessToken: tokens.access_token,
    idToken: tokens.id_token || '',
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in || 3600,
    walletCredential,
    fiUserRef,
    email: claims.email as string,
    firstName: claims.given_name as string | undefined,
    lastName: claims.family_name as string | undefined,
  };
}

/**
 * Raw card response from BSIM API
 */
interface BsimCardResponse {
  id: string;
  cardType: string;
  lastFour: string;
  cardHolder: string;
  expiryMonth: number;
  expiryYear: number;
}

/**
 * Normalized card information from BSIM
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
 * @param provider - BSIM provider configuration
 * @param walletCredential - The wallet credential token (wcred_xxx) from BSIM, NOT the access token
 */
export async function fetchCards(
  provider: BsimProviderConfig,
  walletCredential: string
): Promise<BsimCard[]> {
  // Use explicit apiUrl if provided, otherwise derive from issuer
  const baseUrl = provider.apiUrl || getBsimApiUrl(provider.issuer);
  const cardsUrl = `${baseUrl}/api/wallet/cards`;

  console.log(`[BSIM OIDC] Fetching cards from ${cardsUrl} using wallet credential`);

  const response = await fetch(cardsUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${walletCredential}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[BSIM OIDC] Failed to fetch cards: ${response.status} - ${errorText}`);
    throw new Error(`Failed to fetch cards from BSIM: ${response.status}`);
  }

  const data = await response.json() as { cards?: BsimCardResponse[] };
  const rawCards = data.cards || [];

  // Transform BSIM response format to our normalized format
  return rawCards.map(card => ({
    cardRef: card.id,           // BSIM uses 'id', we use 'cardRef'
    cardType: card.cardType,
    lastFour: card.lastFour,
    cardholderName: card.cardHolder, // BSIM uses 'cardHolder', we use 'cardholderName'
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    isActive: true,             // BSIM doesn't have isActive, assume true
  }));
}

/**
 * Clear the configuration cache (useful for testing or reconnecting)
 */
export function clearConfigCache(): void {
  configCache.clear();
}
