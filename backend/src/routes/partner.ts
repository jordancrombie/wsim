import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/database';

const router = Router();

/**
 * Verify HMAC signature from partner (BSIM)
 * This ensures the request is authentic and hasn't been tampered with
 */
function verifyPartnerSignature(
  payload: Record<string, unknown>,
  signature: string,
  secret: string
): boolean {
  try {
    const signedData = JSON.stringify(payload);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signedData)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Generate a short-lived SSO token for a user
 */
function generateSsoToken(userId: string): { token: string; expiresIn: number } {
  const expiresIn = 5 * 60; // 5 minutes - short-lived for security
  const token = jwt.sign(
    { sub: userId, type: 'sso' },
    env.JWT_SECRET,
    { expiresIn }
  );
  return { token, expiresIn };
}

/**
 * POST /api/partner/sso-token
 * Server-to-server endpoint for partners (BSIM) to request an SSO token
 *
 * This enables true SSO: user logged into BSIM can access WSIM wallet
 * on any device/browser without needing to authenticate again.
 *
 * Request body:
 *   - bsimId: The partner's ID (e.g., "bsim")
 *   - bsimUserId: The user's ID in BSIM (fiUserRef from enrollment)
 *   - email: Optional - user's email for lookup
 *   - timestamp: Request timestamp (for replay protection)
 *   - signature: HMAC signature of the payload
 *
 * Response:
 *   - ssoToken: Short-lived JWT for SSO (5 minutes)
 *   - ssoUrl: Full URL to redirect user to
 *   - expiresIn: Token lifetime in seconds
 */
router.post('/sso-token', async (req, res) => {
  try {
    const { bsimId, bsimUserId, email, timestamp, signature } = req.body as {
      bsimId: string;
      bsimUserId?: string;
      email?: string;
      timestamp: number;
      signature: string;
    };

    // Validate required fields
    if (!bsimId || !signature || !timestamp) {
      res.status(400).json({
        error: 'missing_fields',
        message: 'bsimId, timestamp, and signature are required',
      });
      return;
    }

    if (!bsimUserId && !email) {
      res.status(400).json({
        error: 'missing_user_identifier',
        message: 'Either bsimUserId or email is required',
      });
      return;
    }

    // Verify timestamp is within 5 minutes (replay protection)
    const now = Date.now();
    if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
      res.status(400).json({
        error: 'request_expired',
        message: 'Request timestamp is too old or too far in the future',
      });
      return;
    }

    // Verify signature
    const payload = { bsimId, bsimUserId, email, timestamp };
    // Remove undefined values from payload for consistent signing
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined)
    );

    const isValidSignature = verifyPartnerSignature(
      cleanPayload,
      signature,
      env.INTERNAL_API_SECRET
    );

    if (!isValidSignature) {
      console.error(`[Partner SSO] Invalid signature from ${bsimId}`);
      res.status(403).json({
        error: 'invalid_signature',
        message: 'Request signature is invalid',
      });
      return;
    }

    // Find the user by BSIM enrollment or email
    let user = null;

    if (bsimUserId) {
      // Look up by BSIM enrollment
      const enrollment = await prisma.bsimEnrollment.findFirst({
        where: { fiUserRef: bsimUserId, bsimId },
        include: { user: { select: { id: true, email: true, walletId: true } } },
      });
      if (enrollment) {
        user = enrollment.user;
      }
    }

    if (!user && email) {
      // Fall back to email lookup
      user = await prisma.walletUser.findUnique({
        where: { email },
        select: { id: true, email: true, walletId: true },
      });
    }

    if (!user) {
      console.log(`[Partner SSO] User not found: bsimUserId=${bsimUserId}, email=${email}`);
      res.status(404).json({
        error: 'user_not_found',
        message: 'User is not enrolled in WSIM wallet',
      });
      return;
    }

    // Generate short-lived SSO token
    const { token: ssoToken, expiresIn } = generateSsoToken(user.id);

    // Build the full SSO URL
    const ssoUrl = `${env.FRONTEND_URL}/api/auth/sso?token=${encodeURIComponent(ssoToken)}`;

    console.log(`[Partner SSO] Generated SSO token for ${user.email} (requested by ${bsimId})`);

    res.json({
      ssoToken,
      ssoUrl,
      expiresIn,
      walletId: user.walletId,
    });
  } catch (error) {
    console.error('[Partner SSO] Error:', error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Failed to generate SSO token',
    });
  }
});

export default router;
