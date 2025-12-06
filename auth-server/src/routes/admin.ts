import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../adapters/prisma';

const router = Router();

/**
 * GET /administration - List all OAuth clients
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clients = await prisma.oAuthClient.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        clientId: true,
        clientName: true,
        redirectUris: true,
        scope: true,
        trusted: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.render('admin/clients', {
      clients,
      admin: (req as any).admin,
      message: req.query.message,
      error: req.query.error,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /administration/clients/new - Show create client form
 */
router.get('/clients/new', async (req: Request, res: Response) => {
  res.render('admin/client-form', {
    client: null,
    admin: (req as any).admin,
    isNew: true,
    error: null,
  });
});

/**
 * POST /administration/clients - Create new client
 */
router.post('/clients', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      clientId,
      clientName,
      redirectUris,
      postLogoutRedirectUris,
      scope,
      logoUri,
      trusted,
    } = req.body;

    // Generate a secure client secret
    const clientSecret = crypto.randomBytes(32).toString('hex');

    // Parse arrays from form input (newline-separated)
    const parseArray = (str: string) =>
      str
        ? str
            .split('\n')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];

    await prisma.oAuthClient.create({
      data: {
        clientId: clientId.trim(),
        clientSecret,
        clientName: clientName.trim(),
        redirectUris: parseArray(redirectUris),
        postLogoutRedirectUris: parseArray(postLogoutRedirectUris),
        grantTypes: ['authorization_code', 'refresh_token'],
        scope: scope.trim(),
        logoUri: logoUri?.trim() || null,
        trusted: trusted === 'on',
      },
    });

    res.redirect(`/administration?message=Client "${clientName}" created successfully. Secret: ${clientSecret}`);
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.render('admin/client-form', {
        client: req.body,
        admin: (req as any).admin,
        isNew: true,
        error: 'A client with this ID already exists',
      });
    } else {
      next(err);
    }
  }
});

/**
 * GET /administration/clients/:id - Show edit client form
 */
router.get('/clients/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = await prisma.oAuthClient.findUnique({
      where: { id: req.params.id },
    });

    if (!client) {
      return res.redirect('/administration?error=Client not found');
    }

    res.render('admin/client-form', {
      client,
      admin: (req as any).admin,
      isNew: false,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /administration/clients/:id - Update client
 */
router.post('/clients/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      clientName,
      redirectUris,
      postLogoutRedirectUris,
      scope,
      logoUri,
      trusted,
      regenerateSecret,
    } = req.body;

    // Parse arrays from form input (newline-separated)
    const parseArray = (str: string) =>
      str
        ? str
            .split('\n')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];

    const updateData: any = {
      clientName: clientName.trim(),
      redirectUris: parseArray(redirectUris),
      postLogoutRedirectUris: parseArray(postLogoutRedirectUris),
      scope: scope.trim(),
      logoUri: logoUri?.trim() || null,
      trusted: trusted === 'on',
    };

    // Optionally regenerate secret
    let newSecret: string | null = null;
    if (regenerateSecret === 'on') {
      newSecret = crypto.randomBytes(32).toString('hex');
      updateData.clientSecret = newSecret;
    }

    await prisma.oAuthClient.update({
      where: { id: req.params.id },
      data: updateData,
    });

    const message = newSecret
      ? `Client updated. New secret: ${newSecret}`
      : 'Client updated successfully';

    res.redirect(`/administration?message=${encodeURIComponent(message)}`);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /administration/clients/:id/delete - Delete client
 */
router.post('/clients/:id/delete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = await prisma.oAuthClient.findUnique({
      where: { id: req.params.id },
      select: { clientName: true },
    });

    if (!client) {
      return res.redirect('/administration?error=Client not found');
    }

    await prisma.oAuthClient.delete({
      where: { id: req.params.id },
    });

    res.redirect(`/administration?message=Client "${client.clientName}" deleted`);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /administration/sessions - List active OIDC sessions
 */
router.get('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get active payment consents
    const consents = await prisma.walletPaymentConsent.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // Get OAuth clients for the consents
    const clientIds = [...new Set(consents.map(c => c.merchantId))];
    const clients = await prisma.oAuthClient.findMany({
      where: { clientId: { in: clientIds } },
      select: {
        clientId: true,
        clientName: true,
        logoUri: true,
      },
    });
    const clientMap = new Map(clients.map(c => [c.clientId, c]));

    // Add client info to consents
    const consentsWithClients = consents.map(consent => ({
      ...consent,
      client: clientMap.get(consent.merchantId) || {
        clientId: consent.merchantId,
        clientName: consent.merchantName,
        logoUri: null,
      },
    }));

    res.render('admin/sessions', {
      consents: consentsWithClients,
      admin: (req as any).admin,
      message: req.query.message,
      error: req.query.error,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /administration/sessions/:id/revoke - Revoke a payment consent
 */
router.post('/sessions/:id/revoke', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const consent = await prisma.walletPaymentConsent.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { email: true } },
      },
    });

    if (!consent) {
      return res.redirect('/administration/sessions?error=Session not found');
    }

    // Mark consent as revoked
    await prisma.walletPaymentConsent.update({
      where: { id: req.params.id },
      data: { revokedAt: new Date() },
    });

    res.redirect(
      `/administration/sessions?message=${encodeURIComponent(
        `Session for ${consent.user.email} (${consent.merchantName}) has been revoked`
      )}`
    );
  } catch (err) {
    next(err);
  }
});

/**
 * POST /administration/sessions/revoke-all - Revoke all sessions for a user
 */
router.post('/sessions/revoke-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.redirect('/administration/sessions?error=User ID required');
    }

    // Find all active consents for this user
    const consents = await prisma.walletPaymentConsent.findMany({
      where: {
        userId,
        revokedAt: null,
      },
      include: {
        user: { select: { email: true } },
      },
    });

    if (consents.length === 0) {
      return res.redirect('/administration/sessions?error=No active sessions found for this user');
    }

    // Revoke all consents
    await prisma.walletPaymentConsent.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    const userEmail = consents[0]?.user?.email || 'Unknown';
    res.redirect(
      `/administration/sessions?message=${encodeURIComponent(
        `All ${consents.length} session(s) for ${userEmail} have been revoked`
      )}`
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /administration/users - List wallet users (for admin visibility)
 */
router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.walletUser.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        _count: {
          select: {
            walletCards: true,
            enrollments: true,
            paymentConsents: true,
          },
        },
      },
    });

    res.render('admin/users', {
      users,
      admin: (req as any).admin,
      message: req.query.message,
      error: req.query.error,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
