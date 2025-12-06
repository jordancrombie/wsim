import { Router } from 'express';
import bcrypt from 'bcrypt';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { encrypt, generateWalletCardToken } from '../utils/crypto';
import {
  BsimProviderConfig,
  buildAuthorizationUrl,
  exchangeCode,
  fetchCards,
  generatePkce,
  generateState,
  generateNonce,
} from '../services/bsim-oidc';

const router = Router();

// Parse BSIM providers from environment
function getBsimProviders(): BsimProviderConfig[] {
  try {
    return JSON.parse(env.BSIM_PROVIDERS);
  } catch {
    console.warn('[Enrollment] Failed to parse BSIM_PROVIDERS');
    return [];
  }
}

/**
 * GET /api/enrollment/banks
 * List available banks for enrollment
 */
router.get('/banks', optionalAuth, (req, res) => {
  const providers = getBsimProviders();

  res.json({
    banks: providers.map(p => ({
      bsimId: p.bsimId,
      name: p.name || p.bsimId,
      logoUrl: p.logoUrl,
    })),
  });
});

/**
 * POST /api/enrollment/start/:bsimId
 * Initiate enrollment with a bank
 * Body: { password?: string } - Optional password to set during enrollment
 */
router.post('/start/:bsimId', optionalAuth, async (req, res) => {
  const { bsimId } = req.params;
  const { password } = req.body || {};

  const providers = getBsimProviders();
  const provider = providers.find(p => p.bsimId === bsimId);

  if (!provider) {
    res.status(404).json({ error: 'not_found', message: 'Bank not found' });
    return;
  }

  try {
    // Hash password if provided
    let passwordHash: string | undefined;
    if (password && typeof password === 'string' && password.length >= 8) {
      const saltRounds = 12;
      passwordHash = await bcrypt.hash(password, saltRounds);
      console.log(`[Enrollment] Password will be set during enrollment`);
    }

    // Generate PKCE, state, and nonce
    const { codeVerifier, codeChallenge } = await generatePkce();
    const state = generateState();
    const nonce = generateNonce();

    // Build redirect URI
    const redirectUri = `${env.APP_URL}/api/enrollment/callback/${bsimId}`;

    // Build authorization URL
    const authUrl = await buildAuthorizationUrl(
      provider,
      redirectUri,
      state,
      nonce,
      codeChallenge
    );

    // Store enrollment state in session (including password hash if provided)
    req.session.enrollmentState = {
      bsimId,
      state,
      nonce,
      codeVerifier,
      passwordHash,
    };

    console.log(`[Enrollment] Starting enrollment for ${bsimId}, redirecting to auth`);

    res.json({
      authUrl,
      bsimId: provider.bsimId,
      bankName: provider.name,
    });
  } catch (error) {
    console.error('[Enrollment] Failed to build auth URL:', error);
    res.status(500).json({
      error: 'enrollment_failed',
      message: error instanceof Error ? error.message : 'Failed to start enrollment',
    });
  }
});

/**
 * GET /api/enrollment/callback/:bsimId
 * Handle OIDC callback from bank
 */
router.get('/callback/:bsimId', async (req, res) => {
  const { bsimId } = req.params;
  const { code, state, error, error_description } = req.query;

  // Handle error from BSIM
  if (error) {
    console.error(`[Enrollment] Error from BSIM: ${error} - ${error_description}`);
    res.redirect(`${env.FRONTEND_URL}/enroll?error=${error}&message=${encodeURIComponent(String(error_description || ''))}`);
    return;
  }

  // Validate we have code
  if (!code || typeof code !== 'string') {
    res.redirect(`${env.FRONTEND_URL}/enroll?error=missing_code`);
    return;
  }

  // Validate enrollment state from session
  const enrollmentState = req.session.enrollmentState;
  if (!enrollmentState) {
    console.error('[Enrollment] No enrollment state in session');
    res.redirect(`${env.FRONTEND_URL}/enroll?error=invalid_session`);
    return;
  }

  // Validate state matches
  if (state !== enrollmentState.state) {
    console.error('[Enrollment] State mismatch');
    res.redirect(`${env.FRONTEND_URL}/enroll?error=invalid_state`);
    return;
  }

  // Validate bsimId matches
  if (bsimId !== enrollmentState.bsimId) {
    console.error('[Enrollment] BSIM ID mismatch');
    res.redirect(`${env.FRONTEND_URL}/enroll?error=invalid_bsim`);
    return;
  }

  // Get provider config
  const providers = getBsimProviders();
  const provider = providers.find(p => p.bsimId === bsimId);

  if (!provider) {
    res.redirect(`${env.FRONTEND_URL}/enroll?error=provider_not_found`);
    return;
  }

  try {
    const redirectUri = `${env.APP_URL}/api/enrollment/callback/${bsimId}`;

    // Exchange code for tokens
    console.log(`[Enrollment] Exchanging code for tokens...`);
    const tokenResponse = await exchangeCode(
      provider,
      redirectUri,
      code,
      enrollmentState.codeVerifier,
      enrollmentState.state,
      enrollmentState.nonce
    );

    console.log(`[Enrollment] Got tokens for user: ${tokenResponse.email}`);

    // Find or create user
    let user = await prisma.walletUser.findUnique({
      where: { email: tokenResponse.email },
      select: { id: true, email: true, walletId: true, firstName: true, lastName: true, passwordHash: true },
    });

    if (!user) {
      console.log(`[Enrollment] Creating new user: ${tokenResponse.email}`);
      user = await prisma.walletUser.create({
        data: {
          email: tokenResponse.email,
          firstName: tokenResponse.firstName,
          lastName: tokenResponse.lastName,
          passwordHash: enrollmentState.passwordHash, // Set password if provided during enrollment
        },
      });
      if (enrollmentState.passwordHash) {
        console.log(`[Enrollment] Password set for new user: ${tokenResponse.email}`);
      }
    } else {
      // Update user info if we have new data
      const updateData: { firstName?: string; lastName?: string; passwordHash?: string } = {};
      if (tokenResponse.firstName) updateData.firstName = tokenResponse.firstName;
      if (tokenResponse.lastName) updateData.lastName = tokenResponse.lastName;
      // Only set password if user doesn't already have one and one was provided
      if (!user.passwordHash && enrollmentState.passwordHash) {
        updateData.passwordHash = enrollmentState.passwordHash;
        console.log(`[Enrollment] Password set for existing user: ${tokenResponse.email}`);
      }

      if (Object.keys(updateData).length > 0) {
        user = await prisma.walletUser.update({
          where: { id: user.id },
          data: updateData,
        });
      }
    }

    // Check if already enrolled with this BSIM
    let enrollment = await prisma.bsimEnrollment.findUnique({
      where: {
        userId_bsimId: {
          userId: user.id,
          bsimId: bsimId,
        },
      },
    });

    if (enrollment) {
      // Update existing enrollment
      console.log(`[Enrollment] Updating existing enrollment for ${bsimId}`);
      enrollment = await prisma.bsimEnrollment.update({
        where: { id: enrollment.id },
        data: {
          walletCredential: encrypt(tokenResponse.walletCredential || tokenResponse.accessToken),
          refreshToken: tokenResponse.refreshToken ? encrypt(tokenResponse.refreshToken) : null,
          credentialExpiry: new Date(Date.now() + (tokenResponse.expiresIn * 1000)),
        },
      });
    } else {
      // Create new enrollment
      console.log(`[Enrollment] Creating new enrollment for ${bsimId}`);
      enrollment = await prisma.bsimEnrollment.create({
        data: {
          userId: user.id,
          bsimId: bsimId,
          bsimIssuer: provider.issuer,
          fiUserRef: tokenResponse.fiUserRef,
          walletCredential: encrypt(tokenResponse.walletCredential || tokenResponse.accessToken),
          refreshToken: tokenResponse.refreshToken ? encrypt(tokenResponse.refreshToken) : null,
          credentialExpiry: new Date(Date.now() + (tokenResponse.expiresIn * 1000)),
        },
      });
    }

    // Fetch cards from BSIM using the wallet credential (not the access token)
    console.log(`[Enrollment] Fetching cards from ${bsimId}...`);
    if (!tokenResponse.walletCredential) {
      console.error('[Enrollment] No wallet_credential in token response - BSIM may not have granted wallet:enroll scope');
    }
    try {
      const credentialToUse = tokenResponse.walletCredential || tokenResponse.accessToken;
      const cards = await fetchCards(provider, credentialToUse);
      console.log(`[Enrollment] Got ${cards.length} cards from ${bsimId}`);

      // Store cards
      for (const card of cards) {
        // Check if card already exists
        const existingCard = await prisma.walletCard.findUnique({
          where: {
            enrollmentId_bsimCardRef: {
              enrollmentId: enrollment.id,
              bsimCardRef: card.cardRef,
            },
          },
        });

        if (existingCard) {
          // Update existing card
          await prisma.walletCard.update({
            where: { id: existingCard.id },
            data: {
              cardType: card.cardType,
              lastFour: card.lastFour,
              cardholderName: card.cardholderName,
              expiryMonth: card.expiryMonth,
              expiryYear: card.expiryYear,
              isActive: card.isActive,
            },
          });
        } else {
          // Create new card
          await prisma.walletCard.create({
            data: {
              userId: user.id,
              enrollmentId: enrollment.id,
              cardType: card.cardType,
              lastFour: card.lastFour,
              cardholderName: card.cardholderName,
              expiryMonth: card.expiryMonth,
              expiryYear: card.expiryYear,
              bsimCardRef: card.cardRef,
              walletCardToken: generateWalletCardToken(bsimId),
              isActive: card.isActive,
            },
          });
        }
      }
    } catch (cardError) {
      console.error('[Enrollment] Failed to fetch cards:', cardError);
      // Don't fail enrollment if card fetch fails - user can retry later
    }

    // Set user session
    req.session.userId = user.id;

    // Clear enrollment state
    delete req.session.enrollmentState;

    console.log(`[Enrollment] Enrollment complete for ${tokenResponse.email}`);

    // Redirect to wallet dashboard
    res.redirect(`${env.FRONTEND_URL}/wallet?enrolled=${bsimId}`);

  } catch (error) {
    console.error('[Enrollment] Callback error:', error);
    res.redirect(`${env.FRONTEND_URL}/enroll?error=callback_failed&message=${encodeURIComponent(error instanceof Error ? error.message : 'Unknown error')}`);
  }
});

/**
 * GET /api/enrollment/list
 * List user's enrolled banks
 */
router.get('/list', requireAuth, async (req, res) => {
  const enrollments = await prisma.bsimEnrollment.findMany({
    where: { userId: req.userId },
    select: {
      id: true,
      bsimId: true,
      createdAt: true,
      credentialExpiry: true,
      _count: {
        select: { cards: true },
      },
    },
  });

  const providers = getBsimProviders();

  res.json({
    enrollments: enrollments.map(e => {
      const provider = providers.find(p => p.bsimId === e.bsimId);
      return {
        id: e.id,
        bsimId: e.bsimId,
        bankName: provider?.name || e.bsimId,
        logoUrl: provider?.logoUrl,
        cardCount: e._count.cards,
        enrolledAt: e.createdAt,
        credentialExpiry: e.credentialExpiry,
      };
    }),
  });
});

/**
 * DELETE /api/enrollment/:enrollmentId
 * Remove a bank enrollment and all associated cards
 */
router.delete('/:enrollmentId', requireAuth, async (req, res) => {
  const { enrollmentId } = req.params;

  // Verify enrollment belongs to user
  const enrollment = await prisma.bsimEnrollment.findFirst({
    where: {
      id: enrollmentId,
      userId: req.userId,
    },
    include: {
      cards: true,
    },
  });

  if (!enrollment) {
    res.status(404).json({ error: 'not_found', message: 'Enrollment not found' });
    return;
  }

  // TODO: Revoke credential at BSIM (if supported)
  // This would call BSIM's /api/wallet/revoke endpoint

  // Delete enrollment (cards will cascade)
  await prisma.bsimEnrollment.delete({
    where: { id: enrollmentId },
  });

  console.log(`[Enrollment] Deleted enrollment ${enrollmentId} for user ${req.userId}`);

  res.json({
    success: true,
    deletedCards: enrollment.cards.length,
  });
});

export default router;
