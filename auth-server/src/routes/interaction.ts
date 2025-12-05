import { Router, Request, Response } from 'express';
import Provider from 'oidc-provider';
import { prisma } from '../adapters/prisma';
import { env } from '../config/env';

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
      const error = await response.text();
      console.error('[Interaction] Failed to get card token:', error);
      return null;
    }

    const data = await response.json() as {
      cardToken: string;
      walletCardToken: string;
    };

    return {
      cardToken: data.cardToken,
      walletCardToken: data.walletCardToken,
    };
  } catch (error) {
    console.error('[Interaction] Error requesting card token:', error);
    return null;
  }
}

/**
 * Store payment context in backend
 */
async function storePaymentContext(
  grantId: string,
  walletCardId: string,
  walletCardToken: string,
  bsimCardToken: string | null,
  merchantId?: string,
  merchantName?: string,
  amount?: number,
  currency?: string
): Promise<boolean> {
  try {
    const response = await fetch(`${env.BACKEND_URL}/api/payment/context`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.INTERNAL_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grantId,
        walletCardId,
        walletCardToken,
        bsimCardToken,
        merchantId,
        merchantName,
        amount,
        currency,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Interaction] Failed to store payment context:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Interaction] Error storing payment context:', error);
    return false;
  }
}

/**
 * Create interaction routes for login, consent, and card selection
 */
export function createInteractionRoutes(provider: Provider): Router {
  const router = Router();

  /**
   * GET /interaction/:uid
   * Display the appropriate interaction page
   */
  router.get('/:uid', async (req: Request, res: Response) => {
    try {
      const details = await provider.interactionDetails(req, res);
      const { uid, prompt, params } = details;

      console.log('[Interaction] Type:', prompt.name, 'UID:', uid);

      // Check if this is a payment authorization request
      const isPaymentFlow = (params.scope as string)?.includes('payment:authorize');

      if (prompt.name === 'login') {
        // Show login page
        return res.render('login', {
          uid,
          title: 'Sign in to WSIM',
          isPaymentFlow,
        });
      }

      if (prompt.name === 'consent') {
        // For payment flow, show card selection
        if (isPaymentFlow && details.session?.accountId) {
          const cards = await prisma.walletCard.findMany({
            where: {
              userId: details.session.accountId,
              isActive: true,
            },
            include: {
              enrollment: {
                select: { bsimId: true },
              },
            },
          });

          // Parse payment details from claims parameter
          let paymentDetails = {};
          if (params.claims) {
            try {
              const claims = typeof params.claims === 'string'
                ? JSON.parse(params.claims)
                : params.claims;
              paymentDetails = claims.payment || {};
            } catch {
              // Ignore parse errors
            }
          }

          return res.render('card-select', {
            uid,
            title: 'Select Payment Card',
            cards,
            payment: paymentDetails,
            clientName: params.client_id,
          });
        }

        // Regular consent page
        const scopes = (params.scope as string)?.split(' ') || [];
        return res.render('consent', {
          uid,
          title: 'Authorize Access',
          scopes,
          clientId: params.client_id,
        });
      }

      // Unknown prompt
      res.status(400).render('error', {
        title: 'Error',
        message: `Unknown interaction type: ${prompt.name}`,
      });
    } catch (error) {
      console.error('[Interaction] Error:', error);
      res.status(500).render('error', {
        title: 'Error',
        message: 'Failed to load interaction',
      });
    }
  });

  /**
   * POST /interaction/:uid/login
   * Handle login form submission
   *
   * NOTE: In the real flow, users authenticate via BSIM.
   * This is a simplified login for development/testing.
   */
  router.post('/:uid/login', async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      // Find user by email
      const user = await prisma.walletUser.findUnique({
        where: { email },
      });

      if (!user) {
        return res.render('login', {
          uid: req.params.uid,
          title: 'Sign in to WSIM',
          error: 'User not found. Please enroll a bank first.',
        });
      }

      // Complete the login interaction
      const result = {
        login: {
          accountId: user.id,
          remember: true,
        },
      };

      await provider.interactionFinished(req, res, result, {
        mergeWithLastSubmission: false,
      });
    } catch (error) {
      console.error('[Interaction] Login error:', error);
      res.status(500).render('error', {
        title: 'Error',
        message: 'Login failed',
      });
    }
  });

  /**
   * POST /interaction/:uid/consent
   * Handle consent form submission
   */
  router.post('/:uid/consent', async (req: Request, res: Response) => {
    try {
      const details = await provider.interactionDetails(req, res);

      const consent: {
        rejectedScopes?: string[];
        rejectedClaims?: string[];
        replace?: boolean;
      } = {};

      // Accept all scopes for now
      // In production, you might want to handle rejected scopes

      const result = {
        consent,
      };

      await provider.interactionFinished(req, res, result, {
        mergeWithLastSubmission: true,
      });
    } catch (error) {
      console.error('[Interaction] Consent error:', error);
      res.status(500).render('error', {
        title: 'Error',
        message: 'Consent failed',
      });
    }
  });

  /**
   * POST /interaction/:uid/select-card
   * Handle card selection for payment flow
   */
  router.post('/:uid/select-card', async (req: Request, res: Response) => {
    try {
      const { walletCardId } = req.body;
      const details = await provider.interactionDetails(req, res);

      if (!details.session?.accountId) {
        return res.status(401).render('error', {
          title: 'Error',
          message: 'Not authenticated',
        });
      }

      // Verify card belongs to user
      const card = await prisma.walletCard.findFirst({
        where: {
          id: walletCardId,
          userId: details.session.accountId,
          isActive: true,
        },
        include: {
          enrollment: true,
        },
      });

      if (!card) {
        return res.status(400).render('error', {
          title: 'Error',
          message: 'Card not found',
        });
      }

      // Parse payment details from claims parameter
      let paymentDetails: { merchantId?: string; merchantName?: string; amount?: number; currency?: string } = {};
      if (details.params.claims) {
        try {
          const claims = typeof details.params.claims === 'string'
            ? JSON.parse(details.params.claims)
            : details.params.claims;
          paymentDetails = claims.payment || {};
        } catch {
          // Ignore parse errors
        }
      }

      // Request card token from BSIM via backend
      console.log(`[Interaction] Requesting card token for card ${walletCardId.substring(0, 8)}...`);
      const tokenResult = await requestCardToken(
        walletCardId,
        paymentDetails.merchantId || details.params.client_id as string,
        paymentDetails.merchantName,
        paymentDetails.amount,
        paymentDetails.currency
      );

      // Create a grant for the requested scopes FIRST so we have the grantId
      const grant = new provider.Grant({
        accountId: details.session.accountId,
        clientId: details.params.client_id as string,
      });

      // Add the requested scopes to the grant
      const requestedScopes = (details.params.scope as string)?.split(' ') || [];
      grant.addOIDCScope(requestedScopes.join(' '));

      // Add resource indicator for JWT access tokens
      grant.addResourceScope('urn:wsim:payment-api', requestedScopes.join(' '));

      // Save the grant and get its ID
      const grantId = await grant.save();
      console.log(`[Interaction] Created grant: ${grantId.substring(0, 8)}...`);

      // Store payment context for extraTokenClaims using the actual grant ID
      console.log(`[Interaction] Storing payment context for grant ${grantId.substring(0, 8)}...`);
      const contextStored = await storePaymentContext(
        grantId,
        walletCardId,
        card.walletCardToken,
        tokenResult?.cardToken || null,
        paymentDetails.merchantId || details.params.client_id as string,
        paymentDetails.merchantName,
        paymentDetails.amount,
        paymentDetails.currency
      );

      if (!contextStored) {
        console.warn('[Interaction] Failed to store payment context, continuing anyway');
      }

      const result = {
        consent: {
          grantId,
        },
      };

      console.log(`[Interaction] Finishing interaction for UID ${req.params.uid}...`);
      await provider.interactionFinished(req, res, result, {
        mergeWithLastSubmission: true,
      });
      console.log(`[Interaction] Interaction finished successfully`);
    } catch (error) {
      console.error('[Interaction] Card selection error:', error);
      res.status(500).render('error', {
        title: 'Error',
        message: 'Card selection failed',
      });
    }
  });

  /**
   * POST /interaction/:uid/abort
   * Abort the interaction
   */
  router.post('/:uid/abort', async (req: Request, res: Response) => {
    try {
      const result = {
        error: 'access_denied',
        error_description: 'User cancelled the authorization',
      };

      await provider.interactionFinished(req, res, result, {
        mergeWithLastSubmission: false,
      });
    } catch (error) {
      console.error('[Interaction] Abort error:', error);
      res.redirect('/');
    }
  });

  return router;
}
