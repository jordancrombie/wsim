import * as client from 'openid-client';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { encrypt, decrypt } from '../utils/crypto';

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

  const requestedScope = 'openid profile email wallet:enroll fdx:accountdetailed:read offline_access';
  console.log('[BSIM OIDC] === AUTHORIZATION URL BUILD START ===');
  console.log('[BSIM OIDC] Provider:', provider.bsimId, provider.issuer);
  console.log('[BSIM OIDC] Requested scope string:', JSON.stringify(requestedScope));
  console.log('[BSIM OIDC] Scope includes offline_access:', requestedScope.includes('offline_access'));

  const authUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: requestedScope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'login', // Force BSIM to show login screen even if user has existing session
  });

  // Detailed URL analysis
  const scopeParam = authUrl.searchParams.get('scope');
  console.log('[BSIM OIDC] Generated URL scope param:', JSON.stringify(scopeParam));
  console.log('[BSIM OIDC] Scope param includes offline_access:', scopeParam?.includes('offline_access'));
  console.log('[BSIM OIDC] Full URL:', authUrl.href);

  // Check if URL-encoded scope contains offline_access
  const urlStr = authUrl.href;
  console.log('[BSIM OIDC] URL contains "offline_access":', urlStr.includes('offline_access'));
  console.log('[BSIM OIDC] URL contains encoded "offline_access":', urlStr.includes(encodeURIComponent('offline_access')));
  console.log('[BSIM OIDC] === AUTHORIZATION URL BUILD END ===');

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

  // Log token response details for debugging refresh token issues
  console.log('[BSIM OIDC] Token response keys:', Object.keys(tokens));
  console.log('[BSIM OIDC] Has access_token:', !!tokens.access_token);
  console.log('[BSIM OIDC] Has id_token:', !!tokens.id_token);
  console.log('[BSIM OIDC] Has refresh_token:', !!tokens.refresh_token);
  console.log('[BSIM OIDC] expires_in:', tokens.expires_in);
  if (tokens.refresh_token) {
    console.log('[BSIM OIDC] Refresh token received (first 20 chars):', tokens.refresh_token.substring(0, 20) + '...');
  } else {
    console.warn('[BSIM OIDC] WARNING: No refresh_token in response - offline_access scope may not be granted');
  }

  // Get claims from id_token
  const claims = tokens.claims();
  if (!claims) {
    throw new Error('No claims in token response');
  }

  // Extract wallet_credential and bsim_user_id from access token claims
  // BSIM includes these as custom claims when wallet:enroll scope is granted
  let walletCredential: string | undefined;
  // fiUserRef will be set to bsim_user_id (internal BSIM user ID) for P2P transfer compatibility
  // BSIM accounts are owned by this ID, so TransferSim/P2P needs this to validate account ownership
  let fiUserRef: string = claims.sub as string; // Default to sub claim

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
        // IMPORTANT: Prefer bsim_user_id over fi_user_ref for P2P transfers
        // bsim_user_id is the internal BSIM user ID that owns the accounts
        // fi_user_ref is an external pseudonymous identifier (used for Open Banking privacy)
        if (payload.bsim_user_id) {
          fiUserRef = payload.bsim_user_id;
          console.log('[BSIM OIDC] Using bsim_user_id for P2P:', payload.bsim_user_id);
        } else if (payload.fi_user_ref) {
          // Fallback to fi_user_ref if bsim_user_id not available (older BSIM versions)
          fiUserRef = payload.fi_user_ref;
          console.warn('[BSIM OIDC] bsim_user_id not found, falling back to fi_user_ref (P2P may not work)');
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
 * Derive the BSIM Open Banking API base URL from the issuer URL
 * Examples:
 *   https://auth-dev.banksim.ca -> https://openbanking-dev.banksim.ca
 *   https://auth.banksim.ca -> https://openbanking.banksim.ca
 *   http://localhost:3002 -> http://localhost:3004
 */
function getBsimOpenBankingUrl(provider: BsimProviderConfig): string {
  // If provider has explicit openbankingUrl, use it
  if ((provider as any).openbankingUrl) {
    return (provider as any).openbankingUrl;
  }

  // Derive from issuer (similar to getBsimApiUrl pattern)
  const url = new URL(provider.issuer);

  // Handle local development (port-based)
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    // Auth is on :3002, openbanking is on :3004
    url.port = '3004';
    return url.origin;
  }

  // Handle dev/prod environments (subdomain-based)
  // auth-dev.banksim.ca → openbanking-dev.banksim.ca
  // auth.banksim.ca → openbanking.banksim.ca
  if (url.hostname.startsWith('auth-')) {
    url.hostname = url.hostname.replace('auth-', 'openbanking-');
  } else if (url.hostname.startsWith('auth.')) {
    url.hostname = url.hostname.replace('auth.', 'openbanking.');
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
 * Refresh BSIM OAuth tokens using refresh token
 * @param provider - BSIM provider configuration
 * @param refreshToken - The refresh token from BsimEnrollment (decrypted)
 * @returns New tokens or null if refresh failed
 */
export async function refreshBsimToken(
  provider: BsimProviderConfig,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  try {
    console.log(`[BSIM OIDC] Refreshing BSIM token for ${provider.bsimId}`);

    const tokenUrl = `${provider.issuer}/token`;
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[BSIM OIDC] Token refresh failed: ${response.status} - ${errorText}`);
      return null;
    }

    const tokens = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    console.log(`[BSIM OIDC] Token refreshed successfully for ${provider.bsimId}`);

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken, // Some servers don't rotate
      expiresIn: tokens.expires_in,
    };
  } catch (error) {
    console.error('[BSIM OIDC] Token refresh exception:', error);
    return null;
  }
}

/**
 * Result of a safe token refresh operation
 */
export type SafeRefreshResult =
  | { success: true; accessToken: string; expiresAt: Date }
  | { success: false; error: 'no_refresh_token' | 'refresh_failed' | 'save_failed' | 'needs_reenrollment'; message: string };

/**
 * Safely refresh BSIM tokens with atomic database update
 *
 * IMPORTANT: BSIM uses refresh token rotation. When we call refresh:
 * 1. BSIM immediately invalidates the old refresh token
 * 2. BSIM returns a new refresh token
 * 3. If we fail to save the new token, it's LOST FOREVER
 *
 * This function ensures the new refresh token is persisted before returning,
 * with retry logic to handle transient database failures.
 *
 * @param enrollmentId - BsimEnrollment.id to update
 * @param provider - BSIM provider configuration
 * @param encryptedRefreshToken - The encrypted refresh token from database
 * @returns SafeRefreshResult with success status and new access token
 */
export async function safeRefreshBsimToken(
  enrollmentId: string,
  provider: BsimProviderConfig,
  encryptedRefreshToken: string
): Promise<SafeRefreshResult> {
  const logPrefix = `[BSIM OIDC:${enrollmentId.slice(0, 8)}]`;

  // Decrypt the stored refresh token
  let decryptedRefreshToken: string;
  try {
    decryptedRefreshToken = decrypt(encryptedRefreshToken);
  } catch (err) {
    console.error(`${logPrefix} Failed to decrypt refresh token:`, err);
    return {
      success: false,
      error: 'needs_reenrollment',
      message: 'Refresh token could not be decrypted',
    };
  }

  console.log(`${logPrefix} Attempting token refresh for ${provider.bsimId}...`);

  // Call BSIM to refresh - this INVALIDATES the old token immediately
  const refreshResult = await refreshBsimToken(provider, decryptedRefreshToken);

  if (!refreshResult) {
    console.error(`${logPrefix} BSIM token refresh failed - user needs to re-enroll`);
    return {
      success: false,
      error: 'refresh_failed',
      message: 'Token refresh was rejected by the bank. Please re-enroll.',
    };
  }

  // CRITICAL: We now have a new refresh token that MUST be persisted
  // The old token is already invalidated by BSIM
  const expiresAt = new Date(Date.now() + refreshResult.expiresIn * 1000);

  // Retry logic for database save (handle transient failures)
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await prisma.bsimEnrollment.update({
        where: { id: enrollmentId },
        data: {
          accessToken: encrypt(refreshResult.accessToken),
          refreshToken: encrypt(refreshResult.refreshToken),
          credentialExpiry: expiresAt,
        },
      });

      console.log(`${logPrefix} Token refresh successful, new expiry: ${expiresAt.toISOString()}`);
      return {
        success: true,
        accessToken: refreshResult.accessToken,
        expiresAt,
      };
    } catch (err) {
      lastError = err as Error;
      console.error(`${logPrefix} Failed to save refresh token (attempt ${attempt}/${MAX_RETRIES}):`, err);

      if (attempt < MAX_RETRIES) {
        // Exponential backoff: 100ms, 400ms, 900ms
        const delay = attempt * attempt * 100;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed - this is critical because the new token is lost
  console.error(`${logPrefix} CRITICAL: Failed to persist new refresh token after ${MAX_RETRIES} attempts!`);
  console.error(`${logPrefix} New access token received but refresh token not saved - user may need to re-enroll`);
  console.error(`${logPrefix} Last error:`, lastError);

  // Return the access token we did receive, but flag the save failure
  // The caller should still use this access token but know the refresh token wasn't saved
  return {
    success: false,
    error: 'save_failed',
    message: 'Token refreshed but failed to save. Please try again or re-enroll if issues persist.',
  };
}

/**
 * BSIM Open Banking account response format
 */
interface BsimAccountResponse {
  accountId: string;
  accountNumber: string;
  accountType: string;
  status: string;
  currency: { currencyCode: string };
  balance: {
    current: number;
    available: number;
    asOf: string;
  };
  accountHolder: { name: string };
}

/**
 * Normalized account format for mwsim mobile app
 * Field names match mwsim API contract for P2P "From Account" selection
 */
export interface BsimAccount {
  accountId: string;
  accountType: string;
  displayName: string;
  balance: number;
  currency: string;
  bankName: string;
  bankLogoUrl: string | null;
  bsimId: string;
}

/**
 * Fetch user's bank accounts from BSIM Open Banking API
 * @param provider - BSIM provider configuration
 * @param accessToken - The OAuth access token with fdx:accountdetailed:read scope
 * @returns Array of accounts from this BSIM
 */
export async function fetchAccounts(
  provider: BsimProviderConfig,
  accessToken: string
): Promise<BsimAccount[]> {
  const baseUrl = getBsimOpenBankingUrl(provider);
  const accountsUrl = `${baseUrl}/accounts`;

  console.log(`[BSIM OIDC] Fetching accounts from ${accountsUrl} using access token`);

  const response = await fetch(accountsUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[BSIM OIDC] Failed to fetch accounts: ${response.status} - ${errorText}`);
    throw new Error(`Failed to fetch accounts from BSIM: ${response.status}`);
  }

  const data = await response.json() as { accounts?: BsimAccountResponse[] };
  const rawAccounts = data.accounts || [];

  // Transform BSIM response format to mwsim expected format
  return rawAccounts.map(account => ({
    accountId: account.accountId,
    accountType: account.accountType,
    displayName: `${account.accountType} ${account.accountNumber}`,
    balance: account.balance.current,
    currency: account.currency.currencyCode,
    bankName: provider.name,
    bankLogoUrl: provider.logoUrl || null,
    bsimId: provider.bsimId,
  }));
}

/**
 * Clear the configuration cache (useful for testing or reconnecting)
 */
export function clearConfigCache(): void {
  configCache.clear();
}
