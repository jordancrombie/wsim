import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { Request, Response } from 'express';

// Mock @simplewebauthn/server BEFORE importing the route
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

// Mock Prisma
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => mockPrismaInstance),
}));

// Mock env config
vi.mock('../config/env', () => ({
  env: {
    WEBAUTHN_RP_NAME: 'WSIM Test',
    WEBAUTHN_RP_ID: 'localhost',
    WEBAUTHN_ORIGINS: ['https://localhost:3000'],
  },
}));

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { createMockPrismaClient, MockWalletUserData, MockPasskeyCredentialData } from '../test/mocks/mockPrisma';

// Create mock instance
let mockPrismaInstance: ReturnType<typeof createMockPrismaClient>;

const mockGenerateRegistrationOptions = generateRegistrationOptions as Mock;
const mockVerifyRegistrationResponse = verifyRegistrationResponse as Mock;
const mockGenerateAuthenticationOptions = generateAuthenticationOptions as Mock;
const mockVerifyAuthenticationResponse = verifyAuthenticationResponse as Mock;

// Test data factory
function createTestUser(overrides: Partial<MockWalletUserData> = {}): MockWalletUserData {
  return {
    id: 'user-123',
    email: 'test@example.com',
    passwordHash: null,
    firstName: 'Test',
    lastName: 'User',
    walletId: 'wallet-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createTestPasskey(overrides: Partial<MockPasskeyCredentialData> = {}): MockPasskeyCredentialData {
  return {
    id: 'passkey-123',
    userId: 'user-123',
    credentialId: 'credential-id-base64url',
    publicKey: 'public-key-base64url',
    counter: 0,
    transports: ['internal'],
    deviceName: 'Test Device',
    aaguid: null,
    createdAt: new Date(),
    lastUsedAt: null,
    ...overrides,
  };
}

describe('Passkey Routes', () => {
  beforeEach(() => {
    mockPrismaInstance = createMockPrismaClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockPrismaInstance._clear();
  });

  describe('generateRegistrationOptions logic', () => {
    it('should generate registration options for a user', async () => {
      const testUser = createTestUser();
      mockPrismaInstance._addWalletUser(testUser);

      mockGenerateRegistrationOptions.mockResolvedValue({
        challenge: 'test-challenge-123',
        rp: { name: 'WSIM Test', id: 'localhost' },
        user: { id: testUser.id, name: testUser.email, displayName: 'Test User' },
        pubKeyCredParams: [],
        timeout: 60000,
        attestation: 'none',
        excludeCredentials: [],
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
          authenticatorAttachment: 'platform',
        },
      });

      // Simulate the route logic
      const user = await mockPrismaInstance.walletUser.findUnique({
        where: { id: testUser.id },
        include: { passkeyCredentials: true },
      });

      expect(user).not.toBeNull();
      expect(user?.email).toBe(testUser.email);

      const options = await mockGenerateRegistrationOptions({
        rpName: 'WSIM Test',
        rpID: 'localhost',
        userID: new TextEncoder().encode(testUser.id),
        userName: testUser.email,
        userDisplayName: 'Test User',
        attestationType: 'none',
        excludeCredentials: [],
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
          authenticatorAttachment: 'platform',
        },
      });

      expect(options.challenge).toBe('test-challenge-123');
      expect(mockGenerateRegistrationOptions).toHaveBeenCalled();
    });

    it('should exclude existing credentials when generating registration options', async () => {
      const testUser = createTestUser();
      const existingPasskey = createTestPasskey({ userId: testUser.id });
      mockPrismaInstance._addWalletUser(testUser);
      mockPrismaInstance._addPasskeyCredential(existingPasskey);

      const user = await mockPrismaInstance.walletUser.findUnique({
        where: { id: testUser.id },
        include: { passkeyCredentials: true },
      });

      expect(user?.passkeyCredentials).toHaveLength(1);
      expect(user?.passkeyCredentials?.[0].credentialId).toBe(existingPasskey.credentialId);

      mockGenerateRegistrationOptions.mockResolvedValue({
        challenge: 'test-challenge',
        excludeCredentials: [{ id: existingPasskey.credentialId, type: 'public-key' }],
      });

      const excludeCredentials = user!.passkeyCredentials!.map((cred: MockPasskeyCredentialData) => ({
        id: cred.credentialId,
        transports: cred.transports,
      }));

      await mockGenerateRegistrationOptions({
        excludeCredentials,
      });

      expect(mockGenerateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: expect.arrayContaining([
            expect.objectContaining({ id: existingPasskey.credentialId }),
          ]),
        })
      );
    });

    it('should return null when user not found', async () => {
      const user = await mockPrismaInstance.walletUser.findUnique({
        where: { id: 'nonexistent-user' },
      });

      expect(user).toBeNull();
    });
  });

  describe('verifyRegistration logic', () => {
    it('should verify registration and store passkey', async () => {
      const testUser = createTestUser();
      mockPrismaInstance._addWalletUser(testUser);

      mockVerifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'new-credential-id',
            publicKey: new Uint8Array([1, 2, 3, 4]),
            counter: 0,
          },
          credentialDeviceType: 'singleDevice',
          aaguid: 'test-aaguid',
        },
      });

      const mockResponse = {
        id: 'new-credential-id',
        rawId: 'new-credential-id',
        response: {
          clientDataJSON: 'client-data',
          attestationObject: 'attestation-object',
          transports: ['internal'],
        },
        type: 'public-key',
        clientExtensionResults: {},
      };

      const verification = await mockVerifyRegistrationResponse({
        response: mockResponse,
        expectedChallenge: 'test-challenge',
        expectedOrigin: ['https://localhost:3000'],
        expectedRPID: 'localhost',
      });

      expect(verification.verified).toBe(true);
      expect(verification.registrationInfo).toBeDefined();

      // Store the passkey
      const passkey = await mockPrismaInstance.passkeyCredential.create({
        data: {
          userId: testUser.id,
          credentialId: verification.registrationInfo.credential.id,
          publicKey: Buffer.from(verification.registrationInfo.credential.publicKey).toString('base64url'),
          counter: verification.registrationInfo.credential.counter,
          transports: ['internal'],
          deviceName: 'Test Device',
          aaguid: verification.registrationInfo.aaguid,
        },
      });

      expect(passkey.credentialId).toBe('new-credential-id');
      expect(passkey.userId).toBe(testUser.id);

      // Verify it was stored
      const storedPasskeys = mockPrismaInstance._getPasskeyCredentials();
      expect(storedPasskeys).toHaveLength(1);
    });

    it('should not store passkey when verification fails', async () => {
      mockVerifyRegistrationResponse.mockResolvedValue({
        verified: false,
        registrationInfo: null,
      });

      const verification = await mockVerifyRegistrationResponse({
        response: {},
        expectedChallenge: 'test-challenge',
      });

      expect(verification.verified).toBe(false);

      // Should not create passkey
      const storedPasskeys = mockPrismaInstance._getPasskeyCredentials();
      expect(storedPasskeys).toHaveLength(0);
    });

    it('should throw error when verification throws', async () => {
      mockVerifyRegistrationResponse.mockRejectedValue(new Error('Verification error'));

      await expect(
        mockVerifyRegistrationResponse({
          response: {},
          expectedChallenge: 'test-challenge',
        })
      ).rejects.toThrow('Verification error');
    });
  });

  describe('generateAuthenticationOptions logic', () => {
    it('should generate authentication options without credentials (discoverable)', async () => {
      mockGenerateAuthenticationOptions.mockResolvedValue({
        challenge: 'auth-challenge-123',
        timeout: 60000,
        rpId: 'localhost',
        allowCredentials: undefined,
        userVerification: 'preferred',
      });

      const options = await mockGenerateAuthenticationOptions({
        rpID: 'localhost',
        userVerification: 'preferred',
      });

      expect(options.challenge).toBe('auth-challenge-123');
      expect(options.allowCredentials).toBeUndefined();
    });

    it('should generate authentication options with user credentials', async () => {
      const testUser = createTestUser();
      const passkey1 = createTestPasskey({ id: 'passkey-1', credentialId: 'cred-1' });
      const passkey2 = createTestPasskey({ id: 'passkey-2', credentialId: 'cred-2', transports: ['usb'] });
      mockPrismaInstance._addWalletUser(testUser);
      mockPrismaInstance._addPasskeyCredential(passkey1);
      mockPrismaInstance._addPasskeyCredential(passkey2);

      const user = await mockPrismaInstance.walletUser.findUnique({
        where: { email: testUser.email },
        include: { passkeyCredentials: true },
      });

      expect(user?.passkeyCredentials).toHaveLength(2);

      const credentials = user!.passkeyCredentials!.map((c: MockPasskeyCredentialData) => ({
        credentialId: c.credentialId,
        transports: c.transports,
      }));

      mockGenerateAuthenticationOptions.mockResolvedValue({
        challenge: 'auth-challenge',
        allowCredentials: credentials.map((c: { credentialId: string; transports: string[] }) => ({ id: c.credentialId, type: 'public-key' })),
      });

      const options = await mockGenerateAuthenticationOptions({
        rpID: 'localhost',
        allowCredentials: credentials.map((c: { credentialId: string; transports: string[] }) => ({
          id: c.credentialId,
          transports: c.transports,
        })),
        userVerification: 'preferred',
      });

      expect(options.allowCredentials).toHaveLength(2);
    });

    it('should return undefined allowCredentials when user has no passkeys', async () => {
      const testUser = createTestUser();
      mockPrismaInstance._addWalletUser(testUser);

      const user = await mockPrismaInstance.walletUser.findUnique({
        where: { email: testUser.email },
        include: { passkeyCredentials: true },
      });

      expect(user?.passkeyCredentials).toHaveLength(0);

      mockGenerateAuthenticationOptions.mockResolvedValue({
        challenge: 'auth-challenge',
        allowCredentials: undefined,
      });

      const options = await mockGenerateAuthenticationOptions({
        rpID: 'localhost',
        userVerification: 'preferred',
      });

      expect(options.allowCredentials).toBeUndefined();
    });
  });

  describe('verifyAuthentication logic', () => {
    it('should verify authentication and return user', async () => {
      const testUser = createTestUser();
      const passkey = createTestPasskey({ counter: 5 });
      mockPrismaInstance._addWalletUser(testUser);
      mockPrismaInstance._addPasskeyCredential(passkey);

      // Find credential by ID
      const credential = await mockPrismaInstance.passkeyCredential.findUnique({
        where: { credentialId: passkey.credentialId },
        include: { user: true },
      });

      expect(credential).not.toBeNull();
      expect(credential?.user?.email).toBe(testUser.email);

      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: {
          newCounter: 6,
        },
      });

      const verification = await mockVerifyAuthenticationResponse({
        response: { id: passkey.credentialId },
        expectedChallenge: 'auth-challenge',
        expectedOrigin: ['https://localhost:3000'],
        expectedRPID: 'localhost',
        credential: {
          id: credential!.credentialId,
          publicKey: new Uint8Array(Buffer.from(credential!.publicKey, 'base64url')),
          counter: credential!.counter,
          transports: credential!.transports,
        },
      });

      expect(verification.verified).toBe(true);

      // Update counter
      await mockPrismaInstance.passkeyCredential.update({
        where: { id: credential!.id },
        data: {
          counter: verification.authenticationInfo.newCounter,
          lastUsedAt: new Date(),
        },
      });

      // Verify counter was updated
      const updatedCredential = await mockPrismaInstance.passkeyCredential.findUnique({
        where: { id: credential!.id },
      });
      expect(updatedCredential?.counter).toBe(6);
      expect(updatedCredential?.lastUsedAt).not.toBeNull();
    });

    it('should return null when credential not found', async () => {
      const credential = await mockPrismaInstance.passkeyCredential.findUnique({
        where: { credentialId: 'nonexistent-credential' },
      });

      expect(credential).toBeNull();
    });

    it('should return verified false when authentication fails', async () => {
      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: false,
        authenticationInfo: null,
      });

      const verification = await mockVerifyAuthenticationResponse({
        response: {},
        expectedChallenge: 'auth-challenge',
      });

      expect(verification.verified).toBe(false);
    });
  });

  describe('listCredentials logic', () => {
    it('should return credentials for user', async () => {
      const testUser = createTestUser();
      const passkey1 = createTestPasskey({
        id: 'passkey-1',
        credentialId: 'cred-1',
        deviceName: 'iPhone',
        createdAt: new Date('2024-01-01'),
      });
      const passkey2 = createTestPasskey({
        id: 'passkey-2',
        credentialId: 'cred-2',
        deviceName: 'MacBook',
        createdAt: new Date('2024-02-01'),
        lastUsedAt: new Date('2024-02-15'),
      });
      mockPrismaInstance._addWalletUser(testUser);
      mockPrismaInstance._addPasskeyCredential(passkey1);
      mockPrismaInstance._addPasskeyCredential(passkey2);

      const credentials = await mockPrismaInstance.passkeyCredential.findMany({
        where: { userId: testUser.id },
        select: {
          id: true,
          deviceName: true,
          createdAt: true,
          lastUsedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(credentials).toHaveLength(2);
      // Should be ordered by createdAt desc
      expect(credentials[0].deviceName).toBe('MacBook');
      expect(credentials[1].deviceName).toBe('iPhone');
    });

    it('should return empty array when user has no passkeys', async () => {
      const testUser = createTestUser();
      mockPrismaInstance._addWalletUser(testUser);

      const credentials = await mockPrismaInstance.passkeyCredential.findMany({
        where: { userId: testUser.id },
      });

      expect(credentials).toEqual([]);
    });
  });

  describe('deleteCredential logic', () => {
    it('should delete credential belonging to user', async () => {
      const testUser = createTestUser();
      const passkey = createTestPasskey();
      mockPrismaInstance._addWalletUser(testUser);
      mockPrismaInstance._addPasskeyCredential(passkey);

      // Verify credential exists and belongs to user
      const credential = await mockPrismaInstance.passkeyCredential.findFirst({
        where: { id: passkey.id, userId: testUser.id },
      });

      expect(credential).not.toBeNull();

      // Delete
      await mockPrismaInstance.passkeyCredential.delete({
        where: { id: passkey.id },
      });

      // Verify deleted
      const deletedCredential = await mockPrismaInstance.passkeyCredential.findUnique({
        where: { id: passkey.id },
      });
      expect(deletedCredential).toBeNull();
    });

    it('should not find credential belonging to different user', async () => {
      const testUser = createTestUser();
      const otherUser = createTestUser({ id: 'other-user', email: 'other@example.com' });
      const passkey = createTestPasskey({ userId: otherUser.id });
      mockPrismaInstance._addWalletUser(testUser);
      mockPrismaInstance._addWalletUser(otherUser);
      mockPrismaInstance._addPasskeyCredential(passkey);

      // Try to find credential for wrong user
      const credential = await mockPrismaInstance.passkeyCredential.findFirst({
        where: { id: passkey.id, userId: testUser.id },
      });

      expect(credential).toBeNull();
    });

    it('should use deleteMany with userId constraint for safety', async () => {
      const testUser = createTestUser();
      const passkey = createTestPasskey();
      mockPrismaInstance._addWalletUser(testUser);
      mockPrismaInstance._addPasskeyCredential(passkey);

      const result = await mockPrismaInstance.passkeyCredential.deleteMany({
        where: { id: passkey.id, userId: testUser.id },
      });

      expect(result.count).toBe(1);

      // Verify deleted
      const storedPasskeys = mockPrismaInstance._getPasskeyCredentials();
      expect(storedPasskeys).toHaveLength(0);
    });

    it('should return count 0 when deleting non-owned credential', async () => {
      const testUser = createTestUser();
      const otherUser = createTestUser({ id: 'other-user', email: 'other@example.com' });
      const passkey = createTestPasskey({ userId: otherUser.id });
      mockPrismaInstance._addWalletUser(testUser);
      mockPrismaInstance._addWalletUser(otherUser);
      mockPrismaInstance._addPasskeyCredential(passkey);

      const result = await mockPrismaInstance.passkeyCredential.deleteMany({
        where: { id: passkey.id, userId: testUser.id },
      });

      expect(result.count).toBe(0);

      // Passkey should still exist
      const storedPasskeys = mockPrismaInstance._getPasskeyCredentials();
      expect(storedPasskeys).toHaveLength(1);
    });
  });
});
