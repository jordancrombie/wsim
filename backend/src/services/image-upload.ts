/**
 * Image Upload Service
 *
 * Handles profile image processing and storage for the User Profile feature.
 * - Validates image format and size
 * - Resizes images to standard dimensions (512x512, 128x128, 64x64)
 * - Strips EXIF data for privacy
 * - Uploads to S3 with CDN cache busting
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import crypto from 'crypto';
import { env } from '../config/env';

// Image size configurations
const IMAGE_SIZES = {
  full: 512,    // Primary avatar size
  medium: 128,  // Medium thumbnail
  small: 64,    // Small thumbnail (transaction history)
} as const;

// Allowed MIME types and their magic bytes
const ALLOWED_FORMATS = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/heic': null, // HEIC has complex magic bytes, rely on sharp conversion
} as const;

// S3 Client (lazy initialized)
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.AWS_REGION,
      credentials: env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined, // Use IAM role if no credentials
    });
  }
  return s3Client;
}

export interface ImageUploadResult {
  success: true;
  profileImageUrl: string;
  profileImageKey: string;
  thumbnails: {
    small: string;
    medium: string;
  };
  cacheBustVersion: string;
}

export interface ImageUploadError {
  success: false;
  error: 'invalid_format' | 'file_too_large' | 'processing_failed' | 'upload_failed';
  message: string;
}

export type ImageUploadResponse = ImageUploadResult | ImageUploadError;

/**
 * Validates image file by checking magic bytes
 */
function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const magicBytes = ALLOWED_FORMATS[mimeType as keyof typeof ALLOWED_FORMATS];

  // HEIC is handled by sharp, skip magic byte check
  if (magicBytes === null) {
    return true;
  }

  if (!magicBytes) {
    return false;
  }

  for (let i = 0; i < magicBytes.length; i++) {
    if (buffer[i] !== magicBytes[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Process and resize an image using Sharp
 * Strips EXIF data and converts to JPEG for consistency
 */
async function processImage(
  buffer: Buffer,
  size: number
): Promise<Buffer> {
  return sharp(buffer)
    .rotate() // Auto-rotate based on EXIF orientation before stripping
    .resize(size, size, {
      fit: 'cover',
      position: 'center',
    })
    .jpeg({
      quality: 85,
      mozjpeg: true,
    })
    .toBuffer();
}

/**
 * Generate S3 key for profile image
 * Format: users/{visitorId}/avatar{suffix}.jpg
 */
function generateS3Key(visitorId: string, suffix: string = ''): string {
  return `users/${visitorId}/avatar${suffix}.jpg`;
}

/**
 * Build CDN URL with cache busting version
 */
function buildCdnUrl(s3Key: string, version: string): string {
  return `${env.CDN_BASE_URL}/${s3Key}?v=${version}`;
}

/**
 * Upload buffer to S3
 */
async function uploadToS3(
  key: string,
  buffer: Buffer,
  contentType: string = 'image/jpeg'
): Promise<void> {
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET_PROFILES,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=86400', // 24 hours
    })
  );
}

/**
 * Process and upload a profile image
 *
 * @param buffer - Raw image buffer from upload
 * @param visitorId - User's wallet ID (used as folder name)
 * @param mimeType - MIME type of uploaded file
 * @returns Upload result with URLs or error
 */
export async function uploadProfileImage(
  buffer: Buffer,
  visitorId: string,
  mimeType: string
): Promise<ImageUploadResponse> {
  // Validate file size
  const maxSizeBytes = env.PROFILE_IMAGE_MAX_SIZE_MB * 1024 * 1024;
  if (buffer.length > maxSizeBytes) {
    return {
      success: false,
      error: 'file_too_large',
      message: `Image exceeds ${env.PROFILE_IMAGE_MAX_SIZE_MB}MB limit`,
    };
  }

  // Validate MIME type
  if (!Object.keys(ALLOWED_FORMATS).includes(mimeType)) {
    return {
      success: false,
      error: 'invalid_format',
      message: 'Only JPEG, PNG, and HEIC images are supported',
    };
  }

  // Validate magic bytes
  if (!validateMagicBytes(buffer, mimeType)) {
    return {
      success: false,
      error: 'invalid_format',
      message: 'File content does not match declared format',
    };
  }

  try {
    // Process images in parallel for all sizes
    const [fullBuffer, mediumBuffer, smallBuffer] = await Promise.all([
      processImage(buffer, IMAGE_SIZES.full),
      processImage(buffer, IMAGE_SIZES.medium),
      processImage(buffer, IMAGE_SIZES.small),
    ]);

    // Generate S3 keys
    const fullKey = generateS3Key(visitorId);
    const mediumKey = generateS3Key(visitorId, '_128');
    const smallKey = generateS3Key(visitorId, '_64');

    // Upload all images in parallel
    await Promise.all([
      uploadToS3(fullKey, fullBuffer),
      uploadToS3(mediumKey, mediumBuffer),
      uploadToS3(smallKey, smallBuffer),
    ]);

    // Generate cache bust version (timestamp)
    const version = Date.now().toString();

    console.log(`[ImageUpload] Uploaded profile images for ${visitorId}`);

    return {
      success: true,
      profileImageUrl: buildCdnUrl(fullKey, version),
      profileImageKey: fullKey,
      thumbnails: {
        small: buildCdnUrl(smallKey, version),
        medium: buildCdnUrl(mediumKey, version),
      },
      cacheBustVersion: version,
    };
  } catch (error) {
    console.error('[ImageUpload] Processing/upload error:', error);

    // Check for Sharp-specific errors
    if (error instanceof Error && error.message.includes('Input buffer')) {
      return {
        success: false,
        error: 'invalid_format',
        message: 'Unable to process image. Please use a valid JPEG, PNG, or HEIC file.',
      };
    }

    return {
      success: false,
      error: 'processing_failed',
      message: 'Failed to process image',
    };
  }
}

/**
 * Delete profile images from S3
 *
 * @param visitorId - User's wallet ID
 * @returns true if successful
 */
export async function deleteProfileImage(visitorId: string): Promise<boolean> {
  try {
    const client = getS3Client();

    // Delete all image sizes
    const keys = [
      generateS3Key(visitorId),
      generateS3Key(visitorId, '_128'),
      generateS3Key(visitorId, '_64'),
    ];

    await client.send(
      new DeleteObjectsCommand({
        Bucket: env.AWS_S3_BUCKET_PROFILES,
        Delete: {
          Objects: keys.map(key => ({ Key: key })),
        },
      })
    );

    console.log(`[ImageUpload] Deleted profile images for ${visitorId}`);
    return true;
  } catch (error) {
    console.error('[ImageUpload] Delete error:', error);
    return false;
  }
}

/**
 * Generate deterministic color for initials avatar
 * Based on user ID for consistency across sessions
 */
export function generateInitialsColor(userId: string): string {
  const colors = [
    '#E53935', '#D81B60', '#8E24AA', '#5E35B1',
    '#3949AB', '#1E88E5', '#039BE5', '#00ACC1',
    '#00897B', '#43A047', '#7CB342', '#C0CA33',
    '#FDD835', '#FFB300', '#FB8C00', '#F4511E',
  ];

  // Create a simple hash from user ID
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

/**
 * Generate initials from display name
 */
export function generateInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
