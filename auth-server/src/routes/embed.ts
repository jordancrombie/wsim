import { Router, Request, Response } from 'express';
import { prisma } from '../adapters/prisma';
import { env } from '../config/env';
import { embedSecurityHeaders, isAllowedEmbedOrigin } from '../middleware/embed-headers';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';

const router = Router();

// Apply security headers to all embed routes
router.use(embedSecurityHeaders);

// In-memory challenge storage (shared with popup routes - should use Redis in production)
const challengeStore = new Map<string, { challenge: string; expiresAt: number }>();

// Clean up expired challenges
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of challengeStore.entries()) {
    if (value.expiresAt < now) {
      challengeStore.delete(key);
    }
  }
}, 60000);

function storeChallenge(key: string, challenge: string): void {
  challengeStore.set(key, {
    challenge,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
}

function getChallenge(key: string): string | null {
  const stored = challengeStore.get(key);
  if (!stored || stored.expiresAt < Date.now()) {
    challengeStore.delete(key);
    return null;
  }
  challengeStore.delete(key);
  return stored.challenge;
}

/**
 * Request card token from backend (which calls BSIM)
 */
async function requestCardToken(
  walletCardId: string,
  merchantId?: string,
  merchantName?: string,
  amount?: number,
  currency?: string
): Promise<{ cardToken: string; walletCardToken: string } | null> {
  try {
    const response = await fetch(`${env.BACKEND_URL}/api/payment/request-token`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.INTERNAL_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        walletCardId,
        merchantId,
        merchantName,
        amount,
        currency,
      }),
    });

    if (!response.ok) {
      console.error('[Embed] Failed to get card token:', await response.text());
      return null;
    }

    return await response.json() as { cardToken: string; walletCardToken: string };
  } catch (error) {
    console.error('[Embed] Error requesting card token:', error);
    return null;
  }
}

/**
 * GET /embed/card-picker
 * Display card picker in an iframe for embedded payment flow
 */
router.get('/card-picker', async (req: Request, res: Response) => {
  try {
    const {
      merchantId,
      merchantName,
      amount,
      currency,
      orderId,
      origin,
    } = req.query as {
      merchantId?: string;
      merchantName?: string;
      amount?: string;
      currency?: string;
      orderId?: string;
      origin?: string;
    };

    // Validate origin
    if (!isAllowedEmbedOrigin(origin)) {
      console.warn(`[Embed] Blocked request from unauthorized origin: ${origin}`);
      return res.status(403).render('embed/error', {
        title: 'Access Denied',
        message: 'This origin is not authorized to embed the wallet.',
        allowedOrigin: null,
      });
    }

    // Check for session cookie
    const sessionUserId = (req as Request & { session?: { userId?: string } }).session?.userId;

    if (!sessionUserId) {
      // User not logged in - show auth required view
      return res.render('embed/auth-required', {
        title: 'Sign In Required',
        merchantName: merchantName || merchantId || 'Merchant',
        amount: amount ? parseFloat(amount) : null,
        currency: currency || 'CAD',
        allowedOrigin: origin,
        queryParams: new URLSearchParams(req.query as Record<string, string>).toString(),
      });
    }

    // Get user's cards
    const cards = await prisma.walletCard.findMany({
      where: {
        userId: sessionUserId,
        isActive: true,
      },
      include: {
        enrollment: {
          select: { bsimId: true },
        },
      },
    });

    // Get user's passkeys for authentication
    const passkeys = await prisma.passkeyCredential.findMany({
      where: { userId: sessionUserId },
    });

    res.render('embed/card-picker', {
      title: 'Select Payment Card',
      cards,
      hasPasskeys: passkeys.length > 0,
      payment: {
        merchantId,
        merchantName: merchantName || merchantId || 'Merchant',
        amount: amount ? parseFloat(amount) : null,
        currency: currency || 'CAD',
        orderId,
      },
      allowedOrigin: origin,
      userId: sessionUserId,
    });
  } catch (error) {
    console.error('[Embed] Card picker error:', error);
    res.status(500).render('embed/error', {
      title: 'Error',
      message: 'Failed to load card picker',
      allowedOrigin: req.query.origin,
    });
  }
});

/**
 * POST /embed/login/options
 * Generate passkey authentication options for login (discoverable credentials)
 */
router.post('/login/options', async (req: Request, res: Response) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID: env.WEBAUTHN_RP_ID,
      userVerification: 'preferred',
    });

    const tempKey = `embed_login_${options.challenge.substring(0, 16)}`;
    storeChallenge(tempKey, options.challenge);

    res.json({
      ...options,
      _tempKey: tempKey,
    });
  } catch (error) {
    console.error('[Embed] Login options error:', error);
    res.status(500).json({ error: 'Failed to generate login options' });
  }
});

/**
 * POST /embed/login/verify
 * Verify passkey for login and set session
 */
router.post('/login/verify', async (req: Request, res: Response) => {
  try {
    const { response, _tempKey } = req.body as {
      response: AuthenticationResponseJSON;
      _tempKey?: string;
    };

    if (!response || !_tempKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const expectedChallenge = getChallenge(_tempKey);
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge expired or not found' });
    }

    const credential = await prisma.passkeyCredential.findUnique({
      where: { credentialId: response.id },
      include: { user: true },
    });

    if (!credential) {
      console.log(`[Embed] Login credential not found for ID: ${response.id.substring(0, 10)}...`);
      return res.status(400).json({ error: 'Credential not found' });
    }

    let verification: VerifiedAuthenticationResponse;
    try {
      const publicKeyBuffer = Buffer.from(credential.publicKey, 'base64url');
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: env.WEBAUTHN_ORIGINS,
        expectedRPID: env.WEBAUTHN_RP_ID,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(publicKeyBuffer),
          counter: credential.counter,
          transports: credential.transports as AuthenticatorTransportFuture[],
        },
      });
    } catch (verifyError) {
      console.error('[Embed] Login verification failed:', verifyError);
      return res.status(400).json({ error: 'Passkey verification failed' });
    }

    if (!verification.verified) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    await prisma.passkeyCredential.update({
      where: { id: credential.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    (req.session as { userId?: string }).userId = credential.userId;

    console.log(`[Embed] Login successful for user ${credential.userId.substring(0, 8)}...`);

    res.json({
      success: true,
      user: {
        id: credential.user.id,
        email: credential.user.email,
      },
    });
  } catch (error) {
    console.error('[Embed] Login verify error:', error);
    res.status(500).json({ error: 'Failed to verify login' });
  }
});

/**
 * POST /embed/passkey/options
 * Generate passkey authentication options for payment confirmation
 */
router.post('/passkey/options', async (req: Request, res: Response) => {
  try {
    const { userId, walletCardId, merchantName, amount, currency } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }

    const passkeys = await prisma.passkeyCredential.findMany({
      where: { userId },
    });

    if (passkeys.length === 0) {
      return res.status(400).json({ error: 'No passkeys registered' });
    }

    const options = await generateAuthenticationOptions({
      rpID: env.WEBAUTHN_RP_ID,
      allowCredentials: passkeys.map((p: { credentialId: string; transports: string[] }) => ({
        id: p.credentialId,
        transports: p.transports.includes('internal')
          ? ['internal'] as AuthenticatorTransportFuture[]
          : p.transports as AuthenticatorTransportFuture[],
      })),
      userVerification: 'required',
    });

    const challengeKey = `embed_${userId}_${Date.now()}`;
    storeChallenge(challengeKey, options.challenge);

    res.json({
      ...options,
      _challengeKey: challengeKey,
      _context: { walletCardId, merchantName, amount, currency },
    });
  } catch (error) {
    console.error('[Embed] Passkey options error:', error);
    res.status(500).json({ error: 'Failed to generate passkey options' });
  }
});

/**
 * POST /embed/passkey/verify
 * Verify passkey and generate payment token
 */
router.post('/passkey/verify', async (req: Request, res: Response) => {
  try {
    const {
      response,
      _challengeKey,
      walletCardId,
      merchantId,
      merchantName,
      amount,
      currency,
      origin,
    } = req.body as {
      response: AuthenticationResponseJSON;
      _challengeKey: string;
      walletCardId: string;
      merchantId?: string;
      merchantName?: string;
      amount?: number;
      currency?: string;
      origin?: string;
    };

    if (!response || !_challengeKey || !walletCardId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!isAllowedEmbedOrigin(origin)) {
      return res.status(403).json({ error: 'Unauthorized origin' });
    }

    const expectedChallenge = getChallenge(_challengeKey);
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge expired or not found' });
    }

    const credential = await prisma.passkeyCredential.findUnique({
      where: { credentialId: response.id },
      include: { user: true },
    });

    if (!credential) {
      return res.status(400).json({ error: 'Credential not found' });
    }

    const card = await prisma.walletCard.findFirst({
      where: { id: walletCardId, userId: credential.userId },
    });

    if (!card) {
      return res.status(400).json({ error: 'Card not found or unauthorized' });
    }

    let verification: VerifiedAuthenticationResponse;
    try {
      const publicKeyBuffer = Buffer.from(credential.publicKey, 'base64url');
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: env.WEBAUTHN_ORIGINS,
        expectedRPID: env.WEBAUTHN_RP_ID,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(publicKeyBuffer),
          counter: credential.counter,
          transports: credential.transports as AuthenticatorTransportFuture[],
        },
      });
    } catch (verifyError) {
      console.error('[Embed] Passkey verification failed:', verifyError);
      return res.status(400).json({ error: 'Passkey verification failed' });
    }

    if (!verification.verified) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    await prisma.passkeyCredential.update({
      where: { id: credential.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    console.log(`[Embed] Passkey verified, requesting card token for ${walletCardId.substring(0, 8)}...`);
    const tokenResult = await requestCardToken(
      walletCardId,
      merchantId,
      merchantName,
      amount,
      currency
    );

    if (!tokenResult) {
      return res.status(500).json({ error: 'Failed to get payment token' });
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    console.log(`[Embed] Payment token generated for card ${card.lastFour}`);

    res.json({
      success: true,
      token: tokenResult.walletCardToken,
      cardToken: tokenResult.cardToken,
      cardLast4: card.lastFour,
      cardBrand: card.cardType.toLowerCase(),
      expiresAt,
    });
  } catch (error) {
    console.error('[Embed] Passkey verify error:', error);
    res.status(500).json({ error: 'Failed to verify passkey' });
  }
});

/**
 * POST /embed/select-card-simple
 * For users without passkeys - simplified flow (less secure)
 */
router.post('/select-card-simple', async (req: Request, res: Response) => {
  try {
    const {
      walletCardId,
      merchantId,
      merchantName,
      amount,
      currency,
      origin,
    } = req.body;

    if (!isAllowedEmbedOrigin(origin)) {
      return res.status(403).json({ error: 'Unauthorized origin' });
    }

    const sessionUserId = (req as Request & { session?: { userId?: string } }).session?.userId;
    if (!sessionUserId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const card = await prisma.walletCard.findFirst({
      where: { id: walletCardId, userId: sessionUserId, isActive: true },
    });

    if (!card) {
      return res.status(400).json({ error: 'Card not found' });
    }

    const tokenResult = await requestCardToken(
      walletCardId,
      merchantId,
      merchantName,
      amount ? parseFloat(amount) : undefined,
      currency
    );

    if (!tokenResult) {
      return res.status(500).json({ error: 'Failed to get payment token' });
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    res.json({
      success: true,
      token: tokenResult.walletCardToken,
      cardToken: tokenResult.cardToken,
      cardLast4: card.lastFour,
      cardBrand: card.cardType.toLowerCase(),
      expiresAt,
    });
  } catch (error) {
    console.error('[Embed] Simple select error:', error);
    res.status(500).json({ error: 'Failed to process card selection' });
  }
});

export default router;
