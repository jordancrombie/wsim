/**
 * Mobile API Routes
 *
 * API endpoints for the mwsim mobile wallet application.
 * All endpoints are prefixed with /api/mobile/
 *
 * Phase 1 (MVP):
 * - POST /device/register - Register a mobile device
 * - POST /auth/register - Create a new wallet account
 * - POST /auth/login - Start login for existing account
 * - POST /auth/login/verify - Verify login with email code
 * - POST /auth/token/refresh - Refresh access token
 * - GET /wallet/summary - Get wallet overview
 * - POST /auth/logout - Logout and revoke tokens
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { encrypt } from '../utils/crypto';

const router = Router();

// =============================================================================
// JWT UTILITIES
// =============================================================================

interface MobileAccessTokenPayload {
  sub: string; // userId
  iss: string;
  aud: string;
  deviceId: string;
  type: 'access';
}

interface MobileRefreshTokenPayload {
  sub: string; // userId
  jti: string; // unique token ID
  deviceId: string;
  type: 'refresh';
}

function generateAccessToken(userId: string, deviceId: string): string {
  const payload: Omit<MobileAccessTokenPayload, 'iss' | 'aud'> = {
    sub: userId,
    deviceId,
    type: 'access',
  };

  return jwt.sign(payload, env.MOBILE_JWT_SECRET, {
    expiresIn: env.MOBILE_ACCESS_TOKEN_EXPIRY,
    issuer: env.APP_URL,
    audience: 'mwsim',
  });
}

function generateRefreshToken(userId: string, deviceId: string): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const payload: MobileRefreshTokenPayload = {
    sub: userId,
    jti,
    deviceId,
    type: 'refresh',
  };

  const token = jwt.sign(payload, env.MOBILE_JWT_SECRET, {
    expiresIn: env.MOBILE_REFRESH_TOKEN_EXPIRY,
  });

  return { token, jti };
}

function verifyMobileToken(token: string): MobileAccessTokenPayload | MobileRefreshTokenPayload | null {
  try {
    return jwt.verify(token, env.MOBILE_JWT_SECRET) as MobileAccessTokenPayload | MobileRefreshTokenPayload;
  } catch {
    return null;
  }
}

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================

interface AuthenticatedRequest extends Request {
  userId?: string;
  deviceId?: string;
}

async function requireMobileAuth(req: AuthenticatedRequest, res: Response, next: () => void) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid authorization header',
    });
  }

  const token = authHeader.slice(7);
  const payload = verifyMobileToken(token);

  if (!payload || payload.type !== 'access') {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid or expired access token',
    });
  }

  req.userId = payload.sub;
  req.deviceId = payload.deviceId;
  next();
}

// =============================================================================
// DEVICE REGISTRATION
// =============================================================================

/**
 * POST /api/mobile/device/register
 *
 * Register a mobile device with the wallet service.
 * Device must be registered before account registration/login.
 */
router.post('/device/register', async (req: Request, res: Response) => {
  try {
    const { deviceId, platform, deviceName, pushToken } = req.body as {
      deviceId: string;
      platform: 'ios' | 'android';
      deviceName: string;
      pushToken?: string;
    };

    // Validate required fields
    if (!deviceId || !platform || !deviceName) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'deviceId, platform, and deviceName are required',
      });
    }

    if (!['ios', 'android'].includes(platform)) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'platform must be "ios" or "android"',
      });
    }

    // Check if device already exists (allow update for pushToken)
    const existingDevice = await prisma.mobileDevice.findUnique({
      where: { deviceId },
    });

    if (existingDevice) {
      // Update existing device
      const updated = await prisma.mobileDevice.update({
        where: { deviceId },
        data: {
          deviceName,
          pushToken: pushToken || existingDevice.pushToken,
          updatedAt: new Date(),
        },
      });

      console.log(`[Mobile] Device updated: ${deviceId} (${platform})`);

      return res.json({
        deviceCredential: updated.deviceCredential,
        expiresAt: updated.credentialExpiry.toISOString(),
      });
    }

    // Generate device credential (encrypted random token)
    const rawCredential = crypto.randomBytes(32).toString('hex');
    const deviceCredential = encrypt(rawCredential);
    const credentialExpiry = new Date(Date.now() + env.MOBILE_DEVICE_CREDENTIAL_EXPIRY * 1000);

    // Create device record (userId will be set when user registers/logs in)
    // For now, we create a placeholder that will be updated
    // Actually, looking at the schema, userId is required...
    // We need to handle this differently - device registration should happen AFTER auth

    // For Phase 1, we'll store unassociated devices differently
    // Let's return just the credential for now and associate on register/login

    console.log(`[Mobile] Device pre-registered: ${deviceId} (${platform})`);

    return res.json({
      deviceCredential,
      expiresAt: credentialExpiry.toISOString(),
      message: 'Device credential issued. Complete registration or login to activate.',
    });
  } catch (error) {
    console.error('[Mobile] Device registration error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to register device',
    });
  }
});

// =============================================================================
// ACCOUNT REGISTRATION (New Users)
// =============================================================================

/**
 * POST /api/mobile/auth/register
 *
 * Create a new wallet account from mobile.
 */
router.post('/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, name, deviceId, deviceName, platform } = req.body as {
      email: string;
      name: string;
      deviceId: string;
      deviceName: string;
      platform: 'ios' | 'android';
    };

    // Validate required fields
    if (!email || !name || !deviceId || !deviceName || !platform) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'email, name, deviceId, deviceName, and platform are required',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Invalid email format',
      });
    }

    // Check if user already exists
    const existingUser = await prisma.walletUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'conflict',
        message: 'An account with this email already exists. Use login instead.',
      });
    }

    // Parse name into firstName/lastName
    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Create user
    const user = await prisma.walletUser.create({
      data: {
        email: email.toLowerCase(),
        firstName,
        lastName,
      },
    });

    // Generate device credential
    const rawCredential = crypto.randomBytes(32).toString('hex');
    const deviceCredential = encrypt(rawCredential);
    const credentialExpiry = new Date(Date.now() + env.MOBILE_DEVICE_CREDENTIAL_EXPIRY * 1000);

    // Create device linked to user
    await prisma.mobileDevice.create({
      data: {
        userId: user.id,
        deviceId,
        platform,
        deviceName,
        deviceCredential,
        credentialExpiry,
      },
    });

    // Generate tokens
    const accessToken = generateAccessToken(user.id, deviceId);
    const { token: refreshToken, jti } = generateRefreshToken(user.id, deviceId);

    // Store refresh token
    await prisma.mobileRefreshToken.create({
      data: {
        token: jti, // Store JTI, not the full token
        userId: user.id,
        deviceId,
        expiresAt: new Date(Date.now() + env.MOBILE_REFRESH_TOKEN_EXPIRY * 1000),
      },
    });

    console.log(`[Mobile] New user registered: ${email} from device ${deviceId}`);

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        walletId: user.walletId,
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: env.MOBILE_ACCESS_TOKEN_EXPIRY,
      },
    });
  } catch (error) {
    console.error('[Mobile] Registration error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to create account',
    });
  }
});

// =============================================================================
// ACCOUNT LOGIN (Existing Users)
// =============================================================================

// In-memory store for login challenges (in production, use Redis)
const loginChallenges = new Map<string, { email: string; code: string; expiresAt: Date }>();

/**
 * POST /api/mobile/auth/login
 *
 * Start login for existing account. Sends verification code to email.
 */
router.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, deviceId } = req.body as {
      email: string;
      deviceId: string;
    };

    if (!email || !deviceId) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'email and deviceId are required',
      });
    }

    // Check if user exists
    const user = await prisma.walletUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return res.status(404).json({
        error: 'not_found',
        message: 'No account found with this email',
      });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const challengeId = crypto.randomUUID();

    // Store challenge (5 minute expiry)
    loginChallenges.set(challengeId, {
      email: email.toLowerCase(),
      code,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    // In production, send email with code
    // For development, log the code
    console.log(`[Mobile] Login code for ${email}: ${code}`);

    // TODO: Send email with verification code
    // await sendVerificationEmail(email, code);

    return res.json({
      challenge: challengeId,
      method: 'email',
      message: 'Verification code sent to email',
      // For development only - remove in production
      ...(env.NODE_ENV === 'development' && { _devCode: code }),
    });
  } catch (error) {
    console.error('[Mobile] Login error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to initiate login',
    });
  }
});

/**
 * POST /api/mobile/auth/login/verify
 *
 * Verify login with email code.
 */
router.post('/auth/login/verify', async (req: Request, res: Response) => {
  try {
    const { challenge, code, deviceId, deviceName, platform } = req.body as {
      challenge: string;
      code: string;
      deviceId: string;
      deviceName: string;
      platform: 'ios' | 'android';
    };

    if (!challenge || !code || !deviceId || !deviceName || !platform) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'challenge, code, deviceId, deviceName, and platform are required',
      });
    }

    // Get and validate challenge
    const storedChallenge = loginChallenges.get(challenge);

    if (!storedChallenge) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid or expired challenge',
      });
    }

    if (new Date() > storedChallenge.expiresAt) {
      loginChallenges.delete(challenge);
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Challenge expired. Please request a new code.',
      });
    }

    if (storedChallenge.code !== code) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid verification code',
      });
    }

    // Challenge verified - clean up
    loginChallenges.delete(challenge);

    // Get user
    const user = await prisma.walletUser.findUnique({
      where: { email: storedChallenge.email },
    });

    if (!user) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User not found',
      });
    }

    // Generate device credential
    const rawCredential = crypto.randomBytes(32).toString('hex');
    const deviceCredential = encrypt(rawCredential);
    const credentialExpiry = new Date(Date.now() + env.MOBILE_DEVICE_CREDENTIAL_EXPIRY * 1000);

    // Create or update device
    await prisma.mobileDevice.upsert({
      where: { deviceId },
      update: {
        userId: user.id,
        deviceName,
        deviceCredential,
        credentialExpiry,
        lastUsedAt: new Date(),
      },
      create: {
        userId: user.id,
        deviceId,
        platform,
        deviceName,
        deviceCredential,
        credentialExpiry,
      },
    });

    // Generate tokens
    const accessToken = generateAccessToken(user.id, deviceId);
    const { token: refreshToken, jti } = generateRefreshToken(user.id, deviceId);

    // Store refresh token
    await prisma.mobileRefreshToken.create({
      data: {
        token: jti,
        userId: user.id,
        deviceId,
        expiresAt: new Date(Date.now() + env.MOBILE_REFRESH_TOKEN_EXPIRY * 1000),
      },
    });

    console.log(`[Mobile] User logged in: ${user.email} from device ${deviceId}`);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        walletId: user.walletId,
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: env.MOBILE_ACCESS_TOKEN_EXPIRY,
      },
    });
  } catch (error) {
    console.error('[Mobile] Login verify error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to verify login',
    });
  }
});

// =============================================================================
// TOKEN REFRESH
// =============================================================================

/**
 * POST /api/mobile/auth/token/refresh
 *
 * Refresh an expired access token.
 */
router.post('/auth/token/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body as { refreshToken: string };

    if (!refreshToken) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'refreshToken is required',
      });
    }

    // Verify token
    const payload = verifyMobileToken(refreshToken);

    if (!payload || payload.type !== 'refresh') {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid refresh token',
      });
    }

    const { sub: userId, jti, deviceId } = payload as MobileRefreshTokenPayload;

    // Check if refresh token exists and is valid
    const storedToken = await prisma.mobileRefreshToken.findFirst({
      where: {
        token: jti,
        userId,
        deviceId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!storedToken) {
      // Token not found or revoked - possible token reuse attack
      // Revoke all tokens for this device as a precaution
      await prisma.mobileRefreshToken.updateMany({
        where: { userId, deviceId },
        data: { revokedAt: new Date() },
      });

      console.warn(`[Mobile] Possible token reuse detected for user ${userId} device ${deviceId}`);

      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid or revoked refresh token. Please login again.',
      });
    }

    // Revoke old refresh token (rotation)
    await prisma.mobileRefreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    // Generate new tokens
    const newAccessToken = generateAccessToken(userId, deviceId);
    const { token: newRefreshToken, jti: newJti } = generateRefreshToken(userId, deviceId);

    // Store new refresh token
    await prisma.mobileRefreshToken.create({
      data: {
        token: newJti,
        userId,
        deviceId,
        expiresAt: new Date(Date.now() + env.MOBILE_REFRESH_TOKEN_EXPIRY * 1000),
      },
    });

    // Update device last used
    await prisma.mobileDevice.update({
      where: { deviceId },
      data: { lastUsedAt: new Date() },
    });

    return res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: env.MOBILE_ACCESS_TOKEN_EXPIRY,
    });
  } catch (error) {
    console.error('[Mobile] Token refresh error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to refresh token',
    });
  }
});

// =============================================================================
// LOGOUT
// =============================================================================

/**
 * POST /api/mobile/auth/logout
 *
 * Logout and invalidate tokens.
 */
router.post('/auth/logout', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, deviceId } = req;
    const { revokeAll } = req.query;

    if (revokeAll === 'true') {
      // Revoke all tokens for this user
      await prisma.mobileRefreshToken.updateMany({
        where: { userId },
        data: { revokedAt: new Date() },
      });
      console.log(`[Mobile] All tokens revoked for user ${userId}`);
    } else {
      // Revoke tokens for this device only
      await prisma.mobileRefreshToken.updateMany({
        where: { userId, deviceId },
        data: { revokedAt: new Date() },
      });
      console.log(`[Mobile] Tokens revoked for user ${userId} device ${deviceId}`);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('[Mobile] Logout error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to logout',
    });
  }
});

// =============================================================================
// WALLET SUMMARY
// =============================================================================

/**
 * GET /api/mobile/wallet/summary
 *
 * Get wallet overview in a single request.
 */
router.get('/wallet/summary', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, deviceId } = req;

    // Get user with cards and enrollments
    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      include: {
        walletCards: {
          where: { isActive: true },
          include: {
            enrollment: true,
          },
          orderBy: [
            { isDefault: 'desc' },
            { createdAt: 'desc' },
          ],
        },
        enrollments: {
          select: {
            bsimId: true,
            _count: {
              select: { cards: true },
            },
          },
        },
        mobileDevices: {
          where: { deviceId },
          select: { biometricEnabled: true },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User not found',
      });
    }

    // Format cards
    const cards = user.walletCards.map(card => ({
      id: card.id,
      lastFour: card.lastFour,
      cardType: card.cardType,
      bankName: card.enrollment.bsimId, // TODO: Map to friendly name
      isDefault: card.isDefault,
      addedAt: card.createdAt.toISOString(),
    }));

    // Format enrolled banks
    const enrolledBanks = user.enrollments.map(e => ({
      bsimId: e.bsimId,
      name: e.bsimId, // TODO: Map to friendly name
      cardCount: e._count.cards,
    }));

    // Get biometric status
    const biometricEnabled = user.mobileDevices[0]?.biometricEnabled ?? false;

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      },
      cards,
      enrolledBanks,
      biometricEnabled,
    });
  } catch (error) {
    console.error('[Mobile] Wallet summary error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get wallet summary',
    });
  }
});

export default router;
