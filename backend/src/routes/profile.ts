/**
 * Profile API Routes
 *
 * API endpoints for user profile management (Phase 1 User Profile feature).
 *
 * Mobile API endpoints (JWT auth):
 * - GET    /api/mobile/profile        - Get user's profile
 * - PUT    /api/mobile/profile        - Update profile (displayName, phone)
 * - POST   /api/mobile/profile/image  - Upload profile image
 * - DELETE /api/mobile/profile/image  - Delete profile image
 * - GET    /api/mobile/profile/lookup - Look up another user's profile by walletId or bsimUserId + bsimId
 *
 * Internal API endpoints (X-Internal-Api-Key auth):
 * - GET    /api/internal/profile      - Get profile by bsimUserId + bsimId
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { prisma } from '../config/database';
import { env } from '../config/env';
import {
  uploadProfileImage,
  deleteProfileImage,
  generateInitialsColor,
  generateInitials,
  ImageUploadResponse,
} from '../services/image-upload';

const router = Router();

// Configure multer for file uploads (memory storage for processing)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.PROFILE_IMAGE_MAX_SIZE_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/heic'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and HEIC are allowed.'));
    }
  },
});

// Rate limiting for image uploads (simple in-memory, use Redis in production)
const uploadRateLimits = new Map<string, { count: number; resetAt: Date }>();

function checkUploadRateLimit(userId: string): boolean {
  const now = new Date();
  const limit = uploadRateLimits.get(userId);

  if (!limit || now > limit.resetAt) {
    // Reset or initialize
    uploadRateLimits.set(userId, {
      count: 1,
      resetAt: new Date(now.getTime() + 60 * 60 * 1000), // 1 hour
    });
    return true;
  }

  if (limit.count >= env.PROFILE_IMAGE_UPLOAD_RATE_LIMIT) {
    return false;
  }

  limit.count++;
  return true;
}

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

/**
 * Middleware to verify internal API key for TransferSim communication
 */
async function requireInternalApiKey(req: Request, res: Response, next: () => void) {
  const apiKey = req.headers['x-internal-api-key'] as string;

  if (!apiKey) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'X-Internal-Api-Key header is required',
    });
  }

  if (apiKey !== env.INTERNAL_API_SECRET) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid internal API key',
    });
  }

  next();
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate display name from first/last name if not set
 */
function getDisplayName(user: { displayName: string | null; firstName: string | null; lastName: string | null }): string {
  if (user.displayName) {
    return user.displayName;
  }
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User';
}

/**
 * Build profile response object
 */
function buildProfileResponse(user: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  profileImageKey: string | null;
  initialsColor: string | null;
  walletId: string;
  isVerified: boolean;
  verifiedAt: Date | null;
  verificationLevel: string | null;
}) {
  const displayName = getDisplayName(user);
  const initialsColor = user.initialsColor || generateInitialsColor(user.id);
  const initials = generateInitials(displayName);

  return {
    userId: user.id,
    walletId: user.walletId,
    email: user.email,
    displayName,
    initials,
    initialsColor,
    profileImageUrl: user.profileImageUrl || null,
    thumbnails: user.profileImageUrl
      ? {
          small: user.profileImageUrl.replace('/avatar.jpg', '/avatar_64.jpg'),
          medium: user.profileImageUrl.replace('/avatar.jpg', '/avatar_128.jpg'),
        }
      : null,
    // Verification status (Trusted User feature)
    isVerified: user.isVerified,
    verifiedAt: user.verifiedAt?.toISOString() || null,
    verificationLevel: user.verificationLevel || 'none',
  };
}

// =============================================================================
// MOBILE API ENDPOINTS
// =============================================================================

/**
 * GET /api/mobile/profile
 *
 * Get authenticated user's profile.
 */
router.get('/', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;

    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        displayName: true,
        profileImageUrl: true,
        profileImageKey: true,
        initialsColor: true,
        walletId: true,
        // Verification status (Trusted User feature)
        isVerified: true,
        verifiedAt: true,
        verificationLevel: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User not found',
      });
    }

    return res.json({
      success: true,
      profile: buildProfileResponse(user),
    });
  } catch (error) {
    console.error('[Profile] Get profile error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get profile',
    });
  }
});

/**
 * PUT /api/mobile/profile
 *
 * Update user's profile (displayName, phone, etc.).
 */
router.put('/', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const { displayName } = req.body as {
      displayName?: string;
    };

    // Validate displayName if provided
    if (displayName !== undefined) {
      if (typeof displayName !== 'string') {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'displayName must be a string',
        });
      }

      if (displayName.length > 50) {
        return res.status(400).json({
          error: 'display_name_too_long',
          message: 'Display name cannot exceed 50 characters',
        });
      }

      if (displayName.trim().length === 0) {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'Display name cannot be empty',
        });
      }
    }

    // Update user
    const user = await prisma.walletUser.update({
      where: { id: userId },
      data: {
        ...(displayName !== undefined && { displayName: displayName.trim() }),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        displayName: true,
        profileImageUrl: true,
        profileImageKey: true,
        initialsColor: true,
        walletId: true,
        // Verification status (Trusted User feature)
        isVerified: true,
        verifiedAt: true,
        verificationLevel: true,
      },
    });

    console.log(`[Profile] Updated profile for user ${userId}`);

    return res.json({
      success: true,
      profile: buildProfileResponse(user),
    });
  } catch (error) {
    console.error('[Profile] Update profile error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to update profile',
    });
  }
});

/**
 * POST /api/mobile/profile/image
 *
 * Upload profile image.
 * Request: multipart/form-data with 'image' field
 */
router.post('/image', requireMobileAuth, (req: AuthenticatedRequest, res: Response, next) => {
  // Check rate limit before processing upload
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Authentication required',
    });
  }

  if (!checkUploadRateLimit(userId)) {
    return res.status(429).json({
      error: 'rate_limit_exceeded',
      message: `Image upload limit exceeded. Maximum ${env.PROFILE_IMAGE_UPLOAD_RATE_LIMIT} uploads per hour.`,
    });
  }

  next();
}, upload.single('image'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'No image file provided. Use multipart/form-data with "image" field.',
      });
    }

    // Get user's walletId for S3 key
    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      select: {
        walletId: true,
        profileImageKey: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User not found',
      });
    }

    // Delete existing image if present
    if (user.profileImageKey) {
      await deleteProfileImage(user.walletId);
    }

    // Process and upload new image
    const result: ImageUploadResponse = await uploadProfileImage(
      file.buffer,
      user.walletId,
      file.mimetype
    );

    if (!result.success) {
      return res.status(400).json({
        error: result.error,
        message: result.message,
      });
    }

    // Update user record with new image URLs
    await prisma.walletUser.update({
      where: { id: userId },
      data: {
        profileImageUrl: result.profileImageUrl,
        profileImageKey: result.profileImageKey,
      },
    });

    console.log(`[Profile] Uploaded profile image for user ${userId}`);

    return res.json({
      success: true,
      profileImageUrl: result.profileImageUrl,
      thumbnails: result.thumbnails,
    });
  } catch (error) {
    console.error('[Profile] Image upload error:', error);

    // Handle multer errors
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'file_too_large',
          message: `Image exceeds ${env.PROFILE_IMAGE_MAX_SIZE_MB}MB limit`,
        });
      }
    }

    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to upload image',
    });
  }
});

/**
 * DELETE /api/mobile/profile/image
 *
 * Delete profile image.
 */
router.delete('/image', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req;

    // Get user's current image info
    const user = await prisma.walletUser.findUnique({
      where: { id: userId },
      select: {
        walletId: true,
        profileImageKey: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User not found',
      });
    }

    if (!user.profileImageKey) {
      return res.status(400).json({
        error: 'no_image',
        message: 'No profile image to delete',
      });
    }

    // Delete from S3
    await deleteProfileImage(user.walletId);

    // Clear database fields
    await prisma.walletUser.update({
      where: { id: userId },
      data: {
        profileImageUrl: null,
        profileImageKey: null,
      },
    });

    console.log(`[Profile] Deleted profile image for user ${userId}`);

    return res.json({ success: true });
  } catch (error) {
    console.error('[Profile] Delete image error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to delete image',
    });
  }
});

/**
 * GET /api/mobile/profile/lookup
 *
 * Look up another user's profile.
 * Used by mobile app to resolve user identifiers to display names.
 *
 * Query params (one of the following):
 * - walletId: WSIM wallet ID (for contracts)
 * - bsimUserId + bsimId: User's ID at the BSIM + bank identifier (for transfers)
 */
router.get('/lookup', requireMobileAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { walletId, bsimUserId, bsimId } = req.query as {
      walletId?: string;
      bsimUserId?: string;
      bsimId?: string;
    };

    let user: {
      id: string;
      displayName: string | null;
      firstName: string | null;
      lastName: string | null;
      profileImageUrl: string | null;
      initialsColor: string | null;
      isVerified: boolean;
      verificationLevel: string | null;
    } | null = null;

    if (walletId) {
      // Lookup by WSIM wallet ID
      user = await prisma.walletUser.findUnique({
        where: { walletId },
        select: {
          id: true,
          displayName: true,
          firstName: true,
          lastName: true,
          profileImageUrl: true,
          initialsColor: true,
          isVerified: true,
          verificationLevel: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          error: 'not_found',
          message: 'User not found for given walletId',
        });
      }
    } else if (bsimUserId && bsimId) {
      // Lookup by BSIM enrollment
      const enrollment = await prisma.bsimEnrollment.findFirst({
        where: {
          fiUserRef: bsimUserId,
          bsimId: bsimId,
        },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              firstName: true,
              lastName: true,
              profileImageUrl: true,
              initialsColor: true,
              isVerified: true,
              verificationLevel: true,
            },
          },
        },
      });

      if (!enrollment) {
        return res.status(404).json({
          error: 'not_found',
          message: 'User not found for given bsimUserId and bsimId',
        });
      }

      user = enrollment.user;
    } else {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Either walletId or both bsimUserId and bsimId query parameters are required',
      });
    }

    const displayName = getDisplayName(user);

    return res.json({
      success: true,
      profile: {
        displayName,
        profileImageUrl: user.profileImageUrl || null,
        initials: generateInitials(displayName),
        initialsColor: user.initialsColor || generateInitialsColor(user.id),
        isVerified: user.isVerified || false,
        verificationLevel: user.verificationLevel || 'none',
      },
    });
  } catch (error) {
    console.error('[Profile] Lookup profile error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to lookup profile',
    });
  }
});

// =============================================================================
// INTERNAL API ENDPOINTS (for TransferSim)
// =============================================================================

/**
 * GET /api/internal/profile
 *
 * Get user profile by BSIM user ID and BSIM ID.
 * Used by TransferSim to get sender profile image for webhooks.
 *
 * Query params:
 * - bsimUserId: User's ID at the BSIM (fiUserRef)
 * - bsimId: Bank identifier (e.g., "td-bank")
 *
 * Headers:
 * - X-Internal-Api-Key: Shared secret for internal API auth
 */
export const internalProfileRouter = Router();

internalProfileRouter.get('/', requireInternalApiKey, async (req: Request, res: Response) => {
  try {
    const { bsimUserId, bsimId } = req.query as {
      bsimUserId?: string;
      bsimId?: string;
    };

    if (!bsimUserId || !bsimId) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'bsimUserId and bsimId query parameters are required',
      });
    }

    // Find the enrollment matching this BSIM user
    const enrollment = await prisma.bsimEnrollment.findFirst({
      where: {
        fiUserRef: bsimUserId,
        bsimId: bsimId,
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
            profileImageUrl: true,
            initialsColor: true,
          },
        },
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        error: 'not_found',
        message: 'User not found for given bsimUserId and bsimId',
      });
    }

    const user = enrollment.user;
    const displayName = getDisplayName(user);

    return res.json({
      success: true,
      profile: {
        displayName,
        profileImageUrl: user.profileImageUrl || null,
        thumbnails: user.profileImageUrl
          ? {
              small: user.profileImageUrl.replace('/avatar.jpg', '/avatar_64.jpg'),
              medium: user.profileImageUrl.replace('/avatar.jpg', '/avatar_128.jpg'),
            }
          : null,
        initials: generateInitials(displayName),
        initialsColor: user.initialsColor || generateInitialsColor(user.id),
      },
    });
  } catch (error) {
    console.error('[Profile Internal] Get profile error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get profile',
    });
  }
});

export default router;
