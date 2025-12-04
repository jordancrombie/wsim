import { Router, Request, Response } from 'express';
import Provider from 'oidc-provider';
import { prisma } from '../adapters/prisma';

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

      // TODO: Request card token from BSIM
      // This requires BSIM wallet:request-token endpoint
      // For now, we'll store the card selection and complete consent

      // Store payment context for extraTokenClaims
      // This will be retrieved when generating the access token
      // TODO: Implement payment context storage

      const result = {
        consent: {
          // Grant all requested scopes
        },
      };

      await provider.interactionFinished(req, res, result, {
        mergeWithLastSubmission: true,
      });
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
