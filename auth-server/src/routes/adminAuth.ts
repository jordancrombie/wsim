import { Router, Request, Response } from 'express';
import { prisma } from '../adapters/prisma';
import { env } from '../config/env';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types';
import {
  createAdminToken,
  setAdminCookie,
  clearAdminCookie,
  verifyAdminToken,
} from '../middleware/adminAuth';

const router = Router();

// Configuration
const RP_NAME = 'WSIM Auth Server Admin';
const RP_ID = env.WEBAUTHN_RP_ID;
const ORIGINS = env.WEBAUTHN_ORIGINS;

// Challenge store (in production, use Redis or database)
const challenges = new Map<string, string>();
const registrationChallenges = new Map<string, { challenge: string; userId: string }>();

/**
 * GET /administration/setup - Initial admin setup page (only works when no admins exist)
 */
router.get('/setup', async (req: Request, res: Response) => {
  const adminCount = await prisma.adminUser.count();

  if (adminCount > 0) {
    return res.redirect('/administration/login?error=Setup+already+complete');
  }

  res.render('admin/setup', {
    error: req.query.error,
    rpId: RP_ID,
  });
});

/**
 * POST /administration/setup - Create first admin user (only works when no admins exist)
 */
router.post('/setup', async (req: Request, res: Response) => {
  try {
    const adminCount = await prisma.adminUser.count();

    if (adminCount > 0) {
      return res.status(403).json({ error: 'Setup already complete. Admin user already exists.' });
    }

    const { email, firstName, lastName } = req.body;

    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: 'Email, first name, and last name are required' });
    }

    // Create the first admin user as SUPER_ADMIN
    const admin = await prisma.adminUser.create({
      data: {
        email,
        firstName,
        lastName,
        role: 'SUPER_ADMIN',
      },
    });

    console.log(`[Admin] Created first admin user: ${email}`);

    res.json({
      success: true,
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error('[Admin] Failed to create admin:', error);
    res.status(500).json({ error: 'Failed to create admin user' });
  }
});

/**
 * POST /administration/register-options - Generate registration options for passkey
 */
router.post('/register-options', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const admin = await prisma.adminUser.findUnique({
      where: { email },
      include: {
        passkeys: {
          select: {
            credentialId: true,
          },
        },
      },
    });

    if (!admin) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    // Check if this admin already has a passkey
    if (admin.passkeys.length > 0) {
      return res.status(400).json({ error: 'Admin already has a passkey registered. Use login instead.' });
    }

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: new TextEncoder().encode(admin.id),
      userName: admin.email,
      userDisplayName: `${admin.firstName} ${admin.lastName}`,
      attestationType: 'none',
      excludeCredentials: admin.passkeys.map((passkey) => ({
        id: passkey.credentialId,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Store challenge
    registrationChallenges.set(email, {
      challenge: options.challenge,
      userId: admin.id,
    });

    res.json({ options });
  } catch (error) {
    console.error('[Admin] Failed to generate registration options:', error);
    res.status(500).json({ error: 'Failed to generate registration options' });
  }
});

/**
 * POST /administration/register-verify - Verify registration and save passkey
 */
router.post('/register-verify', async (req: Request, res: Response) => {
  try {
    const { credential, email } = req.body;

    const challengeData = registrationChallenges.get(email);
    if (!challengeData) {
      return res.status(400).json({ error: 'Registration challenge expired' });
    }

    const admin = await prisma.adminUser.findUnique({
      where: { id: challengeData.userId },
    });

    if (!admin) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Registration verification failed' });
    }

    const { credential: registrationCredential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // Save the passkey
    // registrationCredential.id is already a Base64URLString
    await prisma.adminPasskey.create({
      data: {
        adminUserId: admin.id,
        credentialId: registrationCredential.id,
        credentialPublicKey: Buffer.from(registrationCredential.publicKey),
        counter: BigInt(registrationCredential.counter),
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: credential.response.transports || [],
      },
    });

    // Clean up challenge
    registrationChallenges.delete(email);

    // Create JWT token and log them in
    const token = await createAdminToken({
      userId: admin.id,
      email: admin.email,
      role: admin.role,
    });

    setAdminCookie(res, token);

    console.log(`[Admin] Passkey registered for ${admin.email}`);

    res.json({
      success: true,
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error('[Admin] Failed to verify registration:', error);
    res.status(500).json({ error: 'Failed to verify registration' });
  }
});

/**
 * GET /administration/login - Show login page
 */
router.get('/login', async (req: Request, res: Response) => {
  // Check if already logged in
  const token = req.cookies['wsim_admin_token'];
  if (token) {
    const session = await verifyAdminToken(token);
    if (session) {
      return res.redirect('/administration');
    }
  }

  res.render('admin/login', {
    error: req.query.error,
  });
});

/**
 * POST /administration/login-options - Generate authentication options
 */
router.post('/login-options', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    let allowCredentials: any[] = [];

    if (email) {
      const admin = await prisma.adminUser.findUnique({
        where: { email },
        include: {
          passkeys: {
            select: {
              credentialId: true,
              transports: true,
            },
          },
        },
      });

      if (admin && admin.passkeys.length > 0) {
        allowCredentials = admin.passkeys.map((passkey) => ({
          id: passkey.credentialId,
          transports: passkey.transports as AuthenticatorTransportFuture[],
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
      userVerification: 'preferred',
    });

    // Store challenge
    const challengeKey = email || 'global';
    challenges.set(challengeKey, options.challenge);

    res.json({ options });
  } catch (error) {
    console.error('[Admin] Failed to generate login options:', error);
    res.status(500).json({ error: 'Failed to generate login options' });
  }
});

/**
 * POST /administration/login-verify - Verify authentication
 */
router.post('/login-verify', async (req: Request, res: Response) => {
  try {
    const { credential, email } = req.body;

    // Find the passkey
    const passkey = await prisma.adminPasskey.findUnique({
      where: { credentialId: credential.id },
      include: { adminUser: true },
    });

    if (!passkey) {
      return res.status(401).json({ error: 'Passkey not found' });
    }

    // Get challenge
    const challengeKey = email || 'global';
    const challenge = challenges.get(challengeKey);
    if (!challenge) {
      return res.status(401).json({ error: 'Challenge expired' });
    }

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.credentialPublicKey),
        counter: Number(passkey.counter),
      },
    });

    if (!verification.verified) {
      return res.status(401).json({ error: 'Authentication failed' });
    }

    // Update counter and last used
    await prisma.adminPasskey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });

    // Clean up challenge
    challenges.delete(challengeKey);

    // Create JWT token
    const token = await createAdminToken({
      userId: passkey.adminUser.id,
      email: passkey.adminUser.email,
      role: passkey.adminUser.role,
    });

    // Set cookie
    setAdminCookie(res, token);

    console.log(`[Admin] Login successful for ${passkey.adminUser.email}`);

    res.json({
      success: true,
      admin: {
        id: passkey.adminUser.id,
        email: passkey.adminUser.email,
        firstName: passkey.adminUser.firstName,
        lastName: passkey.adminUser.lastName,
        role: passkey.adminUser.role,
      },
    });
  } catch (error) {
    console.error('[Admin] Failed to verify login:', error);
    res.status(500).json({ error: 'Failed to verify login' });
  }
});

/**
 * POST /administration/logout - Logout
 */
router.post('/logout', (req: Request, res: Response) => {
  clearAdminCookie(res);
  res.redirect('/administration/login');
});

/**
 * GET /administration/logout - Logout (for link-based logout)
 */
router.get('/logout', (req: Request, res: Response) => {
  clearAdminCookie(res);
  res.redirect('/administration/login');
});

// =============================================================================
// INVITE ACCEPTANCE FLOW
// =============================================================================

// Helper to validate invite
async function validateInvite(code: string) {
  const invite = await prisma.adminInvite.findUnique({
    where: { code },
    include: {
      createdBy: {
        select: { firstName: true, lastName: true },
      },
    },
  });

  if (!invite) {
    return { valid: false, error: 'Invalid invite code' };
  }

  if (invite.revokedAt) {
    return { valid: false, error: 'This invite has been revoked' };
  }

  if (invite.usedAt) {
    return { valid: false, error: 'This invite has already been used' };
  }

  if (invite.expiresAt < new Date()) {
    return { valid: false, error: 'This invite has expired' };
  }

  return { valid: true, invite };
}

/**
 * GET /administration/join/:code - Show invite acceptance page
 */
router.get('/join/:code', async (req: Request, res: Response) => {
  const { code } = req.params;
  const result = await validateInvite(code);

  if (!result.valid) {
    return res.render('admin/join-error', {
      error: result.error,
    });
  }

  res.render('admin/join', {
    invite: result.invite,
    code,
    rpId: RP_ID,
    error: req.query.error,
  });
});

/**
 * POST /administration/join/:code - Create admin user from invite
 */
router.post('/join/:code', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { email, firstName, lastName } = req.body;

    const result = await validateInvite(code);
    if (!result.valid) {
      return res.status(400).json({ error: result.error });
    }

    const invite = result.invite!;

    // If invite has email restriction, enforce it
    if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).json({ error: 'Email does not match the invite' });
    }

    // Check if email already exists
    const existingAdmin = await prisma.adminUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingAdmin) {
      return res.status(400).json({ error: 'An admin with this email already exists' });
    }

    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'First name and last name are required' });
    }

    // Create the admin user
    const admin = await prisma.adminUser.create({
      data: {
        email: email.toLowerCase(),
        firstName,
        lastName,
        role: invite.role,
      },
    });

    // Mark invite as used
    await prisma.adminInvite.update({
      where: { id: invite.id },
      data: {
        usedAt: new Date(),
        usedById: admin.id,
      },
    });

    console.log(`[Admin] New admin created via invite: ${email} (${invite.role})`);

    res.json({
      success: true,
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error('[Admin] Failed to create admin from invite:', error);
    res.status(500).json({ error: 'Failed to create admin user' });
  }
});

/**
 * POST /administration/join/:code/register-options - Generate passkey registration options for invited user
 */
router.post('/join/:code/register-options', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { email } = req.body;

    // Look up the invite - allow "used" invites since we're in the passkey registration step
    // The invite is marked as "used" when the admin user is created, but we still need to register the passkey
    const invite = await prisma.adminInvite.findUnique({
      where: { code },
    });

    if (!invite) {
      return res.status(400).json({ error: 'Invalid invite code' });
    }

    if (invite.revokedAt) {
      return res.status(400).json({ error: 'This invite has been revoked' });
    }

    if (invite.expiresAt < new Date()) {
      return res.status(400).json({ error: 'This invite has expired' });
    }

    // Note: We allow usedAt to be set - that just means the admin was created

    const admin = await prisma.adminUser.findUnique({
      where: { email },
      include: {
        passkeys: {
          select: { credentialId: true },
        },
      },
    });

    if (!admin) {
      return res.status(404).json({ error: 'Admin user not found. Please complete registration first.' });
    }

    if (admin.passkeys.length > 0) {
      return res.status(400).json({ error: 'Admin already has a passkey registered' });
    }

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: new TextEncoder().encode(admin.id),
      userName: admin.email,
      userDisplayName: `${admin.firstName} ${admin.lastName}`,
      attestationType: 'none',
      excludeCredentials: [],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Store challenge with invite code prefix for security
    registrationChallenges.set(`invite:${code}:${email}`, {
      challenge: options.challenge,
      userId: admin.id,
    });

    res.json({ options });
  } catch (error) {
    console.error('[Admin] Failed to generate invite registration options:', error);
    res.status(500).json({ error: 'Failed to generate registration options' });
  }
});

/**
 * POST /administration/join/:code/register-verify - Verify passkey registration for invited user
 */
router.post('/join/:code/register-verify', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { credential, email } = req.body;

    const challengeKey = `invite:${code}:${email}`;
    const challengeData = registrationChallenges.get(challengeKey);
    if (!challengeData) {
      return res.status(400).json({ error: 'Registration challenge expired' });
    }

    const admin = await prisma.adminUser.findUnique({
      where: { id: challengeData.userId },
    });

    if (!admin) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Registration verification failed' });
    }

    const { credential: registrationCredential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // Save the passkey
    await prisma.adminPasskey.create({
      data: {
        adminUserId: admin.id,
        credentialId: registrationCredential.id,
        credentialPublicKey: Buffer.from(registrationCredential.publicKey),
        counter: BigInt(registrationCredential.counter),
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: credential.response.transports || [],
      },
    });

    // Clean up challenge
    registrationChallenges.delete(challengeKey);

    // Create JWT token and log them in
    const token = await createAdminToken({
      userId: admin.id,
      email: admin.email,
      role: admin.role,
    });

    setAdminCookie(res, token);

    console.log(`[Admin] Passkey registered for invited admin ${admin.email}`);

    res.json({
      success: true,
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error('[Admin] Failed to verify invite registration:', error);
    res.status(500).json({ error: 'Failed to verify registration' });
  }
});

export default router;
