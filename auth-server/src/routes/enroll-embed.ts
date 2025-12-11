import { Router, Request, Response } from 'express';
import { prisma } from '../adapters/prisma';
import { env } from '../config/env';
import { embedSecurityHeaders } from '../middleware/embed-headers';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const router = Router();

// Apply security headers to all enroll-embed routes
router.use(embedSecurityHeaders);

// In-memory challenge storage (should use Redis in production)
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
 * Verify HMAC signature from BSIM
 * This ensures the claims haven't been tampered with client-side
 */
function verifyBsimSignature(
  payload: {
    claims: Record<string, unknown>;
    cards: unknown[];
    bsimId: string;
    timestamp: number;
  },
  signature: string,
  secret: string
): boolean {
  // Recreate the signed payload
  const signedData = JSON.stringify({
    claims: payload.claims,
    cards: payload.cards,
    bsimId: payload.bsimId,
    timestamp: payload.timestamp,
  });

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedData)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Generate a JWT session token for the enrolled user
 */
function generateSessionToken(userId: string): { token: string; expiresIn: number } {
  const expiresIn = 30 * 24 * 60 * 60; // 30 days in seconds
  const token = jwt.sign(
    { sub: userId, type: 'session' },
    env.JWT_SECRET,
    { expiresIn }
  );
  return { token, expiresIn };
}

/**
 * GET /enroll/embed
 * Serve the enrollment embed page
 */
router.get('/', (req: Request, res: Response) => {
  const origin = req.query.origin as string;

  // Validate origin is in allowed list
  if (!origin || !env.ALLOWED_EMBED_ORIGINS.includes(origin)) {
    return res.render('embed/error', {
      title: 'Error',
      error: 'Invalid or missing origin',
      allowedOrigin: origin || '',
    });
  }

  res.render('enroll-embed/enroll', {
    title: 'Enroll in WSIM Wallet',
    allowedOrigin: origin,
    rpId: env.WEBAUTHN_RP_ID,
    rpName: env.WEBAUTHN_RP_NAME,
  });
});

/**
 * POST /enroll/embed/check
 * Check if user is already enrolled
 */
router.post('/check', async (req: Request, res: Response) => {
  try {
    const { email, bsimSub, bsimId } = req.body as {
      email?: string;
      bsimSub?: string;
      bsimId?: string;
    };

    if (!email && !bsimSub) {
      return res.status(400).json({ error: 'Email or bsimSub required' });
    }

    // Check by email first
    let user = null;
    if (email) {
      user = await prisma.walletUser.findUnique({
        where: { email },
        select: { id: true, walletId: true },
      });
    }

    // If not found by email and we have bsimSub, check by enrollment
    if (!user && bsimSub && bsimId) {
      const enrollment = await prisma.bsimEnrollment.findFirst({
        where: { fiUserRef: bsimSub, bsimId },
        include: { user: { select: { id: true, walletId: true } } },
      });
      if (enrollment) {
        user = enrollment.user;
      }
    }

    if (user) {
      return res.json({
        enrolled: true,
        walletId: user.walletId,
      });
    }

    return res.json({ enrolled: false });
  } catch (error) {
    console.error('[Enroll Embed] Check error:', error);
    res.status(500).json({ error: 'Failed to check enrollment status' });
  }
});

/**
 * POST /enroll/embed/passkey/register/options
 * Generate passkey registration options for a NEW user (cross-origin registration)
 */
router.post('/passkey/register/options', async (req: Request, res: Response) => {
  try {
    const { email, firstName, lastName } = req.body as {
      email: string;
      firstName?: string;
      lastName?: string;
    };

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    // Check if user already exists
    const existingUser = await prisma.walletUser.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'User already enrolled',
        code: 'ALREADY_ENROLLED',
      });
    }

    // Generate a temporary user ID for this registration flow
    const tempUserId = crypto.randomUUID();
    const displayName = `${firstName || ''} ${lastName || ''}`.trim() || email;

    const options = await generateRegistrationOptions({
      rpName: env.WEBAUTHN_RP_NAME,
      rpID: env.WEBAUTHN_RP_ID,
      userID: new TextEncoder().encode(tempUserId),
      userName: email,
      userDisplayName: displayName,
      attestationType: 'none',
      excludeCredentials: [], // New user, no existing credentials
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required', // Require user verification for enrollment
        authenticatorAttachment: 'platform',
      },
    });

    // Store challenge with email as key (we'll need it during verification)
    const challengeKey = `enroll_${email}`;
    storeChallenge(challengeKey, options.challenge);

    console.log(`[Enroll Embed] Generated passkey options for ${email}`);

    res.json({
      ...options,
      _tempUserId: tempUserId, // Client will send this back
    });
  } catch (error) {
    console.error('[Enroll Embed] Passkey options error:', error);
    res.status(500).json({ error: 'Failed to generate registration options' });
  }
});

interface CardData {
  id: string;
  cardType: string;
  lastFour: string;
  cardHolder: string;
  expiryMonth: number;
  expiryYear: number;
}

interface EnrollmentClaims {
  sub: string;
  email: string;
  given_name?: string;
  family_name?: string;
}

/**
 * POST /enroll/embed/passkey/register/verify
 * Verify passkey registration and create user with cards
 */
router.post('/passkey/register/verify', async (req: Request, res: Response) => {
  try {
    const {
      email,
      firstName,
      lastName,
      bsimId,
      bsimSub,
      cards,
      credential,
      signature,
      timestamp,
      deviceName,
    } = req.body as {
      email: string;
      firstName?: string;
      lastName?: string;
      bsimId: string;
      bsimSub: string;
      cards: CardData[];
      credential: RegistrationResponseJSON;
      signature: string;
      timestamp: number;
      deviceName?: string;
    };

    // Validate required fields
    if (!email || !bsimId || !bsimSub || !credential || !signature || !timestamp) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify timestamp is within 5 minutes (replay protection)
    const now = Date.now();
    if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
      return res.status(400).json({ error: 'Request expired', code: 'EXPIRED' });
    }

    // Verify BSIM signature
    // For now, use INTERNAL_API_SECRET as the shared secret
    // In production, each BSIM would have its own secret
    const isValidSignature = verifyBsimSignature(
      {
        claims: { sub: bsimSub, email, given_name: firstName, family_name: lastName },
        cards,
        bsimId,
        timestamp,
      },
      signature,
      env.INTERNAL_API_SECRET
    );

    if (!isValidSignature) {
      console.error('[Enroll Embed] Invalid signature for', email);
      return res.status(403).json({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' });
    }

    // Get stored challenge
    const challengeKey = `enroll_${email}`;
    const expectedChallenge = getChallenge(challengeKey);
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge expired or not found' });
    }

    // Verify the passkey registration
    // Note: For cross-origin registration, the origin will be BSIM's origin
    // The browser validates this against /.well-known/webauthn
    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge,
        // Allow both WSIM origins AND related origins (BSIM) for cross-origin registration
        expectedOrigin: [...env.WEBAUTHN_ORIGINS, ...env.WEBAUTHN_RELATED_ORIGINS],
        expectedRPID: env.WEBAUTHN_RP_ID,
      });
    } catch (verifyError) {
      console.error('[Enroll Embed] Passkey verification failed:', verifyError);
      return res.status(400).json({ error: 'Passkey verification failed' });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Passkey verification failed' });
    }

    const { credential: credentialInfo, credentialDeviceType, aaguid } = verification.registrationInfo;

    // Create user and enrollment in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the wallet user
      const user = await tx.walletUser.create({
        data: {
          email,
          firstName: firstName || null,
          lastName: lastName || null,
          walletId: crypto.randomUUID(),
        },
      });

      // Create passkey credential
      await tx.passkeyCredential.create({
        data: {
          userId: user.id,
          credentialId: credentialInfo.id,
          publicKey: Buffer.from(credentialInfo.publicKey).toString('base64url'),
          counter: credentialInfo.counter,
          transports: (credential.response.transports || []) as string[],
          deviceName: deviceName || credentialDeviceType || 'Unknown device',
          aaguid: aaguid || null,
        },
      });

      // Create BSIM enrollment (without wallet_credential for now)
      // This links the user to their BSIM account
      const enrollment = await tx.bsimEnrollment.create({
        data: {
          userId: user.id,
          bsimId,
          bsimIssuer: `https://${bsimId}.banksim.ca`, // Construct issuer from bsimId
          fiUserRef: bsimSub,
          walletCredential: '', // Empty for now - will be populated on first OIDC flow if needed
        },
      });

      // Create wallet cards for selected cards
      const walletCards = await Promise.all(
        cards.map((card) =>
          tx.walletCard.create({
            data: {
              userId: user.id,
              enrollmentId: enrollment.id,
              cardType: card.cardType,
              lastFour: card.lastFour,
              cardholderName: card.cardHolder,
              expiryMonth: card.expiryMonth,
              expiryYear: card.expiryYear,
              bsimCardRef: card.id,
              walletCardToken: `wsim_${bsimId}_${crypto.randomUUID()}`,
              isDefault: false,
              isActive: true,
            },
          })
        )
      );

      // Set first card as default if any
      if (walletCards.length > 0) {
        await tx.walletCard.update({
          where: { id: walletCards[0].id },
          data: { isDefault: true },
        });
      }

      return { user, enrollment, walletCards };
    });

    // Generate session token
    const { token: sessionToken, expiresIn: sessionTokenExpiresIn } = generateSessionToken(result.user.id);

    console.log(`[Enroll Embed] Successfully enrolled user ${result.user.email} with ${result.walletCards.length} cards`);

    res.json({
      success: true,
      walletId: result.user.walletId,
      sessionToken,
      sessionTokenExpiresIn,
      cardsEnrolled: result.walletCards.length,
    });
  } catch (error) {
    console.error('[Enroll Embed] Registration verify error:', error);

    // Check for unique constraint violation (user already exists)
    if ((error as { code?: string }).code === 'P2002') {
      return res.status(409).json({
        error: 'User already enrolled',
        code: 'ALREADY_ENROLLED',
      });
    }

    res.status(500).json({ error: 'Failed to complete enrollment' });
  }
});

export default router;
