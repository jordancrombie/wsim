import { Router, Request, Response } from 'express';
import * as jose from 'jose';
import { prisma } from '../adapters/prisma';
import { env } from '../config/env';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';

/**
 * Passkey Grace Period Configuration
 *
 * After a user authenticates with their passkey (login), we grant a "grace period"
 * during which subsequent payment confirmations don't require another passkey prompt.
 * This improves UX by avoiding redundant passkey prompts when the user just authenticated.
 *
 * Security rationale:
 * - The user has already proven possession of their passkey
 * - The session is bound to their authenticated identity
 * - Similar to banking apps that allow transactions for a few minutes after login
 * - Grace period is short enough to limit exposure if device is compromised
 */
const PASSKEY_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Extended session interface with passkey auth tracking
 */
interface PopupSession {
  userId?: string;
  lastPasskeyAuthAt?: number; // Timestamp of last passkey authentication
}

/**
 * Check if the user is within the passkey grace period
 * Returns true if passkey was used recently and payment passkey can be skipped
 */
function isWithinPasskeyGracePeriod(session: PopupSession): boolean {
  if (!session.lastPasskeyAuthAt) return false;
  return Date.now() - session.lastPasskeyAuthAt < PASSKEY_GRACE_PERIOD_MS;
}

/**
 * Generate a JWT session token for Merchant API access
 * This token can be used by merchants for cross-origin API calls
 * when session cookies don't work (Safari ITP, incognito, etc.)
 *
 * Token lifetime: 30 days (matches long session cookie approach)
 * Used by: SSIM "API Direct (JWT)" flow
 */
async function generateSessionToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  return await new jose.SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
}

const router = Router();

// In-memory challenge storage (use Redis in production)
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
 * Validate that the origin is allowed for popup communication
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return env.ALLOWED_POPUP_ORIGINS.includes(origin);
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
      console.error('[Popup] Failed to get card token:', await response.text());
      return null;
    }

    return await response.json() as { cardToken: string; walletCardToken: string };
  } catch (error) {
    console.error('[Popup] Error requesting card token:', error);
    return null;
  }
}

/**
 * GET /popup/card-picker
 * Display card picker popup for embedded payment flow
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
    if (!isAllowedOrigin(origin)) {
      console.warn(`[Popup] Blocked request from unauthorized origin: ${origin}`);
      return res.status(403).render('popup/error', {
        title: 'Access Denied',
        message: 'This origin is not authorized to use the wallet popup.',
        allowedOrigin: null,
      });
    }

    // Check for session cookie (simple session check)
    const session = req.session as PopupSession;
    const sessionUserId = session?.userId;

    if (!sessionUserId) {
      // User not logged in - show auth required page
      return res.render('popup/auth-required', {
        title: 'Sign In Required',
        merchantName: merchantName || merchantId || 'Merchant',
        amount: amount ? parseFloat(amount) : null,
        currency: currency || 'CAD',
        allowedOrigin: origin,
        queryParams: new URLSearchParams(req.query as Record<string, string>).toString(),
        apiUrl: env.FRONTEND_URL, // Public API URL for browser calls
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

    // Check if within passkey grace period (can skip payment passkey)
    const canSkipPasskey = isWithinPasskeyGracePeriod(session);
    if (canSkipPasskey) {
      console.log(`[Popup] User ${sessionUserId.substring(0, 8)}... within grace period, passkey can be skipped`);
    }

    res.render('popup/card-picker', {
      title: 'Select Payment Card',
      cards,
      hasPasskeys: passkeys.length > 0,
      canSkipPasskey, // New: indicates if passkey prompt can be skipped
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
    console.error('[Popup] Card picker error:', error);
    res.status(500).render('popup/error', {
      title: 'Error',
      message: 'Failed to load card picker',
      allowedOrigin: req.query.origin,
    });
  }
});

/**
 * POST /popup/login/options
 * Generate passkey authentication options for initial login (discoverable credentials)
 */
router.post('/login/options', async (req: Request, res: Response) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID: env.WEBAUTHN_RP_ID,
      userVerification: 'preferred',
      // No allowCredentials = discoverable credential flow
    });

    // Store challenge with a temporary key
    const tempKey = `login_${options.challenge.substring(0, 16)}`;
    storeChallenge(tempKey, options.challenge);

    res.json({
      ...options,
      _tempKey: tempKey,
    });
  } catch (error) {
    console.error('[Popup] Login options error:', error);
    res.status(500).json({ error: 'Failed to generate login options' });
  }
});

/**
 * POST /popup/login/verify
 * Verify passkey for initial login and set session
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

    // Get the challenge
    const expectedChallenge = getChallenge(_tempKey);
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge expired or not found' });
    }

    // Find the credential
    const credential = await prisma.passkeyCredential.findUnique({
      where: { credentialId: response.id },
      include: { user: true },
    });

    if (!credential) {
      console.log(`[Popup] Login credential not found for ID: ${response.id.substring(0, 10)}...`);
      return res.status(400).json({ error: 'Credential not found' });
    }

    // Verify passkey
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
      console.error('[Popup] Login verification failed:', verifyError);
      return res.status(400).json({ error: 'Passkey verification failed' });
    }

    if (!verification.verified) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    // Update counter
    await prisma.passkeyCredential.update({
      where: { id: credential.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    // Set session on auth-server with passkey auth timestamp for grace period
    const session = req.session as PopupSession;
    session.userId = credential.userId;
    session.lastPasskeyAuthAt = Date.now(); // Track when passkey was used

    // Generate JWT session token for API Direct flow
    const sessionToken = await generateSessionToken(credential.userId);

    console.log(`[Popup] Login successful for user ${credential.userId.substring(0, 8)}... (grace period started)`);

    res.json({
      success: true,
      user: {
        id: credential.user.id,
        email: credential.user.email,
      },
      // JWT token for Merchant API access (API Direct flow)
      // Merchant can store this and use as: Authorization: Bearer <sessionToken>
      sessionToken,
      sessionTokenExpiresIn: 30 * 24 * 60 * 60, // 30 days in seconds
      // Indicate grace period is active (client can skip payment passkey)
      passkeyGracePeriodActive: true,
      gracePeriodExpiresIn: PASSKEY_GRACE_PERIOD_MS / 1000, // seconds
    });
  } catch (error) {
    console.error('[Popup] Login verify error:', error);
    res.status(500).json({ error: 'Failed to verify login' });
  }
});

/**
 * POST /popup/passkey/options
 * Generate passkey authentication options for payment confirmation
 */
router.post('/passkey/options', async (req: Request, res: Response) => {
  try {
    const { userId, walletCardId, merchantName, amount, currency } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }

    // Get user's passkeys
    const passkeys = await prisma.passkeyCredential.findMany({
      where: { userId },
    });

    if (passkeys.length === 0) {
      return res.status(400).json({ error: 'No passkeys registered' });
    }

    const options = await generateAuthenticationOptions({
      rpID: env.WEBAUTHN_RP_ID,
      allowCredentials: passkeys.map((p: { credentialId: string; transports: string[] }) => ({
        id: p.credentialId, // Already base64url encoded string
        // Prefer internal (platform) authenticator over hybrid (QR code)
        // This helps avoid the QR code prompt when the passkey is available locally
        transports: p.transports.includes('internal')
          ? ['internal'] as AuthenticatorTransportFuture[]
          : p.transports as AuthenticatorTransportFuture[],
      })),
      userVerification: 'required',
    });

    // Store challenge with context
    const challengeKey = `popup_${userId}_${Date.now()}`;
    storeChallenge(challengeKey, options.challenge);

    res.json({
      ...options,
      _challengeKey: challengeKey,
      _context: { walletCardId, merchantName, amount, currency },
    });
  } catch (error) {
    console.error('[Popup] Passkey options error:', error);
    res.status(500).json({ error: 'Failed to generate passkey options' });
  }
});

/**
 * POST /popup/passkey/verify
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

    // Validate origin
    if (!isAllowedOrigin(origin)) {
      return res.status(403).json({ error: 'Unauthorized origin' });
    }

    // Get the challenge
    const expectedChallenge = getChallenge(_challengeKey);
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge expired or not found' });
    }

    // Find the credential
    const credential = await prisma.passkeyCredential.findUnique({
      where: { credentialId: response.id },
      include: { user: true },
    });

    if (!credential) {
      return res.status(400).json({ error: 'Credential not found' });
    }

    // Verify the credential belongs to the card owner
    const card = await prisma.walletCard.findFirst({
      where: { id: walletCardId, userId: credential.userId },
    });

    if (!card) {
      return res.status(400).json({ error: 'Card not found or unauthorized' });
    }

    // Verify passkey
    let verification: VerifiedAuthenticationResponse;
    try {
      const publicKeyBuffer = Buffer.from(credential.publicKey, 'base64url');
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: env.WEBAUTHN_ORIGINS,
        expectedRPID: env.WEBAUTHN_RP_ID,
        credential: {
          id: credential.credentialId, // Already base64url encoded string
          publicKey: new Uint8Array(publicKeyBuffer),
          counter: credential.counter,
          transports: credential.transports as AuthenticatorTransportFuture[],
        },
      });
    } catch (verifyError) {
      console.error('[Popup] Passkey verification failed:', verifyError);
      return res.status(400).json({ error: 'Passkey verification failed' });
    }

    if (!verification.verified) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    // Update counter
    await prisma.passkeyCredential.update({
      where: { id: credential.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    // Update session with passkey auth timestamp (restarts grace period)
    const session = req.session as PopupSession;
    session.lastPasskeyAuthAt = Date.now();

    // Now get the payment token from BSIM
    console.log(`[Popup] Passkey verified, requesting card token for ${walletCardId.substring(0, 8)}... (grace period restarted)`);
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

    // Return the token data for postMessage
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min TTL

    // Generate JWT session token for API Direct flow
    const sessionToken = await generateSessionToken(credential.userId);

    console.log(`[Popup] Payment token generated for card ${card.lastFour}`);

    res.json({
      success: true,
      token: tokenResult.walletCardToken,
      cardToken: tokenResult.cardToken,
      cardLast4: card.lastFour,
      cardBrand: card.cardType.toLowerCase(),
      expiresAt,
      // JWT token for Merchant API access (API Direct flow)
      // Merchant can store this and use as: Authorization: Bearer <sessionToken>
      sessionToken,
      sessionTokenExpiresIn: 30 * 24 * 60 * 60, // 30 days in seconds
    });
  } catch (error) {
    console.error('[Popup] Passkey verify error:', error);
    res.status(500).json({ error: 'Failed to verify passkey' });
  }
});

/**
 * POST /popup/select-card-simple
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

    // Validate origin
    if (!isAllowedOrigin(origin)) {
      return res.status(403).json({ error: 'Unauthorized origin' });
    }

    // Check session
    const sessionUserId = (req as Request & { session?: { userId?: string } }).session?.userId;
    if (!sessionUserId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Verify card belongs to user
    const card = await prisma.walletCard.findFirst({
      where: { id: walletCardId, userId: sessionUserId, isActive: true },
    });

    if (!card) {
      return res.status(400).json({ error: 'Card not found' });
    }

    // Get payment token
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

    // Generate JWT session token for API Direct flow
    const sessionToken = await generateSessionToken(sessionUserId);

    res.json({
      success: true,
      token: tokenResult.walletCardToken,
      cardToken: tokenResult.cardToken,
      cardLast4: card.lastFour,
      cardBrand: card.cardType.toLowerCase(),
      expiresAt,
      // JWT token for Merchant API access (API Direct flow)
      // Merchant can store this and use as: Authorization: Bearer <sessionToken>
      sessionToken,
      sessionTokenExpiresIn: 30 * 24 * 60 * 60, // 30 days in seconds
    });
  } catch (error) {
    console.error('[Popup] Simple select error:', error);
    res.status(500).json({ error: 'Failed to process card selection' });
  }
});

/**
 * POST /popup/confirm-with-grace-period
 * Confirm payment using passkey grace period (no passkey prompt required)
 *
 * This endpoint is used when the user has recently authenticated with a passkey
 * and is within the grace period. It allows card selection and payment without
 * requiring another passkey prompt, improving UX while maintaining security.
 *
 * Security: Only works if:
 * 1. User has a valid session
 * 2. Session shows passkey was used within PASSKEY_GRACE_PERIOD_MS
 * 3. Card belongs to the authenticated user
 */
router.post('/confirm-with-grace-period', async (req: Request, res: Response) => {
  try {
    const {
      walletCardId,
      merchantId,
      merchantName,
      amount,
      currency,
      origin,
    } = req.body;

    // Validate origin
    if (!isAllowedOrigin(origin)) {
      return res.status(403).json({ error: 'Unauthorized origin' });
    }

    // Check session
    const session = req.session as PopupSession;
    const sessionUserId = session?.userId;

    if (!sessionUserId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Verify user is within grace period
    if (!isWithinPasskeyGracePeriod(session)) {
      console.log(`[Popup] Grace period expired for user ${sessionUserId.substring(0, 8)}..., passkey required`);
      return res.status(403).json({
        error: 'grace_period_expired',
        message: 'Passkey grace period has expired. Please authenticate with your passkey.',
        requirePasskey: true,
      });
    }

    // Verify card belongs to user
    const card = await prisma.walletCard.findFirst({
      where: { id: walletCardId, userId: sessionUserId, isActive: true },
    });

    if (!card) {
      return res.status(400).json({ error: 'Card not found' });
    }

    // Get payment token (no passkey required - within grace period)
    console.log(`[Popup] Confirming payment within grace period for user ${sessionUserId.substring(0, 8)}...`);

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

    // Generate JWT session token for API Direct flow
    const sessionToken = await generateSessionToken(sessionUserId);

    console.log(`[Popup] Payment confirmed (grace period) for card ${card.lastFour}`);

    res.json({
      success: true,
      token: tokenResult.walletCardToken,
      cardToken: tokenResult.cardToken,
      cardLast4: card.lastFour,
      cardBrand: card.cardType.toLowerCase(),
      expiresAt,
      sessionToken,
      sessionTokenExpiresIn: 30 * 24 * 60 * 60,
      // Indicate this was processed via grace period
      usedGracePeriod: true,
    });
  } catch (error) {
    console.error('[Popup] Grace period confirm error:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

/**
 * GET /popup/grace-period-status
 * Check if the current session is within the passkey grace period
 *
 * Used by the card-picker UI to determine whether to show passkey prompt
 */
router.get('/grace-period-status', async (req: Request, res: Response) => {
  try {
    const session = req.session as PopupSession;

    if (!session?.userId) {
      return res.json({
        authenticated: false,
        withinGracePeriod: false,
      });
    }

    const withinGracePeriod = isWithinPasskeyGracePeriod(session);
    const remainingMs = session.lastPasskeyAuthAt
      ? Math.max(0, PASSKEY_GRACE_PERIOD_MS - (Date.now() - session.lastPasskeyAuthAt))
      : 0;

    res.json({
      authenticated: true,
      withinGracePeriod,
      remainingSeconds: Math.floor(remainingMs / 1000),
      gracePeriodDuration: PASSKEY_GRACE_PERIOD_MS / 1000,
    });
  } catch (error) {
    console.error('[Popup] Grace period status error:', error);
    res.status(500).json({ error: 'Failed to check grace period status' });
  }
});

export default router;
