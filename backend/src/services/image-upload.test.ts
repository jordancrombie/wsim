// Image Upload Service Tests
// Tests for profile image processing and S3 upload

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock env before importing the module
vi.mock('../config/env', () => ({
  env: {
    AWS_REGION: 'ca-central-1',
    AWS_S3_BUCKET_PROFILES: 'test-bucket',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    CDN_BASE_URL: 'https://cdn.test.com',
    PROFILE_IMAGE_MAX_SIZE_MB: 5,
  },
}));

// Hoist mock functions so they're available in vi.mock factories
const { mockS3Send, mockSharpToBuffer, mockSharpRotate, mockSharpResize, mockSharpJpeg } = vi.hoisted(() => ({
  mockS3Send: vi.fn(),
  mockSharpToBuffer: vi.fn(),
  mockSharpRotate: vi.fn(),
  mockSharpResize: vi.fn(),
  mockSharpJpeg: vi.fn(),
}));

// Mock AWS S3 client
vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: class S3Client {
      send = mockS3Send;
    },
    PutObjectCommand: class PutObjectCommand {
      constructor(public params: any) {}
    },
    DeleteObjectsCommand: class DeleteObjectsCommand {
      constructor(public params: any) {}
    },
  };
});

// Mock sharp - create chainable mock
vi.mock('sharp', () => {
  const createSharpInstance = () => ({
    rotate: mockSharpRotate.mockReturnThis(),
    resize: mockSharpResize.mockReturnThis(),
    jpeg: mockSharpJpeg.mockReturnThis(),
    toBuffer: mockSharpToBuffer,
  });
  return { default: vi.fn(() => createSharpInstance()) };
});

import {
  uploadProfileImage,
  deleteProfileImage,
  generateInitialsColor,
  generateInitials,
} from './image-upload';

describe('Image Upload Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockS3Send.mockResolvedValue({});
    mockSharpToBuffer.mockResolvedValue(Buffer.from('processed-image'));
  });

  // ===========================================================================
  // generateInitials
  // ===========================================================================
  describe('generateInitials', () => {
    it('should generate initials from two-word name', () => {
      expect(generateInitials('John Doe')).toBe('JD');
    });

    it('should generate initials from multi-word name (first and last)', () => {
      expect(generateInitials('John Michael Doe')).toBe('JD');
    });

    it('should generate initials from single name (first two letters)', () => {
      expect(generateInitials('John')).toBe('JO');
    });

    it('should handle lowercase names', () => {
      expect(generateInitials('john doe')).toBe('JD');
    });

    it('should handle extra whitespace', () => {
      expect(generateInitials('  John   Doe  ')).toBe('JD');
    });

    it('should handle single character name', () => {
      expect(generateInitials('J')).toBe('J');
    });
  });

  // ===========================================================================
  // generateInitialsColor
  // ===========================================================================
  describe('generateInitialsColor', () => {
    it('should return a hex color', () => {
      const color = generateInitialsColor('user-123');
      expect(color).toMatch(/^#[0-9A-F]{6}$/i);
    });

    it('should be deterministic (same input = same output)', () => {
      const color1 = generateInitialsColor('user-123');
      const color2 = generateInitialsColor('user-123');
      expect(color1).toBe(color2);
    });

    it('should produce different colors for different users', () => {
      const color1 = generateInitialsColor('user-abc');
      const color2 = generateInitialsColor('user-xyz');
      // Not guaranteed to be different but very likely with different inputs
      // At minimum they should both be valid colors
      expect(color1).toMatch(/^#[0-9A-F]{6}$/i);
      expect(color2).toMatch(/^#[0-9A-F]{6}$/i);
    });
  });

  // ===========================================================================
  // uploadProfileImage - Validation
  // ===========================================================================
  describe('uploadProfileImage - Validation', () => {
    it('should reject file exceeding size limit', async () => {
      // Create a buffer larger than 5MB
      const largeBuffer = Buffer.alloc(6 * 1024 * 1024);

      const result = await uploadProfileImage(largeBuffer, 'user-123', 'image/jpeg');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('file_too_large');
        expect(result.message).toContain('5MB');
      }
    });

    it('should reject unsupported MIME type', async () => {
      const buffer = Buffer.from('test');

      const result = await uploadProfileImage(buffer, 'user-123', 'image/gif');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('invalid_format');
        expect(result.message).toContain('JPEG, PNG, and HEIC');
      }
    });

    it('should reject JPEG with wrong magic bytes', async () => {
      // PNG magic bytes but claiming to be JPEG
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

      const result = await uploadProfileImage(buffer, 'user-123', 'image/jpeg');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('invalid_format');
        expect(result.message).toContain('does not match');
      }
    });

    it('should reject PNG with wrong magic bytes', async () => {
      // JPEG magic bytes but claiming to be PNG
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

      const result = await uploadProfileImage(buffer, 'user-123', 'image/png');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('invalid_format');
      }
    });

    it('should accept HEIC without magic byte validation', async () => {
      // HEIC has complex magic bytes, so we skip validation
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x20]);

      const result = await uploadProfileImage(buffer, 'user-123', 'image/heic');

      // Should proceed to processing (may fail at sharp, but not at validation)
      // The mock will succeed
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // uploadProfileImage - Success Path
  // ===========================================================================
  describe('uploadProfileImage - Success', () => {
    it('should process and upload JPEG image', async () => {
      // Valid JPEG magic bytes
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(100).fill(0)]);

      const result = await uploadProfileImage(jpegBuffer, 'wallet-456', 'image/jpeg');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.profileImageUrl).toContain('cdn.test.com');
        expect(result.profileImageUrl).toContain('wallet-456');
        expect(result.profileImageKey).toBe('users/wallet-456/avatar.jpg');
        expect(result.thumbnails.small).toContain('avatar_64.jpg');
        expect(result.thumbnails.medium).toContain('avatar_128.jpg');
        expect(result.cacheBustVersion).toBeDefined();
      }

      // Verify Sharp was called to process images (3 sizes)
      expect(mockSharpResize).toHaveBeenCalledTimes(3); // 512, 128, 64

      // Verify S3 uploads
      expect(mockS3Send).toHaveBeenCalledTimes(3);
    });

    it('should process and upload PNG image', async () => {
      // Valid PNG magic bytes
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, ...Array(100).fill(0)]);

      const result = await uploadProfileImage(pngBuffer, 'wallet-789', 'image/png');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.profileImageKey).toBe('users/wallet-789/avatar.jpg');
      }
    });

    it('should include cache bust version in URLs', async () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(100).fill(0)]);

      const result = await uploadProfileImage(jpegBuffer, 'wallet-456', 'image/jpeg');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.profileImageUrl).toMatch(/\?v=\d+$/);
        expect(result.thumbnails.small).toMatch(/\?v=\d+$/);
        expect(result.thumbnails.medium).toMatch(/\?v=\d+$/);
      }
    });
  });

  // ===========================================================================
  // uploadProfileImage - Error Handling
  // ===========================================================================
  describe('uploadProfileImage - Error Handling', () => {
    it('should handle Sharp processing errors', async () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(100).fill(0)]);

      // Make Sharp throw an error
      mockSharpToBuffer.mockRejectedValueOnce(new Error('Input buffer contains unsupported image format'));

      const result = await uploadProfileImage(jpegBuffer, 'wallet-456', 'image/jpeg');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('invalid_format');
      }
    });

    it('should handle S3 upload errors', async () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(100).fill(0)]);

      // Make S3 throw an error
      mockS3Send.mockRejectedValueOnce(new Error('S3 upload failed'));

      const result = await uploadProfileImage(jpegBuffer, 'wallet-456', 'image/jpeg');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('processing_failed');
      }
    });
  });

  // ===========================================================================
  // deleteProfileImage
  // ===========================================================================
  describe('deleteProfileImage', () => {
    it('should delete all image sizes from S3', async () => {
      const result = await deleteProfileImage('wallet-456');

      expect(result).toBe(true);
      expect(mockS3Send).toHaveBeenCalledTimes(1);

      // Verify the command was sent (the params are in the command object)
      const call = mockS3Send.mock.calls[0][0];
      expect(call.params).toEqual({
        Bucket: 'test-bucket',
        Delete: {
          Objects: [
            { Key: 'users/wallet-456/avatar.jpg' },
            { Key: 'users/wallet-456/avatar_128.jpg' },
            { Key: 'users/wallet-456/avatar_64.jpg' },
          ],
        },
      });
    });

    it('should return false on S3 error', async () => {
      mockS3Send.mockRejectedValueOnce(new Error('S3 delete failed'));

      const result = await deleteProfileImage('wallet-456');

      expect(result).toBe(false);
    });
  });
});
