import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../adapters/prisma';
import { env } from '../config/env';
import Provider from 'oidc-provider';

const router = Router();

// Helper to clear OIDC client cache after changes
// Note: cacheClear exists at runtime but isn't in oidc-provider's TypeScript types
function clearClientCache(req: Request, clientId?: string) {
  const provider = req.app.get('oidcProvider') as Provider | undefined;
  if (provider) {
    // Cast to any to access internal cache method not exposed in types
    const Client = provider.Client as any;
    if (clientId) {
      // Clear specific client from cache
      Client.cacheClear?.(clientId);
      console.log(`[Admin] Cleared OIDC cache for client: ${clientId}`);
    } else {
      // Clear all clients from cache
      Client.cacheClear?.();
      console.log('[Admin] Cleared all OIDC client cache');
    }
  }
}

// Helper to check if current admin is SUPER_ADMIN
function isSuperAdmin(req: Request): boolean {
  return (req as any).admin?.role === 'SUPER_ADMIN';
}

// Middleware to require SUPER_ADMIN role
function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!isSuperAdmin(req)) {
    return res.redirect('/administration?error=Super admin access required');
  }
  next();
}

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
      grantTypes,
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

    // Parse grant types from checkbox form input (can be string or array)
    const parseGrantTypes = (input: string | string[] | undefined): string[] => {
      if (!input) return ['authorization_code']; // Default
      if (Array.isArray(input)) return input;
      return [input]; // Single checkbox value
    };

    await prisma.oAuthClient.create({
      data: {
        clientId: clientId.trim(),
        clientSecret,
        clientName: clientName.trim(),
        redirectUris: parseArray(redirectUris),
        postLogoutRedirectUris: parseArray(postLogoutRedirectUris),
        grantTypes: parseGrantTypes(grantTypes),
        scope: scope.trim(),
        logoUri: logoUri?.trim() || null,
        trusted: trusted === 'on',
      },
    });

    // Clear OIDC client cache so new client is immediately available
    clearClientCache(req, clientId.trim());

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
      grantTypes,
      generateApiKey,
      regenerateApiKey,
      revokeApiKey,
    } = req.body;

    // Parse arrays from form input (newline-separated)
    const parseArray = (str: string) =>
      str
        ? str
            .split('\n')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];

    // Parse grant types from checkbox form input (can be string or array)
    const parseGrantTypes = (input: string | string[] | undefined): string[] => {
      if (!input) return ['authorization_code']; // Default
      if (Array.isArray(input)) return input;
      return [input]; // Single checkbox value
    };

    const updateData: any = {
      clientName: clientName.trim(),
      redirectUris: parseArray(redirectUris),
      postLogoutRedirectUris: parseArray(postLogoutRedirectUris),
      grantTypes: parseGrantTypes(grantTypes),
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

    // Handle API key operations
    let newApiKey: string | null = null;
    let apiKeyRevoked = false;

    if (revokeApiKey === 'on') {
      // Revoke (remove) API key
      updateData.apiKey = null;
      apiKeyRevoked = true;
    } else if (generateApiKey === 'on' || regenerateApiKey === 'on') {
      // Generate new API key (format: wsim_api_{random})
      newApiKey = `wsim_api_${crypto.randomBytes(24).toString('base64url')}`;
      updateData.apiKey = newApiKey;
    }

    const updatedClient = await prisma.oAuthClient.update({
      where: { id: req.params.id },
      data: updateData,
      select: { clientId: true },
    });

    // Clear OIDC client cache so changes take effect immediately
    clearClientCache(req, updatedClient.clientId);

    // Build success message
    const messages: string[] = [];
    if (newSecret) {
      messages.push(`New secret: ${newSecret}`);
    }
    if (newApiKey) {
      messages.push(`New API key: ${newApiKey}`);
    }
    if (apiKeyRevoked) {
      messages.push('API key revoked');
    }

    const message = messages.length > 0
      ? `Client updated. ${messages.join('. ')}`
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
      select: { clientId: true, clientName: true },
    });

    if (!client) {
      return res.redirect('/administration?error=Client not found');
    }

    await prisma.oAuthClient.delete({
      where: { id: req.params.id },
    });

    // Clear OIDC client cache so deleted client is no longer usable
    clearClientCache(req, client.clientId);

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

// =============================================================================
// ADMIN USER MANAGEMENT (SUPER_ADMIN only)
// =============================================================================

/**
 * GET /administration/admins - List all admin users
 */
router.get('/admins', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admins = await prisma.adminUser.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        passkeys: {
          select: {
            id: true,
            lastUsedAt: true,
          },
        },
        _count: {
          select: {
            invitesCreated: true,
          },
        },
      },
    });

    res.render('admin/admins', {
      admins,
      admin: (req as any).admin,
      message: req.query.message,
      error: req.query.error,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /administration/invites - List pending invites
 */
router.get('/invites', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invites = await prisma.adminInvite.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        usedBy: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // Build invite URLs
    const baseUrl = env.AUTH_SERVER_URL || 'http://localhost:3002';
    const invitesWithUrls = invites.map(invite => ({
      ...invite,
      url: `${baseUrl}/administration/join/${invite.code}`,
      status: invite.revokedAt
        ? 'revoked'
        : invite.usedAt
          ? 'used'
          : invite.expiresAt < new Date()
            ? 'expired'
            : 'pending',
    }));

    res.render('admin/invites', {
      invites: invitesWithUrls,
      admin: (req as any).admin,
      message: req.query.message,
      error: req.query.error,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /administration/invites/new - Show create invite form
 */
router.get('/invites/new', requireSuperAdmin, async (req: Request, res: Response) => {
  res.render('admin/invite-form', {
    admin: (req as any).admin,
    error: null,
  });
});

/**
 * POST /administration/invites - Create new invite
 */
router.post('/invites', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, role, expiryDays } = req.body;
    const currentAdmin = (req as any).admin;

    // Validate role
    const validRoles = ['ADMIN', 'SUPER_ADMIN'];
    const inviteRole = validRoles.includes(role) ? role : 'ADMIN';

    // Generate secure invite code (32 bytes = 64 hex chars)
    const code = crypto.randomBytes(32).toString('hex');

    // Calculate expiry (default 7 days)
    const days = parseInt(expiryDays) || 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    // Create invite
    const invite = await prisma.adminInvite.create({
      data: {
        code,
        email: email?.trim() || null,
        role: inviteRole,
        createdById: currentAdmin.id,
        expiresAt,
      },
    });

    const baseUrl = env.AUTH_SERVER_URL || 'http://localhost:3002';
    const inviteUrl = `${baseUrl}/administration/join/${code}`;

    console.log(`[Admin] Invite created by ${currentAdmin.email} for ${email || 'anyone'} (${inviteRole})`);

    res.redirect(`/administration/invites?message=${encodeURIComponent(`Invite created! URL: ${inviteUrl}`)}`);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /administration/invites/:id/revoke - Revoke an invite
 */
router.post('/invites/:id/revoke', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invite = await prisma.adminInvite.findUnique({
      where: { id: req.params.id },
    });

    if (!invite) {
      return res.redirect('/administration/invites?error=Invite not found');
    }

    if (invite.usedAt) {
      return res.redirect('/administration/invites?error=Cannot revoke a used invite');
    }

    if (invite.revokedAt) {
      return res.redirect('/administration/invites?error=Invite already revoked');
    }

    await prisma.adminInvite.update({
      where: { id: req.params.id },
      data: { revokedAt: new Date() },
    });

    console.log(`[Admin] Invite ${req.params.id} revoked by ${(req as any).admin.email}`);

    res.redirect('/administration/invites?message=Invite revoked successfully');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /administration/admins/:id/edit - Show edit admin form
 */
router.get('/admins/:id/edit', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentAdmin = (req as any).admin;
    const targetAdmin = await prisma.adminUser.findUnique({
      where: { id: req.params.id },
      include: {
        passkeys: {
          select: {
            id: true,
            credentialId: true,
            lastUsedAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!targetAdmin) {
      return res.redirect('/administration/admins?error=Admin not found');
    }

    res.render('admin/admin-edit', {
      targetAdmin,
      admin: currentAdmin,
      isSelf: currentAdmin.id === targetAdmin.id,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /administration/admins/:id - Update admin user
 */
router.post('/admins/:id', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentAdmin = (req as any).admin;
    const { firstName, lastName, role } = req.body;
    const targetId = req.params.id;

    const targetAdmin = await prisma.adminUser.findUnique({
      where: { id: targetId },
    });

    if (!targetAdmin) {
      return res.redirect('/administration/admins?error=Admin not found');
    }

    // Prevent changing own role (to avoid accidentally locking yourself out)
    const updateData: any = {
      firstName: firstName?.trim() || targetAdmin.firstName,
      lastName: lastName?.trim() || targetAdmin.lastName,
    };

    // Only allow role change if not editing self
    if (currentAdmin.id !== targetId && role && ['ADMIN', 'SUPER_ADMIN'].includes(role)) {
      updateData.role = role;
    }

    await prisma.adminUser.update({
      where: { id: targetId },
      data: updateData,
    });

    console.log(`[Admin] Admin ${targetAdmin.email} updated by ${currentAdmin.email}`);

    res.redirect('/administration/admins?message=' + encodeURIComponent(`Admin "${targetAdmin.email}" updated successfully`));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /administration/admins/:id/delete - Delete admin user
 */
router.post('/admins/:id/delete', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentAdmin = (req as any).admin;
    const targetId = req.params.id;

    // Prevent self-deletion
    if (currentAdmin.id === targetId) {
      return res.redirect('/administration/admins?error=You cannot delete your own admin account');
    }

    const targetAdmin = await prisma.adminUser.findUnique({
      where: { id: targetId },
      select: { email: true, firstName: true, lastName: true },
    });

    if (!targetAdmin) {
      return res.redirect('/administration/admins?error=Admin not found');
    }

    // Delete passkeys first (cascade), then admin
    await prisma.adminPasskey.deleteMany({
      where: { adminUserId: targetId },
    });

    await prisma.adminUser.delete({
      where: { id: targetId },
    });

    console.log(`[Admin] Admin ${targetAdmin.email} deleted by ${currentAdmin.email}`);

    res.redirect('/administration/admins?message=' + encodeURIComponent(`Admin "${targetAdmin.firstName} ${targetAdmin.lastName}" has been removed`));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /administration/admins/:adminId/passkeys/:passkeyId/delete - Delete a specific passkey
 */
router.post('/admins/:adminId/passkeys/:passkeyId/delete', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentAdmin = (req as any).admin;
    const { adminId, passkeyId } = req.params;

    const passkey = await prisma.adminPasskey.findUnique({
      where: { id: passkeyId },
      include: {
        adminUser: { select: { email: true, id: true } },
      },
    });

    if (!passkey || passkey.adminUserId !== adminId) {
      return res.redirect(`/administration/admins/${adminId}/edit?error=Passkey not found`);
    }

    // Check if this is the admin's only passkey
    const passkeyCount = await prisma.adminPasskey.count({
      where: { adminUserId: adminId },
    });

    if (passkeyCount === 1) {
      return res.redirect(`/administration/admins/${adminId}/edit?error=Cannot delete the only passkey. Admin must have at least one authentication method.`);
    }

    await prisma.adminPasskey.delete({
      where: { id: passkeyId },
    });

    console.log(`[Admin] Passkey ${passkeyId} deleted for ${passkey.adminUser.email} by ${currentAdmin.email}`);

    res.redirect(`/administration/admins/${adminId}/edit?message=Passkey deleted successfully`);
  } catch (err) {
    next(err);
  }
});

export default router;
