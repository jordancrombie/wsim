// BSIM OIDC Service Tests
// Tests for OIDC/OAuth flows with BSIM providers

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generatePkce,
  generateState,
  generateNonce,
  buildAuthorizationUrl,
  exchangeCode,
  fetchCards,
  clearConfigCache,
  BsimProviderConfig,
} from './bsim-oidc';

// Mock openid-client
vi.mock('openid-client', () => ({
  randomPKCECodeVerifier: vi.fn(() => 'test-code-verifier-12345'),
  calculatePKCECodeChallenge: vi.fn(async () => 'test-code-challenge-sha256'),
  discovery: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  authorizationCodeGrant: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import * as client from 'openid-client';

const mockProvider: BsimProviderConfig = {
  bsimId: 'test-bank',
  name: 'Test Bank',
  issuer: 'https://auth.testbank.ca',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
};

const mockLocalProvider: BsimProviderConfig = {
  bsimId: 'local-bank',
  name: 'Local Bank',
  issuer: 'http://localhost:3002',
  clientId: 'local-client-id',
  clientSecret: 'local-client-secret',
};

describe('BSIM OIDC Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearConfigCache();
  });

  afterEach(() => {
    clearConfigCache();
  });

  describe('generatePkce', () => {
    it('should generate code verifier and challenge', async () => {
      const pkce = await generatePkce();

      expect(pkce).toHaveProperty('codeVerifier');
      expect(pkce).toHaveProperty('codeChallenge');
      expect(pkce.codeVerifier).toBe('test-code-verifier-12345');
      expect(pkce.codeChallenge).toBe('test-code-challenge-sha256');
    });

    it('should call openid-client PKCE functions', async () => {
      await generatePkce();

      expect(client.randomPKCECodeVerifier).toHaveBeenCalled();
      expect(client.calculatePKCECodeChallenge).toHaveBeenCalledWith('test-code-verifier-12345');
    });
  });

  describe('generateState', () => {
    it('should generate a random hex string', () => {
      const state = generateState();

      expect(state).toBeDefined();
      expect(typeof state).toBe('string');
      // 16 bytes = 32 hex characters
      expect(state).toHaveLength(32);
      expect(/^[0-9a-f]+$/.test(state)).toBe(true);
    });

    it('should generate unique values on each call', () => {
      const state1 = generateState();
      const state2 = generateState();

      expect(state1).not.toBe(state2);
    });
  });

  describe('generateNonce', () => {
    it('should generate a random hex string', () => {
      const nonce = generateNonce();

      expect(nonce).toBeDefined();
      expect(typeof nonce).toBe('string');
      // 16 bytes = 32 hex characters
      expect(nonce).toHaveLength(32);
      expect(/^[0-9a-f]+$/.test(nonce)).toBe(true);
    });

    it('should generate unique values on each call', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('buildAuthorizationUrl', () => {
    it('should discover config and build authorization URL', async () => {
      const mockConfig = { serverMetadata: () => ({ issuer: 'https://auth.testbank.ca' }) };
      const mockUrl = new URL('https://auth.testbank.ca/authorize?response_type=code');

      vi.mocked(client.discovery).mockResolvedValueOnce(mockConfig as any);
      vi.mocked(client.buildAuthorizationUrl).mockReturnValueOnce(mockUrl);

      const authUrl = await buildAuthorizationUrl(
        mockProvider,
        'https://wallet.ca/callback',
        'test-state',
        'test-nonce',
        'test-challenge'
      );

      expect(client.discovery).toHaveBeenCalledWith(
        new URL('https://auth.testbank.ca'),
        'test-client-id',
        'test-client-secret'
      );

      expect(client.buildAuthorizationUrl).toHaveBeenCalledWith(
        mockConfig,
        expect.objectContaining({
          redirect_uri: 'https://wallet.ca/callback',
          scope: 'openid profile email wallet:enroll fdx:accountdetailed:read offline_access',
          state: 'test-state',
          nonce: 'test-nonce',
          code_challenge: 'test-challenge',
          code_challenge_method: 'S256',
          prompt: 'login',
        })
      );

      expect(authUrl).toBe('https://auth.testbank.ca/authorize?response_type=code');
    });

    it('should cache discovered config', async () => {
      const mockConfig = { serverMetadata: () => ({ issuer: 'https://auth.testbank.ca' }) };
      const mockUrl = new URL('https://auth.testbank.ca/authorize');

      vi.mocked(client.discovery).mockResolvedValueOnce(mockConfig as any);
      vi.mocked(client.buildAuthorizationUrl).mockReturnValue(mockUrl);

      // First call should discover
      await buildAuthorizationUrl(mockProvider, 'https://callback', 'state1', 'nonce1', 'challenge1');
      expect(client.discovery).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await buildAuthorizationUrl(mockProvider, 'https://callback', 'state2', 'nonce2', 'challenge2');
      expect(client.discovery).toHaveBeenCalledTimes(1);
    });
  });

  describe('exchangeCode', () => {
    it('should exchange code for tokens and extract claims', async () => {
      const mockConfig = { serverMetadata: () => ({ issuer: 'https://auth.testbank.ca' }) };

      // Create a mock access token JWT with custom claims
      const accessTokenPayload = {
        sub: 'user-123',
        wallet_credential: 'wcred_test_credential',
        fi_user_ref: 'fi-user-ref-456',
      };
      const mockAccessToken = `header.${Buffer.from(JSON.stringify(accessTokenPayload)).toString('base64url')}.signature`;

      const mockTokenResponse = {
        access_token: mockAccessToken,
        id_token: 'mock-id-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        claims: () => ({
          sub: 'user-123',
          email: 'test@example.com',
          given_name: 'Test',
          family_name: 'User',
        }),
      };

      vi.mocked(client.discovery).mockResolvedValueOnce(mockConfig as any);
      vi.mocked(client.authorizationCodeGrant).mockResolvedValueOnce(mockTokenResponse as any);

      const result = await exchangeCode(
        mockProvider,
        'https://wallet.ca/callback',
        'auth-code-123',
        'code-verifier-xyz',
        'expected-state',
        'expected-nonce'
      );

      expect(client.authorizationCodeGrant).toHaveBeenCalledWith(
        mockConfig,
        expect.any(URL),
        {
          pkceCodeVerifier: 'code-verifier-xyz',
          expectedState: 'expected-state',
          expectedNonce: 'expected-nonce',
        }
      );

      expect(result).toEqual({
        accessToken: mockAccessToken,
        idToken: 'mock-id-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
        walletCredential: 'wcred_test_credential',
        fiUserRef: 'fi-user-ref-456',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
      });
    });

    it('should use sub as fiUserRef if fi_user_ref not in token', async () => {
      const mockConfig = { serverMetadata: () => ({ issuer: 'https://auth.testbank.ca' }) };

      // Access token without fi_user_ref
      const accessTokenPayload = { sub: 'user-only-sub' };
      const mockAccessToken = `header.${Buffer.from(JSON.stringify(accessTokenPayload)).toString('base64url')}.signature`;

      const mockTokenResponse = {
        access_token: mockAccessToken,
        id_token: 'mock-id-token',
        expires_in: 3600,
        claims: () => ({
          sub: 'user-only-sub',
          email: 'test@example.com',
        }),
      };

      vi.mocked(client.discovery).mockResolvedValueOnce(mockConfig as any);
      vi.mocked(client.authorizationCodeGrant).mockResolvedValueOnce(mockTokenResponse as any);

      const result = await exchangeCode(
        mockProvider,
        'https://wallet.ca/callback',
        'code',
        'verifier',
        'state',
        'nonce'
      );

      expect(result.fiUserRef).toBe('user-only-sub');
    });

    it('should throw if no claims in token response', async () => {
      const mockConfig = { serverMetadata: () => ({ issuer: 'https://auth.testbank.ca' }) };

      const mockTokenResponse = {
        access_token: 'token',
        claims: () => null,
      };

      vi.mocked(client.discovery).mockResolvedValueOnce(mockConfig as any);
      vi.mocked(client.authorizationCodeGrant).mockResolvedValueOnce(mockTokenResponse as any);

      await expect(
        exchangeCode(mockProvider, 'https://callback', 'code', 'verifier', 'state', 'nonce')
      ).rejects.toThrow('No claims in token response');
    });

    it('should handle malformed access token gracefully', async () => {
      const mockConfig = { serverMetadata: () => ({ issuer: 'https://auth.testbank.ca' }) };

      const mockTokenResponse = {
        access_token: 'not-a-jwt', // Invalid JWT
        id_token: 'mock-id-token',
        expires_in: 3600,
        claims: () => ({
          sub: 'user-123',
          email: 'test@example.com',
        }),
      };

      vi.mocked(client.discovery).mockResolvedValueOnce(mockConfig as any);
      vi.mocked(client.authorizationCodeGrant).mockResolvedValueOnce(mockTokenResponse as any);

      const result = await exchangeCode(
        mockProvider,
        'https://callback',
        'code',
        'verifier',
        'state',
        'nonce'
      );

      // Should still return valid result, just without wallet_credential
      expect(result.email).toBe('test@example.com');
      expect(result.fiUserRef).toBe('user-123');
      expect(result.walletCredential).toBeUndefined();
    });
  });

  describe('fetchCards', () => {
    it('should fetch cards from BSIM API using wallet credential', async () => {
      const mockCards = {
        cards: [
          {
            id: 'card-1',
            cardType: 'VISA',
            lastFour: '4242',
            cardHolder: 'Test User',
            expiryMonth: 12,
            expiryYear: 2025,
          },
          {
            id: 'card-2',
            cardType: 'MC',
            lastFour: '5555',
            cardHolder: 'Test User',
            expiryMonth: 6,
            expiryYear: 2026,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCards,
      });

      const cards = await fetchCards(mockProvider, 'wcred_test_credential');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://testbank.ca/api/wallet/cards',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer wcred_test_credential',
            'Content-Type': 'application/json',
          },
        }
      );

      expect(cards).toHaveLength(2);
      expect(cards[0]).toEqual({
        cardRef: 'card-1',
        cardType: 'VISA',
        lastFour: '4242',
        cardholderName: 'Test User',
        expiryMonth: 12,
        expiryYear: 2025,
        isActive: true,
      });
    });

    it('should derive API URL from issuer (auth subdomain)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cards: [] }),
      });

      await fetchCards(mockProvider, 'credential');

      // auth.testbank.ca -> testbank.ca
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testbank.ca/api/wallet/cards',
        expect.any(Object)
      );
    });

    it('should derive API URL from issuer (auth-dev subdomain)', async () => {
      const devProvider = {
        ...mockProvider,
        issuer: 'https://auth-dev.testbank.ca',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cards: [] }),
      });

      await fetchCards(devProvider, 'credential');

      // auth-dev.testbank.ca -> dev.testbank.ca
      expect(mockFetch).toHaveBeenCalledWith(
        'https://dev.testbank.ca/api/wallet/cards',
        expect.any(Object)
      );
    });

    it('should derive API URL from local issuer (port-based)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cards: [] }),
      });

      await fetchCards(mockLocalProvider, 'credential');

      // localhost:3002 -> localhost:3001
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/wallet/cards',
        expect.any(Object)
      );
    });

    it('should use explicit apiUrl if provided', async () => {
      const providerWithApiUrl = {
        ...mockProvider,
        apiUrl: 'https://api.custom-bank.com',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cards: [] }),
      });

      await fetchCards(providerWithApiUrl, 'credential');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.custom-bank.com/api/wallet/cards',
        expect.any(Object)
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(fetchCards(mockProvider, 'invalid-credential')).rejects.toThrow(
        'Failed to fetch cards from BSIM: 401'
      );
    });

    it('should handle empty cards array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cards: [] }),
      });

      const cards = await fetchCards(mockProvider, 'credential');

      expect(cards).toEqual([]);
    });

    it('should handle missing cards property in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const cards = await fetchCards(mockProvider, 'credential');

      expect(cards).toEqual([]);
    });
  });

  describe('clearConfigCache', () => {
    it('should clear the cached configurations', async () => {
      const mockConfig = { serverMetadata: () => ({ issuer: 'https://auth.testbank.ca' }) };
      const mockUrl = new URL('https://auth.testbank.ca/authorize');

      vi.mocked(client.discovery).mockResolvedValue(mockConfig as any);
      vi.mocked(client.buildAuthorizationUrl).mockReturnValue(mockUrl);

      // First call - should discover
      await buildAuthorizationUrl(mockProvider, 'https://callback', 'state1', 'nonce1', 'challenge1');
      expect(client.discovery).toHaveBeenCalledTimes(1);

      // Clear cache
      clearConfigCache();

      // Next call - should discover again since cache was cleared
      await buildAuthorizationUrl(mockProvider, 'https://callback', 'state2', 'nonce2', 'challenge2');
      expect(client.discovery).toHaveBeenCalledTimes(2);
    });
  });
});
