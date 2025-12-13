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
 *
 * Phase 2 (Enrollment):
 * - GET /enrollment/banks - List available banks
 * - POST /enrollment/start/:bsimId - Start enrollment (returns auth URL)
 * - GET /enrollment/callback/:bsimId - Handle OAuth callback
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { env } from '../config/env';
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
          walletCredential: encrypt(tokenResponse.walletCredential || tokenResponse.accessToken),
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
          walletCredential: encrypt(tokenResponse.walletCredential || tokenResponse.accessToken),
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

export default router;
