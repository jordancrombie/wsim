/**
 * Mobile API Routes
 *
 * API endpoints for the mwsim mobile wallet application.
 * All endpoints are prefixed with /api/mobile/
 *
 * Phase 1 (MVP):
 * - POST /device/register - Register a mobile device
 * - POST /device/push-token - Register push notification token (requires auth)
 * - DELETE /device/push-token - Deactivate push token (on logout)
 * - POST /auth/register - Create a new wallet account
 * - POST /auth/login - Start login for existing account
 * - POST /auth/login/verify - Verify login with email code
 * - POST /auth/token/refresh - Refresh access token
 * - GET /wallet/summary - Get wallet overview
 * - POST /auth/logout - Logout and revoke tokens
 *
 * Phase 2 (Enrollment):
 * - GET /enrollment/banks - List available banks
 * - POST /enrollment/start/:bsimId - Start enrollment (returns auth URL)
 * - GET /enrollment/callback/:bsimId - Handle OAuth callback
 * - GET /enrollment/list - List user's enrolled banks
 * - DELETE /enrollment/:enrollmentId - Remove bank enrollment
 *
 * Phase 3 (Payment Flow - mwsim app approval):
 * Merchant endpoints (x-api-key auth):
 * - POST /payment/request - Create payment request
 * - GET /payment/:requestId/status - Poll for approval status
 * - POST /payment/:requestId/cancel - Cancel payment request
 * - POST /payment/:requestId/complete - Exchange one-time token for card tokens
 *
 * Mobile app endpoints (JWT auth):
 * - GET /payment/:requestId - Get payment details for approval screen
 * - POST /payment/:requestId/approve - Approve with selected card
 * - GET /payment/pending - List user's pending payments
 *
 * Test endpoints (dev only):
 * - POST /payment/:requestId/test-approve - Simulate approval for E2E tests
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { encrypt, decrypt, generateWalletCardToken } from '../utils/crypto';
import {
  BsimProviderConfig,
  BsimAccount,
  buildAuthorizationUrl,
  exchangeCode,
  fetchCards,
  fetchAccounts,
  safeRefreshBsimToken,
  generatePkce,
  generateState,
  generateNonce,
} from '../services/bsim-oidc';
import {
  OrderDetails,
  validateOrderDetails,
  checkOrderDetailsConsistency,
} from '../types/orderDetails';

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
// PUSH NOTIFICATION TOKEN REGISTRATION
// =============================================================================

/**
 * POST /api/mobile/device/push-token
 *
 * Register or update push notification token for the authenticated user's device.
 * Per AD4: Updates existing MobileDevice record with push token fields.
 *
 * Request body:
 * - pushToken: string (required) - Expo, APNs, or FCM push token
 * - tokenType: 'apns' | 'fcm' | 'expo' (optional, defaults to 'expo')
 *
 * The device is identified by the deviceId in the JWT access token.
 */
router.post('/device/push-token', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, deviceId } = req;
    const { pushToken, tokenType = 'expo' } = req.body as {
      pushToken: string;
      tokenType?: 'apns' | 'fcm' | 'expo';
    };

    // Validate required fields
    if (!pushToken) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'pushToken is required',
      });
    }

    // Validate token type
    const validTokenTypes = ['apns', 'fcm', 'expo'];
    if (!validTokenTypes.includes(tokenType)) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'tokenType must be one of: apns, fcm, expo',
      });
    }

    if (!deviceId) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'deviceId not found in token',
      });
    }

    // Find the device
    const device = await prisma.mobileDevice.findUnique({
      where: { deviceId },
    });

    if (!device) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Device not found. Please register the device first.',
      });
    }

    // Verify the device belongs to this user
    if (device.userId !== userId) {
      console.warn(`[Mobile] Push token registration: device ${deviceId} belongs to different user`);
      return res.status(403).json({
        error: 'forbidden',
        message: 'Device does not belong to this user',
      });
    }

    // Update the device with push token
    const now = new Date();
    await prisma.mobileDevice.update({
      where: { deviceId },
      data: {
        pushToken,
        pushTokenType: tokenType,
        pushTokenActive: true,
        pushTokenUpdatedAt: now,
        updatedAt: now,
      },
    });

    console.log(`[Mobile] Push token registered for device ${deviceId} (type: ${tokenType})`);

    return res.json({
      success: true,
      registeredAt: now.toISOString(),
    });
  } catch (error) {
    console.error('[Mobile] Push token registration error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to register push token',
    });
  }
});

/**
 * DELETE /api/mobile/device/push-token
 *
 * Deactivate push token for the current device.
 * Called on logout to stop receiving notifications on this device.
 * Per integration point answer: Mark inactive rather than delete.
 */
router.delete('/device/push-token', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, deviceId } = req;

    if (!deviceId) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'deviceId not found in token',
      });
    }

    // Find and update device
    const device = await prisma.mobileDevice.findUnique({
      where: { deviceId },
    });

    if (!device) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Device not found',
      });
    }

    if (device.userId !== userId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Device does not belong to this user',
      });
    }

    // Mark push token as inactive (don't delete - user might log back in)
    await prisma.mobileDevice.update({
      where: { deviceId },
      data: {
        pushTokenActive: false,
        updatedAt: new Date(),
      },
    });

    console.log(`[Mobile] Push token deactivated for device ${deviceId}`);

    return res.json({ success: true });
  } catch (error) {
    console.error('[Mobile] Push token deactivation error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to deactivate push token',
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

    // Check if device already exists (linked to another user)
    const existingDevice = await prisma.mobileDevice.findUnique({
      where: { deviceId },
    });

    if (existingDevice) {
      return res.status(409).json({
        error: 'device_conflict',
        message: 'This device is already registered. Use login instead.',
      });
    }

    // Parse name into firstName/lastName
    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Generate device credential
    const rawCredential = crypto.randomBytes(32).toString('hex');
    const deviceCredential = encrypt(rawCredential);
    const credentialExpiry = new Date(Date.now() + env.MOBILE_DEVICE_CREDENTIAL_EXPIRY * 1000);

    // Create user and device in a transaction to ensure atomicity
    const { user, device } = await prisma.$transaction(async (tx) => {
      const user = await tx.walletUser.create({
        data: {
          email: email.toLowerCase(),
          firstName,
          lastName,
        },
      });

      const device = await tx.mobileDevice.create({
        data: {
          userId: user.id,
          deviceId,
          platform,
          deviceName,
          deviceCredential,
          credentialExpiry,
        },
      });

      return { user, device };
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

/**
 * POST /api/mobile/auth/login/password
 *
 * Login with email and password (for development/testing).
 * Uses the same password as the web wallet.
 */
router.post('/auth/login/password', async (req: Request, res: Response) => {
  try {
    const { email, password, deviceId, deviceName, platform } = req.body as {
      email: string;
      password: string;
      deviceId: string;
      deviceName: string;
      platform: 'ios' | 'android';
    };

    if (!email || !password || !deviceId || !deviceName || !platform) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'email, password, deviceId, deviceName, and platform are required',
      });
    }

    // Find user
    const user = await prisma.walletUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password',
      });
    }

    // Check if user has a password set
    if (!user.passwordHash) {
      return res.status(401).json({
        error: 'no_password',
        message: 'No password set for this account. Please set a password via the web wallet first.',
      });
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.passwordHash);

    if (!passwordValid) {
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password',
      });
    }

    // Generate device credential
    const rawCredential = crypto.randomBytes(32).toString('hex');
    const deviceCredential = encrypt(rawCredential);
    const credentialExpiry = new Date(Date.now() + env.MOBILE_DEVICE_CREDENTIAL_EXPIRY * 1000);

    // Register/update device
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

    console.log(`[Mobile] Password login successful: ${user.email} from device ${deviceId}`);

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
    console.error('[Mobile] Password login error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to login',
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
        profileImageUrl: user.profileImageUrl || null,
        isVerified: user.isVerified || false,
        verifiedAt: user.verifiedAt?.toISOString() || null,
        verificationLevel: user.verificationLevel || 'none',
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

/**
 * GET /api/mobile/accounts
 *
 * Fetch bank accounts from all enrolled BSIMs using WSIM-stored OAuth tokens.
 * Returns aggregated accounts from all banks with bsimId for P2P routing.
 * Handles token refresh automatically if tokens are expired.
 */
router.get('/accounts', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;

    console.log(`[Mobile] Fetching accounts for user ${userId}`);

    // Get BSIM providers configuration
    const providers: BsimProviderConfig[] = JSON.parse(env.BSIM_PROVIDERS);
    const providersMap = new Map(providers.map(p => [p.bsimId, p]));

    // Get all user's enrollments with BSIM OAuth tokens
    const enrollments = await prisma.bsimEnrollment.findMany({
      where: { userId },
      select: {
        id: true,
        bsimId: true,
        bsimIssuer: true,
        accessToken: true,  // JWT for Open Banking API
        refreshToken: true,
        credentialExpiry: true,
      },
    });

    if (enrollments.length === 0) {
      // User has no bank enrollments yet
      return res.json({ accounts: [] });
    }

    console.log(`[Mobile] Found ${enrollments.length} enrollments for user ${userId}`);

    // Fetch accounts from each enrolled bank
    const allAccounts: BsimAccount[] = [];
    const errors: Array<{ bsimId: string; error: string; message: string; action?: string }> = [];

    for (const enrollment of enrollments) {
      const provider = providersMap.get(enrollment.bsimId);
      if (!provider) {
        console.warn(`[Mobile] No provider config found for ${enrollment.bsimId}, skipping`);
        errors.push({
          bsimId: enrollment.bsimId,
          error: 'provider_not_configured',
          message: `Provider ${enrollment.bsimId} is not configured`,
        });
        continue;
      }

      try {
        // Check if we have an access token (JWT) for Open Banking API
        if (!enrollment.accessToken) {
          console.warn(`[Mobile] No accessToken for ${enrollment.bsimId} - user needs to re-enroll`);
          errors.push({
            bsimId: enrollment.bsimId,
            error: 'missing_access_token',
            message: `Re-enrollment required for ${provider.name || enrollment.bsimId} to access accounts`,
            action: 'reenroll',
          });
          continue;
        }

        // Decrypt the stored access token (JWT for Open Banking API)
        let accessToken = decrypt(enrollment.accessToken);

        // Attempt to fetch accounts
        let accounts: BsimAccount[];
        try {
          accounts = await fetchAccounts(provider, accessToken);
          console.log(`[Mobile] Fetched ${accounts.length} accounts from ${enrollment.bsimId}`);
          allAccounts.push(...accounts);
        } catch (fetchError: any) {
          // If 401, try to refresh the token
          if (fetchError.message?.includes('401') && enrollment.refreshToken) {
            console.log(`[Mobile] Token expired for ${enrollment.bsimId}, attempting refresh`);

            // Use safe refresh that handles token rotation atomically
            const refreshResult = await safeRefreshBsimToken(
              enrollment.id,
              provider,
              enrollment.refreshToken
            );

            if (refreshResult.success) {
              // Retry fetch with new token
              accounts = await fetchAccounts(provider, refreshResult.accessToken);
              console.log(`[Mobile] Fetched ${accounts.length} accounts from ${enrollment.bsimId} after refresh`);
              allAccounts.push(...accounts);
            } else {
              // Refresh failed - user needs to re-enroll
              console.error(`[Mobile] Token refresh failed for ${enrollment.bsimId}: ${refreshResult.error}`);
              errors.push({
                bsimId: enrollment.bsimId,
                error: 'bsim_token_expired',
                message: refreshResult.message || `Re-enrollment required for ${provider.name || enrollment.bsimId}`,
                action: 'reenroll',
              });
            }
          } else {
            // Other fetch error or no refresh token available
            throw fetchError;
          }
        }
      } catch (error: any) {
        console.error(`[Mobile] Failed to fetch accounts from ${enrollment.bsimId}:`, error);

        // Determine error type
        let errorCode = 'bsim_unavailable';
        let errorMessage = `Unable to fetch accounts from ${provider.name || enrollment.bsimId}`;

        if (error.message?.includes('401') || error.message?.includes('403')) {
          errorCode = 'bsim_unauthorized';
          errorMessage = `Authorization failed for ${provider.name || enrollment.bsimId}`;
        } else if (error.message?.includes('Invalid encrypted')) {
          errorCode = 'bsim_invalid_credentials';
          errorMessage = `Invalid credentials stored for ${provider.name || enrollment.bsimId}`;
        }

        errors.push({
          bsimId: enrollment.bsimId,
          error: errorCode,
          message: errorMessage,
        });
      }
    }

    console.log(`[Mobile] Returning ${allAccounts.length} total accounts with ${errors.length} errors`);

    // Return accounts and errors (if any)
    const response: {
      accounts: BsimAccount[];
      errors?: Array<{ bsimId: string; error: string; message: string; action?: string }>;
    } = {
      accounts: allAccounts,
    };

    if (errors.length > 0) {
      response.errors = errors;
    }

    return res.json(response);
  } catch (error) {
    console.error('[Mobile] Accounts fetch error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to fetch accounts',
    });
  }
});

// =============================================================================
// CARD MANAGEMENT
// =============================================================================

/**
 * POST /api/mobile/wallet/cards/:cardId/default
 *
 * Set a card as the default payment card.
 */
router.post('/wallet/cards/:cardId/default', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { cardId } = req.params;
    const { userId } = req;

    // Find the card and verify ownership
    const card = await prisma.walletCard.findFirst({
      where: {
        id: cardId,
        userId,
        isActive: true,
      },
    });

    if (!card) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Card not found',
      });
    }

    // Clear existing default and set new one in a transaction
    await prisma.$transaction([
      prisma.walletCard.updateMany({
        where: { userId },
        data: { isDefault: false },
      }),
      prisma.walletCard.update({
        where: { id: cardId },
        data: { isDefault: true },
      }),
    ]);

    console.log(`[Mobile] Card ${cardId} set as default for user ${userId}`);

    return res.json({
      success: true,
      cardId,
    });
  } catch (error) {
    console.error('[Mobile] Set default card error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to set default card',
    });
  }
});

/**
 * DELETE /api/mobile/wallet/cards/:cardId
 *
 * Remove a card from the wallet (soft delete).
 */
router.delete('/wallet/cards/:cardId', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { cardId } = req.params;
    const { userId } = req;

    // Find the card and verify ownership
    const card = await prisma.walletCard.findFirst({
      where: {
        id: cardId,
        userId,
      },
    });

    if (!card) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Card not found',
      });
    }

    // Soft delete the card
    await prisma.walletCard.update({
      where: { id: cardId },
      data: { isActive: false },
    });

    // If this was the default card, set another card as default
    if (card.isDefault) {
      const nextCard = await prisma.walletCard.findFirst({
        where: {
          userId,
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (nextCard) {
        await prisma.walletCard.update({
          where: { id: nextCard.id },
          data: { isDefault: true },
        });
      }
    }

    console.log(`[Mobile] Card ${cardId} removed for user ${userId}`);

    return res.json({
      success: true,
      cardId,
    });
  } catch (error) {
    console.error('[Mobile] Remove card error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to remove card',
    });
  }
});

// =============================================================================
// BANK ENROLLMENT (Phase 2)
// =============================================================================

// Parse BSIM providers from environment
function getBsimProviders(): BsimProviderConfig[] {
  try {
    return JSON.parse(env.BSIM_PROVIDERS);
  } catch {
    console.warn('[Mobile] Failed to parse BSIM_PROVIDERS');
    return [];
  }
}

// In-memory store for enrollment state (in production, use Redis or database)
// Key is a unique enrollment ID, value contains PKCE params and user context
interface EnrollmentState {
  bsimId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  userId: string;
  deviceId: string;
  expiresAt: Date;
}
const enrollmentStates = new Map<string, EnrollmentState>();

// Clean up expired enrollment states periodically
setInterval(() => {
  const now = new Date();
  for (const [key, state] of enrollmentStates.entries()) {
    if (now > state.expiresAt) {
      enrollmentStates.delete(key);
    }
  }
}, 60000); // Every minute

/**
 * GET /api/mobile/enrollment/banks
 *
 * List available banks for enrollment.
 */
router.get('/enrollment/banks', (req: Request, res: Response) => {
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
 * POST /api/mobile/enrollment/start/:bsimId
 *
 * Start bank enrollment. Returns an authorization URL for WebView.
 * Requires JWT authentication.
 *
 * The mobile app should:
 * 1. Call this endpoint to get the authUrl
 * 2. Open a WebView with the authUrl
 * 3. Intercept the callback URL when the bank redirects back
 * 4. The callback will redirect to a success/error page that WebView can detect
 */
router.post('/enrollment/start/:bsimId', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { bsimId } = req.params;
  const { userId, deviceId } = req;

  if (!userId || !deviceId) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'User authentication required',
    });
  }

  const providers = getBsimProviders();
  const provider = providers.find(p => p.bsimId === bsimId);

  if (!provider) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Bank not found',
    });
  }

  try {
    // Generate PKCE, state, and nonce
    const { codeVerifier, codeChallenge } = await generatePkce();
    const state = generateState();
    const nonce = generateNonce();

    // Generate unique enrollment ID
    const enrollmentId = crypto.randomUUID();

    // Build redirect URI - uses mobile-specific callback endpoint
    const redirectUri = `${env.APP_URL}/api/mobile/enrollment/callback/${bsimId}`;

    // Build authorization URL
    const authUrl = await buildAuthorizationUrl(
      provider,
      redirectUri,
      state,
      nonce,
      codeChallenge
    );

    // Store enrollment state (10 minute expiry)
    enrollmentStates.set(enrollmentId, {
      bsimId,
      state,
      nonce,
      codeVerifier,
      userId,
      deviceId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    console.log(`[Mobile] Starting enrollment for ${bsimId}, user ${userId}`);

    // Return auth URL and enrollment ID
    // Mobile app should append enrollmentId to the state or track it locally
    res.json({
      authUrl,
      enrollmentId,
      bsimId: provider.bsimId,
      bankName: provider.name,
      // The callback URL pattern for the mobile app to detect
      callbackUrlPattern: `${env.APP_URL}/api/mobile/enrollment/callback/${bsimId}`,
    });
  } catch (error) {
    console.error('[Mobile] Enrollment start error:', error);
    res.status(500).json({
      error: 'enrollment_failed',
      message: error instanceof Error ? error.message : 'Failed to start enrollment',
    });
  }
});

/**
 * GET /api/mobile/enrollment/callback/:bsimId
 *
 * Handle OAuth callback from bank. This endpoint is called by the bank
 * after the user authenticates. It processes the OAuth code and redirects
 * to the mobile app via deep link.
 *
 * Query params:
 * - code: OAuth authorization code
 * - state: CSRF state token
 * - error: Error code if authentication failed
 * - error_description: Error description
 *
 * Redirects to:
 * - Success: mwsim://enrollment/callback?success=true&bsimId=...&bankName=...&cardCount=...
 * - Error: mwsim://enrollment/callback?success=false&error=...
 *
 * The enrollment state is looked up using the state parameter which maps
 * to our stored enrollmentId -> state mapping.
 */
router.get('/enrollment/callback/:bsimId', async (req: Request, res: Response) => {
  const { bsimId } = req.params;
  const { code, state, error, error_description } = req.query;

  // Deep link base URL for mobile app (expo-web-browser pattern)
  const mobileDeepLink = 'mwsim://enrollment/callback';

  // Helper to build error redirect
  const errorRedirect = (errorCode: string, message?: string) => {
    const params = new URLSearchParams({
      success: 'false',
      error: errorCode,
    });
    if (message) {
      params.set('message', message);
    }
    return res.redirect(`${mobileDeepLink}?${params.toString()}`);
  };

  // Handle error from BSIM
  if (error) {
    console.error(`[Mobile] Enrollment error from BSIM: ${error} - ${error_description}`);
    return errorRedirect(String(error), String(error_description || ''));
  }

  // Validate we have code and state
  if (!code || typeof code !== 'string') {
    return errorRedirect('missing_code');
  }

  if (!state || typeof state !== 'string') {
    return errorRedirect('missing_state');
  }

  // Find enrollment state by matching the state parameter
  let enrollmentId: string | null = null;
  let enrollmentState: EnrollmentState | null = null;

  for (const [id, stored] of enrollmentStates.entries()) {
    if (stored.state === state && stored.bsimId === bsimId) {
      enrollmentId = id;
      enrollmentState = stored;
      break;
    }
  }

  if (!enrollmentState || !enrollmentId) {
    console.error('[Mobile] No enrollment state found for state:', state);
    return errorRedirect('invalid_state');
  }

  // Check expiry
  if (new Date() > enrollmentState.expiresAt) {
    enrollmentStates.delete(enrollmentId);
    return errorRedirect('expired', 'Enrollment session expired');
  }

  // Get provider config
  const providers = getBsimProviders();
  const provider = providers.find(p => p.bsimId === bsimId);

  if (!provider) {
    return errorRedirect('provider_not_found');
  }

  try {
    const redirectUri = `${env.APP_URL}/api/mobile/enrollment/callback/${bsimId}`;

    // Exchange code for tokens
    console.log(`[Mobile] Exchanging code for tokens...`);
    const tokenResponse = await exchangeCode(
      provider,
      redirectUri,
      code,
      enrollmentState.codeVerifier,
      enrollmentState.state,
      enrollmentState.nonce
    );

    console.log(`[Mobile] Got tokens for enrollment`);

    // Get the user
    const user = await prisma.walletUser.findUnique({
      where: { id: enrollmentState.userId },
    });

    if (!user) {
      console.error('[Mobile] User not found:', enrollmentState.userId);
      return errorRedirect('user_not_found');
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
      console.log(`[Mobile] Updating existing enrollment for ${bsimId}`);
      enrollment = await prisma.bsimEnrollment.update({
        where: { id: enrollment.id },
        data: {
          // walletCredential: wcred_xxx token for card operations
          walletCredential: encrypt(tokenResponse.walletCredential || tokenResponse.accessToken),
          // accessToken: JWT for Open Banking API calls (/accounts)
          accessToken: encrypt(tokenResponse.accessToken),
          refreshToken: tokenResponse.refreshToken ? encrypt(tokenResponse.refreshToken) : null,
          credentialExpiry: new Date(Date.now() + (tokenResponse.expiresIn * 1000)),
        },
      });
    } else {
      // Create new enrollment
      console.log(`[Mobile] Creating new enrollment for ${bsimId}`);
      enrollment = await prisma.bsimEnrollment.create({
        data: {
          userId: user.id,
          bsimId: bsimId,
          bsimIssuer: provider.issuer,
          fiUserRef: tokenResponse.fiUserRef,
          // walletCredential: wcred_xxx token for card operations
          walletCredential: encrypt(tokenResponse.walletCredential || tokenResponse.accessToken),
          // accessToken: JWT for Open Banking API calls (/accounts)
          accessToken: encrypt(tokenResponse.accessToken),
          refreshToken: tokenResponse.refreshToken ? encrypt(tokenResponse.refreshToken) : null,
          credentialExpiry: new Date(Date.now() + (tokenResponse.expiresIn * 1000)),
        },
      });
    }

    // Fetch and store cards
    let cardCount = 0;
    console.log(`[Mobile] Fetching cards from ${bsimId}...`);
    if (!tokenResponse.walletCredential) {
      console.error('[Mobile] No wallet_credential in token response');
    }
    try {
      const credentialToUse = tokenResponse.walletCredential || tokenResponse.accessToken;
      const cards = await fetchCards(provider, credentialToUse);
      console.log(`[Mobile] Got ${cards.length} cards from ${bsimId}`);
      cardCount = cards.length;

      // Store cards
      for (const card of cards) {
        const existingCard = await prisma.walletCard.findUnique({
          where: {
            enrollmentId_bsimCardRef: {
              enrollmentId: enrollment.id,
              bsimCardRef: card.cardRef,
            },
          },
        });

        if (existingCard) {
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
      console.error('[Mobile] Failed to fetch cards:', cardError);
      // Don't fail enrollment if card fetch fails
    }

    // Clean up enrollment state
    enrollmentStates.delete(enrollmentId);

    console.log(`[Mobile] Enrollment complete for user ${user.email}`);

    // Redirect to mobile app via deep link with enrollment info
    const successParams = new URLSearchParams({
      success: 'true',
      bsimId: bsimId,
      bankName: provider.name || bsimId,
      cardCount: String(cardCount),
    });
    res.redirect(`${mobileDeepLink}?${successParams.toString()}`);

  } catch (error) {
    console.error('[Mobile] Enrollment callback error:', error);
    // Clean up on error
    if (enrollmentId) {
      enrollmentStates.delete(enrollmentId);
    }
    return errorRedirect('callback_failed', error instanceof Error ? error.message : 'Unknown error');
  }
});

/**
 * GET /api/mobile/enrollment/list
 *
 * List user's enrolled banks.
 */
router.get('/enrollment/list', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;

    const enrollments = await prisma.bsimEnrollment.findMany({
      where: { userId },
      select: {
        id: true,
        bsimId: true,
        fiUserRef: true,  // BSIM internal user ID - needed for TransferSim P2P routing
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
          fiUserRef: e.fiUserRef,  // BSIM internal user ID for P2P transfers
          bankName: provider?.name || e.bsimId,
          logoUrl: provider?.logoUrl,
          cardCount: e._count.cards,
          enrolledAt: e.createdAt.toISOString(),
          credentialExpiry: e.credentialExpiry?.toISOString(),
        };
      }),
    });
  } catch (error) {
    console.error('[Mobile] Enrollment list error:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get enrollments',
    });
  }
});

/**
 * DELETE /api/mobile/enrollment/:enrollmentId
 *
 * Remove a bank enrollment and all associated cards.
 */
router.delete('/enrollment/:enrollmentId', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { enrollmentId } = req.params;
    const { userId } = req;

    // Find enrollment and verify ownership
    const enrollment = await prisma.bsimEnrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!enrollment) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Enrollment not found',
      });
    }

    if (enrollment.userId !== userId) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Not authorized to delete this enrollment',
      });
    }

    // Delete enrollment (cascades to cards)
    await prisma.bsimEnrollment.delete({
      where: { id: enrollmentId },
    });

    console.log(`[Mobile] Deleted enrollment ${enrollmentId} for user ${userId}`);

    res.json({ success: true });
  } catch (error) {
    console.error('[Mobile] Delete enrollment error:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to delete enrollment',
    });
  }
});

// =============================================================================
// MOBILE PAYMENT FLOW (Phase 3)
// =============================================================================
// Payment flow for mobile app approval of merchant payments.
// Flow:
// 1. Merchant creates payment request via POST /api/mobile/payment/request
// 2. User opens request in mwsim app via GET /api/mobile/payment/:requestId
// 3. User approves via POST /api/mobile/payment/:requestId/approve
// 4. Merchant polls status via GET /api/mobile/payment/:requestId/status
// 5. Merchant completes via POST /api/mobile/payment/:requestId/complete

const PAYMENT_REQUEST_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const APPROVAL_EXTENSION_MS = 60 * 1000; // 60 seconds added on approval

// Standard error codes (agreed with mwsim/SSIM teams)
const PaymentErrors = {
  PAYMENT_NOT_FOUND: { code: 'PAYMENT_NOT_FOUND', status: 404, message: 'Payment request not found' },
  PAYMENT_EXPIRED: { code: 'PAYMENT_EXPIRED', status: 410, message: 'Payment request has expired' },
  PAYMENT_ALREADY_PROCESSED: { code: 'PAYMENT_ALREADY_PROCESSED', status: 409, message: 'Payment has already been processed' },
  CARD_NOT_FOUND: { code: 'CARD_NOT_FOUND', status: 404, message: 'Card not found in user wallet' },
  CARD_TOKEN_ERROR: { code: 'CARD_TOKEN_ERROR', status: 502, message: 'Failed to get card token from bank' },
  UNAUTHORIZED: { code: 'UNAUTHORIZED', status: 401, message: 'Authentication required' },
  FORBIDDEN: { code: 'FORBIDDEN', status: 403, message: 'Not authorized for this payment' },
  INVALID_REQUEST: { code: 'INVALID_REQUEST', status: 400, message: 'Invalid request parameters' },
  INVALID_API_KEY: { code: 'INVALID_API_KEY', status: 401, message: 'Invalid API key' },
} as const;

function paymentError(res: Response, error: typeof PaymentErrors[keyof typeof PaymentErrors], customMessage?: string) {
  return res.status(error.status).json({
    error: error.code,
    message: customMessage || error.message,
  });
}

/**
 * Middleware to verify merchant API key for payment endpoints.
 * Attaches merchant info to request.
 */
interface MerchantRequest extends Request {
  merchant?: {
    clientId: string;
    clientName: string;
    apiKey: string;
  };
}

async function requireMerchantApiKey(req: MerchantRequest, res: Response, next: () => void) {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return paymentError(res, PaymentErrors.INVALID_API_KEY, 'x-api-key header is required');
  }

  const merchant = await prisma.oAuthClient.findFirst({
    where: { apiKey },
    select: {
      clientId: true,
      clientName: true,
      apiKey: true,
    },
  });

  if (!merchant || !merchant.apiKey) {
    return paymentError(res, PaymentErrors.INVALID_API_KEY);
  }

  req.merchant = {
    clientId: merchant.clientId,
    clientName: merchant.clientName,
    apiKey: merchant.apiKey,
  };

  next();
}

/**
 * POST /api/mobile/payment/request
 *
 * Create a new mobile payment request.
 * Called by merchant (SSIM) to initiate a payment that user will approve in mwsim.
 *
 * Requires: x-api-key header
 */
router.post('/payment/request', requireMerchantApiKey, async (req: MerchantRequest, res: Response) => {
  try {
    const { merchant } = req;
    if (!merchant) {
      return paymentError(res, PaymentErrors.UNAUTHORIZED);
    }

    const { amount, currency, orderId, orderDescription, orderDetails, returnUrl, merchantName, merchantLogoUrl } = req.body as {
      amount: string | number;
      currency?: string;
      orderId: string;
      orderDescription?: string;
      orderDetails?: OrderDetails;
      returnUrl: string;
      merchantName?: string;
      merchantLogoUrl?: string;
    };

    // Validate required fields
    if (!amount || !orderId || !returnUrl) {
      return paymentError(res, PaymentErrors.INVALID_REQUEST, 'amount, orderId, and returnUrl are required');
    }

    const parsedAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return paymentError(res, PaymentErrors.INVALID_REQUEST, 'Invalid amount');
    }

    // Validate orderDetails if provided
    const orderDetailsError = validateOrderDetails(orderDetails);
    if (orderDetailsError) {
      return paymentError(res, PaymentErrors.INVALID_REQUEST, orderDetailsError);
    }

    // Check consistency between orderDetails and amount (logs warning only)
    if (orderDetails) {
      checkOrderDetailsConsistency(parsedAmount, orderDetails);
    }

    // Auto-cancel any previous pending requests for same merchant + orderId
    await prisma.mobilePaymentRequest.updateMany({
      where: {
        merchantId: merchant.clientId,
        orderId: orderId,
        status: 'pending',
      },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
      },
    });

    // Create new payment request
    const expiresAt = new Date(Date.now() + PAYMENT_REQUEST_EXPIRY_MS);
    const paymentRequest = await prisma.mobilePaymentRequest.create({
      data: {
        merchantId: merchant.clientId,
        merchantName: merchantName || merchant.clientName,
        merchantLogoUrl: merchantLogoUrl || null,
        orderId,
        orderDescription: orderDescription || null,
        orderDetails: orderDetails ? JSON.parse(JSON.stringify(orderDetails)) : undefined,
        amount: parsedAmount,
        currency: currency || 'CAD',
        returnUrl,
        status: 'pending',
        expiresAt,
      },
    });

    console.log(`[Mobile Payment] Created request ${paymentRequest.id} for merchant ${merchant.clientId}, order ${orderId}`);

    // Build deep link URL for mobile app
    const deepLinkUrl = `mwsim://payment/${paymentRequest.id}`;

    // Build QR code URL for desktop checkout (universal link that opens mwsim or shows fallback page)
    const qrCodeUrl = `${env.FRONTEND_URL}/pay/${paymentRequest.id}`;

    res.status(201).json({
      requestId: paymentRequest.id,
      deepLinkUrl,
      qrCodeUrl,
      expiresAt: expiresAt.toISOString(),
      status: 'pending',
    });
  } catch (error) {
    console.error('[Mobile Payment] Create request error:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to create payment request',
    });
  }
});

/**
 * GET /api/mobile/payment/:requestId/status
 *
 * Get payment request status.
 * Called by merchant (SSIM) to poll for approval status.
 *
 * Requires: x-api-key header
 */
router.get('/payment/:requestId/status', requireMerchantApiKey, async (req: MerchantRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const { merchant } = req;

    if (!merchant) {
      return paymentError(res, PaymentErrors.UNAUTHORIZED);
    }

    const paymentRequest = await prisma.mobilePaymentRequest.findUnique({
      where: { id: requestId },
    });

    if (!paymentRequest) {
      return paymentError(res, PaymentErrors.PAYMENT_NOT_FOUND);
    }

    // Verify merchant owns this request
    if (paymentRequest.merchantId !== merchant.clientId) {
      return paymentError(res, PaymentErrors.FORBIDDEN);
    }

    // Check if expired (and not already in a terminal state)
    if (paymentRequest.status === 'pending' && new Date() > paymentRequest.expiresAt) {
      // Mark as expired
      await prisma.mobilePaymentRequest.update({
        where: { id: requestId },
        data: { status: 'expired' },
      });

      return res.json({
        requestId,
        status: 'expired',
        expiresAt: paymentRequest.expiresAt.toISOString(),
      });
    }

    // Build response based on status
    const response: Record<string, unknown> = {
      requestId,
      status: paymentRequest.status,
      expiresAt: paymentRequest.expiresAt.toISOString(),
    };

    // Include one-time token when approved
    if (paymentRequest.status === 'approved' && paymentRequest.oneTimeToken) {
      response.oneTimePaymentToken = paymentRequest.oneTimeToken;
      response.approvedAt = paymentRequest.approvedAt?.toISOString();
    }

    res.json(response);
  } catch (error) {
    console.error('[Mobile Payment] Get status error:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get payment status',
    });
  }
});

/**
 * POST /api/mobile/payment/:requestId/cancel
 *
 * Cancel a payment request.
 * Can be called by merchant (with API key) or user (with JWT).
 */
router.post('/payment/:requestId/cancel', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;

    // Check for merchant API key or user JWT
    const apiKey = req.headers['x-api-key'] as string;
    const authHeader = req.headers.authorization;

    let merchantId: string | null = null;
    let userId: string | null = null;

    if (apiKey) {
      // Merchant cancellation
      const merchant = await prisma.oAuthClient.findFirst({
        where: { apiKey },
        select: { clientId: true },
      });
      if (merchant) {
        merchantId = merchant.clientId;
      }
    } else if (authHeader?.startsWith('Bearer ')) {
      // User cancellation
      const token = authHeader.slice(7);
      const payload = verifyMobileToken(token);
      if (payload && payload.type === 'access') {
        userId = payload.sub;
      }
    }

    if (!merchantId && !userId) {
      return paymentError(res, PaymentErrors.UNAUTHORIZED);
    }

    const paymentRequest = await prisma.mobilePaymentRequest.findUnique({
      where: { id: requestId },
    });

    if (!paymentRequest) {
      return paymentError(res, PaymentErrors.PAYMENT_NOT_FOUND);
    }

    // Authorization check
    if (merchantId && paymentRequest.merchantId !== merchantId) {
      return paymentError(res, PaymentErrors.FORBIDDEN);
    }
    if (userId && paymentRequest.userId && paymentRequest.userId !== userId) {
      return paymentError(res, PaymentErrors.FORBIDDEN);
    }

    // Can only cancel pending requests
    if (paymentRequest.status !== 'pending') {
      return paymentError(res, PaymentErrors.PAYMENT_ALREADY_PROCESSED);
    }

    // Cancel the request
    await prisma.mobilePaymentRequest.update({
      where: { id: requestId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
      },
    });

    console.log(`[Mobile Payment] Cancelled request ${requestId} by ${merchantId ? 'merchant' : 'user'}`);

    res.json({
      success: true,
      status: 'cancelled',
    });
  } catch (error) {
    console.error('[Mobile Payment] Cancel error:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to cancel payment request',
    });
  }
});

/**
 * POST /api/mobile/payment/:requestId/complete
 *
 * Complete a payment by exchanging the one-time token for card tokens.
 * Called by merchant (SSIM) after polling shows 'approved' status.
 *
 * Requires: x-api-key header, oneTimePaymentToken in body
 */
router.post('/payment/:requestId/complete', requireMerchantApiKey, async (req: MerchantRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const { merchant } = req;
    const { oneTimePaymentToken } = req.body as { oneTimePaymentToken: string };

    if (!merchant) {
      return paymentError(res, PaymentErrors.UNAUTHORIZED);
    }

    if (!oneTimePaymentToken) {
      return paymentError(res, PaymentErrors.INVALID_REQUEST, 'oneTimePaymentToken is required');
    }

    const paymentRequest = await prisma.mobilePaymentRequest.findUnique({
      where: { id: requestId },
    });

    if (!paymentRequest) {
      return paymentError(res, PaymentErrors.PAYMENT_NOT_FOUND);
    }

    // Verify merchant owns this request
    if (paymentRequest.merchantId !== merchant.clientId) {
      return paymentError(res, PaymentErrors.FORBIDDEN);
    }

    // Verify one-time token
    if (paymentRequest.oneTimeToken !== oneTimePaymentToken) {
      return paymentError(res, PaymentErrors.INVALID_REQUEST, 'Invalid one-time payment token');
    }

    // Must be in approved status
    if (paymentRequest.status !== 'approved') {
      return paymentError(res, PaymentErrors.PAYMENT_ALREADY_PROCESSED, `Payment is ${paymentRequest.status}`);
    }

    // Check expiry (should still be valid due to 60s extension)
    if (new Date() > paymentRequest.expiresAt) {
      return paymentError(res, PaymentErrors.PAYMENT_EXPIRED);
    }

    // Mark as completed
    await prisma.mobilePaymentRequest.update({
      where: { id: requestId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        oneTimeToken: null, // Invalidate the one-time token
      },
    });

    console.log(`[Mobile Payment] Completed request ${requestId}`);

    // Return card tokens for NSIM
    res.json({
      success: true,
      status: 'completed',
      cardToken: paymentRequest.cardToken,
      walletCardToken: paymentRequest.walletCardToken,
    });
  } catch (error) {
    console.error('[Mobile Payment] Complete error:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to complete payment',
    });
  }
});

/**
 * GET /api/mobile/payment/pending
 *
 * List all pending payment requests for the authenticated user.
 * Used for "Pending Payments" section in wallet home screen.
 *
 * NOTE: This route MUST be defined BEFORE /payment/:requestId to avoid
 * Express matching "pending" as a requestId parameter.
 *
 * Requires: JWT authorization (mobile access token)
 */
router.get('/payment/pending', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;

    if (!userId) {
      return paymentError(res, PaymentErrors.UNAUTHORIZED);
    }

    const pendingRequests = await prisma.mobilePaymentRequest.findMany({
      where: {
        userId,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    res.json({
      requests: pendingRequests.map(req => ({
        requestId: req.id,
        merchantName: req.merchantName,
        merchantLogoUrl: req.merchantLogoUrl,
        amount: Number(req.amount),
        currency: req.currency,
        orderId: req.orderId,
        createdAt: req.createdAt.toISOString(),
        expiresAt: req.expiresAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[Mobile Payment] List pending error:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to list pending payments',
    });
  }
});

/**
 * GET /api/mobile/payment/:requestId
 *
 * Get payment request details for mobile app.
 * Called by mwsim when user opens a payment deep link.
 *
 * Requires: JWT authorization (mobile access token)
 */
router.get('/payment/:requestId', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const { userId } = req;

    if (!userId) {
      return paymentError(res, PaymentErrors.UNAUTHORIZED);
    }

    const paymentRequest = await prisma.mobilePaymentRequest.findUnique({
      where: { id: requestId },
    });

    if (!paymentRequest) {
      return paymentError(res, PaymentErrors.PAYMENT_NOT_FOUND);
    }

    // Check if expired
    if (paymentRequest.status === 'pending' && new Date() > paymentRequest.expiresAt) {
      // Mark as expired
      await prisma.mobilePaymentRequest.update({
        where: { id: requestId },
        data: { status: 'expired' },
      });

      return paymentError(res, PaymentErrors.PAYMENT_EXPIRED);
    }

    // Can only view pending requests
    if (paymentRequest.status !== 'pending') {
      return paymentError(res, PaymentErrors.PAYMENT_ALREADY_PROCESSED, `Payment is ${paymentRequest.status}`);
    }

    // Associate user with this request if not already
    if (!paymentRequest.userId) {
      await prisma.mobilePaymentRequest.update({
        where: { id: requestId },
        data: { userId },
      });
    } else if (paymentRequest.userId !== userId) {
      // Different user trying to access - this shouldn't happen normally
      return paymentError(res, PaymentErrors.FORBIDDEN, 'This payment is assigned to another user');
    }

    // Fetch user's cards for selection
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
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    const providers = getBsimProviders();

    res.json({
      requestId: paymentRequest.id,
      status: paymentRequest.status,
      merchantName: paymentRequest.merchantName,
      merchantLogoUrl: paymentRequest.merchantLogoUrl,
      amount: Number(paymentRequest.amount),
      currency: paymentRequest.currency,
      orderId: paymentRequest.orderId,
      orderDescription: paymentRequest.orderDescription,
      orderDetails: paymentRequest.orderDetails as OrderDetails | null,
      returnUrl: paymentRequest.returnUrl,
      createdAt: paymentRequest.createdAt.toISOString(),
      expiresAt: paymentRequest.expiresAt.toISOString(),
      cards: cards.map(card => {
        const provider = providers.find(p => p.bsimId === card.enrollment.bsimId);
        return {
          id: card.id,
          cardType: card.cardType,
          lastFour: card.lastFour,
          cardholderName: card.cardholderName,
          expiryMonth: card.expiryMonth,
          expiryYear: card.expiryYear,
          bankName: provider?.name || card.enrollment.bsimId,
          isDefault: card.isDefault,
        };
      }),
    });
  } catch (error) {
    console.error('[Mobile Payment] Get request error:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get payment request',
    });
  }
});

/**
 * GET /api/mobile/payment/:requestId/public
 *
 * Get public payment request details for QR code landing page.
 * Returns only basic info needed for display - no authentication required.
 * This is called by the /pay/[requestId] universal link landing page.
 */
router.get('/payment/:requestId/public', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;

    const paymentRequest = await prisma.mobilePaymentRequest.findUnique({
      where: { id: requestId },
    });

    if (!paymentRequest) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Payment request not found',
      });
    }

    // Return only public/safe information for the landing page
    res.json({
      id: paymentRequest.id,
      merchantName: paymentRequest.merchantName,
      merchantLogoUrl: paymentRequest.merchantLogoUrl,
      amount: Number(paymentRequest.amount),
      currency: paymentRequest.currency,
      orderDescription: paymentRequest.orderDescription,
      orderDetails: paymentRequest.orderDetails as OrderDetails | null,
      status: paymentRequest.status,
      expiresAt: paymentRequest.expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('[Mobile Payment] Get public request error:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get payment details',
    });
  }
});

/**
 * POST /api/mobile/payment/:requestId/approve
 *
 * Approve a payment request with selected card.
 * Called by mwsim after user confirms and biometric succeeds.
 *
 * Requires: JWT authorization (mobile access token)
 */
router.post('/payment/:requestId/approve', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const { userId } = req;
    const { cardId } = req.body as { cardId: string };

    if (!userId) {
      return paymentError(res, PaymentErrors.UNAUTHORIZED);
    }

    if (!cardId) {
      return paymentError(res, PaymentErrors.INVALID_REQUEST, 'cardId is required');
    }

    // Get the payment request
    const paymentRequest = await prisma.mobilePaymentRequest.findUnique({
      where: { id: requestId },
    });

    if (!paymentRequest) {
      return paymentError(res, PaymentErrors.PAYMENT_NOT_FOUND);
    }

    // Verify user owns this request
    if (paymentRequest.userId && paymentRequest.userId !== userId) {
      return paymentError(res, PaymentErrors.FORBIDDEN);
    }

    // Check status
    if (paymentRequest.status !== 'pending') {
      return paymentError(res, PaymentErrors.PAYMENT_ALREADY_PROCESSED, `Payment is ${paymentRequest.status}`);
    }

    // Check expiry
    if (new Date() > paymentRequest.expiresAt) {
      await prisma.mobilePaymentRequest.update({
        where: { id: requestId },
        data: { status: 'expired' },
      });
      return paymentError(res, PaymentErrors.PAYMENT_EXPIRED);
    }

    // Get the selected card
    const card = await prisma.walletCard.findFirst({
      where: {
        id: cardId,
        userId,
        isActive: true,
      },
      include: {
        enrollment: true,
      },
    });

    if (!card) {
      return paymentError(res, PaymentErrors.CARD_NOT_FOUND);
    }

    // Request card token from BSIM
    let cardToken: string | null = null;
    try {
      const providers = getBsimProviders();
      const provider = providers.find(p => p.bsimId === card.enrollment.bsimId);

      if (!provider) {
        console.error(`[Mobile Payment] Provider not found for bsimId: ${card.enrollment.bsimId}`);
        return paymentError(res, PaymentErrors.CARD_TOKEN_ERROR, 'Bank provider not configured');
      }

      // Derive BSIM API URL
      const bsimApiUrl = provider.apiUrl || deriveApiUrlFromIssuer(provider.issuer);

      // Request ephemeral card token
      // Note: Send bsimCardRef (BSIM's card ID) not walletCardToken (WSIM's internal token)
      // This matches the pattern in wallet-api.ts for OIDC payment flow
      const tokenResponse = await fetch(`${bsimApiUrl}/api/wallet/request-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${decrypt(card.enrollment.walletCredential)}`,
        },
        body: JSON.stringify({
          cardId: card.bsimCardRef,
        }),
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        console.error(`[Mobile Payment] BSIM token request failed: ${tokenResponse.status} ${error}`);
        return paymentError(res, PaymentErrors.CARD_TOKEN_ERROR);
      }

      const tokenData = await tokenResponse.json() as { cardToken: string };
      cardToken = tokenData.cardToken;
    } catch (bsimError) {
      console.error('[Mobile Payment] BSIM request error:', bsimError);
      return paymentError(res, PaymentErrors.CARD_TOKEN_ERROR);
    }

    // Generate one-time token for merchant
    const oneTimeToken = crypto.randomBytes(32).toString('hex');

    // Extend expiry by 60 seconds and update status
    const newExpiresAt = new Date(Date.now() + APPROVAL_EXTENSION_MS + (paymentRequest.expiresAt.getTime() - Date.now()));

    await prisma.mobilePaymentRequest.update({
      where: { id: requestId },
      data: {
        status: 'approved',
        userId,
        selectedCardId: cardId,
        cardToken,
        walletCardToken: card.walletCardToken,
        oneTimeToken,
        approvedAt: new Date(),
        expiresAt: newExpiresAt,
      },
    });

    console.log(`[Mobile Payment] Approved request ${requestId} by user ${userId} with card ${cardId}`);

    res.json({
      success: true,
      status: 'approved',
      returnUrl: paymentRequest.returnUrl,
    });
  } catch (error) {
    console.error('[Mobile Payment] Approve error:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to approve payment',
    });
  }
});

/**
 * POST /api/mobile/payment/:requestId/test-approve
 *
 * Test endpoint for E2E testing. Simulates payment approval without biometric.
 * ONLY available in non-production environments.
 *
 * Requires: x-test-key header with value 'wsim-e2e-test'
 */
router.post('/payment/:requestId/test-approve', async (req: Request, res: Response) => {
  // Check environment
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'not_found', message: 'Endpoint not available' });
  }

  // Verify test header
  const testKey = req.headers['x-test-key'];
  if (testKey !== 'wsim-e2e-test') {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid test key' });
  }

  try {
    const { requestId } = req.params;
    const { cardId, userId } = req.body as { cardId: string; userId: string };

    if (!cardId || !userId) {
      return res.status(400).json({ error: 'bad_request', message: 'cardId and userId are required' });
    }

    // Get the payment request
    const paymentRequest = await prisma.mobilePaymentRequest.findUnique({
      where: { id: requestId },
    });

    if (!paymentRequest) {
      return res.status(404).json({ error: 'PAYMENT_NOT_FOUND', message: 'Payment request not found' });
    }

    if (paymentRequest.status !== 'pending') {
      return res.status(409).json({ error: 'PAYMENT_ALREADY_PROCESSED', message: `Payment is ${paymentRequest.status}` });
    }

    // Get the card
    const card = await prisma.walletCard.findFirst({
      where: {
        id: cardId,
        userId,
        isActive: true,
      },
    });

    if (!card) {
      return res.status(404).json({ error: 'CARD_NOT_FOUND', message: 'Card not found' });
    }

    // Generate one-time token
    const oneTimeToken = crypto.randomBytes(32).toString('hex');

    // Update status (skip BSIM call in test mode)
    await prisma.mobilePaymentRequest.update({
      where: { id: requestId },
      data: {
        status: 'approved',
        userId,
        selectedCardId: cardId,
        cardToken: 'test_card_token_' + crypto.randomBytes(8).toString('hex'),
        walletCardToken: card.walletCardToken,
        oneTimeToken,
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + APPROVAL_EXTENSION_MS + PAYMENT_REQUEST_EXPIRY_MS),
      },
    });

    console.log(`[Mobile Payment] TEST approved request ${requestId}`);

    res.json({
      success: true,
      status: 'approved',
      oneTimeToken,
    });
  } catch (error) {
    console.error('[Mobile Payment] Test approve error:', error);
    res.status(500).json({ error: 'server_error', message: 'Failed to test approve' });
  }
});

// Helper function to derive API URL from issuer
function deriveApiUrlFromIssuer(issuer: string): string {
  const url = new URL(issuer);
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

export default router;
