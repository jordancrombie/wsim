// Profile API Routes Tests
// Tests for /api/mobile/profile/* and /api/internal/profile endpoints

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createMockPrismaClient, MockPrismaClient } from '../test/mocks/mockPrisma';

// Mock env before importing the router
vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3003',
    MOBILE_JWT_SECRET: 'test-mobile-jwt-secret-32-chars-long',
    INTERNAL_API_SECRET: 'test-internal-api-secret',
    PROFILE_IMAGE_MAX_SIZE_MB: 5,
    PROFILE_IMAGE_UPLOAD_RATE_LIMIT: 10,
    CDN_BASE_URL: 'https://cdn.banksim.ca',
  },
}));

// Mock the database module BEFORE importing the router
vi.mock('../config/database', () => ({
  prisma: null as any, // Will be set in beforeEach
}));

// Mock the image-upload service
vi.mock('../services/image-upload', () => ({
  uploadProfileImage: vi.fn(),
  deleteProfileImage: vi.fn(),
  generateInitialsColor: vi.fn((userId: string) => '#E53935'),
  generateInitials: vi.fn((displayName: string) => {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length === 1) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }),
}));

let mockPrismaInstance: MockPrismaClient;

// Get the mocked modules
import * as database from '../config/database';
import { env } from '../config/env';
import * as imageUpload from '../services/image-upload';
import profileRouter, { internalProfileRouter } from './profile';

// Helper to create Express app with profile routes
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mobile/profile', profileRouter);
  app.use('/api/internal/profile', internalProfileRouter);
  return app;
}

// Helper to generate valid access token
function generateTestAccessToken(userId: string, deviceId: string): string {
  return jwt.sign(
    { sub: userId, deviceId, type: 'access' },
    env.MOBILE_JWT_SECRET,
    { expiresIn: '1h', issuer: env.APP_URL, audience: 'mwsim' }
  );
}

// Test user data
const testUser = {
  id: 'user-123',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  displayName: null as string | null,
  profileImageUrl: null as string | null,
  profileImageKey: null as string | null,
  initialsColor: null as string | null,
  walletId: 'wallet-456',
};

const testUserWithImage = {
  ...testUser,
  displayName: 'Johnny D',
  profileImageUrl: 'https://cdn.banksim.ca/users/wallet-456/avatar.jpg?v=123',
  profileImageKey: 'users/wallet-456/avatar.jpg',
  initialsColor: '#E53935',
};

describe('Profile API Routes', () => {
  beforeEach(() => {
    mockPrismaInstance = createMockPrismaClient();
    (database as any).prisma = mockPrismaInstance;
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockPrismaInstance._clear();
  });

  // ===========================================================================
  // GET /api/mobile/profile
  // ===========================================================================
  describe('GET /api/mobile/profile', () => {
    it('should return 401 without authorization header', async () => {
      const app = createApp();
      const response = await request(app).get('/api/mobile/profile');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });

    it('should return 401 with invalid token', async () => {
      const app = createApp();
      const response = await request(app)
        .get('/api/mobile/profile')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });

    it('should return 404 if user not found', async () => {
      const app = createApp();
      const token = generateTestAccessToken('nonexistent-user', 'device-1');

      mockPrismaInstance.walletUser.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/mobile/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });

    it('should return user profile with default displayName', async () => {
      const app = createApp();
      const token = generateTestAccessToken(testUser.id, 'device-1');

      mockPrismaInstance.walletUser.findUnique.mockResolvedValue(testUser);

      const response = await request(app)
        .get('/api/mobile/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.profile).toMatchObject({
        userId: testUser.id,
        walletId: testUser.walletId,
        email: testUser.email,
        displayName: 'John Doe', // Generated from firstName + lastName
        initials: 'JD',
        initialsColor: '#E53935',
        profileImageUrl: null,
        thumbnails: null,
      });
    });

    it('should return user profile with custom displayName and image', async () => {
      const app = createApp();
      const token = generateTestAccessToken(testUserWithImage.id, 'device-1');

      mockPrismaInstance.walletUser.findUnique.mockResolvedValue(testUserWithImage);

      const response = await request(app)
        .get('/api/mobile/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.profile.displayName).toBe('Johnny D');
      expect(response.body.profile.profileImageUrl).toBe(testUserWithImage.profileImageUrl);
      expect(response.body.profile.thumbnails).not.toBeNull();
    });
  });

  // ===========================================================================
  // PUT /api/mobile/profile
  // ===========================================================================
  describe('PUT /api/mobile/profile', () => {
    it('should return 401 without authorization', async () => {
      const app = createApp();
      const response = await request(app)
        .put('/api/mobile/profile')
        .send({ displayName: 'New Name' });

      expect(response.status).toBe(401);
    });

    it('should update displayName', async () => {
      const app = createApp();
      const token = generateTestAccessToken(testUser.id, 'device-1');

      const updatedUser = { ...testUser, displayName: 'Johnny Boy' };
      mockPrismaInstance.walletUser.update.mockResolvedValue(updatedUser);

      const response = await request(app)
        .put('/api/mobile/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'Johnny Boy' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockPrismaInstance.walletUser.update).toHaveBeenCalledWith({
        where: { id: testUser.id },
        data: { displayName: 'Johnny Boy' },
        select: expect.any(Object),
      });
    });

    it('should reject displayName over 50 characters', async () => {
      const app = createApp();
      const token = generateTestAccessToken(testUser.id, 'device-1');

      const response = await request(app)
        .put('/api/mobile/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'A'.repeat(51) });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('display_name_too_long');
    });

    it('should reject empty displayName', async () => {
      const app = createApp();
      const token = generateTestAccessToken(testUser.id, 'device-1');

      const response = await request(app)
        .put('/api/mobile/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_request');
    });
  });

  // ===========================================================================
  // POST /api/mobile/profile/image
  // ===========================================================================
  describe('POST /api/mobile/profile/image', () => {
    it('should return 401 without authorization', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/mobile/profile/image')
        .attach('image', Buffer.from('fake-image'), 'test.jpg');

      expect(response.status).toBe(401);
    });

    it('should return 400 if no image provided', async () => {
      const app = createApp();
      const token = generateTestAccessToken(testUser.id, 'device-1');

      mockPrismaInstance.walletUser.findUnique.mockResolvedValue(testUser);

      const response = await request(app)
        .post('/api/mobile/profile/image')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_request');
    });

    it('should upload image successfully', async () => {
      const app = createApp();
      const token = generateTestAccessToken(testUser.id, 'device-1');

      mockPrismaInstance.walletUser.findUnique.mockResolvedValue(testUser);
      mockPrismaInstance.walletUser.update.mockResolvedValue(testUserWithImage);

      vi.mocked(imageUpload.uploadProfileImage).mockResolvedValue({
        success: true,
        profileImageUrl: 'https://cdn.banksim.ca/users/wallet-456/avatar.jpg?v=123',
        profileImageKey: 'users/wallet-456/avatar.jpg',
        thumbnails: {
          small: 'https://cdn.banksim.ca/users/wallet-456/avatar_64.jpg?v=123',
          medium: 'https://cdn.banksim.ca/users/wallet-456/avatar_128.jpg?v=123',
        },
        cacheBustVersion: '123',
      });

      // Create a minimal valid JPEG (just magic bytes for test)
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

      const response = await request(app)
        .post('/api/mobile/profile/image')
        .set('Authorization', `Bearer ${token}`)
        .attach('image', jpegBuffer, { filename: 'test.jpg', contentType: 'image/jpeg' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.profileImageUrl).toContain('cdn.banksim.ca');
    });

    it('should return error when upload fails', async () => {
      const app = createApp();
      const token = generateTestAccessToken(testUser.id, 'device-1');

      mockPrismaInstance.walletUser.findUnique.mockResolvedValue(testUser);

      vi.mocked(imageUpload.uploadProfileImage).mockResolvedValue({
        success: false,
        error: 'invalid_format',
        message: 'Only JPEG, PNG, and HEIC images are supported',
      });

      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

      const response = await request(app)
        .post('/api/mobile/profile/image')
        .set('Authorization', `Bearer ${token}`)
        .attach('image', jpegBuffer, { filename: 'test.jpg', contentType: 'image/jpeg' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_format');
    });
  });

  // ===========================================================================
  // DELETE /api/mobile/profile/image
  // ===========================================================================
  describe('DELETE /api/mobile/profile/image', () => {
    it('should return 401 without authorization', async () => {
      const app = createApp();
      const response = await request(app).delete('/api/mobile/profile/image');

      expect(response.status).toBe(401);
    });

    it('should return 400 if no image to delete', async () => {
      const app = createApp();
      const token = generateTestAccessToken(testUser.id, 'device-1');

      mockPrismaInstance.walletUser.findUnique.mockResolvedValue(testUser);

      const response = await request(app)
        .delete('/api/mobile/profile/image')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('no_image');
    });

    it('should delete image successfully', async () => {
      const app = createApp();
      const token = generateTestAccessToken(testUserWithImage.id, 'device-1');

      mockPrismaInstance.walletUser.findUnique.mockResolvedValue(testUserWithImage);
      mockPrismaInstance.walletUser.update.mockResolvedValue({
        ...testUserWithImage,
        profileImageUrl: null,
        profileImageKey: null,
      });

      vi.mocked(imageUpload.deleteProfileImage).mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/mobile/profile/image')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(imageUpload.deleteProfileImage).toHaveBeenCalledWith(testUserWithImage.walletId);
    });
  });

  // ===========================================================================
  // GET /api/internal/profile (TransferSim API)
  // ===========================================================================
  describe('GET /api/internal/profile', () => {
    it('should return 401 without X-Internal-Api-Key header', async () => {
      const app = createApp();
      const response = await request(app)
        .get('/api/internal/profile')
        .query({ bsimUserId: 'user-ref', bsimId: 'test-bank' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('X-Internal-Api-Key');
    });

    it('should return 401 with invalid API key', async () => {
      const app = createApp();
      const response = await request(app)
        .get('/api/internal/profile')
        .set('X-Internal-Api-Key', 'wrong-key')
        .query({ bsimUserId: 'user-ref', bsimId: 'test-bank' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid internal API key');
    });

    it('should return 400 if bsimUserId missing', async () => {
      const app = createApp();
      const response = await request(app)
        .get('/api/internal/profile')
        .set('X-Internal-Api-Key', env.INTERNAL_API_SECRET)
        .query({ bsimId: 'test-bank' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_request');
    });

    it('should return 400 if bsimId missing', async () => {
      const app = createApp();
      const response = await request(app)
        .get('/api/internal/profile')
        .set('X-Internal-Api-Key', env.INTERNAL_API_SECRET)
        .query({ bsimUserId: 'user-ref' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_request');
    });

    it('should return 404 if enrollment not found', async () => {
      const app = createApp();
      mockPrismaInstance.bsimEnrollment.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/internal/profile')
        .set('X-Internal-Api-Key', env.INTERNAL_API_SECRET)
        .query({ bsimUserId: 'nonexistent-user', bsimId: 'test-bank' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });

    it('should return profile for valid enrollment', async () => {
      const app = createApp();

      const enrollment = {
        id: 'enrollment-123',
        userId: testUserWithImage.id,
        fiUserRef: 'fi-user-ref-123',
        bsimId: 'test-bank',
        user: {
          id: testUserWithImage.id,
          displayName: testUserWithImage.displayName,
          firstName: testUserWithImage.firstName,
          lastName: testUserWithImage.lastName,
          profileImageUrl: testUserWithImage.profileImageUrl,
          initialsColor: testUserWithImage.initialsColor,
        },
      };

      mockPrismaInstance.bsimEnrollment.findFirst.mockResolvedValue(enrollment);

      const response = await request(app)
        .get('/api/internal/profile')
        .set('X-Internal-Api-Key', env.INTERNAL_API_SECRET)
        .query({ bsimUserId: 'fi-user-ref-123', bsimId: 'test-bank' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.profile).toMatchObject({
        displayName: 'Johnny D',
        profileImageUrl: testUserWithImage.profileImageUrl,
        initials: 'JD',
        initialsColor: '#E53935',
      });
      expect(response.body.profile.thumbnails).not.toBeNull();
    });

    it('should return profile without image', async () => {
      const app = createApp();

      const enrollment = {
        id: 'enrollment-123',
        userId: testUser.id,
        fiUserRef: 'fi-user-ref-123',
        bsimId: 'test-bank',
        user: {
          id: testUser.id,
          displayName: null,
          firstName: 'John',
          lastName: 'Doe',
          profileImageUrl: null,
          initialsColor: null,
        },
      };

      mockPrismaInstance.bsimEnrollment.findFirst.mockResolvedValue(enrollment);

      const response = await request(app)
        .get('/api/internal/profile')
        .set('X-Internal-Api-Key', env.INTERNAL_API_SECRET)
        .query({ bsimUserId: 'fi-user-ref-123', bsimId: 'test-bank' });

      expect(response.status).toBe(200);
      expect(response.body.profile.displayName).toBe('John Doe');
      expect(response.body.profile.profileImageUrl).toBeNull();
      expect(response.body.profile.thumbnails).toBeNull();
    });
  });
});
