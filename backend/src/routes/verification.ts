/**
 * Verification API Routes
 *
 * API endpoints for identity verification (Trusted User feature).
 *
 * Mobile API endpoints (JWT auth):
 * - POST   /api/mobile/device/register-key   - Register device public key
 * - POST   /api/mobile/verification/submit   - Submit verification result
 * - DELETE /api/mobile/verification          - Remove verification (testing)
 * - DELETE /api/mobile/account               - Delete account (testing)
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { env } from '../config/env';

const router = Router();

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================

interface MobileAccessTokenPayload {
  sub: string;
  iss: string;
  aud: string;
  deviceId: string;
  type: 'access';
}

interface AuthenticatedRequest extends Request {
  userId?: string;
  deviceId?: string;
}

function verifyMobileToken(token: string): MobileAccessTokenPayload | null {
  try {
    const payload = jwt.verify(token, env.MOBILE_JWT_SECRET) as MobileAccessTokenPayload;
    if (payload.type !== 'access') {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
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

  if (!payload) {
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
// DEVICE KEY REGISTRATION
// =============================================================================

/**
 * POST /api/mobile/device/register-key
 *
 * Register a device's public key for signature verification.
 * Re-registering the same deviceId will replace the existing key.
 */
router.post('/device/register-key', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { deviceId, publicKey, keyType } = req.body as {
      deviceId?: string;
      publicKey?: string;
      keyType?: string;
    };

    // Validate required fields
    if (!deviceId || !publicKey || !keyType) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'deviceId, publicKey, and keyType are required',
      });
    }

    // Validate keyType
    if (!['ECDSA-P256', 'RSA-2048'].includes(keyType)) {
      return res.status(400).json({
        error: 'invalid_key_type',
        message: 'keyType must be ECDSA-P256 or RSA-2048',
      });
    }

    // Validate publicKey is base64
    try {
      Buffer.from(publicKey, 'base64');
    } catch {
      return res.status(400).json({
        error: 'invalid_public_key',
        message: 'publicKey must be valid base64',
      });
    }

    // Upsert device key (replace if exists for same deviceId)
    await prisma.deviceKey.upsert({
      where: { deviceId },
      update: {
        userId: userId!,
        publicKey,
        keyType,
        registeredAt: new Date(),
      },
      create: {
        userId: userId!,
        deviceId,
        publicKey,
        keyType,
      },
    });

    console.log(`[Verification] Device key registered: userId=${userId}, deviceId=${deviceId}, keyType=${keyType}`);

    return res.json({
      success: true,
      registered: true,
      deviceId,
    });
  } catch (error) {
    console.error('[Verification] Register device key error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to register device key',
    });
  }
});

// =============================================================================
// VERIFICATION SUBMIT
// =============================================================================

interface SignedVerification {
  payload: string; // Base64-encoded JSON
  signature: string; // Base64-encoded signature
  deviceId: string;
  appVersion: string;
}

interface VerificationPayload {
  nameMatch: {
    score: number;
    passed: boolean;
  };
  faceMatch?: {
    score: number;
    passed: boolean;
  };
  livenessCheck?: {
    passed: boolean;
    challenges: string[];
  };
  timestamp: string;
  documentType: string;
  issuingCountry: string;
}

/**
 * Verify signature using stored public key
 */
async function verifySignature(
  deviceId: string,
  payload: string,
  signature: string
): Promise<{ valid: boolean; deviceKey?: { keyType: string; publicKey: string } }> {
  const deviceKey = await prisma.deviceKey.findUnique({
    where: { deviceId },
    select: { keyType: true, publicKey: true },
  });

  if (!deviceKey) {
    return { valid: false };
  }

  try {
    const publicKeyBuffer = Buffer.from(deviceKey.publicKey, 'base64');
    const signatureBuffer = Buffer.from(signature, 'base64');
    const dataBuffer = Buffer.from(payload, 'utf8');

    let verifyResult = false;

    if (deviceKey.keyType === 'ECDSA-P256') {
      // ECDSA with SHA-256
      const verify = crypto.createVerify('SHA256');
      verify.update(dataBuffer);
      verifyResult = verify.verify(
        { key: publicKeyBuffer, format: 'der', type: 'spki' },
        signatureBuffer
      );
    } else if (deviceKey.keyType === 'RSA-2048') {
      // RSA-PKCS1-v1_5 with SHA-256
      const verify = crypto.createVerify('SHA256');
      verify.update(dataBuffer);
      verifyResult = verify.verify(
        { key: publicKeyBuffer, format: 'der', type: 'spki' },
        signatureBuffer
      );
    }

    // Update lastUsedAt
    if (verifyResult) {
      await prisma.deviceKey.update({
        where: { deviceId },
        data: { lastUsedAt: new Date() },
      });
    }

    return { valid: verifyResult, deviceKey };
  } catch (error) {
    console.error('[Verification] Signature verification error:', error);
    return { valid: false };
  }
}

/**
 * POST /api/mobile/verification/submit
 *
 * Submit a signed verification result from the mobile app.
 */
router.post('/verification/submit', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { signedVerification } = req.body as { signedVerification?: SignedVerification };

    if (!signedVerification) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'signedVerification is required',
      });
    }

    const { payload, signature, deviceId, appVersion } = signedVerification;

    if (!payload || !signature || !deviceId) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'payload, signature, and deviceId are required in signedVerification',
      });
    }

    // Verify signature
    const { valid, deviceKey } = await verifySignature(deviceId, payload, signature);

    if (!valid) {
      console.warn(`[Verification] Invalid signature: userId=${userId}, deviceId=${deviceId}`);
      return res.status(400).json({
        error: 'invalid_signature',
        message: 'Signature verification failed. Ensure device key is registered.',
      });
    }

    // Decode and parse payload
    let verificationData: VerificationPayload;
    try {
      const decodedPayload = Buffer.from(payload, 'base64').toString('utf8');
      verificationData = JSON.parse(decodedPayload);
    } catch {
      return res.status(400).json({
        error: 'invalid_payload',
        message: 'Payload must be valid base64-encoded JSON',
      });
    }

    // Validate verification data
    if (!verificationData.nameMatch || typeof verificationData.nameMatch.score !== 'number') {
      return res.status(400).json({
        error: 'invalid_payload',
        message: 'nameMatch with score is required',
      });
    }

    // Determine verification level
    const nameMatchPassed = verificationData.nameMatch.score >= 0.85;
    const faceMatchPassed = verificationData.faceMatch?.score !== undefined && verificationData.faceMatch.score >= 0.70;
    const livenessPassed = verificationData.livenessCheck?.passed === true;

    let verificationLevel: 'basic' | 'enhanced' | null = null;

    if (nameMatchPassed && faceMatchPassed && livenessPassed) {
      verificationLevel = 'enhanced';
    } else if (nameMatchPassed) {
      verificationLevel = 'basic';
    }

    if (!verificationLevel) {
      return res.status(400).json({
        error: 'verification_failed',
        message: 'Verification requirements not met. Name match score must be >= 0.85',
      });
    }

    // Calculate expiration (12 months from now)
    const verifiedAt = new Date();
    const expiresAt = new Date(verifiedAt);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    // Create verification record and update user in a transaction
    const [verification, user] = await prisma.$transaction([
      prisma.userVerification.create({
        data: {
          userId: userId!,
          deviceId,
          verificationLevel,
          documentType: verificationData.documentType || 'PASSPORT',
          issuingCountry: verificationData.issuingCountry || 'UNK',
          nameMatchScore: verificationData.nameMatch.score,
          faceMatchScore: verificationData.faceMatch?.score || null,
          livenessPassed: verificationData.livenessCheck?.passed || null,
          verifiedAt,
          expiresAt,
        },
      }),
      prisma.walletUser.update({
        where: { id: userId },
        data: {
          isVerified: true,
          verifiedAt,
          verificationLevel,
        },
      }),
    ]);

    console.log(`[Verification] User verified: userId=${userId}, level=${verificationLevel}, verificationId=${verification.id}`);

    return res.json({
      success: true,
      verificationId: verification.id,
      isVerified: true,
      verifiedAt: verifiedAt.toISOString(),
      verificationLevel,
    });
  } catch (error) {
    console.error('[Verification] Submit verification error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to process verification',
    });
  }
});

// =============================================================================
// TESTING ENDPOINTS
// =============================================================================

/**
 * DELETE /api/mobile/verification
 *
 * Remove verification status from user's account.
 * For testing purposes.
 */
router.delete('/verification', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;

    // Check if user has verification
    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      select: { isVerified: true },
    });

    if (!user?.isVerified) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User has no verification to remove',
      });
    }

    // Remove verification in a transaction
    await prisma.$transaction([
      // Delete all verification records
      prisma.userVerification.deleteMany({
        where: { userId },
      }),
      // Reset user verification status
      prisma.walletUser.update({
        where: { id: userId },
        data: {
          isVerified: false,
          verifiedAt: null,
          verificationLevel: null,
        },
      }),
    ]);

    console.log(`[Verification] Verification removed: userId=${userId}`);

    return res.json({
      success: true,
      message: 'Verification status removed',
    });
  } catch (error) {
    console.error('[Verification] Remove verification error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to remove verification',
    });
  }
});

/**
 * DELETE /api/mobile/account
 *
 * Delete user's WSIM account entirely.
 * For testing purposes. This is IRREVERSIBLE.
 */
router.delete('/account', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;

    // Delete user (cascade will delete related records)
    await prisma.walletUser.delete({
      where: { id: userId },
    });

    console.log(`[Verification] Account deleted: userId=${userId}`);

    return res.json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (error) {
    console.error('[Verification] Delete account error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to delete account',
    });
  }
});

export default router;
