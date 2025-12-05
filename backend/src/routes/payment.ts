import { Router } from 'express';
import { prisma } from '../config/database';
import { decrypt } from '../utils/crypto';
import { env } from '../config/env';

const router = Router();

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
    console.warn('[Payment] Failed to parse BSIM_PROVIDERS');
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
 * POST /api/payment/request-token
 * Request a card token from BSIM for payment processing
 *
 * This endpoint is called by auth-server during the payment authorization flow.
 * It requires internal authentication (shared secret between backend and auth-server).
 */
router.post('/request-token', async (req, res) => {
  try {
    // Verify internal auth (auth-server calling backend)
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${env.INTERNAL_API_SECRET}`) {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid internal auth' });
      return;
    }

    const { walletCardId, merchantId, merchantName, amount, currency } = req.body;

    if (!walletCardId) {
      res.status(400).json({ error: 'bad_request', message: 'walletCardId is required' });
      return;
    }

    // Get the card with enrollment info
    const card = await prisma.walletCard.findUnique({
      where: { id: walletCardId },
      include: {
        enrollment: true,
      },
    });

    if (!card) {
      res.status(404).json({ error: 'not_found', message: 'Card not found' });
      return;
    }

    // Get provider config for this BSIM
    const providers = getBsimProviders();
    const provider = providers.find(p => p.bsimId === card.enrollment.bsimId);

    if (!provider) {
      res.status(404).json({ error: 'provider_not_found', message: `No provider config for ${card.enrollment.bsimId}` });
      return;
    }

    // Decrypt wallet credential
    const walletCredential = decrypt(card.enrollment.walletCredential);

    // Request card token from BSIM
    const apiUrl = getBsimApiUrl(provider);
    const tokenUrl = `${apiUrl}/api/wallet/tokens`;

    console.log(`[Payment] Requesting card token from ${tokenUrl}`);

    const bsimResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${walletCredential}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cardId: card.bsimCardRef,
        merchantId,
        amount,
        currency: currency || 'CAD',
      }),
    });

    if (!bsimResponse.ok) {
      const errorText = await bsimResponse.text();
      console.error(`[Payment] BSIM token request failed: ${bsimResponse.status} - ${errorText}`);
      res.status(502).json({
        error: 'bsim_error',
        message: `Failed to get card token from BSIM: ${bsimResponse.status}`,
      });
      return;
    }

    const tokenData = await bsimResponse.json() as {
      token: string;
      tokenId: string;
      expiresAt: string;
      cardInfo: { lastFour: string; cardType: string };
    };

    console.log(`[Payment] Got card token from BSIM: ${tokenData.tokenId.substring(0, 8)}...`);

    res.json({
      cardToken: tokenData.token,
      tokenId: tokenData.tokenId,
      expiresAt: tokenData.expiresAt,
      walletCardToken: card.walletCardToken,
      cardInfo: tokenData.cardInfo,
    });
  } catch (error) {
    console.error('[Payment] Error requesting token:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to request card token' });
  }
});

/**
 * POST /api/payment/context
 * Store payment context during OIDC flow
 * Called by auth-server when user selects a card
 */
router.post('/context', async (req, res) => {
  try {
    // Verify internal auth
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${env.INTERNAL_API_SECRET}`) {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid internal auth' });
      return;
    }

    const {
      grantId,
      walletCardId,
      walletCardToken,
      bsimCardToken,
      merchantId,
      merchantName,
      amount,
      currency,
    } = req.body;

    if (!grantId || !walletCardId || !walletCardToken) {
      res.status(400).json({
        error: 'bad_request',
        message: 'grantId, walletCardId, and walletCardToken are required',
      });
      return;
    }

    // Create or update payment context
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const context = await prisma.paymentContext.upsert({
      where: { grantId },
      create: {
        grantId,
        walletCardId,
        walletCardToken,
        bsimCardToken,
        merchantId,
        merchantName,
        amount,
        currency,
        expiresAt,
      },
      update: {
        walletCardId,
        walletCardToken,
        bsimCardToken,
        merchantId,
        merchantName,
        amount,
        currency,
        expiresAt,
      },
    });

    console.log(`[Payment] Stored payment context for grant ${grantId.substring(0, 8)}...`);

    res.json({ success: true, contextId: context.id });
  } catch (error) {
    console.error('[Payment] Error storing context:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to store payment context' });
  }
});

/**
 * GET /api/payment/context/:grantId
 * Retrieve payment context for extraTokenClaims
 */
router.get('/context/:grantId', async (req, res) => {
  try {
    // Verify internal auth
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${env.INTERNAL_API_SECRET}`) {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid internal auth' });
      return;
    }

    const { grantId } = req.params;

    const context = await prisma.paymentContext.findUnique({
      where: { grantId },
    });

    if (!context) {
      res.status(404).json({ error: 'not_found', message: 'Payment context not found' });
      return;
    }

    // Check if expired
    if (context.expiresAt < new Date()) {
      res.status(410).json({ error: 'expired', message: 'Payment context has expired' });
      return;
    }

    res.json({
      walletCardToken: context.walletCardToken,
      bsimCardToken: context.bsimCardToken,
      merchantId: context.merchantId,
      merchantName: context.merchantName,
      amount: context.amount,
      currency: context.currency,
    });
  } catch (error) {
    console.error('[Payment] Error retrieving context:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to retrieve payment context' });
  }
});

export default router;
