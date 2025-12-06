import { Router, Request, Response } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

const prisma = new PrismaClient();
const router = Router();

// In-memory challenge storage (use Redis in production)
const challengeStore = new Map<string, { challenge: string; expiresAt: number }>();

// Clean up expired challenges periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of challengeStore.entries()) {
    if (value.expiresAt < now) {
      challengeStore.delete(key);
    }
  }
}, 60000); // Every minute

/**
 * Store a challenge for a user
 */
function storeChallenge(userId: string, challenge: string): void {
  challengeStore.set(userId, {
    challenge,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Get and consume a challenge for a user
 */
function getChallenge(userId: string): string | null {
  const stored = challengeStore.get(userId);
  if (!stored || stored.expiresAt < Date.now()) {
    challengeStore.delete(userId);
    return null;
  }
  challengeStore.delete(userId);
  return stored.challenge;
}

/**
 * Middleware to require authenticated user
 */
function requireAuth(req: Request, res: Response, next: () => void) {
  const userId = (req.session as { userId?: string })?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  (req as Request & { userId: string }).userId = userId;
  next();
}

/**
 * POST /api/passkey/register/options
 * Generate registration options for a new passkey
 */
router.post('/register/options', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;

    // Get user info
    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      include: { passkeyCredentials: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get existing credentials to exclude
    const existingCredentials = user.passkeyCredentials.map((cred) => ({
      id: cred.credentialId, // Already base64url encoded
      transports: cred.transports as AuthenticatorTransportFuture[],
    }));

    const options = await generateRegistrationOptions({
      rpName: env.WEBAUTHN_RP_NAME,
      rpID: env.WEBAUTHN_RP_ID,
      userID: new TextEncoder().encode(userId),
      userName: user.email,
      userDisplayName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      attestationType: 'none', // We don't need attestation for this use case
      excludeCredentials: existingCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform', // Prefer platform authenticators (Face ID, Touch ID)
      },
    });

    // Store challenge for verification
    storeChallenge(userId, options.challenge);

    res.json(options);
  } catch (error) {
    console.error('[Passkey] Registration options error:', error);
    res.status(500).json({ error: 'Failed to generate registration options' });
  }
});

/**
 * POST /api/passkey/register/verify
 * Verify registration response and store credential
 */
router.post('/register/verify', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { response, deviceName } = req.body as {
      response: RegistrationResponseJSON;
      deviceName?: string;
    };

    if (!response) {
      return res.status(400).json({ error: 'Missing registration response' });
    }

    // Get stored challenge
    const expectedChallenge = getChallenge(userId);
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge expired or not found' });
    }

    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: env.WEBAUTHN_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
      });
    } catch (verifyError) {
      console.error('[Passkey] Verification failed:', verifyError);
      return res.status(400).json({ error: 'Verification failed' });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    const { credential, credentialDeviceType, aaguid } = verification.registrationInfo;

    // Store the credential
    // Note: credential.id is already a Base64URLString in @simplewebauthn/server v13+
    // credential.publicKey is a Uint8Array that needs to be encoded
    const passkey = await prisma.passkeyCredential.create({
      data: {
        userId,
        credentialId: credential.id, // Already base64url encoded string
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: response.response.transports || [],
        deviceName: deviceName || credentialDeviceType || 'Unknown device',
        aaguid: aaguid || null,
      },
    });

    console.log(`[Passkey] Registered new passkey for user ${userId.substring(0, 8)}...`);

    res.json({
      success: true,
      credential: {
        id: passkey.id,
        deviceName: passkey.deviceName,
        createdAt: passkey.createdAt,
      },
    });
  } catch (error) {
    console.error('[Passkey] Registration verify error:', error);
    res.status(500).json({ error: 'Failed to verify registration' });
  }
});

/**
 * POST /api/passkey/authenticate/options
 * Generate authentication options
 */
router.post('/authenticate/options', async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email?: string };

    // For popup/embedded flows, we may have a session already
    const sessionUserId = (req.session as { userId?: string })?.userId;

    let userId: string | undefined;
    let credentials: { credentialId: string; transports: string[] }[] = [];

    if (sessionUserId) {
      // User is already logged in, get their credentials
      userId = sessionUserId;
      const user = await prisma.walletUser.findUnique({
        where: { id: userId },
        include: { passkeyCredentials: true },
      });
      if (user) {
        credentials = user.passkeyCredentials.map((c) => ({
          credentialId: c.credentialId,
          transports: c.transports,
        }));
      }
    } else if (email) {
      // Look up user by email
      const user = await prisma.walletUser.findUnique({
        where: { email },
        include: { passkeyCredentials: true },
      });
      if (user) {
        userId = user.id;
        credentials = user.passkeyCredentials.map((c) => ({
          credentialId: c.credentialId,
          transports: c.transports,
        }));
      }
    }

    if (!userId || credentials.length === 0) {
      // Return options for discoverable credentials (resident keys)
      const options = await generateAuthenticationOptions({
        rpID: env.WEBAUTHN_RP_ID,
        userVerification: 'preferred',
        // No allowCredentials = discoverable credential flow
      });

      // Store challenge with a temporary key
      const tempKey = `anon_${options.challenge.substring(0, 16)}`;
      storeChallenge(tempKey, options.challenge);

      return res.json({
        ...options,
        _tempKey: tempKey, // Client will send this back
      });
    }

    const options = await generateAuthenticationOptions({
      rpID: env.WEBAUTHN_RP_ID,
      allowCredentials: credentials.map((c) => ({
        id: c.credentialId, // Already base64url encoded
        // Prefer internal (platform) authenticator over hybrid (QR code)
        // This helps avoid the QR code prompt when the passkey is available locally
        transports: c.transports.includes('internal')
          ? ['internal'] as AuthenticatorTransportFuture[]
          : c.transports as AuthenticatorTransportFuture[],
      })),
      userVerification: 'preferred',
    });

    storeChallenge(userId, options.challenge);

    res.json(options);
  } catch (error) {
    console.error('[Passkey] Authentication options error:', error);
    res.status(500).json({ error: 'Failed to generate authentication options' });
  }
});

/**
 * POST /api/passkey/authenticate/verify
 * Verify authentication response
 */
router.post('/authenticate/verify', async (req: Request, res: Response) => {
  try {
    const { response, _tempKey } = req.body as {
      response: AuthenticationResponseJSON;
      _tempKey?: string;
    };

    if (!response) {
      return res.status(400).json({ error: 'Missing authentication response' });
    }

    // Find the credential
    const credential = await prisma.passkeyCredential.findUnique({
      where: { credentialId: response.id },
      include: { user: true },
    });

    if (!credential) {
      console.log(`[Passkey] Credential not found for ID: ${response.id.substring(0, 10)}...`);
      return res.status(400).json({ error: 'Credential not found' });
    }

    // Get the challenge - try user ID first, then temp key
    let expectedChallenge = getChallenge(credential.userId);
    if (!expectedChallenge && _tempKey) {
      expectedChallenge = getChallenge(_tempKey);
    }

    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge expired or not found' });
    }

    let verification: VerifiedAuthenticationResponse;
    try {
      const publicKeyBuffer = Buffer.from(credential.publicKey, 'base64url');
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: env.WEBAUTHN_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
        credential: {
          id: credential.credentialId, // Already base64url encoded string
          publicKey: new Uint8Array(publicKeyBuffer),
          counter: credential.counter,
          transports: credential.transports as AuthenticatorTransportFuture[],
        },
      });
    } catch (verifyError) {
      console.error('[Passkey] Auth verification failed:', verifyError);
      return res.status(400).json({ error: 'Verification failed' });
    }

    if (!verification.verified) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    // Update counter to prevent replay attacks
    await prisma.passkeyCredential.update({
      where: { id: credential.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    // Set session
    (req.session as { userId?: string }).userId = credential.userId;

    console.log(`[Passkey] Authenticated user ${credential.userId.substring(0, 8)}...`);

    res.json({
      success: true,
      user: {
        id: credential.user.id,
        email: credential.user.email,
        firstName: credential.user.firstName,
        lastName: credential.user.lastName,
      },
    });
  } catch (error) {
    console.error('[Passkey] Authentication verify error:', error);
    res.status(500).json({ error: 'Failed to verify authentication' });
  }
});

/**
 * GET /api/passkey/credentials
 * List user's passkey credentials
 */
router.get('/credentials', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;

    const credentials = await prisma.passkeyCredential.findMany({
      where: { userId },
      select: {
        id: true,
        deviceName: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ credentials });
  } catch (error) {
    console.error('[Passkey] List credentials error:', error);
    res.status(500).json({ error: 'Failed to list credentials' });
  }
});

/**
 * DELETE /api/passkey/credentials/:id
 * Delete a passkey credential
 */
router.delete('/credentials/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { id } = req.params;

    // Verify the credential belongs to the user
    const credential = await prisma.passkeyCredential.findFirst({
      where: { id, userId },
    });

    if (!credential) {
      return res.status(404).json({ error: 'Credential not found' });
    }

    await prisma.passkeyCredential.delete({
      where: { id },
    });

    console.log(`[Passkey] Deleted credential ${id.substring(0, 8)}... for user ${userId.substring(0, 8)}...`);

    res.json({ success: true });
  } catch (error) {
    console.error('[Passkey] Delete credential error:', error);
    res.status(500).json({ error: 'Failed to delete credential' });
  }
});

export default router;
