/**
 * WSIM Merchant Wallet API
 *
 * This API allows merchants to integrate WSIM wallet payments with custom UIs.
 * Merchants can fetch user cards, initiate payments, and confirm with passkey.
 *
 * Authentication:
 * - All endpoints require a valid merchant API key in x-api-key header
 * - User must be authenticated (session cookie from WSIM login)
 *
 * Flow:
 * 1. User logs into merchant site and connects WSIM wallet (OAuth or passkey)
 * 2. Merchant fetches user's cards via GET /api/merchant/cards
 * 3. User selects a card, merchant initiates payment
 * 4. User confirms with passkey, merchant receives payment token
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { decrypt } from '../utils/crypto';
import { verifyJwt } from '../middleware/auth';

const router = Router();

// In-memory challenge storage (should use Redis in production)
const paymentChallengeStore = new Map<string, {
  challenge: string;
  userId: string;
  walletCardId: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: string;
  expiresAt: number;
}>();

// Clean up expired challenges
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of paymentChallengeStore.entries()) {
    if (value.expiresAt < now) {
      paymentChallengeStore.delete(key);
    }
  }
}, 60000);

// BSIM provider config type
interface BsimProviderConfig {
  bsimId: string;
  name: string;
  issuer: string;
  apiUrl?: string;
  clientId: string;
  clientSecret: string;
}

// Parse BSIM providers from environment
function getBsimProviders(): BsimProviderConfig[] {
  try {
    return JSON.parse(env.BSIM_PROVIDERS);
  } catch {
    return [];
  }
}

// Derive API URL from issuer
function getBsimApiUrl(provider: BsimProviderConfig): string {
  if (provider.apiUrl) return provider.apiUrl;
  const url = new URL(provider.issuer);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    url.port = '3001';
    return url.origin;
  }
  if (url.hostname.startsWith('auth-')) {
    url.hostname = url.hostname.replace('auth-', '');
  } else if (url.hostname.startsWith('auth.')) {
    url.hostname = url.hostname.replace('auth.', '');
  }
  return url.origin;
}

/**
 * Middleware to verify merchant API key
 */
async function verifyMerchantApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return res.status(401).json({
      error: 'missing_api_key',
      message: 'x-api-key header is required',
    });
  }

  // Look up the merchant by API key
  const merchant = await prisma.oAuthClient.findFirst({
    where: {
      apiKey: apiKey,
    },
  });

  if (!merchant) {
    return res.status(401).json({
      error: 'invalid_api_key',
      message: 'Invalid API key',
    });
  }

  // Attach merchant info to request (including webauthnRelatedOrigin for cross-domain passkey verification)
  (req as Request & { merchant: { id: string; name: string; webauthnRelatedOrigin?: string } }).merchant = {
    id: merchant.clientId,
    name: merchant.clientName || merchant.clientId,
    webauthnRelatedOrigin: merchant.webauthnRelatedOrigin || undefined,
  };

  next();
}

/**
 * Middleware to require authenticated user session
 *
 * Supports two authentication methods (checked in order):
 * 1. Session cookie (wsim.sid) - traditional browser session
 * 2. JWT bearer token in Authorization header - for cross-origin API calls
 *
 * This hybrid approach allows:
 * - Existing flows (OIDC popup/redirect) to continue working via session cookies
 * - New "API Direct (JWT)" flow where merchant stores and sends JWT token
 */
function requireUserSession(req: Request, res: Response, next: NextFunction) {
  let userId: string | null = null;

  // Method 1: Try session cookie first (existing flow)
  userId = (req.session as { userId?: string })?.userId || null;

  // Method 2: Fall back to JWT bearer token (new API Direct flow)
  if (!userId) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7); // Remove "Bearer " prefix
      const verified = verifyJwt(token);
      if (verified?.sub) {
        userId = verified.sub;
      }
    }
  }

  if (!userId) {
    return res.status(401).json({
      error: 'not_authenticated',
      message: 'User must be authenticated. Provide session cookie or JWT bearer token.',
    });
  }

  (req as Request & { userId: string }).userId = userId;
  next();
}

/**
 * GET /api/merchant/cards
 * List user's wallet cards
 *
 * Headers:
 *   x-api-key: Merchant API key
 *
 * Response:
 *   {
 *     cards: [
 *       {
 *         id: string,
 *         lastFour: string,
 *         cardType: string,
 *         bankName: string,
 *         isDefault: boolean
 *       }
 *     ]
 *   }
 */
router.get('/cards', verifyMerchantApiKey, requireUserSession, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;

    const cards = await prisma.walletCard.findMany({
      where: {
        userId,
        isActive: true,
      },
      include: {
        enrollment: {
          select: {
            bsimId: true,
          },
        },
      },
      orderBy: {
        isDefault: 'desc',
      },
    });

    // Get BSIM provider names
    const providers = getBsimProviders();
    const providerMap = new Map(providers.map(p => [p.bsimId, p.name]));

    res.json({
      cards: cards.map(card => ({
        id: card.id,
        lastFour: card.lastFour,
        cardType: card.cardType,
        bankName: providerMap.get(card.enrollment.bsimId) || card.enrollment.bsimId,
        isDefault: card.isDefault,
      })),
    });
  } catch (error) {
    console.error('[WalletAPI] Error listing cards:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to list cards' });
  }
});

/**
 * POST /api/merchant/payment/initiate
 * Initiate a payment and get passkey challenge
 *
 * Headers:
 *   x-api-key: Merchant API key
 *
 * Body:
 *   {
 *     cardId: string,      // WSIM card ID from /cards endpoint
 *     amount: number,      // Amount in dollars (e.g., 104.99)
 *     currency: string,    // "CAD", "USD", etc.
 *     orderId?: string     // Optional merchant order reference
 *   }
 *
 * Response:
 *   {
 *     paymentId: string,           // Use this in /confirm
 *     passkeyOptions: object,      // WebAuthn authentication options
 *     card: { lastFour, cardType } // Card info for display
 *   }
 */
router.post('/payment/initiate', verifyMerchantApiKey, requireUserSession, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const merchant = (req as Request & { merchant: { id: string; name: string } }).merchant;
    const { cardId, amount, currency, orderId } = req.body as {
      cardId: string;
      amount: number;
      currency?: string;
      orderId?: string;
    };

    if (!cardId || !amount) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'cardId and amount are required',
      });
    }

    // Verify the card belongs to the user
    const card = await prisma.walletCard.findFirst({
      where: {
        id: cardId,
        userId,
        isActive: true,
      },
    });

    if (!card) {
      return res.status(404).json({
        error: 'card_not_found',
        message: 'Card not found or does not belong to user',
      });
    }

    // Get user's passkeys
    const passkeys = await prisma.passkeyCredential.findMany({
      where: { userId },
    });

    if (passkeys.length === 0) {
      return res.status(400).json({
        error: 'no_passkeys',
        message: 'User has no registered passkeys. Redirect to WSIM to register one.',
      });
    }

    // Generate passkey authentication challenge
    const options = await generateAuthenticationOptions({
      rpID: env.WEBAUTHN_RP_ID,
      allowCredentials: passkeys.map(p => ({
        id: p.credentialId,
        transports: p.transports.includes('internal')
          ? ['internal'] as AuthenticatorTransportFuture[]
          : p.transports as AuthenticatorTransportFuture[],
      })),
      userVerification: 'required',
    });

    // Generate a unique payment ID
    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    // Store challenge with payment context
    paymentChallengeStore.set(paymentId, {
      challenge: options.challenge,
      userId,
      walletCardId: cardId,
      merchantId: merchant.id,
      merchantName: merchant.name,
      amount,
      currency: currency || 'CAD',
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    console.log(`[WalletAPI] Payment initiated: ${paymentId} for ${merchant.id}, card ${card.lastFour}`);

    res.json({
      paymentId,
      passkeyOptions: options,
      card: {
        lastFour: card.lastFour,
        cardType: card.cardType,
      },
      orderId,
    });
  } catch (error) {
    console.error('[WalletAPI] Error initiating payment:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to initiate payment' });
  }
});

/**
 * POST /api/merchant/payment/confirm
 * Confirm payment with passkey and receive payment token
 *
 * Headers:
 *   x-api-key: Merchant API key
 *
 * Body:
 *   {
 *     paymentId: string,        // From /initiate response
 *     passkeyResponse: object   // WebAuthn authentication response
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     token: string,           // Wallet payment token (for NSIM)
 *     cardToken: string,       // BSIM card token
 *     cardLast4: string,
 *     cardBrand: string,
 *     expiresAt: string        // Token expiry (ISO timestamp)
 *   }
 */
router.post('/payment/confirm', verifyMerchantApiKey, async (req: Request, res: Response) => {
  try {
    const { paymentId, passkeyResponse } = req.body as {
      paymentId: string;
      passkeyResponse: AuthenticationResponseJSON;
    };

    if (!paymentId || !passkeyResponse) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'paymentId and passkeyResponse are required',
      });
    }

    // Get payment context
    const paymentContext = paymentChallengeStore.get(paymentId);
    if (!paymentContext) {
      return res.status(400).json({
        error: 'invalid_payment',
        message: 'Payment not found or expired. Call /initiate again.',
      });
    }

    // Remove from store (one-time use)
    paymentChallengeStore.delete(paymentId);

    // Verify passkey
    const credential = await prisma.passkeyCredential.findUnique({
      where: { credentialId: passkeyResponse.id },
      include: { user: true },
    });

    if (!credential || credential.userId !== paymentContext.userId) {
      return res.status(400).json({
        error: 'invalid_credential',
        message: 'Passkey credential not found or does not belong to user',
      });
    }

    let verification: VerifiedAuthenticationResponse;
    try {
      const publicKeyBuffer = Buffer.from(credential.publicKey, 'base64url');

      // Build list of allowed origins: standard WSIM origins + merchant's webauthnRelatedOrigin if configured
      const merchant = (req as Request & { merchant?: { webauthnRelatedOrigin?: string } }).merchant;
      const allowedOrigins = [...env.WEBAUTHN_ORIGINS];
      if (merchant?.webauthnRelatedOrigin) {
        allowedOrigins.push(merchant.webauthnRelatedOrigin);
        console.log(`[WalletAPI] Including merchant origin for passkey verification: ${merchant.webauthnRelatedOrigin}`);
      }

      verification = await verifyAuthenticationResponse({
        response: passkeyResponse,
        expectedChallenge: paymentContext.challenge,
        expectedOrigin: allowedOrigins,
        expectedRPID: env.WEBAUTHN_RP_ID,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(publicKeyBuffer),
          counter: credential.counter,
          transports: credential.transports as AuthenticatorTransportFuture[],
        },
      });
    } catch (verifyError) {
      console.error('[WalletAPI] Passkey verification failed:', verifyError);
      return res.status(400).json({
        error: 'passkey_failed',
        message: 'Passkey verification failed',
      });
    }

    if (!verification.verified) {
      return res.status(400).json({
        error: 'verification_failed',
        message: 'Passkey verification failed',
      });
    }

    // Update passkey counter
    await prisma.passkeyCredential.update({
      where: { id: credential.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    // Get the card and request token from BSIM
    const card = await prisma.walletCard.findUnique({
      where: { id: paymentContext.walletCardId },
      include: { enrollment: true },
    });

    if (!card) {
      return res.status(404).json({
        error: 'card_not_found',
        message: 'Card not found',
      });
    }

    // Get provider config for this BSIM
    const providers = getBsimProviders();
    const provider = providers.find(p => p.bsimId === card.enrollment.bsimId);

    if (!provider) {
      return res.status(404).json({
        error: 'provider_not_found',
        message: `No provider config for ${card.enrollment.bsimId}`,
      });
    }

    // Decrypt wallet credential and request card token from BSIM
    const walletCredential = decrypt(card.enrollment.walletCredential);
    const apiUrl = getBsimApiUrl(provider);
    const tokenUrl = `${apiUrl}/api/wallet/tokens`;

    console.log(`[WalletAPI] Requesting card token from ${tokenUrl}`);

    const bsimResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${walletCredential}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cardId: card.bsimCardRef,
        merchantId: paymentContext.merchantId,
        amount: paymentContext.amount,
        currency: paymentContext.currency,
      }),
    });

    if (!bsimResponse.ok) {
      const errorText = await bsimResponse.text();
      console.error(`[WalletAPI] BSIM token request failed: ${bsimResponse.status} - ${errorText}`);
      return res.status(502).json({
        error: 'bsim_error',
        message: `Failed to get card token from BSIM`,
      });
    }

    const tokenData = await bsimResponse.json() as {
      token: string;
      tokenId: string;
      expiresAt: string;
    };

    console.log(`[WalletAPI] Payment confirmed: ${paymentId}, card ${card.lastFour}`);

    res.json({
      success: true,
      token: card.walletCardToken,
      cardToken: tokenData.token,
      cardLast4: card.lastFour,
      cardBrand: card.cardType.toLowerCase(),
      expiresAt: tokenData.expiresAt,
    });
  } catch (error) {
    console.error('[WalletAPI] Error confirming payment:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to confirm payment' });
  }
});

/**
 * GET /api/merchant/user
 * Get current authenticated user info
 *
 * Headers:
 *   x-api-key: Merchant API key
 *
 * Response:
 *   {
 *     authenticated: boolean,
 *     user?: { id, email, hasPasskeys }
 *   }
 */
router.get('/user', verifyMerchantApiKey, async (req: Request, res: Response) => {
  try {
    // Support both session cookie and JWT bearer token (hybrid auth)
    let userId: string | null = (req.session as { userId?: string })?.userId || null;

    // Fall back to JWT bearer token if no session
    if (!userId) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const verified = verifyJwt(token);
        if (verified?.sub) {
          userId = verified.sub;
        }
      }
    }

    if (!userId) {
      return res.json({ authenticated: false });
    }

    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      include: {
        passkeyCredentials: { select: { id: true } },
      },
    });

    if (!user) {
      return res.json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        hasPasskeys: user.passkeyCredentials.length > 0,
      },
    });
  } catch (error) {
    console.error('[WalletAPI] Error getting user:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to get user info' });
  }
});

export default router;
